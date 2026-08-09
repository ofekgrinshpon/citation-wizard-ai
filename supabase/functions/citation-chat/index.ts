import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Canonical database-name mapping (Rule 19.1 + extended sources) ──
// Maps a source URL host → canonical Hebrew database name. Used to override
// free-form values like "המאגר של בית המשפט העליון" that Perplexity returns.
const DB_BY_HOST: Array<[RegExp, string]> = [
  [/(^|\.)lite\.takdin\.co\.il$/i, "תקדין"],
  [/(^|\.)takdin\.co\.il$/i, "תקדין"],
  [/(^|\.)supremedecisions\.court\.gov\.il$/i, "אר\u05F4ש"],
  [/(^|\.)nevo\.co\.il$/i, "נבו"],
  [/(^|\.)psakdin\.co\.il$/i, "פסקדין"],
];
const ALLOWED_DB_NAMES = new Set([
  "נבו",
  "פדאור",
  "דינים",
  "תקדין",
  "אר\u05F4ש",
  "פסקדין",
]);
function normalizeDatabaseName(urls: unknown, fallback: unknown): string {
  const list = Array.isArray(urls) ? urls : urls ? [urls] : [];
  for (const u of list) {
    if (typeof u !== "string" || !u) continue;
    let host = "";
    try {
      host = new URL(u).hostname.toLowerCase();
    } catch {
      continue;
    }
    for (const [re, name] of DB_BY_HOST) {
      if (re.test(host)) return name;
    }
  }
  if (typeof fallback === "string" && fallback.trim()) {
    const f = fallback.trim();
    for (const allowed of ALLOWED_DB_NAMES) {
      if (f.includes(allowed)) return allowed;
    }
  }
  return "";
}
import { CASE_DOCKET_RE, CASE_TYPE_PREFIX_RE, CASE_TYPE_PREFIXES } from "../_shared/caseTypePrefixes.ts";
import {
  TRUSTED_LEGAL,
  TRUSTED_PUB,
  TRUSTED_OLD_SUPREME_MIRRORS,
  countTrustedCitations,
  isTrustedHost,
  untrustedHosts,
  extractDocket,
  urlContainsDocket,
  urlContainsDocketVia,
  textContainsDocket,
  anyUrlContainsDocket,
  anyUrlContainsDocketVia,
  type DocketAnchorVia,
} from "../_shared/trustedHosts.ts";
import { normalizeHebrewNumberRanges } from "../_shared/hebrewNumberRange.ts";
import { normalizeEditorPlacement } from "../_shared/articleCitationValidator.ts";

// ── Tier-2 open-web fallback (flag-gated) ──────────────────────────────────
// Tier-1 = existing call with `search_domain_filter` (high-authority legal
// sources). Tier-2 = single retry with the SAME prompt but no domain filter,
// then post-hoc trust gate over TRUSTED_LEGAL ∪ TRUSTED_PUB.
//
// Fires only when Tier-1 returns zero trusted citations. Off by default;
// flip `CITATION_CHAT_OPENWEB_FALLBACK=on` to enable.
const OPENWEB_FALLBACK_ON =
  ["on", "true", "1", "enabled"].includes(
    (Deno.env.get("CITATION_CHAT_OPENWEB_FALLBACK") || "").trim().toLowerCase(),
  );

interface PplxRunResult {
  resp: Response | null;        // last response (Tier-2 if it fired & helped, else Tier-1)
  tier: "tier1" | "tier2_openweb_fallback";
  tier1_trusted: number;
  tier2_fired: boolean;
  tier2_trusted: number;
  tier2_dropped_hosts: string[];
  docket_anchor_ok: boolean | null; // null = not applicable (no docket passed)
  docket_anchor_via: DocketAnchorVia; // "none" when not applicable or no match
}

/**
 * Run a Perplexity chat-completions call with optional Tier-2 open-web
 * fallback. `tier1Body` must include the existing `search_domain_filter`.
 * The caller still parses the returned Response exactly as before.
 *
 * Tier-2 keeps the same model/temperature/messages/max_tokens — only the
 * `search_domain_filter` is stripped.
 *
 * If `opts.dockedAnchor` is provided, Tier-2 is additionally required to
 * yield ≥1 trusted URL whose path contains the exact docket. This kills
 * adjacent-case contamination (e.g. neighboring docket 5819/24 hijacking a
 * search for 4769/24).
 */
async function perplexityWithFallback(
  apiKey: string,
  tier1Body: Record<string, unknown>,
  logTag: string,
  opts?: { docketAnchor?: { num: string; year: string }; forceOpenWebFallback?: boolean },
): Promise<PplxRunResult> {
  const result: PplxRunResult = {
    resp: null,
    tier: "tier1",
    tier1_trusted: 0,
    tier2_fired: false,
    tier2_trusted: 0,
    tier2_dropped_hosts: [],
    docket_anchor_ok: opts?.docketAnchor ? false : null,
    docket_anchor_via: "none",
  };

  const t1 = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(tier1Body),
  });
  result.resp = t1;

  const fallbackEnabled = OPENWEB_FALLBACK_ON || opts?.forceOpenWebFallback === true;
  if (!fallbackEnabled || !t1.ok) {
    if (fallbackEnabled) {
      console.log(`[pplx-fallback:${logTag}] tier1 not ok (${t1.status}); skipping fallback`);
    }
    return result;
  }

  // Peek at citations without consuming the caller's stream.
  let t1Json: Record<string, unknown> | null = null;
  try {
    const cloned = t1.clone();
    t1Json = await cloned.json();
  } catch {
    return result;
  }
  const t1Cit = (t1Json?.citations as unknown) ?? [];
  result.tier1_trusted = countTrustedCitations(t1Cit, TRUSTED_LEGAL);

  // Tier-1 docket-anchor check. If a docket was provided and Tier-1 has
  // trusted citations but NONE anchor the docket, escalate to Tier-2 — the
  // trusted hits are about other cases (adjacent-docket contamination).
  let tier1DocketAnchored = true;
  if (opts?.docketAnchor) {
    const t1TrustedUrls = Array.isArray(t1Cit)
      ? (t1Cit as unknown[]).filter((u) =>
          typeof u === "string" &&
          TRUSTED_LEGAL.some((d) => {
            try { const h = new URL(u).hostname.toLowerCase(); return h === d || h.endsWith("." + d); } catch { return false; }
          }))
      : [];
    tier1DocketAnchored = anyUrlContainsDocketVia(t1TrustedUrls, opts.docketAnchor) !== "none";
  }

  if (result.tier1_trusted > 0 && tier1DocketAnchored) {
    console.log(
      `[pplx-fallback:${logTag}] tier1_trusted=${result.tier1_trusted} tier1_docket_anchored=${tier1DocketAnchored} → no fallback`,
    );
    return result;
  }
  if (result.tier1_trusted > 0 && !tier1DocketAnchored) {
    console.log(
      `[pplx-fallback:${logTag}] tier1_trusted=${result.tier1_trusted} but NO trusted url anchors docket ${opts!.docketAnchor!.num}/${opts!.docketAnchor!.year} → firing tier2`,
    );
  }

  // Tier-2: same body without `search_domain_filter`.
  const { search_domain_filter: _ignored, ...t2Body } = tier1Body as Record<string, unknown>;
  result.tier2_fired = true;
  if (result.tier1_trusted === 0) {
    console.log(`[pplx-fallback:${logTag}] tier1 returned 0 trusted citations → firing tier2`);
  }
  const t2 = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(t2Body),
  });
  if (!t2.ok) {
    console.log(`[pplx-fallback:${logTag}] tier2 http ${t2.status} → keeping tier1`);
    return result;
  }
  let t2Json: Record<string, unknown> | null = null;
  try {
    const cloned = t2.clone();
    t2Json = await cloned.json();
  } catch {
    return result;
  }
  const t2Cit = (t2Json?.citations as unknown) ?? [];
  const gate = [...TRUSTED_LEGAL, ...TRUSTED_PUB];
  result.tier2_trusted = countTrustedCitations(t2Cit, gate);
  result.tier2_dropped_hosts = untrustedHosts(t2Cit, gate);

  // Docket-anchor gate: ≥1 TRUSTED url must contain the input docket.
  if (opts?.docketAnchor) {
    const trustedCits = Array.isArray(t2Cit)
      ? (t2Cit as unknown[]).filter((u) =>
          typeof u === "string" &&
          gate.some((d) => {
            try { const h = new URL(u).hostname.toLowerCase(); return h === d || h.endsWith("." + d); } catch { return false; }
          }))
      : [];
    const via = anyUrlContainsDocketVia(trustedCits, opts.docketAnchor!);
    result.docket_anchor_via = via;
    result.docket_anchor_ok = via !== "none";
  }

  console.log(
    `[pplx-fallback:${logTag}] tier2_trusted=${result.tier2_trusted} dropped=${
      JSON.stringify(result.tier2_dropped_hosts)
    } docket_anchor_ok=${result.docket_anchor_ok} docket_anchor_via=${result.docket_anchor_via}`,
  );

  // Accept Tier-2 only if trusted AND (no docket required OR docket-anchored).
  const anchorOk = result.docket_anchor_ok !== false; // null or true both ok
  if (result.tier2_trusted > 0 && anchorOk) {
    result.resp = t2;
    result.tier = "tier2_openweb_fallback";
  } else if (result.tier2_trusted > 0 && !anchorOk) {
    console.log(`[pplx-fallback:${logTag}] tier2 discarded — no trusted URL contains docket ${opts!.docketAnchor!.num}/${opts!.docketAnchor!.year}`);
  }
  return result;
}



// ── פ"ד volume → plausible decision-year window (Rule 18) ──
// Add entries opportunistically; unknown volumes skip the check. Ranges are
// inclusive and intentionally generous (decision → publication can lag ~2y).
const PADI_VOLUME_YEAR_RANGES: Record<string, [number, number]> = {
  "נב": [1997, 1999],
  "נג": [1998, 2000],
  "נד": [1999, 2001],
  "נה": [2000, 2002],
  "נו": [2001, 2003],
  "נז": [2002, 2004],
  "נח": [2003, 2005],
  "נט": [2004, 2006],
  "ס": [2005, 2007],
  "סא": [2006, 2008],
  "סב": [2007, 2009],
  "סג": [2008, 2010],
  "סד": [2010, 2012],
  "סה": [2011, 2013],
};

// ── Focused decision-date verification for published Supreme Court cases ──
// Perplexity's first-pass `date`/`year` for פ"ד citations is often the
// volume's print year (or fabricated). This re-asks specifically for the
// decision date, anchored to the verified volume/part/page.
async function verifyDecisionDate(
  apiKey: string,
  caseType: string,
  caseNumber: string,
  padiVolume: string,
  padiPart: string,
  padiPage: string,
): Promise<{ date?: string; year?: string } | null> {
  try {
    const fullRef = `${caseType} ${caseNumber}`;
    const part = padiPart ? `(${padiPart})` : "";
    const padiRef = `פ"ד ${padiVolume}${part} ${padiPage || ""}`.trim();
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar-pro",
        search_domain_filter: ["nevo.co.il", "supreme.court.gov.il", "court.gov.il", "psakdin.co.il", "takdin.co.il", "lite.takdin.co.il"],
        messages: [
          {
            role: "system",
            content: `אתה עוזר מחקר משפטי. החזר JSON בלבד: {"date":"DD.MM.YYYY","year":"YYYY","confidence":"high/low"}.\nהתאריך הנדרש הוא תאריך מתן פסק הדין על ידי בית המשפט — לא שנת הוצאת כרך פ"ד.\nאם לא מצאת אישור מפורש לתאריך מתן פסק הדין, החזר {"date":"","year":"","confidence":"low"}.`,
          },
          {
            role: "user",
            content: `מהו התאריך המדויק שבו ניתן פסק הדין ${fullRef} שפורסם ב-${padiRef}? ציין יום.חודש.שנה ושנת מתן פסק הדין.`,
          },
        ],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || "";
    console.log(`[case-law] date-verify sources for ${fullRef}:`, JSON.stringify({
      citations: data.citations ?? null,
      search_results: data.search_results ?? null,
    }));
    console.log(`[case-law] date-verify raw content for ${fullRef}:`, content);
    const jm = content.match(/\{[\s\S]*\}/);
    if (!jm) return null;
    const parsed = JSON.parse(
      jm[0].replace(/([\u0590-\u05FF])"([\u0590-\u05FF])/g, "$1\u05F4$2"),
    );
    const date = parsed.date ? String(parsed.date).trim() : "";
    let year = parsed.year ? String(parsed.year).trim() : "";
    if (!year && date) {
      const ym = date.match(/(\d{4})/);
      if (ym) year = ym[1];
    }
    if (!date && !year) return { date: "", year: "" };
    return { date, year };
  } catch (e) {
    console.error("[case-law] verifyDecisionDate error:", e);
    return null;
  }
}

// Applies decision-date verification + פ"ד volume plausibility guard to a
// parsed Perplexity case-law result. Mutates `parsed` in place.
async function reconcilePublishedDate(
  apiKey: string,
  caseType: string,
  caseNumber: string,
  parsed: Record<string, unknown>,
): Promise<void> {
  const isPub = !!parsed.isPublished;
  const vol = parsed.padi_volume ? String(parsed.padi_volume).trim() : "";
  if (!isPub || !vol) return;
  const part = parsed.padi_part ? String(parsed.padi_part).trim() : "";
  const page = parsed.padi_page ? String(parsed.padi_page).trim() : "";
  const origDate = parsed.date ? String(parsed.date) : "";
  const origYear = parsed.year ? String(parsed.year) : "";

  const v = await verifyDecisionDate(apiKey, caseType, caseNumber, vol, part, page);
  let action: "override" | "clear" | "keep" = "keep";
  if (v && (v.date || v.year)) {
    parsed.date = v.date || "";
    parsed.year = v.year || "";
    action = "override";
  } else if (v) {
    // Verification returned an empty result → clear hallucinated values
    parsed.date = "";
    parsed.year = "";
    parsed.confidence = "low";
    action = "clear";
  }
  console.log(
    `[case-law] date verification: original={date:${origDate},year:${origYear}} ` +
    `verified=${JSON.stringify(v)} action=${action}`,
  );

  // Volume plausibility guard
  const range = PADI_VOLUME_YEAR_RANGES[vol];
  const yNum = parseInt(String(parsed.year || ""), 10);
  if (range && !Number.isNaN(yNum) && (yNum < range[0] || yNum > range[1])) {
    console.log(
      `[case-law] volume plausibility: volume=${vol} year=${yNum} ` +
      `range=${range[0]}-${range[1]} → out of range, cleared`,
    );
    parsed.year = "";
    parsed.date = "";
    parsed.confidence = "low";
  }
}

// ── Old-docket retry (pre-electronic era, year < 1995) ──
// Triggered only when the standard Tier-1/Tier-2 case-number search returns
// a Perplexity payload whose results don't anchor the docket. Re-asks
// Perplexity with the docket forced into a quoted phrase, an explicit
// "old Supreme Court case" context, and an expanded trusted-host set that
// includes pre-electronic-era mirrors (versa.cardozo, he.wikipedia,
// padi.gov.il). Acceptance still requires that the docket appears literally
// in the URL/title/snippet of a trusted result.
async function retryOldSupremeDocket(
  apiKey: string,
  caseType: string,
  caseNum: string,
  yearStr: string,
): Promise<Record<string, unknown> | null> {
  const fullCaseRef = `${caseType} ${caseNum}`;
  const docket = extractDocket(fullCaseRef);
  if (!docket) return null;
  try {
    const query = `אנא מצא את פסק הדין הישראלי הישן ${fullCaseRef} (משנת ${yearStr}). חפש את הצירוף המדויק "${caseType} ${caseNum}" בכל מאגרי הפסיקה הישראליים ובמקורות אקדמיים, כולל ויקיפדיה העברית ומאגרי תרגום של בית המשפט העליון (כגון Versa של אוניברסיטת קרדוזו). ציין במדויק: 1) שמות הצדדים (שם משפחה בלבד לאנשים, שם מלא לתאגידים), 2) תאריך מתן פסק הדין (יום.חודש.שנה), 3) בית המשפט (בית המשפט העליון), 4) פרסום בפד"י: כרך, חלק ועמוד ראשון. אל תמציא נתונים — אם אינך בטוח, סמן שדה כריק. ענה בעברית בלבד.`;
    const body: Record<string, unknown> = {
      model: "sonar-pro",
      messages: [
        {
          role: "system",
          content: `אתה עוזר מחקר משפטי המתמחה בפסיקה ישראלית ישנה (לפני 1995). החזר JSON בלבד בפורמט:\n{"found":true/false,"party1":"שם צד א","party2":"שם צד ב","date":"DD.MM.YYYY","court":"בית המשפט","isPublished":true/false,"padi_volume":"כרך","padi_part":"חלק","padi_page":"עמוד","databaseName":"שם מאגר","year":"YYYY","confidence":"high/low"}\nרוב פסקי הדין של בית המשפט העליון מלפני 1995 פורסמו בפד"י — בדוק זאת היטב.`,
        },
        { role: "user", content: query },
      ],
    };
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.log(`[case-law:old-retry] http ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || "";
    console.log(`[case-law:old-retry] sources for ${fullCaseRef}:`, JSON.stringify({
      citations: data.citations ?? null,
      search_results: data.search_results ?? null,
    }));
    console.log(`[case-law:old-retry] raw content:`, content);

    // Anchor gate: ≥1 trusted (legal + pub + old-mirrors) URL/title/snippet
    // must contain the literal docket.
    const trustedSet = [...TRUSTED_LEGAL, ...TRUSTED_PUB, ...TRUSTED_OLD_SUPREME_MIRRORS];
    const searchResults: Array<Record<string, unknown>> = Array.isArray(data.search_results) ? data.search_results : [];
    const citations: string[] = Array.isArray(data.citations)
      ? (data.citations as unknown[]).filter((u): u is string => typeof u === "string")
      : [];
    const urlAnchored = citations.some((u) => isTrustedHost(u, trustedSet) && urlContainsDocket(u, docket));
    const snippetAnchored = searchResults.some((r) => {
      if (typeof r.url !== "string" || !isTrustedHost(r.url, trustedSet)) return false;
      return urlContainsDocket(r.url, docket)
        || textContainsDocket(r.title, docket)
        || textContainsDocket(r.snippet, docket);
    });
    if (!urlAnchored && !snippetAnchored) {
      console.log(`[case-law:old-retry] no trusted source anchors docket ${docket.num}/${docket.year} → discarding`);
      return null;
    }

    const jm = content.match(/\{[\s\S]*\}/);
    if (!jm) return null;
    const parsed = JSON.parse(jm[0]);
    if (!parsed?.found || !parsed.party1 || !parsed.party2) {
      console.log(`[case-law:old-retry] anchored but parsed missing parties → discarding`);
      return null;
    }
    console.log(`[case-law:old-retry] accepted: parties=${parsed.party1} / ${parsed.party2}`);
    return parsed;
  } catch (e) {
    console.error(`[case-law:old-retry] error:`, e);
    return null;
  }
}

// ── Bibliographic title/author anchoring (for article + book branches) ──
// Mirrors the docket-anchor gate used for caselaw. Prevents Perplexity from
// returning a hallucinated author when no actual source confirms the title.


const BIBLIO_TRUSTED_DOMAINS = [
  "nevo.co.il",
  "law.tau.ac.il",
  "law.huji.ac.il",
  "law.biu.ac.il",
  "tau.ac.il",
  "huji.ac.il",
  "biu.ac.il",
  "idc.ac.il",
  "runi.ac.il",
  "colman.ac.il",
  "ono.ac.il",
  "openu.ac.il",
  "books.google.com",
  "scholar.google.com",
  "jstor.org",
  "ssrn.com",
  "academia.edu",
  "researchgate.net",
  "he.wikipedia.org",
  "wikipedia.org",
  "takdin.co.il",
  "lite.takdin.co.il",
  "kotar.cet.ac.il",
  "magnespress.co.il",
  "hebrewbooks.org",
];

function normalizeHe(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, "") // niqqud
    .replace(/[״"׳'`.,:;!?(){}\[\]–—\-_*\/\\<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeUrlSafe(u: string): string {
  try { return decodeURIComponent(u); } catch { return u; }
}

// Quote-aware title extraction: prefers content inside Hebrew quotes if present
// (e.g. אזכור the article title inside `"..."`). Falls back to the full query.
function extractTitleCandidate(raw: string): string {
  const quoted = raw.match(/[״"]([^"״]{6,})[״"]/);
  if (quoted && quoted[1]) return quoted[1];
  return raw;
}

function hostnameOf(u: string): string {
  try { return new URL(u).hostname.toLowerCase(); } catch { return ""; }
}

function isTrustedBiblioHost(u: string): boolean {
  const h = hostnameOf(u);
  if (!h) return false;
  if (BIBLIO_TRUSTED_DOMAINS.some((d) => h === d || h.endsWith("." + d))) return true;
  // Treat any Israeli academic/government host as trusted-ish
  if (/\.ac\.il$/.test(h) || /\.gov\.il$/.test(h)) return true;
  return false;
}

function anchorTitleInSources(
  rawTitle: string,
  citations: unknown,
  searchResults: unknown,
  opts?: { authorHint?: string },
): {
  anchored: boolean;
  anchorUrls: string[];
  trustedAnchorUrls: string[];
  quality: "strong" | "weak" | "none";
  sample: string;
} {
  const title = extractTitleCandidate(rawTitle);
  const norm = normalizeHe(title);
  const tokens = norm.split(" ").filter((t) => t.length >= 2);
  if (tokens.length < 2) {
    return { anchored: false, anchorUrls: [], trustedAnchorUrls: [], quality: "none", sample: "" };
  }
  // Build strong (5+ contiguous tokens) and weak (3-4 token) windows separately
  const strongWindows: string[] = [];
  const weakWindows: string[] = [];
  for (const k of [Math.min(7, tokens.length), 6, 5]) {
    if (k < 5) continue;
    for (let i = 0; i + k <= tokens.length; i++) {
      const w = tokens.slice(i, i + k).join(" ");
      if (w.length >= 12) strongWindows.push(w);
    }
  }
  for (const k of [4, 3]) {
    if (tokens.length < k) continue;
    for (let i = 0; i + k <= tokens.length; i++) {
      const w = tokens.slice(i, i + k).join(" ");
      if (w.length >= 8) weakWindows.push(w);
    }
  }
  if (strongWindows.length === 0 && weakWindows.length === 0) weakWindows.push(tokens.join(" "));

  const authorNorm = normalizeHe(opts?.authorHint || "");
  const authorLast = authorNorm.split(" ").filter(Boolean).pop() || "";

  const urls: string[] = Array.isArray(citations)
    ? (citations as unknown[]).filter((u) => typeof u === "string") as string[]
    : [];
  const sr = Array.isArray(searchResults) ? (searchResults as Array<Record<string, unknown>>) : [];

  const strongHits = new Set<string>();
  const weakHits = new Set<string>();
  let sample = "";

  const consider = (url: string, blob: string, snippet?: string) => {
    const hasStrong = strongWindows.some((w) => blob.includes(w));
    if (hasStrong) {
      if (url) strongHits.add(url);
      if (!sample && snippet) sample = snippet;
      return;
    }
    const hasWeak = weakWindows.some((w) => blob.includes(w));
    if (hasWeak) {
      // Promote weak to strong if author last-name co-occurs
      const promoted = authorLast.length >= 2 && blob.includes(authorLast);
      if (promoted) {
        if (url) strongHits.add(url);
      } else if (url) {
        weakHits.add(url);
      }
      if (!sample && snippet) sample = snippet;
    }
  };

  for (const u of urls) {
    consider(u, normalizeHe(decodeUrlSafe(u)), u);
  }
  for (const r of sr) {
    const url = typeof r.url === "string" ? r.url : "";
    const blob = normalizeHe([
      typeof r.title === "string" ? r.title : "",
      typeof r.snippet === "string" ? r.snippet : "",
      decodeUrlSafe(url),
    ].join(" "));
    consider(url, blob, typeof r.snippet === "string" ? r.snippet : url);
  }

  const allHits = new Set<string>([...strongHits, ...weakHits]);
  const trusted = [...allHits].filter(isTrustedBiblioHost);
  const quality: "strong" | "weak" | "none" =
    strongHits.size > 0 ? "strong" : weakHits.size > 0 ? "weak" : "none";
  return {
    anchored: allHits.size > 0,
    anchorUrls: [...allHits],
    trustedAnchorUrls: trusted,
    quality,
    sample,
  };
}

function authorAppearsInSources(
  author: string,
  citations: unknown,
  searchResults: unknown,
): boolean {
  const a = normalizeHe(author);
  if (a.length < 2) return false;
  // Use last name (or full short author) for matching
  const parts = a.split(" ").filter(Boolean);
  const lastName = parts[parts.length - 1] || a;
  const probes = Array.from(new Set([a, lastName].filter((p) => p.length >= 2)));
  const urls: string[] = Array.isArray(citations)
    ? (citations as unknown[]).filter((u) => typeof u === "string") as string[]
    : [];
  const sr = Array.isArray(searchResults) ? (searchResults as Array<Record<string, unknown>>) : [];
  for (const u of urls) {
    const dec = normalizeHe(decodeUrlSafe(u));
    if (probes.some((p) => dec.includes(p))) return true;
  }
  for (const r of sr) {
    const blob = normalizeHe([
      typeof r.title === "string" ? r.title : "",
      typeof r.snippet === "string" ? r.snippet : "",
      decodeUrlSafe(typeof r.url === "string" ? r.url : ""),
    ].join(" "));
    if (probes.some((p) => blob.includes(p))) return true;
  }
  return false;
}

function authorsAgree(a: string, b: string): boolean {
  const na = normalizeHe(a);
  const nb = normalizeHe(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Last-name agreement (Israeli academic authors are usually single)
  const lastA = na.split(" ").pop() || "";
  const lastB = nb.split(" ").pop() || "";
  if (lastA && lastA === lastB) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

// Focused single-call cross-check: ask Perplexity strictly for the author of
// the given title, on the same trusted domain set. Used to confirm/reject the
// first call's author. Returns "" on failure or low confidence.
async function verifyBiblioAuthor(
  apiKey: string,
  kind: "article" | "book",
  title: string,
): Promise<{ author: string; citations: unknown; search_results: unknown } | null> {
  try {
    const kindHe = kind === "article" ? "המאמר" : "הספר";
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar-pro",
        // Open web — no domain filter. We rely on title-anchor + cross-check for safety.

        messages: [
          {
            role: "system",
            content: `אתה עוזר מחקר משפטי. החזר JSON בלבד: {"author":"שם המחבר/ים","confidence":"high"|"low"}.\nציין את המחבר רק אם מצאת מקור מפורש המייחס לו את ${kindHe} הזה. אם לא בטוח — החזר {"author":"","confidence":"low"}.`,
          },
          {
            role: "user",
            content: `מי המחבר של ${kindHe} "${extractTitleCandidate(title)}"? ציין שם פרטי + משפחה ללא תארים.`,
          },
        ],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || "";
    const jm = content.match(/\{[\s\S]*\}/);
    if (!jm) return null;
    const parsed = JSON.parse(
      jm[0].replace(/([\u0590-\u05FF])"([\u0590-\u05FF])/g, "$1\u05F4$2"),
    );
    const author = parsed.author ? String(parsed.author).trim() : "";
    const conf = parsed.confidence ? String(parsed.confidence).toLowerCase() : "low";
    if (!author || conf !== "high") return { author: "", citations: data.citations, search_results: data.search_results };
    return { author, citations: data.citations, search_results: data.search_results };
  } catch (e) {
    console.error(`[${kind}] verifyBiblioAuthor error:`, e);
    return null;
  }
}

// Cross-type biblio fallback: when the chosen branch (book/article) finds nothing,
// run a generic biblio search that lets Perplexity classify journal/article_in_book/book
// and build the matching hint. Reuses anchorTitleInSources for safety.
async function fallbackBiblioSearch(
  apiKey: string,
  query: string,
  preferKind: "book" | "article",
): Promise<{ hint: string; kind: string } | null> {
  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content: `אתה עוזר מחקר משפטי ישראלי. החזר JSON בלבד.
חפש את המקור הביבליוגרפי המתאים (ספר, מאמר בכתב עת, או מאמר שפורסם בתוך ספר/אסופה).
הפורמט:
{"found":true,"kind":"journal"|"article_in_book"|"book","author":"שם המחבר/ים","title":"שם המקור","journalName":"","bookTitle":"","bookAuthor":"","volume":"","notebook":"","firstPage":"","editor":"","year":0,"hebrewYear":""}
אם לא מצאת מקור מפורש — החזר {"found":false}. אל תנחש.
שמות ללא תארים (פרופ', ד"ר, עו"ד, שופט).`,
          },
          {
            role: "user",
            content: `מצא את המקור הביבליוגרפי הישראלי המתאים ל: "${query}". העדף סוג ${preferKind === "book" ? "ספר" : "מאמר"}, אך אם זה למעשה סוג אחר — ציין את הסוג הנכון.`,
          },
        ],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || "";
    const jm = text.match(/\{[\s\S]*\}/);
    if (!jm) return null;
    let p: any;
    try {
      p = JSON.parse(jm[0].replace(/([\u0590-\u05FF])"([\u0590-\u05FF])/g, "$1\u05F4$2"));
    } catch { return null; }
    if (!p?.found || !p?.title) return null;
    const anchor = anchorTitleInSources(p.title, data.citations, data.search_results, { authorHint: p.author || p.bookAuthor });
    if (!anchor.anchored) {
      console.log(`[fallback] title_anchored=false for "${query}"`);
      return null;
    }
    const kind: string = p.kind === "journal" || p.kind === "article_in_book" || p.kind === "book" ? p.kind : preferKind;
    let details = "";
    if (kind === "book") {
      details = `\n\n══ נתוני ספר שנמצאו בחיפוש (fallback) ══\n`;
      details += `מחבר: ${p.author || "[חסר — לא אומת מול מקור]"}\n`;
      details += `שם הספר: ${p.title}\n`;
      if (p.year) details += `שנה לועזית: ${p.year}\n`;
      if (p.hebrewYear && !p.year) details += `שנה עברית: ${p.hebrewYear}\n`;
      if (p.editor) details += `עורך: ${p.editor}\n`;
      details += `══ עיצוב אזכור לפי כלל 23. סמן [חסר:...] לשדות חסרים. אל תמציא. ══`;
    } else if (kind === "article_in_book") {
      details = `\n\n══ נתוני מאמר בספר שנמצאו בחיפוש (fallback) ══\n`;
      details += `מחבר המאמר: ${p.author || "[חסר — לא אומת מול מקור]"}\n`;
      details += `שם המאמר: ${p.title}\n`;
      if (p.bookAuthor) details += `מחבר הספר: ${p.bookAuthor}\n`;
      if (p.bookTitle) details += `שם הספר: ${p.bookTitle}\n`;
      if (p.editor) details += `עורך: ${p.editor}\n`;
      if (p.volume) details += `כרך: ${p.volume}\n`;
      if (p.firstPage) details += `עמוד ראשון: ${p.firstPage}\n`;
      if (p.year) details += `שנה: ${p.year}\n`;
      details += `══ עיצוב אזכור לפי כלל 24.11. סמן [חסר:...] לשדות חסרים. אל תמציא. ══`;
    } else {
      details = `\n\n══ נתוני מאמר שנמצאו בחיפוש (fallback) ══\n`;
      details += `מחבר: ${p.author || "[חסר — לא אומת מול מקור]"}\n`;
      details += `שם מאמר: ${p.title}\n`;
      if (p.journalName) details += `כתב עת: ${p.journalName}\n`;
      if (p.volume) details += `כרך: ${p.volume}\n`;
      if (p.notebook) details += `חוברת: ${p.notebook}\n`;
      if (p.firstPage) details += `עמוד ראשון: ${p.firstPage}\n`;
      if (p.year) details += `שנה: ${p.year}\n`;
      if (p.hebrewYear && !p.year) details += `שנה עברית: ${p.hebrewYear}\n`;
      details += `══ עיצוב אזכור לפי כלל 24. סמן [חסר:...] לשדות חסרים. אל תמציא. ══`;
    }
    return { hint: details, kind };
  } catch (e) {
    console.error("[fallback] biblio search error:", e);
    return null;
  }
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Citation input validator (mirror of src/lib/citationInputValidation.ts) ───
const HEBREW_LETTER_RE = /[\u0590-\u05FF]/;
const URL_RE_V = /https?:\/\/\S+/i;
// Accept the full BIU procedural-prefix dictionary plus the publication
// abbreviations (פ"ד, ס"ח, ק"ת, ה"ח, י"פ, כ"א) which aren't in the case-type list.
const LEGAL_ABBR_RE_V = new RegExp(
  `(?:${CASE_TYPE_PREFIX_RE.source}|פ["״]ד|ס["״]ח|ק["״]ת|ה["״]ח|י["״]פ|כ["״]א)`
);
const LEGAL_KEYWORD_RE_V =
  /(?:^|\s)(?:חוק|חוק[- ]?יסוד|פקודת|פקודה|תקנות|תקנה|צו|כללי|הוראות|סעיף|הצעת\s+חוק|אמנה|תקנון|פסק[- ]?דין|פס["״]ד|בית[- ]?המשפט|השופט[ת]?|הנשיא[ה]?|נגד|נ['׳])/;
const CASE_NUMBER_RE_V = /\b\d+\/\d{2,4}\b/;
const PARTY_SEP_RE_V = /\sנ['׳]\s|\sנגד\s/;
const SINGLE_CHAR_REPEAT_V = /^(.)\1{2,}$/;
const SHORT_PATTERN_REPEAT_V = /^(.{1,3})\1{2,}$/;
const LATIN_OR_DIGIT_ONLY_V = /^[a-z0-9\s.,!?-]+$/i;
const INVALID_INPUT_MSG_HE =
  "לא ניתן לעבד את הבקשה כי לא זוהה טקסט משפטי ברור לאזכור.";

function isValidCitationInputServer(raw: string): boolean {
  const text = (raw ?? "")
    .replace(/\[סיווג אוטומטי:.*?\]\n?/g, "")
    .replace(/\[בחירת תוצאה\]\s*/g, "")
    .replace(/══[\s\S]*?══+\s*/g, "")
    .trim();
  if (!text) return false;
  const compact = text.replace(/\s+/g, "");
  if (SINGLE_CHAR_REPEAT_V.test(compact)) return false;

  const hasMarker =
    LEGAL_ABBR_RE_V.test(text) ||
    LEGAL_KEYWORD_RE_V.test(text) ||
    CASE_NUMBER_RE_V.test(text) ||
    PARTY_SEP_RE_V.test(text) ||
    URL_RE_V.test(text);

  if (!hasMarker && SHORT_PATTERN_REPEAT_V.test(compact) && compact.length <= 12) return false;
  if (hasMarker) return true;
  if (compact.length < 6) return false;
  const hasHebrew = HEBREW_LETTER_RE.test(text);
  if (!hasHebrew && LATIN_OR_DIGIT_ONLY_V.test(text) && text.length < 18) return false;
  const tokens = text
    .split(/[\s,.;:!?()[\]{}"״׳'\\/|–—-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  const distinct = new Set(tokens.map((t) => t.toLowerCase()));
  return distinct.size >= 2;
}

function isRefusalResponseServer(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;
  const phrases = [
    "אינו יכול לפרש",
    "לא ניתן לפרש",
    "לא ניתן לעבד",
    "לא נמצא טקסט משפטי",
    "הקלט אינו ברור",
    "הבקשה אינה ברורה",
    "לא הצלחתי להבין",
    "אין מספיק מידע",
    "cannot interpret",
    "unable to interpret",
    "could not interpret",
  ];
  if (phrases.some((p) => t.toLowerCase().includes(p.toLowerCase()))) return true;
  const hasCitationMarker =
    /חוק|סעיף|פקודת|תקנות|ע["״]א|ת["״]א|בג["״]ץ|פ["״]ד|ס["״]ח|ק["״]ת|נ['׳]|https?:\/\//.test(t);
  const hasApology = /(אינו|לא ניתן|לא נמצא|מצטער|sorry|unable)/i.test(t);
  if (!hasCitationMarker && hasApology && t.length < 220) return true;
  return false;
}

const normalizeSearchableText = (text: string) =>
  text
    .toLowerCase()
    .replace(/\[סיווג אוטומטי:.*?\]\n?/g, "")
    .replace(/["״׳'.,()[\]{}:;!?/\\|–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenizeSearchTerms = (text: string) =>
  Array.from(new Set(normalizeSearchableText(text).split(" ").filter((word) => word.length >= 2)));

const scoreVerifiedMatch = (
  query: string,
  candidate: { source_name: string; full_citation: string },
) => {
  const normalizedQuery = normalizeSearchableText(query);
  const normalizedSourceName = normalizeSearchableText(candidate.source_name);
  const normalizedCandidate = normalizeSearchableText(`${candidate.source_name} ${candidate.full_citation}`);
  const words = tokenizeSearchTerms(query);

  const matchesExactName = normalizedSourceName === normalizedQuery;
  const matchesAllWords = words.length > 1 && words.every((word) => normalizedCandidate.includes(word));
  const matchesSingleWord = words.length === 1 && normalizedQuery.length >= 4 && normalizedSourceName.includes(normalizedQuery);

  if (!matchesExactName && !matchesAllWords && !matchesSingleWord) return -1;

  let score = 0;
  if (matchesExactName) score += 200;
  if (matchesAllWords) score += 100;
  if (matchesSingleWord) score += 40;
  if (normalizedCandidate.includes(normalizedQuery)) score += 20;
  score += words.reduce((total, word) => total + (normalizedCandidate.includes(word) ? 10 : 0), 0);

  return score;
};

const PUBLICATION_REF_REGEX = /(ס["״]ח|ק["״]ת)\s+(\d+)/g;
const NUMBER_ONLY_REGEX = /^\d+[.]?$/;
const LEGISLATION_RESPONSE_REGEX = /(?:^|\n)\s*(?:סעיף\s+[^\s]+\s+ל)?(?:חוק(?:[\s-]יסוד)?|חוק-יסוד|פקודת|פקודה|תקנות|צו|כללי|הוראות)/;
const PINPOINT_REGEX = /(?:סעיף|ס['׳']|פסקה|פס['׳']|עמ['׳']|לפסק\s+דינ[וה]\s+של|בעמ['׳']|שם,|פיסקה|השופט[ת]?\s|הנשיא[ה]?\s)/;

// ─── Citation Engine Data (mirrored from citationEngine.ts) ────
const CITATION_ENGINE_TEMPLATES: Record<string, { rule: string; template: string; required: string[] }> = {
  "חקיקה ראשית": {
    rule: "כלל 2",
    template: "{שם החוק}, {שנה עברית}–{שנה לועזית}, {קובץ} {עמוד ראשון}.",
    required: ["שם החוק המלא", "שנה עברית (כלל 2.4)", "שנה לועזית (כלל 2.4)", "קובץ פרסום – ס\"ח (כלל 2.5)", "עמוד ראשון (כלל 2.6)"],
  },
  "חוק יסוד": {
    rule: "כלל 4",
    template: "חוק-יסוד: {שם}, {קובץ} {עמוד}.",
    required: ["שם חוק היסוד (כלל 4.3 – עם מקף)", "ס\"ח (כלל 2.5)", "עמוד ראשון"],
  },
  "חקיקת משנה": {
    rule: "כלל 6",
    template: "{שם התקנות}, {שנה עברית}–{שנה לועזית}, {ק\"ת} {עמוד}.",
    required: ["שם התקנות", "שנה עברית ולועזית", "ק\"ת", "עמוד ראשון"],
  },
  "הצעת חוק": {
    rule: "כלל 8",
    template: 'הצעת חוק {שם}, {שנה עברית}-{שנה לועזית}, ה"ח {הכנסת/הממשלה/ריק} {מספר חוברת}.',
    required: ["שם הצעת החוק", "שנה עברית", "שנה לועזית", "מספר חוברת"],
    notes: 'אחרי ה"ח אפשר לכתוב "הכנסת" או "הממשלה" או להשמיט (ריק). סוג החוברת אינו חובה. אין צורך בעמוד ראשון.',
  },
  "הצעת חוק יסוד": {
    rule: "כלל 8",
    template: 'הצעת חוק-יסוד: {שם}, {שנה עברית}, ה"ח {הכנסת/הממשלה/ריק} {מספר חוברת}.',
    required: ["שם הצעת חוק היסוד", "שנה עברית (ללא שנה לועזית)", "מספר חוברת"],
    notes: 'בהצעות חוק יסוד מציינים שנה עברית בלבד. אחרי ה"ח אפשר "הכנסת" או "הממשלה" או להשמיט. אין צורך בעמוד ראשון.',
  },
  "פסיקה (דפוס)": {
    rule: "כלל 18",
    template: "{סוג הליך} {מספר} **{צד א'}** נ' **{צד ב'}**, {סדרה} {כרך}({חלק}) {עמוד} ({שנה}).",
    required: ["סוג הליך (כלל 18.2)", "מספר תיק (כלל 18.2)", "שני צדדים מודגשים (כלל 18.4)", "סדרה (כלל 18.6)", "כרך (כלל 18.6)", "עמוד ראשון (כלל 18.8)", "שנה (כלל 18.7)"],
  },
  "פסיקה (מאגר)": {
    rule: "כלל 19",
    template: "{סוג הליך} {מספר} **{צד א'}** נ' **{צד ב'}** ({מאגר} {תאריך}).",
    required: ["סוג הליך (כלל 18.2)", "מספר תיק", "שני צדדים מודגשים", "שם מאגר (כלל 19.1)", "תאריך מלא (כלל 19.1)"],
  },
  "ספר": {
    rule: "כלל 23",
    template: "{מחבר} **{שם הספר}** {כרך} {הפניה ספציפית} ({מהדורה}, {עורך}, {מתרגם}, {שנה}).",
    required: ["שם המחבר (כלל 23.2)", "שם הספר – מודגש (כלל 23.3)", "שנת פרסום (כלל 23.9)"],
    notes: 'כלל 23.2.1: שם פרטי + משפחה כמו במקור, קיצורים בגרש (לא נקודות). כלל 23.2.2: 2 מחברים = ו"ו; 3 = פסיקים + ו"ו; 4+ = אופציונלי ראשון + ואח\'. כלל 23.2.3: ללא תארים. כלל 23.2.4: מוסד כמחבר – שם הגוף בלבד. כלל 23.3: שם הספר מודגש. כלל 23.4: כרך תמיד, כמו בספר, ללא הדגשה, ללא גרש אחרי אות. כלל 23.5.2: עמוד ללא "בעמ\'". כלל 23.5.3: פרק/סעיף עם תווית; § רק אם מספור רצוף. כלל 23.5.4: ה"ש/טבלה = עמוד, פסיק, כינוי + מספר. כלל 23.6: מהדורה רק אם 2+. כלל 23.7: עורך/ת/ים/ות אחרי שמות. כלל 23.8: מתרגם/ת/ים/ות, ללא שפת מקור. כלל 23.9: עברית בלבד → עברית (עם ה\'). לועזית בלבד → לועזית. שתיהן → לועזית בלבד. כלל 1.9: פסיק בין מספרים/מילים עוקבים ללא הבחנה חזותית.',
  },
  "מאמר בכתב עת": {
    rule: "כלל 24",
    template: '{מחבר} "{שם מאמר}" **{כתב עת}** {כרך}{(חוברת)} {עמוד ראשון}[, הפניה ספציפית] ({שנה}).',
    required: ["שם המחבר (כלל 24.2, לפי 23.2)", "שם המאמר – מירכאות (כלל 24.3)", "שם כתב העת – מודגש (כלל 24.4)", "עמוד ראשון (כלל 24.7.1, למעט חריגי 24.7.2)", "שנה (כלל 24.9 – רק אם לא הופיעה ככרך)"],
    notes: 'כלל 24.2: שמות מחברים לפי 23.2 (שם פרטי + משפחה, ללא תארים, 2 = ו"ו, 3 = פסיקים + ו"ו, 4+ = ואח\'). כלל 24.3.1: שם מאמר במירכאות. 24.3.3: שם משני בנקודתיים (אלא אם מופרד אחרת). כלל 24.4: כתב עת מודגש. עיתון יומי עם חלק: **שם:חלק**. כלל 24.5: כרך לא מודגש, כמו במקור (אותיות או מספרים). כלל 24.6: חוברת בסוגריים ללא רווח אחרי הכרך – רק אם כל חוברת מעמוד 1 (למשל ה(2)). כלל 24.7.2: אין עמוד ראשון אם: מאמר יחיד בגיליון, כולם מעמוד 1, אין עמודים. כלל 24.8: הפניה ספציפית אחרי פסיק (עמוד, ה"ש, טבלה). כלל 24.9.1: שנה רק אם לא ככרך. 24.9.2: עברית בלבד → עברית (עם ה\'). לועזית בלבד → לועזית. שתיהן → לועזית. כלל 24.10: מקוון – כמו מודפס. כלל 24.12.1: "משפט, חברה ותרבות" לפני 2018 = מאמר בספר (24.11). כלל 24.12.2: "פרשת השבוע" – פרשה לפני השנה, ללא עמוד ראשון.',
  },
  "מאמר שפורסם בספר": {
    rule: "כלל 24.11",
    template: '{מחבר מאמר} "{שם מאמר}" {מחבר ספר} **{שם ספר}** {כרך} {עמוד תחילת}[, הפניה ספציפית] ([מהדורה] [עורך] [מתרגם] {שנה}).',
    required: ["שם מחבר המאמר (כלל 24.2)", "שם המאמר – מירכאות (כלל 24.3)", "שם הספר – מודגש (כלל 23.3)", "עמוד תחילת המאמר (כלל 24.7)", "שנה (כלל 23.9)"],
    notes: 'רכיבי המאמר לפי כללים 24.2, 24.3, 24.7, 24.8. רכיבי הספר לפי כללים 23.2–23.4, 23.6–23.9. אם למאמר ולספר אותו מחבר באותו סדר – אין לחזור על שמו לפני שם הספר.',
  },
  "מקור מרשתת": {
    rule: "כלל 34.2",
    template: '{מחבר} "{כותרת}" {סוג תוכן} **{שם האתר}** {הפניה ספציפית} ({תאריך}) {URL}.',
    required: ["כתובת URL מלאה כולל http:// (כלל 34.2.8)"],
    notes: 'כלל 34.2.1: נוסחה: [שם המחבר] "[שם העמוד או התוכן]" [סוג התוכן] [שם האתר] [הפניה ספציפית] ([תאריך]) [כתובת]. חלה על אתרים, עמודים, מדיה חברתית, מאמרים באתרי עיתונים. לא חלה על כתבי עת מקוונים (24.10) או תגובות (34.2.9). כלל 34.2.2: שם מחבר רק אם הופיע בעמוד. מדיה חברתית – שם משתמש בסוגריים (username@). שם בעברית ובשפות נוספות – די בעברית. כלל 34.2.3: כותרת רק אם הופיעה. עמוד ראשי – ללא כותרת. מדיה חברתית – כותרת אופציונלית. כלל 34.2.4: סוג תוכן רק אם אינו הסוג הבסיסי (שרשור בטוויטר, סטורי באינסטגרם). כלל 34.2.5: שם אתר מודגש. מדיה חברתית בעברית: טוויטר, פייסבוק, אינסטגרם, יוטיוב. כלל 34.2.6: הפניה ספציפית (כותרת, פסקה, זמן). כתובת מדויקת עדיפה. כלל 34.2.7: תאריך לועזי מלא ביותר שמופיע. אם אין – עברי. אם אין כלל – ללא. מדיה חברתית – אפשר שעה. כלל 34.2.8: כתובת URL מלאה כולל http://. אם ארוכה – אפשר לקצר. דוגמות: טובה צימוקי "פתרון לסחבת במערכת המשפט" **ynet** (21.12.2017) https://www.ynet.co.il/articles/0,7340,L-5060004,00.html. | "הסיוע המשפטי" **משרד המשפטים** (2020) https://www.justice.gov.il/Units/SiuaMishpaty/Pages/Default.aspx. | "הולדה בעוולה" **ויקיפדיה** (30.11.2019) http://tiny.cc/uczjsz. | orcarmi( or carmi@) **טוויטר** (2.11.2019, 7:38) https://twitter.com/orcarmi/status/1190503422144995328. | נציבות שוויון הזדמנויות בעבודה (nezivutshivyon@) **פייסבוק** (1.3.2020) https://www.facebook.com/nezivutshivyon/posts/3454910927859039. | נעמה כרמי **קרוא וכתוב** https://naama-carmi.com. | Birnhack( Michael Birnhack@) שרשור **טוויטר** (22.4.2020, 8:12) https://twitter.com/Birnhack/status/1252827512599572482. | משרד המשפטים (MishpatimGovIL@) "מונחים משפטיים בשפת הסימנים" **יוטיוב** (30.7.2019) https://youtu.be/Q-w3i6jS2jI. | "פרק 02 גלי גינת וארי פינס – בין רומן זדורוב לאלישע חייבטוב" **הפודקאסט המשפטי עם עו"ד ליעד ורצהיזר** (14.11.2019) http://tiny.cc/om26pz.',
  },
  "תגובה במרשתת": {
    rule: "כלל 34.2.9",
    template: '{שם מחבר התגובה} "{כותרת}" תגובה {פרטי תגובה} ל{פרטי המקור}.',
    required: ["כתובת URL (כלל 34.2.8)"],
    notes: 'כלל 34.2.9: נוסחה: [שם מחבר התגובה] "[כותרת]" תגובה [פרטי תגובה] ל[פרטי המקור]. על שם מחבר התגובה יחול כלל 34.2.2. כותרת התגובה רק אם מופיעה. פרטי התגובה: מספרה (אם ממוספרת) ותאריך (אחרי "מ-") אם מופיע. פרטי המקור לפי כללים 34.2.2–34.2.8. כתובת התגובה עדיפה על כתובת המקור. דוגמות: usabach( Uri@) תגובה לאגודה לזכויות האזרח (acrionline@) **אינסטגרם** (28.8.2018) https://www.instagram.com/p/BnBSOyygw1K. | קרן ילין-מור, תגובה מ-5.12.2013, 22:45 לנועם זמיר "האם רשאי בית המשפט של הערעור להיעזר בנט המשפט?" **הטרקלין** (5.12.2013) https://israelaw.wordpress.com/2013/12/05/net-hamishpat/. | רחובותית, תגובה 1 מ-5.1.2017, 11:37 ליותם טולוב "זאת לא השפה: חברי הכנסת מפגרים מאחור" **וואלה!** (26.12.2016) https://news.walla.co.il/item/3025997. | ניר, תגובה מ-24.12.2019 לאבישי גרינצייג "נאמני הבימה לביהמ"ש: \'ההצגה חייבת להימשך, תאטרון אינו עסק\'" **גלובס** (24.12.2019) https://www.spot.im/s/00c5OyyA5cAF.',
  },
  "מקור דתי": {
    rule: "כללים 28–30",
    template: "(רב-נוסחאות – ראה notes)",
    required: ["שם המקור/חיבור", "הפניה ספציפית"],
    notes: 'כלל 28.2 – תנ"ך: {שם ספר} {פרק באותיות ללא גרש} {פסוק בספרות}. ספר שמסתיים באות → פסיק לפני הפרק. פסוקים באותו פרק בפסיק; פרקים שונים בנקודה-פסיק. דוגמות: שמואל א, א 19. | בראשית ג 19; ח 3–7, 17. כלל 28.3 – משנה: משנה, {מסכת} {פרק}, {משנה}. דוגמה: משנה, בבא מציעא א, ד. כלל 28.4 – בבלי: בבלי, {מסכת} {דף}, {עמוד}. דוגמה: בבלי, ברכות ב, ע"א. כלל 28.5 – ירושלמי: ירושלמי, {מסכת} {פרק}, {הלכה}. דוגמה: ירושלמי, גיטין ד, א. כלל 28.6 – ספרות חז"ל/רבנית: {חיבור}, {הפניה} (מהדורת {שם} {עמוד}). דוגמות: מכילתא דרבי ישמעאל, שירה ד (מהדורת הורוביץ-רבין 129–132). | שמות רבה ד, ד (מהדורת שנאן 151). כלל 28.6.1: שם חיבור מלא; שו"ת בר"ת אם מקובל; חיבורים בשם זהה מזוהים לפי מחבר. דוגמות: שולחן ערוך, אורח חיים, סימן א, סעיף ג. | שו"ת הרשב"א, סימן א. | ספר הישר לר"ת, סימן קכה (מהדורת שלזינגר 92–93). כלל 28.6.2: הפניה לפי חלוקה מסורתית (ספר, פרק, הלכה, סימן, סעיף). פירושים – ד"ה. דוגמות: משנה תורה, נחלות, פרק י, הלכה ד. | רש"י, ברכות ב, ע"א, ד"ה "מאימתי". כלל 29 – ברית חדשה: כמו תנ"ך (28.2). דוגמה: הבשורה על פי יוחנן א 1. כלל 30 – קוראן: שלוש נוסחות: (1) הקוראן, סורת {שם} {פסוק}. (2) הקוראן, סורה {מספר באותיות} {פסוק}. (3) הקוראן, סורה {מספר בספרות}, {פסוק}. יש לבחור אחת ולנקוט עקבית. דוגמות: הקוראן, סורת חזון הנשים 8. | הקוראן, סורה ד 8. | הקוראן, סורה 4, 8.',
  },
  "כתבי אמנה": {
    rule: "כלל 9",
    template: '[הפניה ספציפית] [ל]{שם האמנה בעברית}, כ"א {מספר כרך}, {עמוד ראשון}, {עמוד ספציפי} ({פרטי חתימה}).',
    required: ["שם האמנה בעברית (כלל 9.1)", 'מספר כרך בכתבי אמנה – כ"א (כלל 9.1)', "עמוד ראשון (כלל 9.1)", "פרטי חתימה: נפתחה/נחתמה ב-{שנה} (כלל 9.1)"],
    notes: 'אמנה רב-צדדית: "נפתחה לחתימה ב-{שנה}" (ללא רווח בין הקו לשנה). אמנה דו-צדדית: "נחתמה ב-{שנה}". אם העמודים בכרך לא רציפים – מספר חוברת בסוגריים אחרי הכרך, למשל כ"א 51(1415). כלל 9.2: אפשר להוסיף מידע נוסף כגון שנת אשרור בסוגריים נפרדים בסוף.',
  },
  "תקנון": {
    rule: "כלל 13.1",
    template: "[הפניה ספציפית] ל{שם התקנון או קיצורו} ({תאריך לועזי מדויק}).",
    required: ["שם התקנון או קיצורו", "תאריך לועזי מדויק של גרסת התקנון (DD.MM.YYYY)"],
    notes: 'יש לציין את התאריך הלועזי המדויק של גרסת התקנון המאוזכרת. תקנון מעודכן – תאריך התיקון האחרון. דוגמות: ס\' 141 לתקנון הכנסת (30.4.2019). פס\' 06.211 לתקשי"ר (18.10.2010). ס\' 10(ב) לתקנון האתיקה המקצועית של העיתונות (20.2.2017). תיקוני תקנון הכנסת מתפרסמים בילקוט הפרסומים: תיקון תקנון הכנסת, י"פ התשע"ב 5730, 5744.',
  },
  "החלטות גופים שלטוניים": {
    rule: "כלל 15",
    template: 'החלטה {מספר} של {הגוף המחליט} "{שם ההחלטה}" ({תאריך לועזי מלא}).',
    required: ["הגוף המחליט", "שם ההחלטה – במירכאות", "תאריך לועזי מלא (DD.MM.YYYY)"],
    notes: 'כלל 15.1: הנוסחה הבסיסית. כלל 15.2: אם אין מספר להחלטה – משמיטים. כלל 15.3: ממשלה/ועדת שרים – לציין מספר ממשלה (למשל הממשלה ה-30). כלל 15.4: אם אין תאריך לועזי מלא – תאריך חלקי או עברי. כלל 15.7: רשם הפטנטים – נוסחה מיוחדת: [סוג הליך] מס\' [מספר] [שמות צדדים] ([הליך ביניים]) ([תאריך]). כלל 15.8: ועדות ערר לתכנון ובנייה – מאוזכרות כפסקי דין (כללים 18–20).',
  },
  "חוות דעת": {
    rule: "כלל 16",
    template: '"[שם חוות הדעת]" (חוות דעת של [זהות נותן חוות הדעת] [תאריך לועזי מלא]).',
    required: ["שם חוות הדעת – במירכאות", "זהות נותן חוות הדעת (תפקיד או שם + תואר)", "תאריך לועזי מלא (DD.MM.YYYY)"],
    notes: 'כלל 16.2: תפקיד רשמי – מציינים תפקיד בלבד. חוות דעת פרטית – שם + תואר רלוונטי. אם השם מופיע בשם חוות הדעת – אין צורך לחזור עליו בסוגריים. כלל 16.3: תאריך לועזי מלא. אם אין – תאריך חלקי או עברי. כלל 16.4: נציבות תלונות הציבור על שופטים – נוסחה מיוחדת: חוות דעת [מספר] של נציבות תלונות הציבור על שופטים "[שם]" [פרטי פרסום] ([תאריך]).',
  },
  "תכנית תכנון ובנייה": {
    rule: "כלל 17.1",
    template: 'תכנית מפורטת [מספר] של [שם הוועדה] "[שם התכנית]" ([שנה/תאריך]).',
    required: ["מספר התכנית", "שם הוועדה (הגוף המחליט)", "שם התכנית – במירכאות", "שנה או תאריך מלא"],
    notes: 'כלל 17.1: תכניות של ועדות לתכנון ובנייה מאוזכרות בדומה להחלטות של גופים שלטוניים (כלל 15). דוגמה: תכנית מפורטת 2549א\' של הוועדה המקומית לתכנון ולבניה תל-אביב–יפו "מתחם רח\' יפת, רח\' רבי פנחס" (2003).',
  },
  "הסכם קיבוצי": {
    rule: "כלל 17.2",
    template: 'הסכם קיבוצי מס\' [מספר] בין [צד א\'] ל[צד ב\'] בעניין [נושא] ([תאריך]).',
    required: ["מספר ההסכם", "צד א'", "צד ב'", "נושא ההסכם (אחרי 'בעניין')", "תאריך ההסכם (DD.MM.YYYY)"],
    notes: 'כלל 17.2: אם צד כולל יותר מגורם אחד, אפשר לציין את הגורם הראשון בלבד ואחריו "ואח\'" אם אין חשיבות מיוחדת לציון יתר הגורמים. דוגמות: הסכם קיבוצי מס\' 2008/7033 בין הסתדרות העובדים הכללית החדשה ללשכת התאום של הארגונים הכלכליים בעניין עקרונות מוסכמים וכלי שימוש במחשב ובתיבת דואר אלקטרוני במקום העבודה (25.6.2008). | הסכם קיבוצי מס\' 2011/7017 בין ממשלת ישראל ואח\' להסתדרות העובדים הכללית החדשה בעניין תוספת שכר 6.25% (12.1.2011).',
  },
  "כתב טענות": {
    rule: "כלל 22.2",
    template: '[הפניה ספציפית] ל[כותרת כתב הטענות] ב[סוג ההליך] ([פרטי הערכאה]) [מספר התיק] [צד א\'] [מפריד] [צד ב\'] ([תאריך כתב הטענות]).',
    required: ["כותרת כתב הטענות", "סוג ההליך", "מספר התיק", "צד א'", "צד ב'", "תאריך כתב הטענות (DD.MM.YYYY)"],
    notes: 'הפניה ספציפית (ס\' X) אופציונלית ומופיעה בתחילת האזכור. כותרת כתב הטענות כוללת סוג המסמך ואופציונלית מטעם מי. אם מצוטט ממאגר – שם המאגר לפני התאריך. דוגמות: כתב ערעור בע"א 751/10 דיין נ\' ר\' (15.2.2010). | ס\' 38 לטיעונים משלימים מטעם העותרים בבג"ץ 2974/06 ישראלי נ\' הועדה להרחבת סל הבריאות (נבו 16.5.2006).',
  },
  "מקור לועזי": {
    rule: "כלל 36 / Bluebook",
    template: "לפי כללי ה-Bluebook (מהדורה 21).",
    required: ["אזכור מלא לפי Bluebook"],
  },
  "התכתבות": {
    rule: "כלל 32.1",
    template: "{סוג ההתכתבות} מ{שם הכותב}[, {תפקיד הכותב},] ל{שם הנמען}[, {תפקיד הנמען},] {נושא ההתכתבות} ({תאריך לועזי}).",
    required: ["סוג ההתכתבות (מכתב/מזכר/דואר אלקטרוני)", "שם הכותב", "שם הנמען", "תאריך לועזי"],
    notes: 'כלל 32.1.1: יש לציין סוג ההתכתבות (מכתב, מזכר, דואר אלקטרוני). כלל 32.1.2: שם הכותב, תפקידו, שם הנמען ותפקידו כפי שמופיעים במסמך. דוגמות: מכתב מנאור כהן, סגן שר ההגנה, לטל גולדברג, היועצת המשפטית למשרד הפיתוח, בעניין תקציב לניסויים חקלאיים (20.7.2015). | דואר אלקטרוני מאור זמיר, הזואולוגית המחוזית, לאלון זוסמן, דיקן הפקולטה לביולוגיה, ואשר לוין, ראש החוג לאבולוציה (5.8.2018, 11:57:36).',
  },
  "ריאיון": {
    rule: "כלל 32.2",
    template: "{סוג הריאיון} [של {שם המראיין}] עם {שם המרואיין}[, {תפקיד המרואיין}] ({תאריך לועזי}).",
    required: ["שם המרואיין", "תאריך לועזי"],
    notes: 'שלוש צורות: (1) ריאיון עם X (ללא מראיין). (2) ריאיון טלפוני עם X. (3) ריאיון של X עם Y. דוגמות: ריאיון עם מסעודה גולני, מנהלת מחלקת הטלוויזיה בעיריית שדרות (4.11.1993). | ריאיון טלפוני עם עו"ד עמית דנציגר, בא כוח העותרות (19.5.1987). | ריאיון של מני זמורה עם אסף שמגר (1.2.2020–15.3.2020).',
  },
  "הרצאה": {
    rule: "כלל 32.3",
    template: '{שם הדובר} "{שם ההרצאה}" (הרצאה ב{שם האירוע}, {מקום האירוע} {תאריך}).',
    required: ["שם הדובר", "שם ההרצאה – במירכאות", "שם האירוע", "תאריך"],
    notes: 'דוגמה: איסי רוזן-צבי "שלטי חוצות: בין משפט ופוליטיקה" (הרצאה ביום עיון בנושא "שלטי פרסום במרחב הציבורי", הפקולטה למשפטים, אוניברסיטת תל אביב 19.6.2008).',
  },
  "הודעה לתקשורת": {
    rule: "כלל 32.4",
    template: '{שם המודיע} "{כותרת ההודעה}" ({תיאור ההודעה} {תאריך}).',
    required: ["שם המודיע", "כותרת ההודעה – במירכאות", "תאריך"],
    notes: 'תיאור ההודעה יהיה כפי שהופיע בה (הודעה לתקשורת, הודעה לעיתונות, הודעת דוברות). אם לא הופיע תיאור – "הודעה לתקשורת". דוגמה: רשות המסים "פרויקט \'חינוך למסים\' יוצא לדרך" (הודעת דוברות 27.1.2013).',
  },
  "סרט": {
    rule: "כלל 33.1",
    template: "{שם הסרט} ({שם הבמאי} במאי/ת {שנה}).",
    required: ["שם הסרט", "שם הבמאי + במאי/במאית/במאים/במאיות", "שנת צאת הסרט"],
    notes: 'על שם הבמאי יחול כלל 23.2 (שמות מחברים). לאחר שמות הבמאים: "במאי"/"במאית"/"במאים"/"במאיות". דוגמה: אפס ביחסי אנוש (טליה לביא במאית 2010).',
  },
  "תוכנית טלוויזיה": {
    rule: "כלל 33.2",
    template: '"{שם התוכנית}[: {שם הפרק}]" ([{יוצר} יוצר/ת,] {ערוץ} {תאריך לועזי מלא}).',
    required: ["שם התוכנית – במירכאות", "ערוץ הטלוויזיה", "תאריך לועזי מלא"],
    notes: 'אם אין שם לפרק – רק שם התוכנית. יוצר לפי כלל 23.2 + "יוצר"/"יוצרת" וכו\'. אם אין יוצר – לא מציינים. כלל 33.5: הפניית זמן לפני הסוגריים. דוגמות: "רמזור: שם לתינוק" (אדיר מילר יוצר, ערוץ 2, 10.9.2011). | "מבט" (ערוץ 1, 22.1.1997). | "סליחה על השאלה: אסירים משוחררים" 19:19–21:17 (כאן 11, 13.11.2018).',
  },
  "תוכנית רדיו": {
    rule: "כלל 33.3",
    template: '"{שם התוכנית}[: {שם הפרק}]" ({תחנת הרדיו} {תאריך לועזי מלא}).',
    required: ["שם התוכנית – במירכאות", "תחנת הרדיו", "תאריך לועזי מלא"],
    notes: 'אם אין שם לפרק – רק שם התוכנית. כלל 33.5: הפניית זמן לפני הסוגריים. דוגמות: "האוניברסיטה המשודרת: מבוא לעבודה: עבדות מודרנית וסחר בבני אדם עם הד"ר הילה שמיר" (גלי צה"ל 21.7.2020). | "דנה בסוגיה" (קול ברמה 19.11.2019).',
  },
  "ערך במילון/אנציקלופדיה": {
    rule: "כלל 25",
    template: '"{שם הערך}" {מחבר} **{שם המילון/אנציקלופדיה}** {עמוד} ({עורך} {שנה}).',
    required: ["שם הערך – במירכאות", "שם המילון/אנציקלופדיה – מודגש", "עמוד תחילת הערך", "שנה"],
    notes: 'כלל 25: ערכים במילונים, באנציקלופדיות ובפרסומים כיוצא באלו מאוזכרים בדומה למאמר בספר (כלל 24.11). שם הערך מופיע במירכאות בתחילת האזכור. דוגמות: "דין" אברהם אבן-שושן **מלון אבן-שושן המרכז: מחדש ומעודכן לשנות האלפים** 182 (משה אזר עורך ראשי 2004). | "משפט משוה" **האנציקלופדיה העברית: כללית, יהודית וארצישראלית** כרך עשרים וארבעה 678 (יהושע פראוור עורך ראשי 1988).',
  },
  "עבודה אקדמית": {
    rule: "כלל 26",
    template: '{מחבר} **{שם העבודה}** {הפניה ספציפית} ({סוג העבודה}, {מוסד אקדמי} {שנה}).',
    required: ["שם המחבר (כלל 23.2)", "שם העבודה – מודגש (כלל 23.3)", "סוג העבודה כפי שבמקור", "שם המוסד האקדמי", "שנת הגשה"],
    notes: 'כלל 26: על מרכיבי הנוסחה יחולו כללי אזכור ספרים (כלל 23). סוג העבודה כפי שהופיע במקור. עבודה בקורס: "בקורס {שם הקורס}" אחרי סוג העבודה. דוגמות: אושרה קנצפולסקי **תרופות חוקתיות לתופעה של פגיעה על ידי המשטרה בזכויות חשודים: גישה אמפירית** (חיבור לשם קבלת תואר "דוקטור למשפטים", אוניברסיטת חיפה 2014). | עומר אלוני "למען ישכון שלום בכפר": השתקפויות של גישות אוריינטליסטיות במשפט הישראלי המוקדם (עבודת גמר לקראת התואר "מוסמך במשפטים", אוניברסיטת תל-אביב 2012). | ערן נריה **החוויה הפרופסיונאלית: בחינת חוויותיהן של רופאים ועורכי דין בתחילת דרכם לאור התיאוריה הפרופסיונאלית** (עבודה סמינריונית בקורס אנתרופולוגיה רפואית, האוניברסיטה העברית 2003).',
  },
  "דברי כנסת": {
    rule: "כלל 8",
    template: 'ד"כ {תאריך לועזי מלא}, {עמוד}.',
    required: ["תאריך לועזי מלא (יום.חודש.שנה)", "עמוד"],
    notes: 'דברי הכנסת מסומנים בקיצור ד"כ. התאריך הוא תאריך לועזי מלא של הדיון. דוגמה: ד"כ 13.6.1950, 1743.',
  },
  "מועצת המדינה הזמנית": {
    rule: "כלל 8.2",
    template: "מועצת המדינה הזמנית {כרך באותיות עבריות}, ישיבה {מספר ישיבה}, {עמוד} ({תאריך לועזי מלא}).",
    required: ["כרך באותיות עבריות", "מספר ישיבה", "עמוד (מספר העמוד – חובה!)", "תאריך לועזי מלא (יום.חודש.שנה – חובה!)"],
    notes: 'מקורות מכרכי מועצת המדינה הזמנית. מספר הכרך באותיות עבריות (א, ב, ג...). עמוד הוא שדה חובה – אם חסר יש לסמן [חסר: עמוד]. התאריך חייב להיות תאריך לועזי מלא בפורמט יום.חודש.שנה (למשל 5.5.1948) – שנה בלבד (כמו 1959) אינה מספיקה, יש לבקש תאריך מלא או לסמן [חסר: תאריך לועזי מלא]. דוגמה: מועצת המדינה הזמנית א, ישיבה ב, 9 (5.5.1948).',
  },
};

/**
 * If the user message contains a classification tag, extract the engine template
 * and inject it as structured guidance for the AI.
 */
function extractEngineHint(userContent: string): string {
  const classMatch = userContent.match(/\[סיווג אוטומטי:\s*([^\]]+)\]/);
  if (!classMatch) return "";
  const sourceLabel = classMatch[1].trim();
  const engine = CITATION_ENGINE_TEMPLATES[sourceLabel];
  if (!engine) return "";
  // Already embedded by the client — no need to double-inject
  if (userContent.includes("מנוע אזכור")) return "";
  return `\n[מנוע אזכור – ${engine.rule}] תבנית: ${engine.template} | רכיבי חובה: ${engine.required.join(", ")}`;
}

function hasExplicitPublicationReference(text: string) {
  return PUBLICATION_REF_REGEX.test(text);
}

function isNumberOnlyInput(text: string) {
  return NUMBER_ONLY_REGEX.test(text.trim());
}

function ensureMissingDataWarning(content: string) {
  if (/\[חסר:/.test(content) && !/⚠️/.test(content)) {
    return `${content}\n⚠️ חסרים פרטים לפי כלל 2.1. אנא השלם אותם.`;
  }
  return content;
}

/**
 * Fix bare Hebrew years (e.g. תשס"ב) by prepending ה' → התשס"ב.
 * All modern Hebrew years start with תש.
 */
function fixHebrewYearPrefix(text: string): string {
  return text.replace(/(?<!ה)(תש[א-ת]["״\u05F4][א-ת])/g, "ה$1");
}

/**
 * Rule 24.9.2: When both Hebrew and Gregorian years appear in parentheses,
 * keep only the Gregorian year.
 * Matches patterns like (התשס"ב–2002), (2002–התשס"ב), (התשס"ב, 2002), etc.
 * Does NOT touch legislation patterns like התשל"ז-1977 outside parentheses.
 */
function normalizeArticleYearByRule2492(text: string): string {
  // Pattern: (HebrewYear separator GregorianYear) → (GregorianYear)
  // Hebrew year: ה?תש[א-ת]["״׳'][א-ת] with optional quotes variations
  const hebrewYearPattern = `ה?ת(?:ש|רש)[א-ת]["״׳'\\u05F4][א-ת]["״׳'\\u05F4]?[א-ת]?`;
  const gregorianYearPattern = `\\d{4}`;
  const separator = `[–\\-,\\s]+`;

  // Case 1: (HebrewYear–GregorianYear) → (GregorianYear)
  const pattern1 = new RegExp(
    `\\(\\s*${hebrewYearPattern}${separator}(${gregorianYearPattern})\\s*\\)`,
    "g"
  );
  text = text.replace(pattern1, "($1)");

  // Case 2: (GregorianYear–HebrewYear) → (GregorianYear)
  const pattern2 = new RegExp(
    `\\(\\s*(${gregorianYearPattern})${separator}${hebrewYearPattern}\\s*\\)`,
    "g"
  );
  text = text.replace(pattern2, "($1)");

  return text;
}

function sanitizeHallucinatedPublicationData(
  content: string,
  options: {
    hasVerifiedCandidates: boolean;
    hasTrustedLegislationPage: boolean;
    messages: Array<{ role: string; content: string }>;
    userInput: string;
  },
) {
  if (options.hasVerifiedCandidates || options.hasTrustedLegislationPage) return content;

  const isLikelyLegislationResponse =
    LEGISLATION_RESPONSE_REGEX.test(content) || /(ס["״]ח|ק["״]ת)/.test(content);

  if (!isLikelyLegislationResponse) return content;

  const userProvidedPublicationData = options.messages.some(
    (message) => message.role === "user" && hasExplicitPublicationReference(message.content),
  );

  if (userProvidedPublicationData || isNumberOnlyInput(options.userInput)) {
    return content;
  }

  let sanitized = content
    .replace(/(ס["״]ח)\s*\d+/g, '$1 [חסר: עמוד ראשון]')
    .replace(/(ק["״]ת)\s*\d+/g, '$1 [חסר: עמוד ראשון]');

  if (sanitized !== content) {
    sanitized = ensureMissingDataWarning(sanitized);
  }

  return sanitized;
}

/**
 * Ensure case-law citation lines end with a trailing period (אזכור אחיד —
 * הערת שוליים מסתיימת בנקודה). Scoped to lines that look like case citations
 * (contain ` נ' ` / ` נ׳ ` / ` נ" ` between parties). Skips lines that already
 * end with `.`, `?`, `!`, `…`, or `:`, and skips the rule indicator line
 * (starts with `📐`). Collapses ` .` to `.`.
 */
function ensureCitationTrailingPeriod(text: string): string {
  if (!text) return text;
  const lines = text.split("\n");
  const partyRe = /\s[נN]['׳״"\u2018\u2019\u05F3]\s/;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.replace(/\s+$/, "");
    if (!trimmed) continue;
    if (trimmed.startsWith("📐")) continue;
    if (!partyRe.test(trimmed)) continue;
    // Collapse stray " ." → "."
    let fixed = trimmed.replace(/\s+\.$/u, ".");
    const last = fixed[fixed.length - 1];
    if (last !== "." && last !== "?" && last !== "!" && last !== "…" && last !== ":") {
      fixed = fixed + ".";
    }
    if (fixed !== raw) lines[i] = fixed;
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT = `אתה מומחה לכללי האזכור האחיד בכתיבה המשפטית בישראל (מהדורת 2021). תפקידך הוא לקבל טקסט משפטי גולמי, לזהות בתוכו הפניות למקורות, ולהמיר אותן להערות שוליים תקניות ומדויקות לפי הכללים. אל תתייחס לעצמך בגוף ראשון או בכינוי כלשהו — אל תכתוב "אני", "העוזר", "המערכת" וכד'.

═══════════════════════════════════════════════
עקרון עליון: כללי האזכור האחיד גוברים על הכל
═══════════════════════════════════════════════

*** כלל ברזל: כללי האזכור האחיד (מהדורת 2021) הם הסמכות העליונה והבלעדית. ***
*** אם קלט המשתמש סותר את הכללים – הכללים גוברים. ***
*** אם המשתמש השמיט פרט חובה – אתה חייב להוסיפו או לסמן [חסר:...]. ***
*** אם המשתמש כתב פורמט שגוי – תקן אותו בשקט לפי הכללים. ***

דוגמאות ליישום עקרון העליונות:
- המשתמש כתב "חוק כבוד האדם" → תקן ל"חוק-יסוד: כבוד האדם וחירותו" (כלל 4.3)
- המשתמש השמיט שנה עברית בחקיקה → הוסף אותה או סמן [חסר: שנה עברית] (כלל 2.4)
- המשתמש כתב חוק ללא נתוני פרסום → סמן [חסר: קובץ פרסום] ו-[חסר: עמוד ראשון] לפי הצורך (כלל 2)
- המשתמש כתב פסק דין ללא שמות צדדים → סמן [חסר: שם המערער/העותר] ו-[חסר: שם המשיב] (כלל 18.4)
- המשתמש כתב "בגץ" → תקן ל-בג"ץ (נספח קיצורים)
- המשתמש ביקש לא לכלול שנה → התעלם מהבקשה, השנה חובה לפי הכללים

סגנון תקשורת:
דבר בטון מקצועי, מדויק ומסייע. הימנע משפה יומיומית מדי אך שמור על נגישות. בסס כל תשובה בכללי האזכור האחיד. אל תזכיר את עצמך בשם או בכינוי — אל תכתוב "העוזר", "המערכת", "אני" וכד'. אסור לפתוח את הפלט במשפט הסבר/זיהוי/הקדמה כלשהי. הפלט חייב להתחיל ישירות באזכור עצמו.

═══════════════════════════════════════════════
פורמט פלט – חובה לעקוב
═══════════════════════════════════════════════

*** הצג רק את הציטוט הסופי המעוצב ואת הפניית הכלל. ***
*** אל תציג שלבי חשיבה, ניתוח פנימי, שלב 1, שלב 2 וכו'. ***
*** אל תכתוב "מכיוון שמדובר ב..." או "המערכת מזהה כי..." ***
*** הפלט חייב להיות נקי: ציטוט + כלל בלבד. ***

דוגמה לפלט נכון:
חוק-יסוד: הכנסת, התשי"ח–1958, ס"ח 69.
📐 כלל: 4.3 – אזכור חוקי יסוד

דוגמה לפלט שגוי (אסור!):
[כל פתיח של "[כינוי כלשהו] מזהה/מבין/מבחין כי..." או "שלב 1 / שלב 2..." או "מכיוון שמדובר ב..." — אסור. הפלט חייב להתחיל ישירות באזכור.]

דמות ועמדה מקצועית:
אתה מומחה לכללי האזכור האחיד בעברית ובלועזית. אתה יודע את כל כללי הבלובוק (מהדורה 21) לגבי מקורות לועזיים. אתה שולט בכל נוסחאות האזכור לפי הכללים.

הנחיות עבודה פנימיות (בצע בשקט, ללא הצגה למשתמש):

1. זהה סוג מקור (חקיקה/פסיקה/ספרות/מאמר/מרשתת/דתי/לועזי)
2. נרמל קיצורים: בגץ→בג"ץ, עא→ע"א, סח→ס"ח, קת→ק"ת, פד→פ"ד, רעא→רע"א, דנא→דנ"א, בשפ→בש"פ, פדע→פד"ע, הש→ה"ש
3. זהה צדדים (כלל 18.4-18.5) – הפרד עם נ' מודגש, שמות **מודגשים**. כלל 18.3: אל תציין מיקום ביהמ"ש העליון.
4. טפל בשנים לפי סוג מקור:
   - חקיקה (כלל 2.4-2.5): שנה עברית ולועזית יחד (התשנ"ז–1997). השלם חסרות.
   - פסיקה (כלל 18.10): רק שנה לועזית בסוגריים. חריג: בי"ד רבני – עברית.
   - ספרות/מאמרים (כלל 23.9, 24.9): לפי מה שסופק.
   - מרשתת (כלל 34.2.7): תאריך לועזי מלא.
5. בדוק שלמות – סמן [חסר:...] לרכיבים חסרים.
6. יישם נוסחת כלל מתאימה.
7. בדוק תיקוף סופי – פיסוק, קיצורים, שנים, הדגשות.
8. אם סופק מקור מאומת – השתמש בו כבסיס.

שלב 5 – בדיקת שלמות חובה (Missing Data Protocol):

═══════════════════════════════════════════════
פרוטוקול "נתון חסר" – חובה לבצע לפני כל פלט
═══════════════════════════════════════════════

לפני הצגת האזכור הסופי, בצע סריקה שיטתית של כל רכיבי החובה לפי סוג המקור.
לכל רכיב חסר – הצב סימון [חסר:...] במיקום המדויק בתוך האזכור.

רכיבי חובה לפי סוג מקור:
- פסיקה בדפוס (כלל 18): סוג הליך, מספר תיק, שני צדדים, סדרה, כרך, עמוד ראשון, שנה
- פסיקה ממאגר (כלל 19): סוג הליך, מספר תיק, שני צדדים, שם מאגר, תאריך מלא
- חקיקה ראשית (כלל 2): שם החוק המלא, שנה עברית ולועזית, קובץ (ס"ח), עמוד ראשון
- חקיקת משנה (כלל 6): שם התקנות, שנה, קובץ (ק"ת), עמוד
- ספרים (כלל 23): שם מחבר (כלל 23.2), שם ספר מודגש (כלל 23.3), שנה (כלל 23.9). אופציונלי: כרך (23.4), הפניה ספציפית (23.5), מהדורה (23.6), עורך (23.7), מתרגם (23.8)
- מאמרים (כלל 24): שם מחבר (24.2, לפי 23.2), שם מאמר במירכאות (24.3), שם כתב עת מודגש (24.4), כרך (24.5), חוברת אם כל חוברת מעמוד 1 (24.6), עמוד ראשון (24.7.1, למעט חריגי 24.7.2), שנה (24.9 – רק אם לא ככרך)
- מאמר שפורסם בספר (כלל 24.11): שם מחבר המאמר (24.2), שם המאמר במירכאות (24.3), שם מחבר הספר (23.2 – אם זהה למחבר המאמר אין לחזור), שם הספר מודגש (23.3), כרך (23.4), עמוד תחילת המאמר (24.7), הפניה ספציפית (24.8), מהדורה (23.6), עורך (23.7), מתרגם (23.8), שנה (23.9)
- ערכים במילונים/אנציקלופדיות (כלל 25): שם הערך במירכאות, שם המילון/אנציקלופדיה מודגש, עמוד, שנה. מאוזכר בדומה למאמר בספר (כלל 24.11).
- עבודות אקדמיות (כלל 26): שם המחבר (23.2), שם העבודה מודגש (23.3), סוג העבודה כפי שהופיע במקור, שם המוסד האקדמי, שנת הגשה. עבודה בקורס: "בקורס {שם הקורס}" אחרי סוג העבודה.
- מקורות מרשתת (כלל 34.2): כתובת URL מלאה. שם מחבר (34.2.2) – רק אם הופיע; מדיה חברתית – שם משתמש בסוגריים. כותרת (34.2.3) – רק אם הופיעה. סוג תוכן (34.2.4) – רק אם אינו בסיסי. שם אתר מודגש (34.2.5) – מדיה חברתית בעברית. הפניה ספציפית (34.2.6). תאריך לועזי מלא ביותר (34.2.7). כתובת URL מלאה (34.2.8). תגובות (34.2.9): [מחבר] "[כותרת]" תגובה [פרטי תגובה] ל[פרטי המקור].
- תגובות במרשתת (כלל 34.2.9): שם מחבר תגובה, כותרת (אופציונלי), מספר תגובה (אם ממוספרת), תאריך תגובה (אחרי "מ-"), פרטי המקור לפי 34.2.2–34.2.8. כתובת התגובה עדיפה על כתובת המקור.
- מקורות דתיים (כללים 28–30): זהה תת-סוג: תנ"ך (28.2), משנה (28.3), בבלי (28.4), ירושלמי (28.5), ספרות חז"ל/רבנית (28.6), ברית חדשה (29), קוראן (30). החל נוסחה מתאימה. תנ"ך: {ספר} {פרק באותיות} {פסוק בספרות}. ספר שמסתיים באות → פסיק. משנה: משנה, {מסכת} {פרק}, {משנה}. בבלי: בבלי, {מסכת} {דף}, {עמוד}. ירושלמי: ירושלמי, {מסכת} {פרק}, {הלכה}. ספרות רבנית: {חיבור}, {הפניה} (מהדורת {שם} {עמוד}). ברית חדשה: כמו תנ"ך. קוראן: שלוש נוסחות אפשריות.
- תקנונים (כלל 13.1): שם התקנון או קיצורו, תאריך לועזי מדויק (DD.MM.YYYY)
- החלטות גופים שלטוניים (כלל 15): הגוף המחליט, שם ההחלטה (במירכאות), תאריך לועזי מלא. מספר החלטה – אם קיים. ממשלה/ועדת שרים – מספר ממשלה (כלל 15.3).
- חוות דעת (כלל 16): שם חוות הדעת (במירכאות), זהות נותן חוות הדעת (תפקיד או שם + תואר), תאריך לועזי מלא. מספר חוות דעת – לנציבות תלונות הציבור על שופטים (כלל 16.4).
- תכניות תכנון ובנייה (כלל 17.1): מספר תכנית, שם הוועדה, שם התכנית (במירכאות), שנה או תאריך.
- הסכמים קיבוציים (כלל 17.2): מספר הסכם, צד א', צד ב', נושא ההסכם (אחרי "בעניין"), תאריך.
- כתבי טענות (כלל 22.2): כותרת כתב הטענות, סוג הליך, מספר תיק, צד א', צד ב', תאריך כתב הטענות. הפניה ספציפית – אופציונלי.
- התכתבויות (כלל 32.1): סוג ההתכתבות (מכתב/מזכר/דואר אלקטרוני), שם הכותב, שם הנמען, תאריך לועזי. תפקידים ונושא – אופציונלי.
- ראיונות (כלל 32.2): שם המרואיין, תאריך לועזי. סוג ריאיון, שם מראיין, תפקיד מרואיין – אופציונלי.
- הרצאות (כלל 32.3): שם הדובר, שם ההרצאה (במירכאות), שם האירוע, תאריך. מקום – אופציונלי.
- הודעות לתקשורת (כלל 32.4): שם המודיע, כותרת ההודעה (במירכאות), תאריך. תיאור ההודעה – אופציונלי.
- סרטים (כלל 33.1): שם הסרט, שם הבמאי + "במאי/ת", שנה.
- תוכניות טלוויזיה (כלל 33.2): שם התוכנית (במירכאות), ערוץ, תאריך לועזי מלא. יוצר, שם פרק – אופציונלי. הפניית זמן (33.5) לפני הסוגריים.
- רדיו/תסכיתים (כלל 33.3): שם התוכנית (במירכאות), תחנת רדיו, תאריך לועזי מלא. שם פרק – אופציונלי. הפניית זמן (33.5) לפני הסוגריים.
- הצעות חוק רגילות (כלל 8): שם הצעת החוק, שנה עברית ולועזית, מספר חוברת. הקיצור התקני הוא ה"ח (לא הצ"ח!). אחרי ה"ח כותבים "הכנסת" או "הממשלה" או משמיטים (ריק) — תלוי בסוג החוברת. אין עמוד ראשון.
- הצעות חוק יסוד (כלל 8): שם הצעת חוק היסוד, שנה עברית בלבד (ללא שנה לועזית!), מספר חוברת. הקיצור התקני הוא ה"ח. אחרי ה"ח כותבים "הכנסת" או "הממשלה" או משמיטים. אין עמוד ראשון.
- דברי כנסת (כלל 8): ד"כ {תאריך לועזי מלא}, {עמוד}. דוגמה: ד"כ 13.6.1950, 1743.
- מועצת המדינה הזמנית (כלל 8.2): מועצת המדינה הזמנית {כרך באותיות עבריות}, ישיבה {מספר ישיבה}, {עמוד} ({תאריך לועזי מלא}). דוגמה: מועצת המדינה הזמנית א, ישיבה ב, 9 (5.5.1948). עמוד הוא רכיב חובה. שנה בודדת (למשל 1959) אינה עמוד ואינה תחליף לתאריך לועזי מלא.

אם רכיב חובה חסר – הצב [חסר: תיאור] במיקום המדויק בתוך האזכור.
אחרי אזכור עם סימוני [חסר:...], הוסף: ⚠️ חסרים פרטים לפי כלל [מספר]. אנא השלם אותם.

פרוטוקול חד-משמעיות בפסיקה:
כשהמשתמש מתאר פסק דין בשפה טבעית (למשל "פסק הדין המזרחי המאוחד") ויש יותר מפסק דין אחד שעשוי להתאים (למשל הליכים שונים באותו עניין — ערעור ורשות ערעור), הצג את כל האפשרויות כרשימה ממוספרת ושאל "לאיזה פסק דין התכוונת?". פורמט:

נמצאו מספר פסקי דין תואמים. לאיזה פסק דין התכוונת?

1. ע"א 6821/93 בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי, פ"ד מט(4) 221 (1995)
2. רע"א 1908/94 בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי, פ"ד מט(4) 221 (1995)

אל תבחר בעצמך — תן למשתמש לבחור. אם יש רק תוצאה אחת, אזכר אותה ישירות.

נוסחאות אזכור:

פסיקה בדפוס (כלל 18): [סוג ההליך] [מספר התיק] **[צד א']** נ' **[צד ב']**, [סדרה] [כרך]([חלק]) [עמוד ראשון][, הפניה ספציפית] ([שנה]).
פסיקה ממאגר (כלל 19): [סוג ההליך] [מספר התיק] **[צד א']** נ' **[צד ב']**[, הפניה ספציפית] ([שם המאגר] [תאריך מלא]).
חקיקה ראשית (כלל 2): [שם החוק], [שנה עברית]–[שנה לועזית], [קובץ] [עמוד ראשון].
הפניה לסעיף בחקיקה (כלל 2.6): ס' X ל[שם החוק], [שנה עברית]–[שנה לועזית], [קובץ] [עמוד].
*** חשוב מאוד: בהפניה נקודתית לסעיף בחקיקה, תמיד כתוב "ס'" (עם גרש) ולא "סעיף". דוגמה: ס' 3 לחוק-יסוד: הממשלה, התשס"א–2001, ס"ח 158. ***
כלל 4.3: חוק-יסוד עם מקף. כלל 4.5: [נוסח חדש]. כלל 4.6: [נוסח משולב]. כלל 2.7: שנת קובץ לחוקי יסוד.
ספרים (כלל 23): [שם המחבר] **[שם הספר]** [מספר הכרך] [הפניה ספציפית] ([המהדורה] [שם העורך] [שם המתרגם] [שנת פרסום הספר]).
כלל 23.2.1: שם פרטי + משפחה כמו במקור. קיצורים בגרש/גרשיים (לא נקודות). כלל 23.2.2: 2 מחברים = ו"ו לפני השני. 3 = פסיקים + ו"ו לפני האחרון. 4+ = אופציונלי ראשון + "ואח'". כלל 23.2.3: ללא תארים אקדמיים/צבאיים/אחרים. כלל 23.2.4: מוסד כמחבר – שם הגוף/הוועדה בלבד, ללא שמות חברים. כלל 23.3: שם הספר מודגש. כלל 23.4: כרך תמיד מצוין, כפי שבספר, ללא הדגשה, ללא גרש אחרי אות (כרך א, כרך שני). כלל 23.5.2: עמוד כמו בספר, ללא "בעמ'". כלל 23.5.3: פרק/סעיף עם תווית (פרק, ס', §). § רק אם מספור רצוף. כלל 23.5.4: ה"ש/טבלה/תרשים = עמוד, פסיק, כינוי + מספר (158, ה"ש 69). אין פסיק בין שם ספר/כרך להפניה (אלא לפי כלל 1.9). כלל 23.6: מהדורה רק אם 2+, כמו במקור. כלל 23.7: שמות עורכים + עורך/עורכת/עורכים/עורכות. כלל 23.8: שמות מתרגמים + מתרגם/מתרגמת/מתרגמים/מתרגמות. ללא שפת מקור. כלל 23.9: שנה עברית בלבד → עברית (עם ה', ללא גרש: התשמ"ז). לועזית בלבד → לועזית. שתיהן מצוינות → לועזית בלבד. מהדורה חדשה → שנת המהדורה החדשה. כלל 1.9: פסיק מפריד בין שני מספרים/מילים עוקבים ללא הבחנה חזותית (הדגשה/מירכאות).
דוגמות ספרים: אוריאל פרוקצ'יה **דיני חברות חדשים בישראל: דין נוהג, דין רצוי והדרך לחקיקה** (1989). | דניאל פרידמן ואלרן שפירא בר-אור **דיני עשיית עושר ולא במשפט** כרך ב (מהדורה שלישית 2017). | חאלד גנאים, מרדכי קרמניצר ובועז שנור **דיני לשון הרע: הדין המצוי והדין הרצוי** (מהדורה שנייה מורחבת 2019). | בנג'מין לי וורף **שפה, מחשבה, מציאות** (מהדורה שנייה מתוקנת ומעודכנת, יאיר אור עורך, איתמר אוסטרייכר ואח' מתרגמים 2018). | אריאל בן נון **חוק החוזים האחידים, התשמ"ג–1982** 73 (1987). | גבריאל קלינג **אתיקה בעריכת דין** 158, ה"ש 69 (2001). | ש"ז פלר **יסודות בדיני עונשין** כרך א, ז–ח (1984). | מנחם אלון **המשפט העברי: תולדותיו, מקורותיו, עקרונותיו** כרך שלישי (מהדורה שלישית מורחבת ומתוקנת התשנ"ב). | קתרין מקינון **פמיניזם משפטי בתיאוריה ובפרקטיקה** (דפנה ברק-ארז עורכת, עידית שורר מתרגמת 2005). | משרד המשפטים **דין וחשבון הועדה לפישוט הענינים ולשיפור ההליכים בתביעות נזיקין** (1972).
מאמרים (כלל 24): [שם המחבר] "[שם המאמר]" **[שם כתב העת]** [כרך][(חוברת)] [עמוד תחילת המאמר][, הפניה ספציפית] ([שנה]).
כלל 24.2: שמות מחברים לפי 23.2 (שם פרטי + משפחה, ללא תארים). כלל 24.3: שם מאמר במירכאות; שם משני בנקודתיים (24.3.3). כלל 24.4: כתב עת מודגש; עיתון יומי עם חלק: **שם:חלק** (הכל מודגש). דוגמה: יעל גרוס "נקנה ביום חול" **מעריב: עסקים** 2.4.2004, 10. כלל 24.5: כרך לא מודגש, כמו במקור (אותיות או מספרים). כלל 24.6: חוברת בסוגריים ללא רווח – רק אם כל חוברת מעמוד 1. דוגמה: ה(2) 27. כלל 24.7.1: עמוד תחילת חובה. כלל 24.7.2: אין עמוד ראשון אם: מאמר יחיד בגיליון, כולם מעמוד 1, אין עמודים. כלל 24.8: הפניה ספציפית אחרי פסיק. דוגמה: לד 569, 584–586. כלל 24.9.1: שנה רק אם לא הופיעה ככרך. 24.9.2: עברית בלבד → עברית (עם ה'). שתיהן → לועזית. כלל 24.10: מקוון – כמו מודפס. כלל 24.12.1: "משפט, חברה ותרבות" – לפני 2018 מאמר בספר (24.11), אחרי 2018 מאמר בכתב עת. כלל 24.12.2: "פרשת השבוע" – פרשה לפני השנה, ללא עמוד ראשון. דוגמה: פרשת השבוע 398 (פרשת וירא התשע"ב).
דוגמות מאמרים: רונית לוין-שנור "הפרטה, הפרדה והפליה" **עיוני משפט** לד 183 (2011). | נתן ברון "פרשת 'מסמך השופטים החסוי': מבט נוסף על הקמת מערכת השיפוט הישראלית בשנת תש"ח (1948)" **קתדרה** 115, 195 (2005). | יובל יועז "חמלה יהודית, או ארץ מקלט לעבריינים?" **הארץ** 23.6.2004 ב3. | רות גביזון "היועץ המשפטי לממשלה: בחינה ביקורתית של מגמות חדשות" **פלילים** ה(2) 27 (1996). | אלכס שטיין "הבטחה מינהלית" **משפטים** יד 255, 259, ה"ש 19 (1984).
מאמר שפורסם בספר (כלל 24.11): [שם מחבר המאמר] "[שם המאמר]" [שם מחבר הספר] **[שם הספר]** [מספר הכרך] [עמוד תחילת המאמר][, הפניה ספציפית] ([המהדורה] [שם העורך] [שם המתרגם] [שנת פרסום הספר]).
*** כלל 24.11 – הבהרות: רכיבי המאמר לפי כללים 24.2, 24.3, 24.7, 24.8. רכיבי הספר לפי כללים 23.2–23.4, 23.6–23.9. אם למאמר ולספר אותו מחבר באותו סדר – אין לחזור על שמו לפני שם הספר. ***
*** קריטי – עורכים מול מחבר הספר: שם המלווה בתואר "עורך"/"עורכת"/"עורכים"/"עורכות" הוא עורך ולעולם אינו "מחבר הספר". מקומו אך ורק בתוך הסוגריים שבסוף האזכור, לפני שנת הפרסום (כלל 23.7). אין לכתוב שמות עורכים בין שם המאמר לשם הספר. משבצת "מחבר הספר" מיועדת רק לספר שנכתב בידי מחבר/ים (כמו דניאל פרידמן ונילי כהן **חוזים**); בקובץ ערוך (למשל "ספר ...", אסופה, "בתוך") משבצת מחבר הספר נשארת ריקה.
שגוי: אורי אהרונסון "חוק הלאום בראי חוקי-היסוד האחרים" ידידיה צ' שטרן, יובל שני עורכים **ספר הפרשנות של חוק יסוד: ישראל – מדינת הלאום של העם היהודי** 79 (2023).
נכון: אורי אהרונסון "חוק הלאום בראי חוקי-היסוד האחרים" **ספר הפרשנות של חוק יסוד: ישראל – מדינת הלאום של העם היהודי** 79 (ידידיה צ' שטרן ויובל שני עורכים 2023). ***
דוגמות מאמר בספר: אייל גרוס "בריאות בישראל: בין זכות למצרך" **זכויות כלכליות, חברתיות ותרבותיות בישראל** 437 (יורם רבין ויובל שני עורכים 2004). | דליה דורנר "מידתיות" **ספר ברנזון** כרך שני: בני סברה 281 (אהרן ברק וחיים ברנזון עורכים 2000). | אהרן ברק "עוולת הרשלנות" **מבחר כתבים** כרך ב 1083 (חיים ה' כהן ויצחק זמיר עורכים 2000). | אריאל פורת "חוזים אחידים" דניאל פרידמן ונילי כהן **חוזים** כרך ג 729 (2003).
ערכים במילונים/אנציקלופדיות (כלל 25): "[שם הערך]" [מחבר] **[שם המילון/אנציקלופדיה]** [עמוד] ([עורך] [שנה]). מאוזכר בדומה למאמר בספר (כלל 24.11). שם הערך מופיע במירכאות בתחילת האזכור. דוגמות: "דין" אברהם אבן-שושן **מלון אבן-שושן המרכז: מחדש ומעודכן לשנות האלפים** 182 (משה אזר עורך ראשי 2004). | "משפט משוה" **האנציקלופדיה העברית: כללית, יהודית וארצישראלית** כרך עשרים וארבעה 678 (יהושע פראוור עורך ראשי 1988).
עבודות אקדמיות (כלל 26): [שם המחבר] **[שם העבודה]** [הפניה ספציפית] ([סוג העבודה], [שם המוסד האקדמי] [שנת הגשה]). על מרכיבי הנוסחה יחולו כללי כלל 23. סוג העבודה כפי שהופיע במקור. עבודה בקורס: "בקורס {שם}" אחרי סוג העבודה. דוגמות: אושרה קנצפולסקי **תרופות חוקתיות לתופעה של פגיעה על ידי המשטרה בזכויות חשודים: גישה אמפירית** (חיבור לשם קבלת תואר "דוקטור למשפטים", אוניברסיטת חיפה 2014). | עומר אלוני "למען ישכון שלום בכפר": השתקפויות של גישות אוריינטליסטיות במשפט הישראלי המוקדם (עבודת גמר לקראת התואר "מוסמך במשפטים", אוניברסיטת תל-אביב 2012). | ערן נריה **החוויה הפרופסיונאלית: בחינת חוויותיהן של רופאים ועורכי דין בתחילת דרכם לאור התיאוריה הפרופסיונאלית** (עבודה סמינריונית בקורס אנתרופולוגיה רפואית, האוניברסיטה העברית 2003).
דברי כנסת (כלל 8): ד"כ [תאריך לועזי מלא], [עמוד]. דוגמה: ד"כ 13.6.1950, 1743.
מועצת המדינה הזמנית (כלל 8.2): מועצת המדינה הזמנית [כרך באותיות עבריות], ישיבה [מספר ישיבה], [עמוד] ([תאריך לועזי מלא]). דוגמה: מועצת המדינה הזמנית א, ישיבה ב, 9 (5.5.1948). אם חסר עמוד, כתוב [חסר: עמוד]. אם יש רק שנה בודדת כמו 1959, אין להציב אותה במקום העמוד.
כתבי אמנה (כלל 9): [הפניה ספציפית] [ל][שם האמנה בעברית], כ"א [מספר כרך], [עמוד ראשון], [עמוד ספציפי] ([פרטי חתימה]). אמנה רב-צדדית: "נפתחה לחתימה ב-{שנה}" (ללא רווח). אמנה דו-צדדית: "נחתמה ב-{שנה}". אם עמודים לא רציפים – מספר חוברת בסוגריים: כ"א 51(1415). כלל 9.2: אפשר להוסיף מידע נוסף בסוגריים (אשרור, כניסה לתוקף). דוגמות: ס' 6 לאמנה בדבר מניעתו וענישתו של הפשע השמדת עם, כ"א 1, 65, 66 (נפתחה לחתימה ב-1948). | הסכם ממלכת-הירדן ההאשמית – ישראל על שביתת נשק כללית, כ"א 1, 35 (נחתמה ב-1949). | אמנה בדבר זכויות הילד, כ"א 31, 221 (נפתחה לחתימה ב-1989) (אושררה ונכנסה לתוקף ב-1991).
תקנונים (כלל 13.1): [הפניה ספציפית] ל[שם התקנון או קיצורו] ([תאריך לועזי מדויק]). יש לציין את התאריך הלועזי המדויק של גרסת התקנון המאוזכרת. תקנון מעודכן – תאריך התיקון האחרון. דוגמות: ס' 141 לתקנון הכנסת (30.4.2019). | פס' 06.211 לתקשי"ר (18.10.2010). | ס' 10(ב) לתקנון האתיקה המקצועית של העיתונות (20.2.2017). תיקוני תקנון הכנסת מתפרסמים בילקוט הפרסומים: תיקון תקנון הכנסת, י"פ התשע"ב 5730, 5744.
החלטות גופים שלטוניים (כלל 15): החלטה [מספר ההחלטה] של [הגוף המחליט] "[שם ההחלטה]" ([תאריך לועזי מלא]). כלל 15.2: אין מספר – משמיטים. כלל 15.3: ממשלה/ועדת שרים – מציינים מספר ממשלה (הממשלה ה-30). כלל 15.4: אין תאריך לועזי מלא – תאריך חלקי או עברי. דוגמות: החלטה 1666 של הממשלה ה-30 "מינוי המועצה הישראלית לתרבות ואמנות" (14.3.2004). | החלטה של ועדת האתיקה של הכנסת "בענין השתתפות חברי הכנסת באירועי תרבות שבסיומם נערך דיון בנוכחות הקהל" (6.7.2004). | כלל 15.7 – רשם הפטנטים: [סוג הליך] מס' [מספר] [שמות צדדים] ([הליך ביניים]) ([תאריך]). דוגמה: בקשה לביטול תיקון בפנקס הפטנטים מס' 180149 מפעל הפיס (חל"צ) נ' יו-סי 2 (ד,ס) בע"מ (30.6.2020). | כלל 15.8 – ועדות ערר לתכנון ובנייה מאוזכרות כפסקי דין (כללים 18–20). דוגמה: ערר (ועדת ערר לתכנון ובנייה הצפון) 230/05 קיבוץ עין השופט נ' ועדה מקומית לתכנון ולבניה יזרעאלים, מקרקעין ד/6, 555 (2005).
חוות דעת (כלל 16): "[שם חוות הדעת]" (חוות דעת של [זהות נותן חוות הדעת] [תאריך לועזי מלא]). כלל 16.2: תפקיד רשמי – מציינים תפקיד בלבד. חוות דעת פרטית – שם + תואר רלוונטי. אם השם מופיע בשם חוות הדעת – אין צורך לחזור עליו בסוגריים. כלל 16.3: תאריך לועזי מלא. אם אין – תאריך חלקי או עברי. כלל 16.4: נציבות תלונות הציבור על שופטים – נוסחה מיוחדת: חוות דעת [מספר] של נציבות תלונות הציבור על שופטים "[שם]" [פרטי פרסום] ([תאריך]). דוגמות: "הצעת חוק איסור התערבות גנטית (שיבוט אדם ושינוי בתנאי רבייה) (תיקון), התשס"ד–2004" (חוות דעת של נציב הדורות הבאים 22.3.2004). | "חוות דעת נוספת של הוועדה לצמצום הריכוזיות בדבר השתתפות גורמים ריכוזיים בהקצאת פרויקט JNET" (5.6.2018). | חוות דעת 10/06 של נציבות תלונות הציבור על שופטים "התבטאות בפסק דין, הסתייגות חלק משופטי הרכב מקטע ממנו וקשר עם התקשורת" דין וחשבון שנתי לשנת 2006 193 (3.9.2006).
תכניות תכנון ובנייה (כלל 17.1): תכנית מפורטת [מספר] של [שם הוועדה] "[שם התכנית]" ([שנה/תאריך]). מאוזכרות בדומה להחלטות של גופים שלטוניים (כלל 15). דוגמה: תכנית מפורטת 2549א' של הוועדה המקומית לתכנון ולבניה תל-אביב–יפו "מתחם רח' יפת, רח' רבי פנחס" (2003).
הסכמים קיבוציים (כלל 17.2): הסכם קיבוצי מס' [מספר] בין [צד א'] ל[צד ב'] בעניין [נושא] ([תאריך]). אם צד כולל יותר מגורם אחד – ציין הראשון + "ואח'". דוגמות: הסכם קיבוצי מס' 2008/7033 בין הסתדרות העובדים הכללית החדשה ללשכת התאום של הארגונים הכלכליים בעניין עקרונות מוסכמים וכלי שימוש במחשב ובתיבת דואר אלקטרוני במקום העבודה (25.6.2008). | הסכם קיבוצי מס' 2011/7017 בין ממשלת ישראל ואח' להסתדרות העובדים הכללית החדשה בעניין תוספת שכר 6.25% (12.1.2011).
כתבי טענות (כלל 22.2): [הפניה ספציפית] ל[כותרת כתב הטענות] ב[סוג ההליך] ([פרטי הערכאה]) [מספר התיק] [צד א'] נ' [צד ב'] ([תאריך כתב הטענות]). הפניה ספציפית (ס' X) אופציונלית ומופיעה בתחילת האזכור. כותרת כתב הטענות כוללת סוג המסמך ואופציונלית מטעם מי ("מטעם העותרים"). אם מצוטט ממאגר – שם המאגר לפני התאריך. דוגמות: כתב ערעור בע"א 751/10 דיין נ' ר' (15.2.2010). | ס' 38 לטיעונים משלימים מטעם העותרים בבג"ץ 2974/06 ישראלי נ' הועדה להרחבת סל הבריאות (נבו 16.5.2006).
התכתבויות (כלל 32.1): [סוג ההתכתבות] מ[שם הכותב][, תפקיד הכותב,] ל[שם הנמען][, תפקיד הנמען,] [נושא] ([תאריך לועזי]). כלל 32.1.1: ציון סוג (מכתב/מזכר/דואר אלקטרוני). כלל 32.1.2: שמות ותפקידים כפי שבמסמך. דוגמות: מכתב מנאור כהן, סגן שר ההגנה, לטל גולדברג, היועצת המשפטית למשרד הפיתוח, בעניין תקציב לניסויים חקלאיים (20.7.2015). | דואר אלקטרוני מאור זמיר, הזואולוגית המחוזית, לאלון זוסמן, דיקן הפקולטה לביולוגיה, ואשר לוין, ראש החוג לאבולוציה (5.8.2018, 11:57:36).
ראיונות (כלל 32.2): [סוג הריאיון] [של שם המראיין] עם [שם המרואיין][, תפקיד] ([תאריך לועזי]). שלוש צורות: ריאיון עם X, ריאיון טלפוני עם X, ריאיון של X עם Y. דוגמות: ריאיון עם מסעודה גולני, מנהלת מחלקת הטלוויזיה בעיריית שדרות (4.11.1993). | ריאיון טלפוני עם עו"ד עמית דנציגר, בא כוח העותרות (19.5.1987). | ריאיון של מני זמורה עם אסף שמגר (1.2.2020–15.3.2020).
הרצאות (כלל 32.3): [שם הדובר] "[שם ההרצאה]" (הרצאה ב[שם האירוע], [מקום] [תאריך]). דוגמה: איסי רוזן-צבי "שלטי חוצות: בין משפט ופוליטיקה" (הרצאה ביום עיון בנושא "שלטי פרסום במרחב הציבורי", הפקולטה למשפטים, אוניברסיטת תל אביב 19.6.2008).
הודעות לתקשורת (כלל 32.4): [שם המודיע] "[כותרת ההודעה]" ([תיאור ההודעה] [תאריך]). תיאור כפי שהופיע; אם אין – "הודעה לתקשורת". דוגמה: רשות המסים "פרויקט 'חינוך למסים' יוצא לדרך" (הודעת דוברות 27.1.2013).
סרטים (כלל 33.1): [שם הסרט] ([שם הבמאי] במאי/ת [שנה]). שם הבמאי לפי כלל 23.2. אחרי השמות: במאי/במאית/במאים/במאיות. דוגמה: אפס ביחסי אנוש (טליה לביא במאית 2010).
תוכניות טלוויזיה (כלל 33.2): "[שם התוכנית][: שם הפרק]" ([יוצר יוצר/ת,] [ערוץ] [תאריך לועזי מלא]). יוצר לפי 23.2 + יוצר/ת. אם אין יוצר – לא מציינים. כלל 33.5: הפניית זמן לפני הסוגריים. דוגמות: "רמזור: שם לתינוק" (אדיר מילר יוצר, ערוץ 2, 10.9.2011). | "מבט" (ערוץ 1, 22.1.1997). | "סליחה על השאלה: אסירים משוחררים" 19:19–21:17 (כאן 11, 13.11.2018).
רדיו/תסכיתים (כלל 33.3): "[שם התוכנית][: שם הפרק]" ([תחנת הרדיו] [תאריך לועזי מלא]). כלל 33.5: הפניית זמן לפני הסוגריים. דוגמות: "האוניברסיטה המשודרת: מבוא לעבודה: עבדות מודרנית וסחר בבני אדם עם הד"ר הילה שמיר" (גלי צה"ל 21.7.2020). | "דנה בסוגיה" (קול ברמה 19.11.2019).
מקורות דתיים (כללים 28–30): כלל 28.2 – תנ"ך: {שם ספר} {פרק באותיות ללא גרש/גרשיים} {פסוק בספרות}. ספר שמסתיים באות (מלכים ב, שמואל א) → פסיק לפני מספר הפרק. פסוקים באותו פרק מופרדים בפסיק; הפניות מפרקים שונים מופרדות בנקודה-פסיק. דוגמות: שמואל א, א 19. | בראשית ג 19; ח 3–7, 17. כלל 28.3 – משנה: משנה, {מסכת} {פרק}, {משנה}. דוגמה: משנה, בבא מציעא א, ד. כלל 28.4 – בבלי: בבלי, {מסכת} {דף}, {עמוד}. דוגמה: בבלי, ברכות ב, ע"א. כלל 28.5 – ירושלמי: ירושלמי, {מסכת} {פרק}, {הלכה}. דוגמה: ירושלמי, גיטין ד, א. כלל 28.6 – ספרות חז"ל/רבנית: {שם חיבור}, {הפניה} (מהדורת {שם המהדורה} {עמוד}). דוגמות: מכילתא דרבי ישמעאל, שירה ד (מהדורת הורוביץ-רבין 129–132). | שמות רבה ד, ד (מהדורת שנאן 151). | אוצר הגאונים, תענית, חלק התשובות (מהדורת לוין 26). כלל 28.6.1: שם חיבור מלא. שו"ת בר"ת אם מקובל. חיבורים בשם זהה מזוהים לפי מחבר. דוגמות: שולחן ערוך, אורח חיים, סימן א, סעיף ג. | שו"ת הרשב"א, סימן א. | ספר הישר לר"ת, סימן קכה (מהדורת שלזינגר 92–93). כלל 28.6.2: הפניה לפי חלוקה מסורתית (ספר, פרק, הלכה, פרשה, סימן, סעיף). פירושים – ד"ה. דוגמות: משנה תורה, נחלות, פרק י, הלכה ד. | ארבעה טורים, אורח חיים, סימן ב, סעיף ב. | רש"י, ברכות ב, ע"א, ד"ה "מאימתי". כלל 29 – ברית חדשה: כמו תנ"ך (28.2). דוגמה: הבשורה על פי יוחנן א 1. כלל 30 – קוראן: שלוש נוסחות: (1) הקוראן, סורת {שם הסורה} {פסוק}. (2) הקוראן, סורה {מספר באותיות} {פסוק}. (3) הקוראן, סורה {מספר בספרות}, {פסוק}. יש לבחור אחת ולנקוט עקבית. דוגמות: הקוראן, סורת חזון הנשים 8. | הקוראן, סורה ד 8. | הקוראן, סורה 4, 8.
לועזי (כלל 36/Bluebook): ספרים: FIRST LAST, ##TITLE## [עמוד] (שנה). מאמרים: First Last, ##Title##, [כרך] J. ABBREV. [עמוד] (שנה).

כלל 1.9 (הפרדה בפסיק): אם שני מספרים עוקבים או שתי מילים עוקבות ואין הבחנה חזותית (הדגשה/מירכאות) – פסיק מפריד. דוגמות: כרך א, ז–ח; מהדורה שישית, חנן מוניץ עורך 2016.
כלל 1.10 (טווחי מספרים): בעברית – מימין לשמאל: הנמוך מימין לקו המפריד, הגבוה משמאל (37–40, כה–כז, 474–478). בלועזית – לפי כללי שפת המקור. באזכור חוזר בעברית של מקור לועזי – מימין לשמאל (2364–2372). דוגמות: ס' 37–40 לפקודת התעבורה [נוסח חדש]. | בג"ץ 4284/08 קלפנר נ' חברת דואר ישראל בע"מ, פ"ד סג(3) 766, פס' כה–כז (2010). | Kagan, לעיל ה"ש 89, בעמ' 2364–2372.

סימון: **מודגש** לשמות צדדים/ספרים/כתבי עת. ##נטוי## למקורות לועזיים. "מירכאות" לשמות מאמרים בעברית.
אזכור חוזר: [שם המקור], לעיל ה"ש X[, בעמ' Y]. אם ממש לפני: שם[, בעמ' Y].
בסוף כל אזכור: 📐 כלל: [מספר] – [תיאור קצר]

כלל פתרון סתירות: אם עמוד שונה מהעמוד הפותח המוכר – תקן בשקט. לעולם אל תשרשר שני עמודים.
מקורות מאומתים: אם סופק מקור מאומת – השתמש בו כבסיס ואל תשנה אותו.

═══════════════════════════════════════════════
*** הפניות נקודתיות (Pinpoint References) ***
═══════════════════════════════════════════════

*** כאשר הקלט מכיל מילות מפתח כמו: סעיף, ס', פסקה, פס', עמ', בעמ', לפסק דינו של, לפסק דינה של ***
*** זהה את זה כהפניה נקודתית (pinpoint) ושלב אותה עם המקור המאומת לפי הכללים. ***

*** חקיקה (כלל 2.6): ס' X ל[שם החוק], [שנה עברית]–[שנה לועזית], [קובץ] [עמוד]. ***
  דוגמה: ס' 3 לחוק-יסוד: הממשלה, התשס"א, ס"ח 158.
  חשוב: בהפניה נקודתית לחקיקה, תמיד כתוב "ס'" ולא "סעיף". ***
*** פסיקה בדפוס (כלל 18): הוסף את ההפניה הנקודתית אחרי סוגריי השנה. ***
  דוגמה: בג"ץ 1514/01 **יעקב גור אריה** נ' **הרשות השנייה לטלוויזיה ולרדיו**, פ"ד נה(4) 267 (2001), פס׳ 11 לפסק דינו של הנשיא ברק.
  מבנה: [ציטוט מאומת מלא עם שנה בסוגריים], [פס׳/בעמ'] [מספר] [לפסק דינו/דינה של שופט/ת].
*** פסיקה ממאגר (כלל 19): הוסף את ההפניה הנקודתית אחרי סוגריי המאגר והתאריך. ***
  דוגמה: ע"א 1234/05 **פלוני** נ' **אלמוני** (נבו 1.1.2020), פס׳ 5 לפסק דינו של השופט כהן.
*** ספרים (כלל 23): הוסף עמוד ספציפי אחרי הכרך. ***
*** מאמרים (כלל 25): הוסף ", בעמ' Y" אחרי העמוד הראשון. ***

*** חשוב: אל תשנה שום נתון מהמקור המאומת. רק הוסף את ההפניה הנקודתית במיקום הנכון. ***
*** אין צורך לאמת הפניה נקודתית – הצג אותה ישירות למשתמש. ***
*** כאשר המשתמש מציין שופט/ת – תמיד כלול את שמו/שמה בהפניה הנקודתית. ***

═══════════════════════════════════════════════
*** איסור מוחלט להמצאת מטא-נתונים (Anti-Hallucination) ***
═══════════════════════════════════════════════

*** הגבלת חיפוש: אסור לך לנחש, לשער או להמציא מספרי ס"ח/ק"ת, עמודים, כרכים או מספרי תיק. ***
*** נתוני פרסום מותרים רק משלושה מקורות: (1) מקור מאומת מהמאגר, (2) המשתמש עצמו, או (3) בלוק "══ נתוני חקיקה מאומתים ══" שמוזרק להודעה. ***
*** אם הופיע בלוק "══ נתוני חקיקה מאומתים ══", יש להתייחס אליו כאל נתון מאומת לכל דבר ולהשתמש במספר העמוד שבו בדיוק. ***

*** עדיפות מאגר מאומת: ***
*** אם החוק קיים בטבלת המקורות המאומתים – השתמש בנתוני ס"ח, עמוד, ושנה בדיוק כפי שנשמרו. אל תשאל את המשתמש ואל תחפש באינטרנט. ***

*** כשאין נתוני פרסום מאומתים: ***
*** אם החוק אינו קיים במאגר המאומת ואין גם בלוק "══ נתוני חקיקה מאומתים ══" – אל תציב מספר אחרי ס"ח/ק"ת. ***
*** 1. אם קובץ הפרסום ידוע אך העמוד לא ידוע: הצג [חסר: עמוד ראשון] אחרי ס"ח/ק"ת ***
*** 2. אם גם קובץ הפרסום לא ידוע: הצג [חסר: קובץ פרסום] ו-[חסר: עמוד ראשון] ***
*** 3. בקש מהמשתמש במפורש: "אנא ספק את העמוד הראשון שבו פורסם החיקוק בקובץ החקיקה." ***
*** 4. אל תנסה למלא ערכים ממידע כללי או מכל מקור אחר שאינו אחד משלושת המקורות המותרים. ***

*** דוגמאות:
  - חוק ללא נתוני פרסום מאומתים: כתוב [חסר: קובץ פרסום] [חסר: עמוד ראשון]
  - חוק עם נתון מאומת ס"ח 69: כתוב ס"ח 69 (זהו מספר העמוד, בדיוק כפי שסופק)
  - אם לא ידועה שנה עברית: כתוב [חסר: שנה עברית]
***
*** לעולם אל תכתוב מספר עמוד אחרי ס"ח/ק"ת אם הוא לא סופק במפורש על ידי המשתמש, המאגר, או בלוק נתוני החקיקה המאומתים. מספר שגוי גרוע מ-[חסר:...]. ***

═══════════════════════════════════════════════
*** לולאת תיקון – כשהמשתמש משלים נתון חסר ***
═══════════════════════════════════════════════

*** כאשר המשתמש מגיב עם מספר, שנה, עמוד, או כל מטא-נתון שהיה מסומן כ-[חסר:...]: ***
*** 1. שלב את הנתון שסופק במיקום הנכון בציטוט. ***
*** 2. הסר את סימון ה-[חסר:...] עבור אותו שדה. ***
*** 3. אם כל הנתונים הושלמו – הצג את הציטוט המלא ללא סימוני חסר ובלי ⚠️. ***
*** 4. אל תשאל שוב על נתון שכבר סופק. ***

*** הכללים גוברים על קלט המשתמש. תמיד. ***

═══════════════════════════════════════════════
*** פסיקה – ביעור רב-תוצאתי (Disambiguation) ***
═══════════════════════════════════════════════

*** כאשר שאילתת המשתמש לגבי פסיקה יכולה להתאים ליותר מפסק דין אחד ***
*** (למשל אותם צדדים אך סוגי הליך שונים, או מספרי תיק שונים): ***
*** 1. אל תבחר בעצמך – הצג את כל האפשרויות כרשימה ממוספרת. ***
*** 2. כתוב כל אפשרות בשורה נפרדת בפורמט: "1. [סוג הליך] [מספר] [צד א'] נ' [צד ב'] ([שנה])" ***
*** 3. בקש מהמשתמש לבחור: "לאיזה פסק דין התכוונת?" ***
*** 4. אל תנחש סוג הליך – אם אינך בטוח, הצג את כל האפשרויות. ***

*** דוגמה: ***
*** אם המשתמש שואל על "פסק הדין המזרחי המאוחד", והידע שלך כולל גם ע"א וגם רע"א: ***
*** "מצאתי מספר פסקי דין תואמים: ***
*** 1. ע"א 6821/93 בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי (1995) ***
*** 2. רע"א 1908/94 בנק המזרחי המאוחד נ' מגדל כפר שיתופי (1995) ***
*** לאיזה פסק דין התכוונת?" ***`;

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  // ── Auth gate: require a valid JWT ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const SUPABASE_URL_ENV = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authClient = createClient(SUPABASE_URL_ENV, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(
      JSON.stringify({ error: "Unauthorized – invalid token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  // ── End auth gate ──

  // Build a per-request user-scoped client for credit RPCs
  const userClient = createClient(SUPABASE_URL_ENV, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  let creditRequestId: string | null = null;
  const refundIfCharged = async (reason: string) => {
    if (!creditRequestId) return;
    try {
      await userClient.rpc("refund_credits", {
        _request_id: creditRequestId,
        _reason: reason,
      });
    } catch (e) {
      console.error("refund_credits failed:", e);
    }
  };

  try {
    const { messages, requestId: clientReqId } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    creditRequestId = (typeof clientReqId === "string" && clientReqId.length >= 8)
      ? clientReqId
      : crypto.randomUUID();

    const lastUserMessage = [...messages].reverse().find((m: { role: string }) => m.role === "user");
    const userInput = lastUserMessage?.content || "";

    // ── Pre-consume validation: reject gibberish/empty input BEFORE charging credits ──
    if (!isValidCitationInputServer(userInput)) {
      return new Response(
        JSON.stringify({ error: "INVALID_INPUT", messageHe: INVALID_INPUT_MSG_HE }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let verifiedHint = "";
    let hasVerifiedCandidates = false;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && userInput.length >= 2) {
      try {
        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const searchTerm = userInput
          .replace(/\[סיווג אוטומטי:.*?\]\n?/, "")
          .replace(/══[\s\S]*══+\s*/g, "")
          .trim();
        const words = tokenizeSearchTerms(searchTerm);

        // Also extract case number patterns (e.g., "1514/01", "1514")
        const caseNumberParts = (searchTerm.match(/\d+(?:\/\d+)?/g) || []).filter((p: string) => p.length >= 2);
        const allTerms = Array.from(new Set([...words, ...caseNumberParts]));

        if (allTerms.length > 0) {
          const orConditions = allTerms
            .flatMap((word) => [
              `search_text.ilike.%${word}%`,
              `source_name.ilike.%${word}%`,
              `full_citation.ilike.%${word}%`,
            ])
            .join(",");

          const { data: verified } = await sb
            .from("verified_sources")
            .select("source_name, full_citation, source_type, year, metadata")
            .eq("verification_status", "verified")
            .or(orConditions)
            .limit(12);

          if (verified && verified.length > 0) {
            const rankedMatches = verified
              .map((candidate) => ({
                candidate,
                score: scoreVerifiedMatch(searchTerm, candidate as { source_name: string; full_citation: string }),
              }))
              .filter((item) => item.score >= 0)
              .sort((a, b) => b.score - a.score);

            if (rankedMatches.length > 0) {
              hasVerifiedCandidates = true;
            }
            console.log(`[verified] raw=${verified.length}, ranked=${rankedMatches.length}, hasVerifiedCandidates=${rankedMatches.length > 0}`);

            const bestMatch = rankedMatches[0]?.candidate as { full_citation: string } | undefined;
            const hasPinpoint = PINPOINT_REGEX.test(userInput);
            if (bestMatch && !hasPinpoint) {
              return new Response(JSON.stringify({ content: bestMatch.full_citation }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            if (bestMatch && hasPinpoint) {
              verifiedHint = `\n\n══ מקור מאומת (הפניה נקודתית) ══\nהמקור המאומת: ${bestMatch.full_citation}\n══ המשתמש מבקש הפניה נקודתית (pinpoint). שלב את ההפניה הנקודתית עם המקור המאומת לפי כללי האזכור האחיד. אל תשנה את הנתונים מהמקור המאומת. ══`;
            }

            const sources = verified.map((v: Record<string, unknown>) =>
              `[מקור מאומת] ${v.source_name}: ${v.full_citation}`,
            ).join("\n");
            verifiedHint = `\n\n══ מקורות מאומתים שנמצאו במאגר ══\n${sources}\n══ השתמש בציטוטים המאומתים הללו כבסיס לתשובתך. אל תשנה אותם אלא אם הם סותרים את כללי האזכור. ══`;
          }
        }
      } catch (e) {
        console.error("Verified source lookup failed:", e);
      }
    }

    // ── Consume 1 credit before invoking the AI (verified short-circuit above is free) ──
    const consumeRes = await userClient.rpc("consume_credits", {
      _amount: 1,
      _reason: "citation-chat",
      _request_id: creditRequestId,
    });
    const consumeData = (consumeRes.data ?? {}) as Record<string, unknown>;
    if (consumeRes.error || !consumeData.ok) {
      if (consumeData.error === "INSUFFICIENT_CREDITS") {
        return new Response(
          JSON.stringify({
            error: "INSUFFICIENT_CREDITS",
            required: 1,
            remaining_included: consumeData.remaining_included ?? 0,
            remaining_topup: consumeData.remaining_topup ?? 0,
          }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.error("consume_credits failed:", consumeRes.error, consumeData);
      // Don't block on RPC errors — proceed without charging
      creditRequestId = null;
    }

    let caseLawHint = "";
    let caseLawOverrideLabel: string | null = null;
    const classMatch = userInput.match(/\[סיווג אוטומטי:\s*([^\]]+)\]/);
    
    // ── Check if this is a disambiguation selection (skip Perplexity) ──
    const isDisambiguationSelection = /\[בחירת תוצאה\]/.test(userInput);

    // Party-name fallback: detect "X נגד Y" or "X נ' Y" pattern
    const cleanedForParty = userInput
      .replace(/\[סיווג אוטומטי:.*?\]\n?/, "")
      .replace(/\[בחירת תוצאה\]\s*/, "")
      .replace(/\n?══[\s\S]*?══+\s*/g, "")
      .trim();

    const caseNumberMatch = userInput.match(CASE_DOCKET_RE);
    // Bare docket fallback: users routinely paste "5555/18 חסון נ' כנסת ישראל"
    // without the בג"ץ prefix. Without this the input degraded to a party-name
    // search, which could return a DIFFERENT case between the same parties and
    // silently substitute its docket.
    const bareDocket = caseNumberMatch ? null : findBareDocket(cleanedForParty);
    if (bareDocket) {
      console.log(`[case-law] bare_docket_detected=${bareDocket.docket} (no case-type prefix in input)`);
    }
    const docketQuery: { caseType: string; caseNum: string } | null = caseNumberMatch
      ? { caseType: caseNumberMatch[1], caseNum: caseNumberMatch[2] }
      : bareDocket
        ? { caseType: "", caseNum: bareDocket.docket }
        : null;

    const isCaseLaw = Boolean((classMatch && /פסיקה/.test(classMatch[1])) || docketQuery);

    // Extract embedded data blob (carried over from a prior party-search disambiguation list)
    let selectionDataBlob: Record<string, unknown> | null = null;
    if (isDisambiguationSelection) {
      const blobMatch = userInput.match(/<!--DATA:([^>]+?)-->/);
      if (blobMatch) {
        try {
          selectionDataBlob = JSON.parse(decodeURIComponent(blobMatch[1]));
          console.log("[case-law] Disambiguation data blob parsed:", selectionDataBlob);
        } catch (e) {
          console.warn("[case-law] Failed to parse disambiguation data blob:", e);
        }
      }
    }

    // Accepts: "X נגד Y", "X נ' Y", "X נ״ Y", and bare "X נ Y".
    // Length guard: each side must contain ≥2 Hebrew letters to avoid
    // a stray middle-word `נ` triggering false positives.
    const PARTY_RE = /([\u0590-\u05FF][\u0590-\u05FF\s'"״׳]*[\u0590-\u05FF])\s+(?:נגד|נ['׳״"\u2018\u2019\u05F3]?)\s+([\u0590-\u05FF][\u0590-\u05FF\s'"״׳]*[\u0590-\u05FF])/;
    // Never let the party-name branch run when the user supplied a docket
    // (prefixed OR bare) — it is the path that can override the docket.
    const partyMatch = !docketQuery ? cleanedForParty.match(PARTY_RE) : null;


    // If we have a data blob from prior party-search, use it directly — no Perplexity re-search
    if (isDisambiguationSelection && isCaseLaw && selectionDataBlob) {
      const r = selectionDataBlob as Record<string, string | boolean>;
      const fullRef = `${r.caseType || "[חסר: סוג הליך]"} ${r.caseNumber || "[חסר: מספר תיק]"}`;
      let details = `\n\n══ נתוני פסק דין שנבחר ══\n`;
      details += `תיק: ${fullRef}\n`;
      if (r.party1 && r.party2) details += `צדדים: **${r.party1}** נ' **${r.party2}**\n`;
      if (r.court) details += `בית משפט: ${r.court}\n`;
      if (r.isPublished && r.padi_volume) {
        caseLawOverrideLabel = "פסיקה (דפוס)";
        const part = r.padi_part ? `(${r.padi_part})` : "";
        details += `פרסום: פ"ד ${r.padi_volume}${part} ${r.padi_page || ""}\n`;
      } else if (r.databaseName) {
        caseLawOverrideLabel = "פסיקה (מאגר)";
        details += `מאגר: ${r.databaseName}\n`;
      }
      if (r.date) details += `תאריך: ${r.date}\n`;
      if (r.year) details += `שנה: ${r.year}\n`;
      details += `══ השתמש אך ורק בנתונים שלמעלה. אם נתון חסר — סמן [חסר:...]. ══`;
      caseLawHint = details;
      console.log("[case-law] Using selection data blob — skipping Perplexity");
    } else if (isDisambiguationSelection && isCaseLaw && docketQuery) {
      console.log(`[case-law] Disambiguation selection detected (no blob), doing focused search for ${docketQuery.caseType} ${docketQuery.caseNum}`.trim());
    } else if (isDisambiguationSelection && isCaseLaw) {
      // No case number found in selection — build hint from text
      const selectionText = userInput.replace(/\[סיווג אוטומטי:.*?\]\n?/, "").replace(/\[בחירת תוצאה\]\s*/, "").trim();
      const yearMatch = selectionText.match(/\((\d{4})\)/);
      const courtMatch = selectionText.match(/—\s*(.+?)$/);
      const partiesInSelection = selectionText.match(/([\u0590-\u05FF][\u0590-\u05FF\s'"״׳]*[\u0590-\u05FF])\s+(?:נגד|נ['׳״"\u2018\u2019\u05F3]?)\s+([\u0590-\u05FF][\u0590-\u05FF\s'"״׳]*[\u0590-\u05FF])/);
      
      let details = `\n\n══ נתוני פסק דין שנבחר ══\n`;
      details += `פרטים: ${selectionText}\n`;
      if (partiesInSelection) details += `צדדים: **${partiesInSelection[1].trim()}** נ' **${partiesInSelection[2].trim().replace(/\s*\(\d{4}\).*$/, '')}**\n`;
      if (courtMatch) details += `בית משפט: ${courtMatch[1].trim()}\n`;
      if (yearMatch) details += `שנה: ${yearMatch[1]}\n`;
      details += `══ עצב אזכור מלא לפסק דין זה. סמן [חסר:...] לשדות חסרים. ══`;
      caseLawHint = details;
      console.log(`[case-law] No case number in selection, using parsed text hint`);
    }

    // When disambiguation selection has a case number, allow the normal case-number search to proceed
    // — UNLESS we already built the hint from a data blob.
    const shouldSearchCaseLaw = isCaseLaw && !hasVerifiedCandidates && (docketQuery || partyMatch) && !(isDisambiguationSelection && !docketQuery) && !selectionDataBlob;
    console.log(`[case-law] isCaseLaw=${isCaseLaw}, isDisambiguationSelection=${isDisambiguationSelection}, docket=${docketQuery ? `${docketQuery.caseType} ${docketQuery.caseNum}`.trim() : 'null'}, bare_docket=${bareDocket ? 'yes' : 'no'}, partyMatch=${partyMatch ? 'yes' : 'no'}, hasVerifiedCandidates=${hasVerifiedCandidates}, hasBlob=${!!selectionDataBlob}`);

    if (shouldSearchCaseLaw) {
      try {
        const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
        if (PERPLEXITY_API_KEY) {

          // ── Branch A: Search by case number (existing logic) ──
          if (docketQuery) {
            const caseType = docketQuery.caseType;
            // Preserve original docket separator: lower-courts use dashes (e.g. סע"ש 50358-09-16),
            // Supreme historical use slashes (e.g. ע"א 158/77). Don't normalize.
            const caseNum = docketQuery.caseNum;
            const fullCaseRef = `${caseType} ${caseNum}`.trim();
            const query = `מצא את פסק הדין הישראלי ${fullCaseRef}.${caseType ? "" : ` מספר התיק הוא ${caseNum} וסוג ההליך (הקידומת) לא צוין — עליך לזהות את סוג ההליך המדויק (למשל בג"ץ, ע"א, רע"א, ע"פ) עבור מספר תיק זה בדיוק. אסור להחזיר פסק דין אחר עם מספר תיק אחר.`} חשוב מאוד: בדוק קודם כל האם פסק הדין פורסם בפד"י (פסקי דין של בית המשפט העליון). חפש את מספר התיק יחד עם המילה "פ"ד" וכרך. רק אם וידאת שהוא לא מופיע בפד"י, ציין באיזה מאגר (נבו/תקדין/פסקדין). ציין: 1) שמות הצדדים (שם משפחה בלבד לאנשים פרטיים, שם מלא לתאגידים), 2) תאריך מתן פסק הדין (יום.חודש.שנה), 3) שם בית המשפט, 4) סוג ההליך (caseType) בקיצור הרשמי, 5) פרסום בפד"י: כרך, חלק ועמוד ראשון. ענה בעברית בלבד.`;


            const caseSearchBody: Record<string, unknown> = {
              model: "sonar-pro",
              search_domain_filter: ["nevo.co.il", "court.gov.il", "supreme.court.gov.il", "takdin.co.il", "lite.takdin.co.il", "psakdin.co.il"],
              messages: [
                {
                  role: "system",
                  content: `אתה עוזר מחקר משפטי ישראלי. החזר תשובה בפורמט JSON בלבד.
טיפ חיפוש: ב-https://lite.takdin.co.il/search-results מוצגים בעמוד אחד שמות הצדדים, מספר התיק, בית המשפט, תאריך פסק הדין ופרסום בפ"ד — חפש שם קודם כדי לאתר את כל הנתונים במקום אחד.
חשוב ביותר: עדיפות ראשונה היא לבדוק פרסום בפד"י (פסקי דין). רוב פסקי הדין של בית המשפט העליון פורסמו בפד"י. אל תסתמך רק על מאגרי מידע אלקטרוניים - חפש במיוחד אם יש ציון "פ"ד" עם כרך ועמוד.
סמן isPublished: false רק אם חיפשת במפורש פרסום בפד"י ווידאת שהוא לא קיים.
הפורמט:
{"found":true/false,"party1":"שם צד א","party2":"שם צד ב","date":"DD.MM.YYYY","court":"בית המשפט","isPublished":true/false,"padi_volume":"כרך","padi_part":"חלק","padi_page":"עמוד","databaseName":"שם מאגר","year":"YYYY","confidence":"high/low"}
שמות צדדים: שם משפחה בלבד לאנשים פרטיים, שם מלא לתאגידים. ללא תארים.
confidence: "high" אם מצאת מידע מפורש ומוסכם ממקורות רבים, "low" אם יש ספק או מקור יחיד.
חשוב: שדה year/date חייב להיות תאריך/שנת מתן פסק הדין על ידי בית המשפט, ולא שנת הוצאת כרך פ"ד.`,
                },
                { role: "user", content: query },
              ],
            };
            const docketAnchor = extractDocket(fullCaseRef);
            const caseSearchRun = await perplexityWithFallback(
              PERPLEXITY_API_KEY,
              caseSearchBody,
              `case-number:${fullCaseRef}`,
              docketAnchor
                ? { docketAnchor: { num: docketAnchor.num, year: docketAnchor.year }, forceOpenWebFallback: true }
                : { forceOpenWebFallback: true },
            );
            const perplexityResp = caseSearchRun.resp!;
            console.log(`[case-law] tier=${caseSearchRun.tier} tier1_trusted=${caseSearchRun.tier1_trusted} tier2_fired=${caseSearchRun.tier2_fired} tier2_trusted=${caseSearchRun.tier2_trusted} docket_anchor_ok=${caseSearchRun.docket_anchor_ok} docket_anchor_via=${caseSearchRun.docket_anchor_via} dropped=${JSON.stringify(caseSearchRun.tier2_dropped_hosts)}`);

            if (perplexityResp.ok) {
              const pData = await perplexityResp.json();
              const pContent = pData.choices?.[0]?.message?.content || "";
              console.log(`[case-law] perplexity sources for ${fullCaseRef}:`, JSON.stringify({
                citations: pData.citations ?? null,
                search_results: pData.search_results ?? null,
                model: pData.model,
              }));
              console.log("Case law search result:", pContent);
              const jsonMatch = pContent.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                try {
                  let parsed = JSON.parse(jsonMatch[0]);

                  // ── Strict party-source agreement check (kills adjacent-case / cited-precedent contamination) ──
                  // The Perplexity snippet for a Supreme Court PDF often excerpts a paragraph
                  // *inside* the judgment that cites a different precedent — so the loose
                  // "party1 OR party2 anywhere in snippet" rule can accept parties from a
                  // cited neighbor instead of the actual caption. We require either:
                  //   (a) BOTH parties present in the anchored title+snippet  → "both", or
                  //   (b) one party adjacent (≤40 chars) to a caption marker
                  //       (נ׳ / נ' / נגד / העותרים / המשיבים / המערערים / המבקשים) → "caption_marker"
                  // Otherwise drop the parties and render explicit [חסר: שמות צדדים].
                  let partyMismatch = false;
                  let partyVerification: "both" | "caption_marker" | "insufficient_snippet" | "no_anchor" | "n/a" = "n/a";
                  let docketAnchored = false;
                  if (docketAnchor) {
                    // Anchor against BOTH structured search_results AND raw citation URLs.
                    // Some sonar-pro responses populate only `citations` (no
                    // `search_results`), and previously that left the guard inert.
                    const searchResults: Array<Record<string, unknown>> = Array.isArray(pData.search_results)
                      ? pData.search_results : [];
                    const citationUrls: string[] = Array.isArray(pData.citations)
                      ? (pData.citations as unknown[]).filter((u): u is string => typeof u === "string")
                      : [];
                    // A result counts as anchored if (a) its URL references
                    // the docket via any encoded channel, OR (b) the URL is
                    // on a trusted legal host AND the title/snippet contains
                    // the literal docket. Branch (b) closes a blind spot for
                    // pre-electronic-era Supreme Court cases (filed before
                    // ~1995): nevo/takdin serve them via opaque slug URLs
                    // that never include "NUM/YY" in the path, so URL-only
                    // anchoring blanks the result even when the case page
                    // itself is correct.
                    const anchoredResults = searchResults.filter((r) => {
                      if (typeof r.url !== "string") return false;
                      if (urlContainsDocket(r.url, docketAnchor)) return true;
                      if (!isTrustedHost(r.url, TRUSTED_LEGAL)) return false;
                      return (
                        textContainsDocket(r.title, docketAnchor) ||
                        textContainsDocket(r.snippet, docketAnchor)
                      );
                    });
                    const anchoredCitationUrls = citationUrls.filter((u) =>
                      urlContainsDocket(u, docketAnchor),
                    );
                    docketAnchored = anchoredResults.length > 0 || anchoredCitationUrls.length > 0;

                    if (parsed.found && parsed.party1 && parsed.party2) {
                      if (anchoredResults.length === 0) {
                        // No anchored snippet → we cannot ground the parties against
                        // the actual case page. Treat as a hard mismatch and drop
                        // every model-supplied fact that depends on the source set
                        // (parties, court, date, publication, database name).
                        partyVerification = "no_anchor";
                        partyMismatch = true;
                        console.log(`[case-law] party_verification=no_anchor for ${fullCaseRef} — no search_result URL contains the docket (citations_anchored=${anchoredCitationUrls.length}). Dropping parties + date + court + isPublished + databaseName.`);
                        parsed.party1 = "";
                        parsed.party2 = "";
                        parsed.confidence = "low";
                        parsed.date = "";
                        parsed.court = "";
                        parsed.isPublished = false;
                        parsed.padi_volume = "";
                        parsed.padi_part = "";
                        parsed.padi_page = "";
                        parsed.databaseName = "";
                      } else {
                        const norm = (s: unknown) =>
                          (typeof s === "string" ? s : "").replace(/\s+/g, " ").trim();
                        const haystack = anchoredResults
                          .map((r) => `${norm(r.title)} ${norm(r.snippet)}`)
                          .join(" \u2014 ");
                        const p1 = norm(parsed.party1);
                        const p2 = norm(parsed.party2);
                        const p1Hit = p1.length >= 3 && haystack.includes(p1);
                        const p2Hit = p2.length >= 3 && haystack.includes(p2);

                        // Caption-marker proximity check: a party token within ~40 chars of a caption marker.
                        const CAPTION_MARKERS = ["נ׳", "נ'", "נגד", "העותרים", "המשיבים", "המערערים", "המבקשים"];
                        const nearMarker = (party: string): boolean => {
                          if (party.length < 3) return false;
                          const idx = haystack.indexOf(party);
                          if (idx < 0) return false;
                          const windowStart = Math.max(0, idx - 40);
                          const windowEnd = Math.min(haystack.length, idx + party.length + 40);
                          const win = haystack.slice(windowStart, windowEnd);
                          return CAPTION_MARKERS.some((m) => win.includes(m));
                        };

                        if (p1Hit && p2Hit) {
                          partyVerification = "both";
                        } else if (nearMarker(p1) || nearMarker(p2)) {
                          partyVerification = "caption_marker";
                        } else {
                          partyVerification = "insufficient_snippet";
                          partyMismatch = true;
                          console.log(`[case-law] party_verification=insufficient_snippet for ${fullCaseRef} — anchored snippet does not contain both parties nor caption-marker proximity. Dropping parties (will render [חסר: שמות צדדים]).`);
                          parsed.party1 = "";
                          parsed.party2 = "";
                          parsed.confidence = "low";
                        }
                      }
                    } else if (!docketAnchored) {
                      // No parties returned AND no anchored URL — log it so we can
                      // distinguish from clean "model said nothing" misses.
                      partyVerification = "no_anchor";
                    }
                  }
                  console.log(`[case-law] party_verification=${partyVerification} party_mismatch=${partyMismatch} docket_anchored=${docketAnchored} for ${fullCaseRef}`);

                  // ── Old-docket retry for pre-electronic-era Supreme Court cases ──
                  // When the standard search couldn't anchor the docket (parties were
                  // dropped), try once more with a stronger query and broader trusted
                  // mirrors (versa.cardozo, he.wikipedia, padi.gov.il). Only fires for
                  // years < 1995 to keep modern-case protection intact.
                  if (!docketAnchored && docketAnchor) {
                    const yNum = parseInt(docketAnchor.year.length === 2
                      ? (parseInt(docketAnchor.year, 10) < 70 ? `20${docketAnchor.year}` : `19${docketAnchor.year}`)
                      : docketAnchor.year, 10);
                    if (Number.isFinite(yNum) && yNum < 1995) {
                      console.log(`[case-law] firing old-docket retry for ${fullCaseRef} (year=${yNum})`);
                      const retryParsed = await retryOldSupremeDocket(
                        PERPLEXITY_API_KEY,
                        caseType,
                        caseNum,
                        String(yNum),
                      );
                      if (retryParsed) {
                        parsed = retryParsed;
                        partyMismatch = false;
                        partyVerification = "both";
                        docketAnchored = true;
                      }
                    }
                  }


                  // ── Secondary verification: if Perplexity says not published, double-check with a focused query ──
                  if (parsed.found && !parsed.isPublished) {
                    console.log(`[case-law] First search says unpublished for ${fullCaseRef}, running verification search...`);
                    try {
                      const verifyResp = await fetch("https://api.perplexity.ai/chat/completions", {
                        method: "POST",
                        headers: {
                          Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          model: "sonar-pro",
                          search_domain_filter: ["nevo.co.il", "court.gov.il", "supreme.court.gov.il", "takdin.co.il", "lite.takdin.co.il", "psakdin.co.il"],
                          messages: [
                            {
                              role: "system",
                              content: `בדוק האם פסק דין ישראלי פורסם בפד"י (פסקי דין). החזר JSON בלבד:
{"isPublished":true/false,"padi_volume":"כרך","padi_part":"חלק","padi_page":"עמוד ראשון"}
אם לא מצאת ציון פד"י, החזר {"isPublished":false}`,
                            },
                            {
                              role: "user",
                              content: `האם ${fullCaseRef} פורסם בפד"י (פסקי דין)? חפש "${caseNum} פ"ד" או "${fullCaseRef} פ"ד כרך". ציין כרך, חלק ועמוד ראשון.`,
                            },
                          ],
                        }),
                      });
                      if (verifyResp.ok) {
                        const vData = await verifyResp.json();
                        const vContent = vData.choices?.[0]?.message?.content || "";
                        console.log("[case-law] Verification search result:", vContent);
                        const vJson = vContent.match(/\{[\s\S]*\}/);
                        if (vJson) {
                          const vParsed = JSON.parse(vJson[0]);
                          if (vParsed.isPublished && vParsed.padi_volume && vParsed.padi_volume.trim() !== "") {
                            // ── Sanity-check the override before accepting ──
                            // 1. The volume must be in PADI_VOLUME_YEAR_RANGES.
                            // 2. The decision year (from parsed) must fall within
                            //    that window (±2y already baked into the ranges).
                            // 3. ≥1 trusted citation URL must contain the docket.
                            const vol = String(vParsed.padi_volume).trim();
                            const range = PADI_VOLUME_YEAR_RANGES[vol];
                            const decisionYearStr = String(parsed.year || "").trim()
                              || (String(parsed.date || "").match(/(\d{4})/)?.[1] ?? "");
                            const decisionYear = decisionYearStr ? parseInt(decisionYearStr, 10) : NaN;
                            const yearOk = !range || (Number.isFinite(decisionYear)
                              && decisionYear >= range[0] - 2 && decisionYear <= range[1] + 2);
                            const docketOk = !docketAnchor
                              || anyUrlContainsDocket(vData.citations, docketAnchor);
                            const volKnown = !!range; // unknown vol → don't trust the override
                            if (yearOk && docketOk && volKnown) {
                              console.log(`[case-law] Verification found פד"י publication! Overriding.`);
                              parsed.isPublished = true;
                              parsed.padi_volume = vParsed.padi_volume;
                              parsed.padi_part = vParsed.padi_part || parsed.padi_part;
                              parsed.padi_page = vParsed.padi_page || parsed.padi_page;
                              parsed.confidence = "high";
                            } else {
                              console.log(`[case-law] padi_override_rejected vol=${vol} year=${decisionYearStr} vol_known=${volKnown} year_ok=${yearOk} docket_ok=${docketOk}`);
                            }
                          }
                        }
                      }
                    } catch (verifyErr) {
                      console.error("[case-law] Verification search error:", verifyErr);
                    }
                  }

                  // Reconcile decision date/year for published cases (Rule 18).
                  // First-pass `date`/`year` is often the volume's print year or fabricated.
                  await reconcilePublishedDate(PERPLEXITY_API_KEY, caseType, caseNum, parsed);



                  // Normalize databaseName from Perplexity citation URLs (lite.takdin → תקדין,
                  // supremedecisions.court.gov.il → אר״ש, etc). Overrides free-form strings.
                  if (!parsed.isPublished) {
                    const normalized = normalizeDatabaseName(pData.citations, parsed.databaseName);
                    if (normalized) parsed.databaseName = normalized;
                  }

                  // Validate data quality: reject bogus results with empty/placeholder fields
                  const hasValidDate = parsed.date && !/^0+\.0+\.0+$/.test(parsed.date) && parsed.date.trim() !== "";
                  const hasValidParties = parsed.party1 && parsed.party1.trim() !== "" && parsed.party2 && parsed.party2.trim() !== "";
                  const hasValidPublication = (parsed.isPublished && parsed.padi_volume && parsed.padi_volume.trim() !== "") || (!parsed.isPublished && parsed.databaseName && parsed.databaseName.trim() !== "");
                  // Treat anchor-verified-but-parties-dropped as usable so we render [חסר: שמות צדדים]
                  // rather than silently hiding the citation behind a wrong fallback.
                  const dataIsUsable = parsed.found && (hasValidParties || partyMismatch) && (hasValidDate || hasValidPublication);
                  
                  if (dataIsUsable) {
                    let details = `\n\n══ נתוני פסק דין שנמצאו בחיפוש ══\n`;
                    details += `תיק: ${fullCaseRef}\n`;
                    if (hasValidParties) {
                      details += `צדדים: **${parsed.party1}** נ' **${parsed.party2}**\n`;
                    } else if (partyMismatch) {
                      details += `צדדים: [חסר: שמות צדדים]\n`;
                    }
                    if (parsed.court) details += `בית משפט: ${parsed.court}\n`;
                    if (parsed.isPublished && parsed.padi_volume && parsed.padi_volume.trim() !== "") {
                      caseLawOverrideLabel = "פסיקה (דפוס)";
                      const part = parsed.padi_part ? `(${parsed.padi_part})` : "";
                      details += `פרסום: פ"ד ${parsed.padi_volume}${part} ${parsed.padi_page || ""}\n`;
                    }
                    if (!parsed.isPublished && parsed.databaseName && parsed.databaseName.trim() !== "") {
                      caseLawOverrideLabel = "פסיקה (מאגר)";
                      details += `מאגר: ${parsed.databaseName}\n`;
                      // Add uncertainty note for low-confidence database classifications
                      if (parsed.confidence === "low") {
                        details += `⚠️ הערה: לא ניתן לאמת בוודאות אם פסק הדין פורסם בפ"ד. מוצג כפסיקה ממאגר. אם ידוע לך שפורסם בפ"ד, נא לציין כרך וחלק.\n`;
                      }
                    }
                    if (hasValidDate) details += `תאריך: ${parsed.date}\n`;
                    if (parsed.year && parsed.year.trim() !== "") details += `שנה: ${parsed.year}\n`;
                    if (caseLawOverrideLabel === "פסיקה (דפוס)") {
                      details += `══ נמצא פרסום בפ"ד, לכן חובה לעצב את האזכור כפסיקה (דפוס) לפי כלל 18. אין לציין מאגר או תאריך בסוגריים במקום פ"ד. ══`;
                    } else {
                      details += `══ השתמש בנתונים אלו לעיצוב האזכור. אם הנתונים חלקיים, סמן [חסר:...] לשדות החסרים. ══`;
                    }
                    console.log(`[case-law] overrideLabel=${caseLawOverrideLabel ?? 'none'}, confidence=${parsed.confidence ?? 'unknown'}`);
                    caseLawHint = details;
                  } else {
                    console.log(`[case-law] Data unusable for ${fullCaseRef}: found=${parsed.found}, validParties=${hasValidParties}, validDate=${hasValidDate}, validPub=${hasValidPublication}`);
                    caseLawHint = `\n\n══ חיפוש פסק דין ══\nלא נמצאו נתונים מאומתים עבור ${fullCaseRef}.\nחובה להשתמש ב-[חסר:...] עבור כל שדה שאינו ידוע (צדדים, תאריך, בית משפט, פרסום/מאגר).\nאל תמציא שמות צדדים, תאריכים, או פרטי פרסום.\n══`;
                  }
                } catch (e) {
                  console.error("Failed to parse case law search JSON:", e);
                  caseLawHint = `\n\n══ חיפוש פסק דין ══\nלא נמצאו נתונים מאומתים עבור ${fullCaseRef}.\nחובה להשתמש ב-[חסר:...] עבור כל שדה שאינו ידוע (צדדים, תאריך, בית משפט, פרסום/מאגר).\nאל תמציא שמות צדדים, תאריכים, או פרטי פרסום.\n══`;
                }
              } else {
                console.log(`[case-law] No JSON found in Perplexity response for ${fullCaseRef}`);
                caseLawHint = `\n\n══ חיפוש פסק דין ══\nלא נמצאו נתונים מאומתים עבור ${fullCaseRef}.\nחובה להשתמש ב-[חסר:...] עבור כל שדה שאינו ידוע (צדדים, תאריך, בית משפט, פרסום/מאגר).\nאל תמציא שמות צדדים, תאריכים, או פרטי פרסום.\n══`;
              }
            } else {
              console.error("Perplexity search failed:", perplexityResp.status);
              caseLawHint = `\n\n══ חיפוש פסק דין ══\nלא נמצאו נתונים מאומתים עבור ${caseNumberMatch[0]}.\nחובה להשתמש ב-[חסר:...] עבור כל שדה שאינו ידוע.\n══`;
            }

          // ── Branch B: Search by party names (multi-result) ──
          } else if (partyMatch) {
            const rawParty1 = partyMatch[1].trim();
            const party2 = partyMatch[2].trim();

            // Strip a leading BIU procedure prefix from party1 (e.g. סע"ש, ת"א).
            // Keep the prefix as the user-supplied caseType for filtering and search focus.
            const normalizeQuotes = (s: string) => s.replace(/[״"]/g, '"').replace(/[׳']/g, "'");
            let userCaseTypeNorm: string | null = null;
            let party1 = rawParty1;
            const leadingPrefixMatch = rawParty1.match(new RegExp("^(" + CASE_TYPE_PREFIX_RE.source + ")\\s+(.+)$"));
            if (leadingPrefixMatch) {
              userCaseTypeNorm = normalizeQuotes(leadingPrefixMatch[1]);
              party1 = leadingPrefixMatch[2].trim();
            } else if (partyMatch?.index !== undefined) {
              // Fallback: prefix sitting just before the parties in the cleaned text.
              const window = cleanedForParty.slice(Math.max(0, partyMatch.index - 20), partyMatch.index);
              const localPrefix = window.match(new RegExp(CASE_TYPE_PREFIX_RE.source + "\\s*$"));
              if (localPrefix) userCaseTypeNorm = normalizeQuotes(localPrefix[0]);
            }

            const searchQuery = userCaseTypeNorm
              ? `${userCaseTypeNorm} ${party1} נגד ${party2}`
              : `${party1} נגד ${party2}`;
            console.log(`[case-law] Party-name search: "${searchQuery}" (rawParty1="${rawParty1}", party1="${party1}", party2="${party2}", caseType=${userCaseTypeNorm ?? 'none'})`);

            const partySearchBody: Record<string, unknown> = {
              model: "sonar-pro",
              search_domain_filter: ["nevo.co.il", "court.gov.il", "supreme.court.gov.il", "takdin.co.il", "lite.takdin.co.il", "psakdin.co.il"],
              messages: [
                {
                  role: "system",
                  content: `אתה עוזר מחקר משפטי ישראלי. מצא את כל פסקי הדין הרלוונטיים בין הצדדים שניתנו.
טיפ חיפוש: ב-https://lite.takdin.co.il/search-results מופיעים בעמוד אחד שמות הצדדים ומספר התיק — חפש שם כדי לאתר את הצדדים והדוקט.
חשוב: בערכי המחרוזות בתוך ה-JSON, השתמש אך ורק בגרשיים עבריים (״ U+05F4) או בגרש (׳ U+05F3) במקום במירכאות כפולות (") — למשל "פד״י" במקום "פד"י", "פ״ד" במקום "פ"ד", "ע״א" במקום "ע"א". מירכאות כפולות בתוך ערך מחרוזת ישברו את ה-JSON.
כללים:
- מקסימום 5 תוצאות, ממוינות מהחדש לישן
- שמות צדדים: שם משפחה בלבד לאנשים פרטיים, שם מלא לתאגידים. ללא תארים.
- כלול את כל סוגי ההליכים (ערעור, בקשת רשות ערעור, משפט ראשוני וכו')
- שדה "caseType" חייב להכיל את הקיצור הרשמי של סוג ההליך לפי כללי האזכור האחיד (למשל: סע״ש, ע״א, ת״א, בג״ץ, רע״א, עת״מ, תמ״ש, תפ״ח, ת״פ). אסור להחזיר תיאור מילולי כמו "תביעה" או "תביעה פלילית".
- חובה לכבד את סדר הצדדים שהמשתמש כתב. אם פסק הדין הרשמי הפוך, אל תחזיר אותו אלא אם זה אכן הפסק שהמשתמש מבקש.
- חובה למלא את שדות party1 ו-party2 לכל תוצאה. אם לא הצלחת לאמת שמות צדדים, אל תחזיר את התוצאה.
- אם נתון תאריך מלא (DD.MM.YYYY) לא נמצא במקור — השאר את date ריק. אל תמציא תאריך.
- ⚠️ קריטי לגבי פרסום בפ"ד: סמן isPublished=true ומלא padi_volume/padi_part/padi_page/year אך ורק אם ראית את הציון "פ"ד <כרך> <עמוד>" יחד עם מספר התיק המדויק במקור מהימן (nevo.co.il, supreme.court.gov.il, court.gov.il, psakdin.co.il). אסור להסיק כרך/עמוד/שנה מתוצאות takdin/lite.takdin — שם המידע מעורבב בין תיקים סמוכים. אם אינך בטוח, החזר isPublished=false ו-padi_volume/padi_part/padi_page/year ריקים.
- חובה לכלול source_url לכל תוצאה — הקישור המדויק שממנו לקחת את שמות הצדדים והדוקט. ללא source_url התוצאה תיפסל.
- אם לא נמצאו תוצאות, החזר {"results":[]}`,
                },
                {
                  role: "user",
                  content: userCaseTypeNorm
                    ? `מצא את פסק הדין הישראלי מסוג ${userCaseTypeNorm} שבו ${party1} הוא צד א׳ ו-${party2} הוא צד ב׳. כלול את מספר התיק המלא, בית המשפט, תאריך פסק הדין המדויק (DD.MM.YYYY) ושם המאגר (תקדין/נבו/פדאור). חפש קודם ב-lite.takdin.co.il.`
                    : `מצא את כל פסקי הדין הישראליים בין ${party1} ל${party2}. כלול ערעורים, בקשות רשות ערעור, ודיונים נוספים בין הצדדים. בדוק גם פרסום בפ״ד.`,
                },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  schema: {
                    type: "object",
                    properties: {
                      results: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            found: { type: "boolean" },
                            caseType: { type: "string" },
                            caseNumber: { type: "string" },
                            party1: { type: "string" },
                            party2: { type: "string" },
                            date: { type: "string" },
                            court: { type: "string" },
                            isPublished: { type: "boolean" },
                            padi_volume: { type: "string" },
                            padi_part: { type: "string" },
                            padi_page: { type: "string" },
                            databaseName: { type: "string" },
                            year: { type: "string" },
                            source_url: { type: "string" },
                          },
                        },
                      },
                    },
                    required: ["results"],
                  },
                },
              },
            };
            const partySearchRun = await perplexityWithFallback(
              PERPLEXITY_API_KEY,
              partySearchBody,
              `party:${searchQuery}`,
            );
            const partySearchResp = partySearchRun.resp!;
            console.log(`[case-law] party tier=${partySearchRun.tier} tier1_trusted=${partySearchRun.tier1_trusted} tier2_fired=${partySearchRun.tier2_fired} tier2_trusted=${partySearchRun.tier2_trusted} dropped=${JSON.stringify(partySearchRun.tier2_dropped_hosts)}`);

            if (partySearchResp.ok) {
              const psData = await partySearchResp.json();
              const psContent = psData.choices?.[0]?.message?.content || "";
              console.log("[case-law] party-search sources:", JSON.stringify({
                citations: psData.citations ?? null,
                search_results: psData.search_results ?? null,
                model: psData.model,
              }));
              console.log("[case-law] Party search result:", psContent);

              const psJsonMatch = psContent.match(/\{[\s\S]*\}/);
              if (psJsonMatch) {
                const rawJson = psJsonMatch[0];
                // Repair: replace unescaped ASCII " sitting between Hebrew letters
                // (e.g. פ"ד, פד"י, ס"ח, ת"א, ע"א) with Hebrew gershayim ״ (U+05F4).
                // These are never JSON delimiters in our domain.
                const repairedJson = rawJson.replace(/([\u0590-\u05FF])"([\u0590-\u05FF])/g, "$1\u05F4$2");
                let psParsed: Record<string, unknown> | null = null;
                try {
                  psParsed = JSON.parse(repairedJson);
                } catch (e1) {
                  console.warn("[case-law] First parse attempt failed, trying raw:", e1);
                  try {
                    psParsed = JSON.parse(rawJson);
                  } catch (e2) {
                    console.error("[case-law] Failed to parse party search JSON:", e2);
                    caseLawHint = `\n\n══ חיפוש פסק דין ══\nלא הצלחתי לחפש פסקי דין בין ${party1} ל${party2}.\nבקש מהמשתמש לספק מספר תיק מדויק.\n══`;
                  }
                }
                if (psParsed) {
                  try {
                  const rawResults = Array.isArray(psParsed.results) ? psParsed.results.filter((r: Record<string, unknown>) => r.found) : [];

                  // ── Relevance filter: drop hallucinated results that share only a surname ──
                  const STOPWORDS = new Set(["נ", "נגד", "של", "את", "עם", "על", "בין", "מדינת", "מדינה", "ה"]);
                  const tokenize = (s: string): string[] =>
                    s.split(/[\s,'"״׳\-־.()]+/u)
                      .map((t) => t.trim())
                      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
                  const userP1Tokens = tokenize(party1);
                  const userP2Tokens = tokenize(party2);
                  const hasOverlap = (resultParty: string, tokens: string[]) =>
                    tokens.length === 0 || tokens.some((t) => resultParty.includes(t));

                  // Detect user-typed caseType prefix from the outer scope (already
                  // stripped from rawParty1 above, or detected via 20-char window).
                  // Already declared at outer scope: `userCaseTypeNorm`, `normalizeQuotes`.

                  const results = rawResults.filter((r: Record<string, unknown>) => {
                    const rp1 = String(r.party1 || "");
                    const rp2 = String(r.party2 || "");
                    const rType = normalizeQuotes(String(r.caseType || ""));
                    const rNum = String(r.caseNumber || "").trim();
                    const hasParties = rp1.length > 0 && rp2.length > 0;

                    // Strong match: result's caseType matches user's prefix AND has a docket.
                    // This rescues correct results where Perplexity dropped party fields.
                    const caseTypeMatchesUser = !!userCaseTypeNorm && rType === userCaseTypeNorm;
                    const hasDocket = /\d/.test(rNum);

                    if (hasParties) {
                      // Order-preserving: result.p1 ⊇ user.p1 AND result.p2 ⊇ user.p2
                      const sameOrder = hasOverlap(rp1, userP1Tokens) && hasOverlap(rp2, userP2Tokens);
                      if (!sameOrder) {
                        // Allow if caseType+docket strongly match user's request despite reversed parties
                        if (caseTypeMatchesUser && hasDocket) {
                          console.log(`[case-law] Keeping reversed-parties result on caseType+docket match: ${rType} ${rNum}`);
                        } else {
                          console.log(`[case-law] Dropping irrelevant result: "${rp1}" נ' "${rp2}" (user typed: "${party1}" / "${party2}")`);
                          return false;
                        }
                      }
                    } else {
                      // Empty parties — keep only if caseType+docket strongly match user's request.
                      if (!(caseTypeMatchesUser && hasDocket)) {
                        console.log(`[case-law] Dropping empty-parties result without strong caseType match: caseType=${rType}, num=${rNum}`);
                        return false;
                      }
                      console.log(`[case-law] Accepting empty-parties result on caseType+docket match: ${rType} ${rNum}`);
                    }

                    // If user supplied a caseType prefix, drop results from a different known prefix
                    if (userCaseTypeNorm) {
                      const rTypeIsKnownPrefix = CASE_TYPE_PREFIXES.some(
                        (p) => normalizeQuotes(p) === rType,
                      );
                      if (rType && rTypeIsKnownPrefix && rType !== userCaseTypeNorm) {
                        console.log(`[case-law] Dropping cross-jurisdiction result: caseType=${rType}, user=${userCaseTypeNorm}`);
                        return false;
                      }
                    }
                    return true;
                  });

                  console.log(`[case-law] Filtered ${rawResults.length} → ${results.length} relevant results`);

                  // ── Publication-data hallucination guard ──
                  // Takdin/lite.takdin pages mix metadata between neighboring cases, so the
                  // model often invents padi_volume/padi_page/year from sidebar noise.
                  // Trust padi_* only when source_url is on a trusted publisher domain AND
                  // the year is consistent with the docket year. Otherwise, run a focused
                  // verification call; if that also fails, strip padi_* fields.
                  const TRUSTED_PUB_DOMAINS = [
                    "nevo.co.il",
                    "supreme.court.gov.il",
                    "court.gov.il",
                    "psakdin.co.il",
                  ];
                  const docketYearOf = (caseNumber: string): number | null => {
                    const m = String(caseNumber || "").match(/\/(\d{2,4})\b/);
                    if (!m) return null;
                    const n = parseInt(m[1], 10);
                    if (Number.isNaN(n)) return null;
                    if (n >= 1000) return n;
                    // 2-digit: assume 19xx for ≥40, 20xx otherwise (Israeli legal docket convention)
                    return n >= 40 ? 1900 + n : 2000 + n;
                  };
                  const isTrustedPubUrl = (url: unknown): boolean => {
                    if (typeof url !== "string" || !url) return false;
                    try {
                      const host = new URL(url).hostname.toLowerCase();
                      return TRUSTED_PUB_DOMAINS.some((d) => host === d || host.endsWith("." + d));
                    } catch {
                      return false;
                    }
                  };

                  const verifyPadiPublication = async (
                    caseType: string,
                    caseNumber: string,
                  ): Promise<{ verified: boolean; padi_volume?: string; padi_part?: string; padi_page?: string; year?: string } | null> => {
                    try {
                      const fullRef = `${caseType} ${caseNumber}`;
                      const verifyResp = await fetch("https://api.perplexity.ai/chat/completions", {
                        method: "POST",
                        headers: {
                          Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          model: "sonar-pro",
                          search_domain_filter: TRUSTED_PUB_DOMAINS,
                          messages: [
                            {
                              role: "system",
                              content: `בדוק האם פסק דין ישראלי פורסם בפד"י, רק על סמך מקורות מהימנים (nevo / supreme.court.gov.il / court.gov.il / psakdin). אל תשתמש ב-takdin. החזר JSON בלבד:\n{"isPublished":true/false,"padi_volume":"כרך","padi_part":"חלק","padi_page":"עמוד ראשון","year":"YYYY"}\nאם לא ראית במפורש "פ"ד <כרך> <עמוד>" יחד עם מספר התיק, החזר {"isPublished":false}.`,
                            },
                            {
                              role: "user",
                              content: `האם ${fullRef} פורסם בפד"י? חפש "${caseNumber} פ\"ד" וציין כרך, חלק, עמוד ראשון ושנת פרסום.`,
                            },
                          ],
                        }),
                      });
                      if (!verifyResp.ok) return null;
                      const vData = await verifyResp.json();
                      const vContent = vData.choices?.[0]?.message?.content || "";
                      const vJson = vContent.match(/\{[\s\S]*\}/);
                      if (!vJson) return null;
                      const vParsed = JSON.parse(
                        vJson[0].replace(/([\u0590-\u05FF])"([\u0590-\u05FF])/g, "$1\u05F4$2"),
                      );
                      if (vParsed.isPublished && vParsed.padi_volume && String(vParsed.padi_volume).trim()) {
                        return {
                          verified: true,
                          padi_volume: String(vParsed.padi_volume).trim(),
                          padi_part: vParsed.padi_part ? String(vParsed.padi_part).trim() : "",
                          padi_page: vParsed.padi_page ? String(vParsed.padi_page).trim() : "",
                          year: vParsed.year ? String(vParsed.year).trim() : "",
                        };
                      }
                      return { verified: false };
                    } catch (e) {
                      console.error("[case-law] verifyPadiPublication error:", e);
                      return null;
                    }
                  };

                  for (const r of results) {
                    // Normalize databaseName for unpublished results based on source_url
                    if (!r.isPublished) {
                      const normalized = normalizeDatabaseName(r.source_url, r.databaseName);
                      if (normalized) r.databaseName = normalized;
                    }
                    const claimsPub = !!r.isPublished && !!r.padi_volume && String(r.padi_volume).trim() !== "";
                    if (!claimsPub) continue;
                    const dy = docketYearOf(String(r.caseNumber || ""));
                    const ry = parseInt(String(r.year || ""), 10);
                    const yearMismatch = dy != null && !Number.isNaN(ry) && Math.abs(ry - dy) > 3;
                    const trusted = isTrustedPubUrl(r.source_url);
                    const halfPub = (!!r.padi_volume) !== (!!r.padi_page);
                    const dateMissing = !r.date || !String(r.date).trim();
                    const suspect = yearMismatch || halfPub || (claimsPub && dateMissing) || !trusted;
                    console.log(
                      `[case-law] pub-guard: ${r.caseType} ${r.caseNumber} ` +
                      `dy=${dy} ry=${ry} trustedUrl=${trusted} suspect=${suspect} src=${r.source_url ?? "none"}`,
                    );
                    if (!suspect) continue;
                    const v = await verifyPadiPublication(String(r.caseType || userCaseTypeNorm || ""), String(r.caseNumber || ""));
                    if (v && v.verified && v.padi_volume) {
                      console.log(`[case-law] pub-guard: verified, overriding padi_* for ${r.caseType} ${r.caseNumber}`);
                      r.padi_volume = v.padi_volume;
                      if (v.padi_part) r.padi_part = v.padi_part;
                      if (v.padi_page) r.padi_page = v.padi_page;
                      if (v.year) r.year = v.year;
                      r.isPublished = true;
                    } else {
                      console.log(`[case-law] pub-guard: verification failed, stripping padi_* for ${r.caseType} ${r.caseNumber}`);
                      r.padi_volume = "";
                      r.padi_part = "";
                      r.padi_page = "";
                      r.isPublished = false;
                      // Year may also be hallucinated from Takdin sidebar — keep only if it
                      // matches the docket year window.
                      if (yearMismatch) r.year = "";
                    }
                    // Re-normalize if pub-guard flipped isPublished to false
                    if (!r.isPublished) {
                      const normalized = normalizeDatabaseName(r.source_url, r.databaseName);
                      if (normalized) r.databaseName = normalized;
                    }
                    // Reconcile decision date/year for surviving published cases (Rule 18).
                    if (r.isPublished && r.padi_volume) {
                      await reconcilePublishedDate(
                        PERPLEXITY_API_KEY,
                        String(r.caseType || userCaseTypeNorm || ""),
                        String(r.caseNumber || ""),
                        r as Record<string, unknown>,
                      );
                    }
                  }


                  if (results.length === 0) {
                    console.log(`[case-law] No relevant results found for party search "${searchQuery}"`);
                    caseLawHint = `\n\n══ חיפוש פסק דין ══\nלא נמצאו פסקי דין רלוונטיים בין ${party1} ל${party2}.\nבקש מהמשתמש לספק מספר תיק מדויק (למשל ע"פ 1234/56) לחיפוש מדויק יותר.\n══`;
                  } else if (results.length === 1) {
                    // Single result – use same logic as case-number search
                    const r = results[0];
                    // Fallback: if Perplexity dropped party fields, use the user-typed parties.
                    const effP1 = (r.party1 && String(r.party1).trim()) || party1;
                    const effP2 = (r.party2 && String(r.party2).trim()) || party2;
                    const fullRef = `${r.caseType || userCaseTypeNorm || "[חסר: סוג הליך]"} ${r.caseNumber || "[חסר: מספר תיק]"}`;
                    let details = `\n\n══ נתוני פסק דין שנמצאו בחיפוש ══\n`;
                    details += `תיק: ${fullRef}\n`;
                    details += `צדדים: **${effP1}** נ' **${effP2}**\n`;
                    if (r.court) details += `בית משפט: ${r.court}\n`;
                    if (r.isPublished && r.padi_volume) {
                      caseLawOverrideLabel = "פסיקה (דפוס)";
                      const part = r.padi_part ? `(${r.padi_part})` : "";
                      details += `פרסום: פ"ד ${r.padi_volume}${part} ${r.padi_page || ""}\n`;
                    } else if (r.databaseName) {
                      caseLawOverrideLabel = "פסיקה (מאגר)";
                      details += `מאגר: ${r.databaseName}\n`;
                    }
                    if (r.date && String(r.date).trim()) {
                      details += `תאריך: ${r.date}\n`;
                    } else {
                      details += `תאריך: [חסר: תאריך]  ⚠️ חובה לכתוב במפורש "[חסר: תאריך]" באזכור — אסור להמציא תאריך.\n`;
                    }
                    if (r.year) details += `שנה: ${r.year}\n`;
                    const partyLockLine = `\n⚠️ חובה מוחלטת: השתמש בשמות הצדדים בדיוק כפי שמופיעים כאן — "${effP1}" ו-"${effP2}". אסור להוסיף שמות פרטיים, תארים, "עזבון", "יורשי" או כל תוספת אחרת, גם אם אתה "זוכר" אותם ממקור אחר. כלל 18.4: שם משפחה בלבד לאנשים פרטיים.\n`;
                    const spacingLine = `⚠️ חובה: רווח בין "פ\"ד" לכרך (למשל: פ"ד לג(2) 281, ולא פ"דלג).\n`;
                    if (caseLawOverrideLabel === "פסיקה (דפוס)") {
                      details += `${partyLockLine}${spacingLine}══ חובה לעצב כפסיקה (דפוס) לפי כלל 18, תוך שימוש בלעדי בנתונים שלמעלה. ══`;
                    } else {
                      details += `${partyLockLine}══ השתמש אך ורק בנתונים שלמעלה. אסור להוסיף מידע מהזיכרון. אם נתון חסר — סמן [חסר:...]. ══`;
                    }
                    caseLawHint = details;
                  } else {
                    // Multiple results – present disambiguation list with embedded data blobs
                    console.log(`[case-law] Found ${results.length} relevant results for party search "${searchQuery}"`);
                    let details = `\n\n══ נמצאו מספר פסקי דין תואמים ══\n`;
                    details += `הצג למשתמש את הרשימה הבאה ובקש ממנו לבחור את פסק הדין הרלוונטי:\n\n`;
                    results.forEach((r: Record<string, unknown>, i: number) => {
                      const ref = `${r.caseType || userCaseTypeNorm || "?"} ${r.caseNumber || "?"}`;
                      const effP1 = (r.party1 && String(r.party1).trim()) || party1;
                      const effP2 = (r.party2 && String(r.party2).trim()) || party2;
                      const parties = `${effP1} נ' ${effP2}`;
                      const year = r.year || "";
                      const court = r.court || "";
                      // Embed full data so the selection branch can skip a re-search.
                      // Backfill missing parties with user-typed values so downstream is consistent.
                      const blob = encodeURIComponent(JSON.stringify({
                        caseType: r.caseType || userCaseTypeNorm || "",
                        caseNumber: r.caseNumber,
                        party1: effP1, party2: effP2,
                        date: r.date, court: r.court,
                        isPublished: r.isPublished,
                        padi_volume: r.padi_volume, padi_part: r.padi_part, padi_page: r.padi_page,
                        databaseName: r.databaseName, year: r.year,
                      }));
                      details += `${i + 1}. ${ref} ${parties}${year ? ` (${year})` : ""}${court ? ` — ${court}` : ""}<!--DATA:${blob}-->\n`;
                    });
                    details += `\n══ שאל את המשתמש: "נמצאו מספר פסקי דין בין הצדדים. לאיזה פסק דין התכוונת?" והצג את הרשימה הממוספרת בדיוק כפי שהיא, כולל הסימון <!--DATA:...--> בסוף כל שורה (זהו סימן טכני שמועבר חזרה במערכת ולא מוצג למשתמש). לאחר שהמשתמש יבחר, עצב את האזכור לפי הנתונים שנמצאו. ══`;
                    caseLawHint = details;
                  }
                  } catch (e) {
                    console.error("[case-law] Error processing party search results:", e);
                    caseLawHint = `\n\n══ חיפוש פסק דין ══\nלא הצלחתי לחפש פסקי דין בין ${party1} ל${party2}.\nבקש מהמשתמש לספק מספר תיק מדויק.\n══`;
                  }
                }
              }
            } else {
              console.error("[case-law] Party search failed:", partySearchResp.status);
            }
          }
        }
      } catch (e) {
        console.error("Case law search error:", e);
      }
    }

    // ── Legislation search via Perplexity ──
    let legislationHint = "";
    let hasTrustedLegislationPage = false;
    const isLegislation = classMatch && /חקיקה|חוק יסוד|חקיקת משנה/.test(classMatch[1]);
    if (isLegislation && !hasVerifiedCandidates) {
      try {
        const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
        if (PERPLEXITY_API_KEY) {
          // Extract law name: strip classification tag and engine hint
          const lawName = userInput
            .replace(/\[סיווג אוטומטי:\s*[^\]]+\]\s*/, "")
            .replace(/\n?══ מנוע אזכור[\s\S]*?══════════════════════════════════\n?/m, "")
            .trim();

          if (lawName.length > 2) {
            console.log(`[legislation] Searching Perplexity for: ${lawName}`);
            const legQuery = `מצא את פרטי הפרסום הרשמי של החוק הישראלי "${lawName}". חפש באיזה ספר חוקים הוא פורסם (ס"ח - ספר החוקים, ק"ת - קובץ התקנות, או נ"ח - נוסח חדש), באיזו שנה עברית ולועזית, ומה מספר העמוד הראשון. אם זה פקודה מנדטורית שפורסמה בנוסח חדש, ציין זאת.`;

            const legResp = await fetch("https://api.perplexity.ai/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "sonar",
                messages: [
                  {
                    role: "system",
                    content: `אתה עוזר מחקר משפטי ישראלי. החזר תשובה בפורמט JSON בלבד.
חפש את פרטי הפרסום הרשמי של החוק. לחקיקה ראשית חפש בספר החוקים (ס"ח). לחקיקת משנה (תקנות, צווים) חפש בקובץ התקנות (ק"ת). לפקודות מנדטוריות בנוסח חדש חפש בנוסח חדש (נ"ח).
הפורמט:
{"found":true/false,"lawName":"שם החוק המלא","hebrewYear":"שנה עברית","gregorianYear":1965,"collection":"ס\\"ח","page":63,"isNewVersion":false,"isCombinedVersion":false}
collection חייב להיות אחד מ: ס"ח, ק"ת, נ"ח, ע"ר

חשוב מאוד: page הוא מספר העמוד הראשון שבו מופיע החיקוק בקובץ החקיקה, ולא מספר החוברת בקובץ החקיקה.
דוגמה: חוק הירושה, התשכ"ה–1965 פורסם בס"ח חוברת 446, עמוד 63. הערך הנכון של page הוא 63 (העמוד), ולא 446 (החוברת).
דוגמה נוספת: חוק העונשין, התשל"ז-1977 פורסם בס"ח חוברת 864, עמוד 226. הערך הנכון של page הוא 226.

isNewVersion=true אם החוק הוא בנוסח חדש (נו"ח).
isCombinedVersion=true אם החוק הוא בנוסח משולב.`,
                  },
                  { role: "user", content: legQuery },
                ],
              }),
            });

            if (legResp.ok) {
              const legData = await legResp.json();
              const legContent = legData.choices?.[0]?.message?.content || "";
              const legJsonMatch = legContent.match(/\{[\s\S]*?\}/);
              if (legJsonMatch) {
                try {
                  const legParsed = JSON.parse(legJsonMatch[0]);
                  if (legParsed.found && legParsed.lawName && legParsed.collection) {
                    hasTrustedLegislationPage = Boolean(legParsed.page);
                    console.log(`[legislation] Found: ${legParsed.lawName}, ${legParsed.collection} ${legParsed.page || '?'}, ${legParsed.hebrewYear || '?'}`);
                    let details = `\n\n══ נתוני חקיקה מאומתים ══\n`;
                    details += `שם החוק: ${legParsed.lawName}\n`;
                    if (legParsed.hebrewYear) details += `שנה עברית: ${legParsed.hebrewYear}\n`;
                    if (legParsed.gregorianYear) details += `שנה לועזית: ${legParsed.gregorianYear}\n`;
                    details += `קובץ פרסום: ${legParsed.collection}`;
                    if (legParsed.page) details += ` ${legParsed.page}`;
                    details += `\n`;
                    if (legParsed.isNewVersion) details += `נוסח חדש: כן\n`;
                    if (legParsed.isCombinedVersion) details += `נוסח משולב: כן\n`;
                    details += `══ השתמש בנתונים אלו לעיצוב אזכור החקיקה. אם קובץ הפרסום כולל מספר עמוד, אל תוסיף [חסר: עמוד] — הנתונים מאומתים. סמן [חסר:...] רק לשדות שאינם מופיעים למעלה. ══`;
                    legislationHint = details;
                  } else {
                    console.log(`[legislation] Data unusable: found=${legParsed.found}, lawName=${legParsed.lawName}, collection=${legParsed.collection}`);
                    legislationHint = `\n\n══ חיפוש חקיקה ══\nלא נמצאו נתוני פרסום מאומתים עבור "${lawName}".\nחובה להשתמש ב-[חסר:...] עבור שדות פרסום שאינם ידועים (ס"ח, עמוד, שנה).\nאל תמציא נתוני פרסום.\n══`;
                  }
                } catch (e) {
                  console.error("[legislation] Failed to parse JSON:", e);
                  legislationHint = `\n\n══ חיפוש חקיקה ══\nלא נמצאו נתוני פרסום מאומתים עבור "${lawName}".\nחובה להשתמש ב-[חסר:...] עבור שדות פרסום שאינם ידועים.\n══`;
                }
              }
            } else {
              console.error("[legislation] Perplexity search failed:", legResp.status);
            }
          }
        }
      } catch (e) {
        console.error("[legislation] search error:", e);
      }
    }

    // ── Regulation (תקנון) search via Perplexity ──
    let regulationHint = "";
    const isRegulation = classMatch && /תקנון/.test(classMatch[1]);
    if (isRegulation && !hasVerifiedCandidates) {
      try {
        const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
        if (PERPLEXITY_API_KEY) {
          const regName = userInput
            .replace(/\[סיווג אוטומטי:\s*[^\]]+\]\s*/, "")
            .replace(/\n?══ מנוע אזכור[\s\S]*?══════════════════════════════════\n?/m, "")
            .trim();

          if (regName.length > 2) {
            console.log(`[regulation] Searching Perplexity for: ${regName}`);
            const regQuery = `מצא את התקנון הישראלי "${regName}". ציין: 1) שם התקנון המלא, 2) התאריך הלועזי המדויק (יום.חודש.שנה) של הנוסח העדכני ביותר (תאריך התיקון האחרון, או תאריך קבלתו אם לא תוקן), 3) קיצור מקובל אם יש (למשל תקשי"ר).`;

            const regResp = await fetch("https://api.perplexity.ai/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "sonar",
                messages: [
                  {
                    role: "system",
                    content: `אתה עוזר מחקר משפטי ישראלי. החזר תשובה בפורמט JSON בלבד.
חפש את פרטי התקנון (bylaw/regulation) הישראלי. מצא את השם המלא, התאריך הלועזי המדויק של הנוסח העדכני (DD.MM.YYYY), וקיצור מקובל אם קיים.
הפורמט:
{"found":true/false,"regulationName":"שם התקנון המלא","fullDate":"DD.MM.YYYY","abbreviation":"קיצור מקובל אם יש"}
אם לא מצאת, החזר {"found":false}.
חשוב: התאריך חייב להיות תאריך לועזי מדויק בפורמט DD.MM.YYYY (למשל 30.4.2019). אם התקנון תוקן – תאריך התיקון האחרון. אם לא תוקן – תאריך קבלתו.`,
                  },
                  { role: "user", content: regQuery },
                ],
              }),
            });

            if (regResp.ok) {
              const regData = await regResp.json();
              const regContent = regData.choices?.[0]?.message?.content || "";
              const regJsonMatch = regContent.match(/\{[\s\S]*?\}/);
              if (regJsonMatch) {
                try {
                  const regParsed = JSON.parse(regJsonMatch[0]);
                  if (regParsed.found && regParsed.regulationName) {
                    console.log(`[regulation] Found: ${regParsed.regulationName}, date=${regParsed.fullDate || '?'}`);
                    let details = `\n\n══ נתוני תקנון מאומתים ══\n`;
                    details += `שם התקנון: ${regParsed.regulationName}\n`;
                    if (regParsed.fullDate) details += `תאריך: ${regParsed.fullDate}\n`;
                    if (regParsed.abbreviation) details += `קיצור: ${regParsed.abbreviation}\n`;
                    details += `══ השתמש בנתונים אלו לעיצוב אזכור התקנון לפי כלל 13.1. סמן [חסר:...] רק לשדות שאינם מופיעים למעלה. ══`;
                    regulationHint = details;
                  } else {
                    console.log(`[regulation] Data unusable: found=${regParsed.found}`);
                    regulationHint = `\n\n══ חיפוש תקנון ══\nלא נמצאו נתונים מאומתים עבור "${regName}".\nחובה להשתמש ב-[חסר:...] עבור שדות חסרים (תאריך, שם תקנון).\nאל תמציא תאריכים.\n══`;
                  }
                } catch (e) {
                  console.error("[regulation] Failed to parse JSON:", e);
                  regulationHint = `\n\n══ חיפוש תקנון ══\nלא נמצאו נתונים מאומתים עבור "${regName}".\nחובה להשתמש ב-[חסר:...] עבור שדות חסרים.\n══`;
                }
              }
            } else {
              console.error("[regulation] Perplexity search failed:", regResp.status);
            }
          }
        }
      } catch (e) {
        console.error("[regulation] search error:", e);
      }
    }

    // ── Book (ספר) search via Perplexity ──
    let bookHint = "";
    const isBook = classMatch && /ספרות|ספר/.test(classMatch[1]);
    const isUnknown = classMatch && /לא מזוהה|אחר/.test(classMatch[1]);
    const noClassTag = !classMatch;
    // Also trigger book search for unknown/untagged types that look like Hebrew name + title (4+ words, no legislation markers)
    const cleanedForBookCheck = userInput.replace(/\[סיווג אוטומטי:\s*[^\]]+\]\s*/, "").replace(/\n?══ מנוע אזכור[\s\S]*?══════════════════════════════════\n?/m, "").trim();
    const looksLikeBook = (isUnknown || noClassTag) && 
      /^[\u0590-\u05FF]/.test(cleanedForBookCheck.replace(/['׳"״`]/g, '')) && 
      cleanedForBookCheck.split(/\s+/).length >= 4 &&
      !/נ['']|נגד|חוק |פקודת |תקנות|הצעת חוק|אמנ|ד["״]כ/.test(cleanedForBookCheck);
    if ((isBook || looksLikeBook) && !hasVerifiedCandidates) {
      try {
        const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
        if (PERPLEXITY_API_KEY) {
          const bookQuery = userInput
            .replace(/\[סיווג אוטומטי:\s*[^\]]+\]\s*/, "")
            .replace(/\n?══ מנוע אזכור[\s\S]*?══════════════════════════════════\n?/m, "")
            .trim();

          if (bookQuery.length > 2) {
            console.log(`[book] Searching Perplexity for: ${bookQuery}`);
            const bookSearchQuery = `מצא את הספר המשפטי/אקדמי הישראלי "${bookQuery}". ציין: 1) שם המחבר/ים המלא (ללא תארים אקדמיים/צבאיים), 2) שם הספר המלא, 3) שנת פרסום לועזית, 4) שנת פרסום עברית אם קיימת, 5) מהדורה (רק אם יש יותר ממהדורה אחת), 6) שם העורך אם יש, 7) שם המתרגם אם יש, 8) מספר כרכים אם יש, 9) שם ההוצאה לאור, 10) האם המחבר הוא מוסד/גוף ציבורי.`;

            const bookRun = await perplexityWithFallback(
              PERPLEXITY_API_KEY,
              {
                model: "sonar-pro",
                // Open web — no domain filter. Recall first; title-anchor + author cross-check enforce safety.
                messages: [
                  {
                    role: "system",
                    content: `אתה עוזר מחקר משפטי ישראלי. החזר תשובה בפורמט JSON בלבד.
חפש את פרטי הספר המשפטי/אקדמי הישראלי. מצא את כל הפרטים הביבליוגרפיים.
הפורמט:
{"found":true/false,"author":"שם המחבר/ים (ללא תארים)","bookTitle":"שם הספר המלא","year":2019,"hebrewYear":"התשע\\"ט","edition":"מהדורה שנייה","editor":"שם העורך","translator":"שם המתרגם","volumes":"מספר כרכים","publisher":"הוצאה לאור","isInstitutional":false}
אם לא מצאת מקור מפורש המייחס את הספר למחבר כלשהו, החזר {"found":false}. אל תנחש מחבר.
חשוב:
- שמות מחברים ללא תארים אקדמיים (פרופ', ד"ר) או צבאיים (אלוף, סא"ל) או אחרים (עו"ד, שופט).
- אם המחבר הוא מוסד/ועדה/גוף ציבורי, סמן isInstitutional: true וכתוב את שם המוסד בשדה author.
- אם יש שנה עברית ולועזית, ציין את שתיהן. שנה עברית מתחילה תמיד באות ה' (למשל: התשע"ט).
- ציין מהדורה רק אם יש יותר ממהדורה אחת.
- השאר שדות ריקים ("") אם המידע לא ידוע.`,
                  },
                  { role: "user", content: bookSearchQuery },
                ],
              },
              "book",
            );

            const bookResp = bookRun.resp;

            if (bookResp && bookResp.ok) {
              const bookData = await bookResp.json();
              const bookContent = bookData.choices?.[0]?.message?.content || "";
              const bookCitations = bookData.citations;
              const bookSearchResults = bookData.search_results;
              console.log(`[book] Perplexity raw response: ${bookContent.substring(0, 300)}`);
              const bookJsonMatch = bookContent.match(/\{[\s\S]*?\}/);
              if (bookJsonMatch) {
                try {
                  const bookParsed = JSON.parse(bookJsonMatch[0]);
                  // ── Journal-clue guard: Perplexity sometimes returns "book" for journal articles.
                  // If the publisher / journalName / bookTitle hints at a journal, treat as unusable
                  // and let the cross-type fallback (article search) take over.
                  const journalRe = /כתב.?עת|משפטים|עיוני\s+משפט|הפרקליט|משפט\s+וממשל|דין\s+ודברים|מחקרי\s+משפט|תיאוריה\s+וביקורת|עלי\s+משפט|מאזני\s+משפט|חוקים|המשפט/;
                  const looksLikeJournal =
                    (bookParsed?.publisher && journalRe.test(String(bookParsed.publisher))) ||
                    (bookParsed?.journalName && String(bookParsed.journalName).length > 0) ||
                    (bookParsed?.bookTitle && journalRe.test(String(bookParsed.bookTitle)));
                  if (looksLikeJournal) {
                    console.log(`[book] journal clue detected in book response → forcing article fallback. publisher="${bookParsed?.publisher || ""}"`);
                    bookParsed.found = false;
                  }
                  if (bookParsed.found && bookParsed.bookTitle && (bookParsed.author || bookParsed.year)) {
                    // ── Title-anchor gate ──
                    const anchor = anchorTitleInSources(
                      bookParsed.bookTitle || bookQuery,
                      bookCitations,
                      bookSearchResults,
                      { authorHint: bookParsed.author },
                    );
                    const totalCitations = Array.isArray(bookCitations) ? bookCitations.length : 0;
                    const onlyUntrustedSingleHit =
                      anchor.anchored && totalCitations <= 1 && anchor.trustedAnchorUrls.length === 0;
                    let authorConfirmed = false;
                    if (!anchor.anchored) {
                      console.log(`[book] title_anchored=false — dropping all model-supplied fields for "${bookQuery}"`);
                      bookParsed.author = "";
                      bookParsed.year = "";
                      bookParsed.hebrewYear = "";
                      bookParsed.edition = "";
                      bookParsed.editor = "";
                      bookParsed.translator = "";
                      bookParsed.volumes = "";
                      bookParsed.publisher = "";
                    } else if (bookParsed.author && !bookParsed.isInstitutional) {
                      // ── Author cross-check pass ──
                      const inSource = authorAppearsInSources(bookParsed.author, bookCitations, bookSearchResults);
                      const verify = await verifyBiblioAuthor(PERPLEXITY_API_KEY, "book", bookParsed.bookTitle || bookQuery);
                      const agrees = verify && verify.author && authorsAgree(bookParsed.author, verify.author);
                      const inVerify = verify && authorAppearsInSources(bookParsed.author, verify.citations, verify.search_results);
                      // Stronger requirement when anchor is weak OR only one untrusted citation exists
                      const needStrict = anchor.quality === "weak" || onlyUntrustedSingleHit;
                      authorConfirmed = needStrict
                        ? !!(agrees && (inSource || inVerify))
                        : !!(inSource || (agrees && (inSource || inVerify)));
                      console.log(`[book] author_check anchor_quality=${anchor.quality} trusted_anchors=${anchor.trustedAnchorUrls.length} strict=${needStrict} in_source=${inSource} verify="${verify?.author || ""}" agrees=${!!agrees} in_verify=${!!inVerify} confirmed=${authorConfirmed}`);
                      if (!authorConfirmed) {
                        console.log(`[book] author_dropped first="${bookParsed.author}" verify="${verify?.author || ""}"`);
                        // Prefer a high-confidence different author that appears in our sources
                        if (verify && verify.author && authorAppearsInSources(verify.author, bookCitations, bookSearchResults)) {
                          console.log(`[book] author_replaced with verify="${verify.author}"`);
                          bookParsed.author = verify.author;
                          authorConfirmed = true;
                        } else {
                          bookParsed.author = "";
                        }
                      }
                    } else if (bookParsed.isInstitutional) {
                      authorConfirmed = authorAppearsInSources(bookParsed.author || "", bookCitations, bookSearchResults);
                      if (!authorConfirmed) bookParsed.author = "";
                    }
                    console.log(`[book] decision tier=${bookRun.tier} title_anchored=${anchor.anchored} anchor_quality=${anchor.quality} trusted_anchors=${anchor.trustedAnchorUrls.length} author_confirmed=${authorConfirmed}`);

                    console.log(`[book] Found: ${bookParsed.bookTitle}, author=${bookParsed.author || '?'}, year=${bookParsed.year || '?'}`);
                    let details = `\n\n══ נתוני ספר שנמצאו בחיפוש ══\n`;
                    if (bookParsed.author) details += `מחבר: ${bookParsed.author}\n`;
                    else details += `מחבר: [חסר — לא אומת מול מקור]\n`;
                    details += `שם הספר: ${bookParsed.bookTitle}\n`;
                    if (bookParsed.year) details += `שנה לועזית: ${bookParsed.year}\n`;
                    if (bookParsed.year && bookParsed.hebrewYear) {
                      details += `הנחיה חשובה (כלל 23.9): מכיוון שקיימות גם שנה עברית וגם שנה לועזית, יש לציין רק את השנה הלועזית (${bookParsed.year}). אין לציין את השנה העברית.\n`;
                    }
                    if (bookParsed.hebrewYear && !bookParsed.year) details += `שנה עברית: ${bookParsed.hebrewYear}\n`;
                    if (bookParsed.edition) details += `מהדורה: ${bookParsed.edition}\n`;
                    if (bookParsed.editor) details += `עורך: ${bookParsed.editor}\n`;
                    if (bookParsed.translator) details += `מתרגם: ${bookParsed.translator}\n`;
                    if (bookParsed.volumes) details += `כרכים: ${bookParsed.volumes}\n`;
                    if (bookParsed.publisher) details += `הוצאה לאור: ${bookParsed.publisher}\n`;
                    if (bookParsed.isInstitutional) details += `מחבר מוסדי: כן\n`;
                    details += `══ השתמש בנתונים אלו לעיצוב אזכור הספר לפי כלל 23. אם המחבר ריק או מסומן [חסר...], אל תמציא מחבר — סמן [חסר: מחבר]. סמן [חסר:...] לכל שדה שאינו מופיע. ══`;
                    bookHint = details;
                  } else {
                    console.log(`[book] Data unusable: found=${bookParsed.found}, title=${bookParsed.bookTitle}`);
                    bookHint = `\n\n══ חיפוש ספר ══\nלא נמצאו נתונים מאומתים עבור "${bookQuery}".\nחובה להשתמש ב-[חסר:...] עבור שדות חסרים.\nאל תמציא נתונים ביבליוגרפיים.\n══`;
                  }
                } catch (e) {
                  console.error("[book] Failed to parse JSON:", e);
                  bookHint = `\n\n══ חיפוש ספר ══\nלא נמצאו נתונים מאומתים עבור "${bookQuery}".\nחובה להשתמש ב-[חסר:...] עבור שדות חסרים.\n══`;
                }
                // ── Cross-type fallback: book → article search ──
                if (!bookHint || /חיפוש ספר ══\nלא נמצאו/.test(bookHint)) {
                  const fb = await fallbackBiblioSearch(PERPLEXITY_API_KEY, bookQuery, "article");
                  console.log(`[book] fallback=article hit=${!!fb} kind=${fb?.kind || "none"}`);
                  if (fb) { bookHint = fb.hint; }
                }
              }
            } else {
              console.error("[book] Perplexity search failed:", bookResp?.status);
            }
          }
        }
      } catch (e) {
        console.error("[book] search error:", e);
      }
    }

    // ── Article (מאמר) search via Perplexity ──
    let articleHint = "";
    const isArticle = classMatch && /מאמר/.test(classMatch[1]);
    if (isArticle && !hasVerifiedCandidates) {
      try {
        const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
        if (PERPLEXITY_API_KEY) {
          const articleQuery = userInput
            .replace(/\[סיווג אוטומטי:\s*[^\]]+\]\s*/, "")
            .replace(/\n?══ מנוע אזכור[\s\S]*?══════════════════════════════════\n?/m, "")
            .trim();

          if (articleQuery.length > 2) {
            const isArticleInBook = /מאמר שפורסם בספר/.test(classMatch![1]) || /בתוך|בספר/.test(articleQuery);
            console.log(`[article] Searching Perplexity for: ${articleQuery} (inBook=${isArticleInBook})`);

            const articleSearchPrompt = isArticleInBook
              ? `מצא את המאמר "${articleQuery}" שפורסם בספר. ציין: 1) שם מחבר המאמר (ללא תארים), 2) שם המאמר המלא, 3) שם מחבר הספר (ללא תארים), 4) שם הספר המלא, 5) כרך (אם יש), 6) עמוד תחילת המאמר, 7) עורך/ים, 8) שנת פרסום לועזית, 9) האם מחבר המאמר זהה למחבר הספר.`
              : `מצא את המאמר האקדמי/משפטי הישראלי: "${articleQuery}". ציין: 1) שם המחבר/ים המלא (ללא תארים אקדמיים/צבאיים), 2) שם המאמר המלא, 3) שם כתב העת, 4) מספר כרך (אותיות או מספרים כמו במקור), 5) מספר חוברת (אם רלוונטי), 6) עמוד תחילת המאמר, 7) שנת פרסום לועזית, 8) שנת פרסום עברית (אם קיימת), 9) האם זה עיתון יומי ואם כן שם החלק ותאריך פרסום מלא.`;

            const articleSystemPrompt = isArticleInBook
              ? `אתה עוזר מחקר משפטי ישראלי. החזר תשובה בפורמט JSON בלבד.
חפש מאמר שפורסם בתוך ספר. מצא את כל הפרטים הביבליוגרפיים.
הפורמט:
{"found":true,"type":"article_in_book","author":"שם מחבר המאמר","articleTitle":"שם המאמר","bookAuthor":"שם מחבר הספר","bookTitle":"שם הספר","volume":"","firstPage":"","editor":"","year":0,"sameAuthor":false}
אם לא מצאת, החזר {"found":false}.
חשוב: שמות ללא תארים (פרופ', ד"ר, עו"ד). sameAuthor=true אם מחבר המאמר זהה למחבר הספר.`
              : `אתה עוזר מחקר משפטי ישראלי. החזר תשובה בפורמט JSON בלבד.
חפש מאמר אקדמי/משפטי ישראלי. מצא את כל הפרטים הביבליוגרפיים.
הפורמט:
{"found":true,"type":"journal","author":"שם מחבר","articleTitle":"שם המאמר","journalName":"שם כתב העת","volume":"","notebook":"","firstPage":"","year":0,"hebrewYear":"","newspaperSection":"","newspaperDate":""}
אם type הוא "newspaper" (עיתון יומי), ציין את שם החלק ב-newspaperSection ותאריך פרסום מלא ב-newspaperDate.
אם לא מצאת, החזר {"found":false}.
חשוב: שמות ללא תארים (פרופ', ד"ר, עו"ד). כרך כמו במקור (אותיות עבריות או מספרים).`;

            const artRun = await perplexityWithFallback(
              PERPLEXITY_API_KEY,
              {
                model: "sonar-pro",
                // Open web — no domain filter. Recall first; title-anchor + author cross-check enforce safety.
                messages: [
                  { role: "system", content: articleSystemPrompt + `\nאל תנחש מחבר — אם אינך מוצא מקור מפורש המייחס את המאמר למחבר כלשהו, החזר {"found":false}.` },
                  { role: "user", content: articleSearchPrompt },
                ],
              },
              "article",
            );
            const artResp = artRun.resp;

            if (artResp && artResp.ok) {
              const artData = await artResp.json();
              const artContent = artData.choices?.[0]?.message?.content || "";
              const artCitations = artData.citations;
              const artSearchResults = artData.search_results;
              console.log(`[article] Perplexity raw response: ${artContent.substring(0, 300)}`);
              const artJsonMatch = artContent.match(/\{[\s\S]*?\}/);
              if (artJsonMatch) {
                try {
                  const art = JSON.parse(artJsonMatch[0]);
                  if (art.found && art.articleTitle && (art.author || art.journalName || art.bookTitle)) {
                    // ── Title-anchor gate ──
                    const anchor = anchorTitleInSources(
                      art.articleTitle || articleQuery,
                      artCitations,
                      artSearchResults,
                      { authorHint: art.author },
                    );
                    const totalCitations = Array.isArray(artCitations) ? artCitations.length : 0;
                    const onlyUntrustedSingleHit =
                      anchor.anchored && totalCitations <= 1 && anchor.trustedAnchorUrls.length === 0;
                    let authorConfirmed = false;
                    if (!anchor.anchored) {
                      console.log(`[article] title_anchored=false — dropping all model-supplied fields for "${articleQuery}"`);
                      art.author = "";
                      art.bookAuthor = "";
                      art.year = "";
                      art.hebrewYear = "";
                      art.journalName = "";
                      art.volume = "";
                      art.notebook = "";
                      art.firstPage = "";
                      art.editor = "";
                      art.bookTitle = art.bookTitle || "";
                    } else if (art.author) {
                      const inSource = authorAppearsInSources(art.author, artCitations, artSearchResults);
                      const verify = await verifyBiblioAuthor(PERPLEXITY_API_KEY, "article", art.articleTitle || articleQuery);
                      const agrees = verify && verify.author && authorsAgree(art.author, verify.author);
                      const inVerify = verify && authorAppearsInSources(art.author, verify.citations, verify.search_results);
                      const needStrict = anchor.quality === "weak" || onlyUntrustedSingleHit;
                      authorConfirmed = needStrict
                        ? !!(agrees && (inSource || inVerify))
                        : !!(inSource || (agrees && (inSource || inVerify)));
                      console.log(`[article] author_check anchor_quality=${anchor.quality} trusted_anchors=${anchor.trustedAnchorUrls.length} strict=${needStrict} in_source=${inSource} verify="${verify?.author || ""}" agrees=${!!agrees} in_verify=${!!inVerify} confirmed=${authorConfirmed}`);
                      if (!authorConfirmed) {
                        console.log(`[article] author_dropped first="${art.author}" verify="${verify?.author || ""}"`);
                        // If verify returned a high-confidence different author that IS in sources, prefer it
                        if (verify && verify.author && authorAppearsInSources(verify.author, artCitations, artSearchResults)) {
                          console.log(`[article] author_replaced with verify="${verify.author}"`);
                          art.author = verify.author;
                          authorConfirmed = true;
                        } else {
                          art.author = "";
                        }
                      }
                    }
                    console.log(`[article] decision tier=${artRun.tier} title_anchored=${anchor.anchored} anchor_quality=${anchor.quality} trusted_anchors=${anchor.trustedAnchorUrls.length} author_confirmed=${authorConfirmed}`);

                    console.log(`[article] Found: ${art.articleTitle}, author=${art.author || '?'}, journal=${art.journalName || ''}, book=${art.bookTitle || ''}`);

                    if (art.type === "article_in_book" || isArticleInBook) {
                      // Article in book hint
                      let details = `\n\n══ נתוני מאמר בספר שנמצאו בחיפוש ══\n`;
                      if (art.author) details += `מחבר המאמר: ${art.author}\n`;
                      else details += `מחבר המאמר: [חסר — לא אומת מול מקור]\n`;
                      details += `שם המאמר: ${art.articleTitle}\n`;
                      // Guard: editors must never occupy the book-author slot (rule 24.11 / 23.7)
                      const EDITOR_MARK_RE = /עורכ(?:ים|ות|ת)?\b|עורך\b/;
                      if (art.bookAuthor && EDITOR_MARK_RE.test(art.bookAuthor)) {
                        if (!art.editor) art.editor = art.bookAuthor;
                        art.bookAuthor = "";
                      }
                      if (art.bookAuthor) details += `מחבר הספר: ${art.bookAuthor}\n`;
                      if (art.bookTitle) details += `שם הספר: ${art.bookTitle}\n`;
                      if (art.volume) details += `כרך: ${art.volume}\n`;
                      if (art.firstPage) details += `עמוד ראשון: ${art.firstPage}\n`;
                      if (art.editor) details += `עורך: ${art.editor}\n`;
                      if (art.year) details += `שנה: ${art.year}\n`;
                      if (art.sameAuthor) details += `מחבר זהה: כן (לפי כלל 24.11 – אין לחזור על שם המחבר לפני שם הספר)\n`;
                      if (art.editor) details += `הנחיה מחייבת (כלל 23.7): שמות העורכים יופיעו אך ורק בתוך הסוגריים בסוף האזכור, לפני השנה. אין לכתוב אותם לפני שם הספר.\n`;
                      details += `══ השתמש בנתונים אלו לעיצוב אזכור לפי כלל 24.11. אם המחבר ריק או מסומן [חסר...], אל תמציא מחבר — סמן [חסר: מחבר]. סמן [חסר:...] לכל שדה שאינו מופיע. ══`;
                      articleHint = details;
                    } else {
                      // Journal / newspaper hint
                      let details = `\n\n══ נתוני מאמר שנמצאו בחיפוש ══\n`;
                      if (art.author) details += `מחבר: ${art.author}\n`;
                      else details += `מחבר: [חסר — לא אומת מול מקור]\n`;
                      details += `שם מאמר: ${art.articleTitle}\n`;
                      if (art.journalName) details += `כתב עת: ${art.journalName}\n`;
                      if (art.volume) details += `כרך: ${art.volume}\n`;
                      if (art.notebook) details += `חוברת: ${art.notebook}\n`;
                      if (art.firstPage) details += `עמוד ראשון: ${art.firstPage}\n`;
                      if (art.year) details += `שנה: ${art.year}\n`;
                      // Rule 24.9.2: if both years exist, instruct to use only Gregorian
                      if (art.year && art.hebrewYear) {
                        details += `הנחיה חשובה (כלל 24.9.2): מכיוון שקיימות גם שנה עברית וגם שנה לועזית, יש לציין רק את השנה הלועזית (${art.year}). אין לציין את השנה העברית.\n`;
                      }
                      if (art.hebrewYear && !art.year) details += `שנה עברית: ${art.hebrewYear}\n`;

                      // Special cases
                      if (art.journalName && /פרשת השבוע/.test(art.journalName)) {
                        details += `הנחיה מיוחדת: כלל 24.12.2 — ציין פרשה לפני השנה, ללא עמוד ראשון.\n`;
                      }
                      if (art.journalName && /משפט,?\s*חברה ותרבות/.test(art.journalName) && art.year && art.year < 2018) {
                        details += `הנחיה מיוחדת: כלל 24.12.1 — אזכר כמאמר בספר לפי כלל 24.11.\n`;
                      }
                      if (art.type === "newspaper" || art.newspaperSection) {
                        if (art.newspaperSection) details += `חלק בעיתון: ${art.newspaperSection}\n`;
                        if (art.newspaperDate) details += `תאריך פרסום: ${art.newspaperDate}\n`;
                        details += `הנחיה: עיתון יומי — שם כתב העת מודגש עם נקודתיים לפני שם החלק: **שם:חלק**\n`;
                      }

                      details += `══ השתמש בנתונים אלו לעיצוב אזכור לפי כלל 24. אם המחבר ריק או מסומן [חסר...], אל תמציא מחבר — סמן [חסר: מחבר]. סמן [חסר:...] לכל שדה שאינו מופיע. ══`;
                      articleHint = details;
                    }
                  } else {
                    console.log(`[article] Data unusable: found=${art.found}, title=${art.articleTitle}`);
                    articleHint = `\n\n══ חיפוש מאמר ══\nלא נמצאו נתונים מאומתים עבור "${articleQuery}".\nחובה להשתמש ב-[חסר:...] עבור שדות חסרים.\nאל תמציא נתונים ביבליוגרפיים.\n══`;
                  }
                } catch (e) {
                  console.error("[article] Failed to parse JSON:", e);
                  articleHint = `\n\n══ חיפוש מאמר ══\nלא נמצאו נתונים מאומתים עבור "${articleQuery}".\nחובה להשתמש ב-[חסר:...] עבור שדות חסרים.\n══`;
                }
                // ── Cross-type fallback: article → book search ──
                if (!articleHint || /חיפוש מאמר ══\nלא נמצאו/.test(articleHint)) {
                  const fb = await fallbackBiblioSearch(PERPLEXITY_API_KEY, articleQuery, "book");
                  console.log(`[article] fallback=book hit=${!!fb} kind=${fb?.kind || "none"}`);
                  if (fb) { articleHint = fb.hint; }
                }
              }
            } else {
              console.error("[article] Perplexity search failed:", artResp?.status);
            }
          }
        }
      } catch (e) {
        console.error("[article] search error:", e);
      }
    }

    const enhancedMessages = messages.map((m: { role: string; content: string }, i: number) => {
      if (i === messages.length - 1 && m.role === "user") {
        let content = m.content;
        if (caseLawOverrideLabel) {
          content = content
            .replace(/\[סיווג אוטומטי:\s*[^\]]+\]/, `[סיווג אוטומטי: ${caseLawOverrideLabel}]`)
            .replace(/\n?══ מנוע אזכור[\s\S]*?══════════════════════════════════\n?/m, "\n");
        }

        // Inject engine hint + verified source hints + case law search + legislation search + regulation search + book search + article search into the last user message
        const engineHint = extractEngineHint(content);
        const allHints = engineHint + (verifiedHint || "") + caseLawHint + legislationHint + regulationHint + bookHint + articleHint;
        if (allHints || content !== m.content) {
          return { ...m, content: content + allHints };
        }
      }
      return m;
    });

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...enhancedMessages,
          ],
        }),
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || "אירעה שגיאה.";
    let content = sanitizeHallucinatedPublicationData(rawContent, {
      hasVerifiedCandidates,
      hasTrustedLegislationPage,
      messages,
      userInput,
    });
    content = fixHebrewYearPrefix(content);
    content = normalizeArticleYearByRule2492(content);
    // Rule 1.10: Hebrew number ranges must be high→low (renders low on the right in RTL).
    content = normalizeHebrewNumberRanges(content);
    // Rule 24.11 / 23.7: editors belong inside the trailing parentheses, not
    // in the book-author slot before the book title.
    content = content
      .split("\n")
      .map((line) => normalizeEditorPlacement(line))
      .join("\n");
    content = ensureCitationTrailingPeriod(content);
    // Strip persona/preamble openings if the model regresses
    content = content.replace(
      /^\s*(?:["'״׳]?\s*)?(העוזר[^\n]*|המערכת[^\n]*מזהה[^\n]*|מכיוון שמדובר[^\n]*|אני\s+(?:מזהה|מבין|מבחין)[^\n]*|שלב\s*\d+[^\n]*)\n+/u,
      "",
    );

    // Post-response safety net: if the AI returned a refusal/non-meaningful answer,
    // automatically refund the credit so the user isn't charged for an unusable result.
    if (isRefusalResponseServer(content)) {
      await refundIfCharged("invalid_input_refusal");
      return new Response(
        JSON.stringify({
          content,
          refunded: true,
          refundReason: "הקלט לא היה ברור דיו לעיבוד",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat error:", e);
    await refundIfCharged("citation-chat exception");
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", refunded: !!creditRequestId, refundReason: "טעות טכנית" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});