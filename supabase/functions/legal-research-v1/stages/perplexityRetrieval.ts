// P3.1 — Perplexity retrieval. Broad discovery, classification, strict admission.
// Discovery-only results are kept in telemetry, never admitted to the pool.
// For useful clues in discovery-only items (docket, statute+section), one
// follow-up search is run to surface the canonical/official source.

import {
  Candidate,
  CAPS,
  DroppedSource,
  Query,
  SourceRole,
  StageRun,
} from "../lib/types.ts";

const PPLX_TIMEOUT_MS = 25_000;

// ─── Domain → source class ──────────────────────────────────────────────────

type SourceClass =
  | "official_primary"        // Supreme Court / court.gov.il / justice / supremedecisions
  | "court_case"              // recognized case-law databases
  | "legislation"             // nevo law page, knesset law page
  | "government_report"       // gov.il / mevaker / official committee
  | "academic"                // .ac.il, university domains
  | "publisher"               // SSRN paper/abstract page, jstor, journal articles
  | "discovery_only"          // law firm blog, kol-zchut, news, scholar, generic publisher
  | "commercial_secondary"    // commercial DBs without direct cite-able URL
  | "news"
  | "unknown"
  | "bad";                    // wikipedia, broken

const OFFICIAL_COURT_DOMAINS = new Set([
  "supremedecisions.court.gov.il",
  "supreme.court.gov.il",
  "court.gov.il",
  "elyon1.court.gov.il",
]);
const COURT_DB_DOMAINS = new Set([
  "nevo.co.il", "takdin.co.il", "lite.takdin.co.il", "psakdin.co.il", "din.org.il",
]);
const KNESSET_DOMAINS = new Set([
  "main.knesset.gov.il", "knesset.gov.il", "fs.knesset.gov.il",
]);
const GOV_REPORT_DOMAINS_SUFFIX = ["gov.il", "mevaker.gov.il", "boi.org.il", "cbs.gov.il", "btl.gov.il"];
const ACADEMIC_SUFFIX = [
  ".ac.il", "academia.edu", "hebrewu.ac.il", "law.bgu.ac.il", "mishpat.ac.il",
];
const PUBLISHER_DOMAINS = new Set([
  "ssrn.com", "papers.ssrn.com", "jstor.org",
]);
const BAD_DOMAINS = new Set([
  "wikipedia.org", "he.wikipedia.org", "en.wikipedia.org",
]);
const DISCOVERY_ONLY_HINTS = [
  "kolzchut", "kol-zchut", "din-online", "law-info", "lawguide",
  "lawyer", "advocate", "calcalist", "themarker", "ynet", "haaretz",
  "globes", "n12", "kan.org.il", "mako.co.il", "walla.co.il",
  "blog", "scholar.google",
];

function getDomain(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function getPath(url: string | undefined): string {
  if (!url) return "";
  try { return new URL(url).pathname.toLowerCase(); } catch { return ""; }
}

function classify(url: string, title: string): SourceClass {
  const domain = getDomain(url);
  const path = getPath(url);
  const titleL = (title || "").toLowerCase();
  if (!domain) return "unknown";
  if (BAD_DOMAINS.has(domain) || domain.endsWith(".wikipedia.org")) return "bad";

  if (OFFICIAL_COURT_DOMAINS.has(domain)) return "official_primary";
  if (KNESSET_DOMAINS.has(domain)) {
    // P3.2 #4: explicit חוק / statute markers in URL or title → legislation
    const looksLaw = /\.pdf$/i.test(path) ||
      /law|legislation|bill/.test(path) ||
      /חוק|הצעת\s+חוק/.test(title);
    if (looksLaw) return "legislation";
    return "government_report";
  }
  if (domain === "justice.gov.il") return "official_primary";

  if (COURT_DB_DOMAINS.has(domain)) {
    if (domain === "nevo.co.il") {
      // P3.2 #4: nevo law_word/*.doc is NOT auto-legislation — could be a case or DB doc.
      if (/\/law_word\//i.test(path)) {
        // Decide by title hints
        if (/חוק\s|תקנות\s|פקודת\s/.test(title)) return "legislation";
        if (/ע"?א|בג"?ץ|רע"?א|ע"?פ|פס"?ד|פסק\s*דין/.test(title)) return "court_case";
        return "court_case"; // default lean
      }
      if (/\/product\/book/i.test(path)) return "publisher";
      if (/\/law/i.test(path)) return "legislation";
      return "court_case";
    }
    return "court_case";
  }

  // scholar.google never final
  if (/scholar\.google\./.test(domain)) return "discovery_only";

  if (PUBLISHER_DOMAINS.has(domain)) {
    if (domain.endsWith("ssrn.com") && !/abstract|papers\.cfm/.test(path)) return "discovery_only";
    return "publisher";
  }

  if (ACADEMIC_SUFFIX.some((s) => domain.endsWith(s))) return "academic";

  // gov.il (non-knesset, non-court): if title says חוק/תקנות → legislation
  if (GOV_REPORT_DOMAINS_SUFFIX.some((s) => domain.endsWith(s))) {
    if (/חוק|תקנות|פקודה/.test(titleL) || /law|statute/.test(path)) return "legislation";
    return "government_report";
  }

  if (DISCOVERY_ONLY_HINTS.some((s) => domain.includes(s) || titleL.includes(s))) {
    return "discovery_only";
  }

  if (/law|mishpat|din|advocate|lawyer/i.test(domain)) return "discovery_only";

  return "unknown";
}

// Admission policy: class × role
function admitFor(role: SourceRole, cls: SourceClass): boolean {
  switch (role) {
    case "primary_statute":
    case "regulation":
      return cls === "legislation" || cls === "official_primary" || cls === "government_report";
    case "binding_case_law":
    case "persuasive_case_law":
      return cls === "official_primary" || cls === "court_case";
    case "scholarship":
      return cls === "academic" || cls === "publisher";
    case "factual_report":
    case "government_report":
      return cls === "government_report" || cls === "official_primary";
  }
}

// P3.2 #4: source-class override — if the source is clearly official legislation
// or an official court case, correct the planner's role rather than dropping.
function correctRoleForClass(
  role: SourceRole,
  cls: SourceClass,
): { role: SourceRole; corrected_from?: SourceRole } {
  // Knesset/gov-il legislation: always admit as primary_statute regardless of original role.
  if (cls === "legislation" && role !== "primary_statute" && role !== "regulation") {
    return { role: "primary_statute", corrected_from: role };
  }
  // Official Supreme Court / court.gov.il: always case law.
  if (cls === "official_primary" && role !== "binding_case_law" && role !== "persuasive_case_law") {
    return { role: "binding_case_law", corrected_from: role };
  }
  if (cls === "court_case" && role !== "binding_case_law" && role !== "persuasive_case_law") {
    return { role: "persuasive_case_law", corrected_from: role };
  }
  return { role };
}

// ─── Role prompts ───────────────────────────────────────────────────────────

const ROLE_PROMPT: Record<SourceRole, { focus: string; hint: string }> = {
  primary_statute: {
    focus: "חקיקה ראשית ישראלית: חוקים וסעיפי חוק רלוונטיים",
    hint: "החזר כותרת מלאה של החוק, סעיף, וקישור ל־nevo.co.il, fs.knesset.gov.il, knesset.gov.il, justice.gov.il, gov.il",
  },
  regulation: {
    focus: "תקנות וצווים ישראליים",
    hint: "החזר את שם התקנה והסעיף, וקישור ל־nevo.co.il / knesset.gov.il / gov.il",
  },
  binding_case_law: {
    focus: "פסיקה מחייבת — בית המשפט העליון ובג\"ץ",
    hint: "החזר שם הצדדים, מספר תיק, וקישור ל־supremedecisions.court.gov.il / court.gov.il / nevo.co.il / takdin / psakdin",
  },
  persuasive_case_law: {
    focus: "פסיקה מנחה — מחוזי, שלום, בתי דין מיוחדים",
    hint: "החזר שם הצדדים, מספר תיק, וקישור למאגר פסיקה מוכר",
  },
  scholarship: {
    focus: "ספרות אקדמית משפטית: מאמרים, ספרים, פרקים",
    hint: "החזר מחבר, כותרת, כתב עת/הוצאה ושנה. עדיף קישור אקדמי או דף מאמר ישיר ב־SSRN/JSTOR",
  },
  factual_report: {
    focus: "דו\"חות עובדתיים, נתונים סטטיסטיים",
    hint: "מקור רשמי או מכון מחקר; קישור ישיר למסמך",
  },
  government_report: {
    focus: "דו\"חות ממשלתיים, מבקר המדינה, ועדות חקירה",
    hint: "קישור ל־gov.il, mevaker.gov.il, knesset.gov.il",
  },
};

interface PplxSource {
  title: string;
  source_type?: string;
  url?: string;
  snippet?: string;
}

async function callPerplexity(query: Query, queryOverride?: string): Promise<{
  raw: PplxSource[];
  ms: number;
  ok: boolean;
  http?: number;
}> {
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  if (!key) return { raw: [], ms: 0, ok: false };
  const role = ROLE_PROMPT[query.role];
  const sys =
    `אתה מאתר מקורות משפטיים ישראליים. עבור התפקיד: ${role.focus}. ${role.hint}. ` +
    `החזר עד ${CAPS.PERPLEXITY_PER_QUERY} מקורות עם כתובת URL ישירה. אל תמציא קישורים.`;
  const t0 = Date.now();
  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: queryOverride || query.query_he },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "sources",
            schema: {
              type: "object",
              properties: {
                sources: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      source_type: { type: "string" },
                      url: { type: "string" },
                      snippet: { type: "string" },
                    },
                    required: ["title"],
                  },
                },
              },
              required: ["sources"],
            },
          },
        },
      }),
      signal: AbortSignal.timeout(PPLX_TIMEOUT_MS),
    });
    const ms = Date.now() - t0;
    if (!r.ok) return { raw: [], ms, ok: false, http: r.status };
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content ?? "";
    const citations: string[] = Array.isArray(j?.citations) ? j.citations : [];
    let parsed: { sources?: PplxSource[] } = {};
    try { parsed = JSON.parse(content); } catch { /* tolerate */ }
    const raw = Array.isArray(parsed.sources)
      ? parsed.sources.slice(0, CAPS.PERPLEXITY_PER_QUERY).map((s, i) => ({
          title: String(s.title ?? "").trim(),
          source_type: String(s.source_type ?? "").trim(),
          url: (s.url && String(s.url).trim()) || citations[i] || "",
          snippet: s.snippet ? String(s.snippet).slice(0, 400) : undefined,
        }))
      : [];
    return { raw, ms, ok: true, http: r.status };
  } catch {
    return { raw: [], ms: Date.now() - t0, ok: false, http: 0 };
  }
}

// ─── Follow-up term extraction from discovery_only ──────────────────────────

const DOCKET_RE = /\b(?:בג"?ץ|בג״ץ|ע"?א|ע״א|רע"?א|רע״א|ע"?פ|ע״פ|דנ"?א|דנ״א|בש"?פ|בש״פ)\s*\d{1,5}\/\d{2,4}\b/g;
const STATUTE_SECTION_RE = /סעיף\s+\d+[א-ת]?\s+ל?חוק[^,?.\n]{0,60}/g;

function extractFollowupTerms(title: string, snippet?: string): string[] {
  const hay = `${title} ${snippet || ""}`;
  const terms = new Set<string>();
  for (const m of hay.matchAll(DOCKET_RE)) terms.add(m[0]);
  for (const m of hay.matchAll(STATUTE_SECTION_RE)) terms.add(m[0]);
  return [...terms].slice(0, 3);
}

// ─── Per-result row in telemetry ────────────────────────────────────────────

interface PplxResultRow {
  title: string;
  url: string;
  domain: string;
  classified_source_class: SourceClass;
  admitted_to_candidate_pool: boolean;
  drop_reason?: string;
  extracted_followup_terms?: string[];
  role_corrected_from?: SourceRole;
  role_corrected_to?: SourceRole;
}

function processRaw(
  query: Query,
  raw: PplxSource[],
): {
  admitted: Candidate[];
  rows: PplxResultRow[];
  followupTerms: string[];
} {
  const admitted: Candidate[] = [];
  const rows: PplxResultRow[] = [];
  const followupTerms = new Set<string>();
  for (const s of raw) {
    const title = (s.title || "").trim();
    const url = (s.url || "").trim();
    const domain = getDomain(url);
    if (!url) {
      rows.push({ title, url, domain, classified_source_class: "unknown",
        admitted_to_candidate_pool: false, drop_reason: "no_url" });
      continue;
    }
    const cls = classify(url, title);
    if (cls === "bad") {
      rows.push({ title, url, domain, classified_source_class: cls,
        admitted_to_candidate_pool: false, drop_reason: "bad_source" });
      continue;
    }

    // P3.2 #4: role correction before admission
    const { role: effectiveRole, corrected_from } = correctRoleForClass(query.role, cls);
    const admit = admitFor(effectiveRole, cls);
    if (!admit) {
      const followup = cls === "discovery_only" ? extractFollowupTerms(title, s.snippet) : [];
      followup.forEach((t) => followupTerms.add(t));
      rows.push({
        title, url, domain,
        classified_source_class: cls,
        admitted_to_candidate_pool: false,
        drop_reason: cls === "discovery_only" ? "discovery_only" : `class_${cls}_not_admitted_for_${effectiveRole}`,
        extracted_followup_terms: followup.length ? followup : undefined,
        role_corrected_from: corrected_from,
        role_corrected_to: corrected_from ? effectiveRole : undefined,
      });
      continue;
    }
    rows.push({
      title, url, domain, classified_source_class: cls,
      admitted_to_candidate_pool: true,
      role_corrected_from: corrected_from,
      role_corrected_to: corrected_from ? effectiveRole : undefined,
    });
    admitted.push({
      candidate_id: crypto.randomUUID(),
      claim_id: query.claim_id,
      role: effectiveRole,
      origin: "perplexity",
      retrieval_method: "perplexity",
      title,
      source_type: s.source_type || query.expected_source_type || "other",
      source_url: url,
      snippet: s.snippet ?? null,
      query_he: query.query_he,
      score: cls === "official_primary" || cls === "legislation" ? 0.95 : 0.75,
      expected_source_type: query.expected_source_type,
      metadata: {
        domain, classified_source_class: cls,
        role_corrected_from: corrected_from,
      },
    });
  }
  return { admitted, rows, followupTerms: [...followupTerms].slice(0, 2) };
}

export interface PerplexityRetrievalResult {
  candidates: Candidate[];
  dropped: DroppedSource[];
  per_query: Array<{
    claim_id: string;
    role: string;
    query_he: string;
    http?: number;
    raw_count: number;
    discovery_only: number;
    admitted: number;
    followup_terms: string[];
    followup_admitted: number;
    ms: number;
    results: PplxResultRow[];
  }>;
  stage_runs: StageRun[];
  ms: number;
}

export async function runPerplexityRetrieval(
  queries: Query[],
): Promise<PerplexityRetrievalResult> {
  const t0 = Date.now();
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  if (!key) {
    return {
      candidates: [], dropped: [], per_query: [],
      stage_runs: [{ stage: "perplexity_retrieval.skipped", ms: 0, ok: false }],
      ms: 0,
    };
  }
  const targets = queries.filter((q) => q.targets.includes("perplexity"));

  const candidates: Candidate[] = [];
  const dropped: DroppedSource[] = [];
  const per_query: PerplexityRetrievalResult["per_query"] = [];

  for (const q of targets) {
    const first = await callPerplexity(q);
    const { admitted, rows, followupTerms } = processRaw(q, first.raw);
    candidates.push(...admitted);
    let totalMs = first.ms;
    let followupAdmitted = 0;

    // One follow-up using the most promising extracted term, if any.
    if (followupTerms.length > 0) {
      const term = followupTerms[0];
      const second = await callPerplexity(q, `${term} ${q.query_he}`.slice(0, 200));
      totalMs += second.ms;
      const second_p = processRaw(q, second.raw);
      candidates.push(...second_p.admitted);
      followupAdmitted = second_p.admitted.length;
      // mark these in rows as followup
      for (const r of second_p.rows) {
        rows.push({ ...r, drop_reason: r.drop_reason ? `followup:${r.drop_reason}` : r.drop_reason });
      }
    }

    // Build dropped[] for backwards-compat top-level telemetry.
    for (const r of rows) {
      if (!r.admitted_to_candidate_pool) {
        dropped.push({
          query_he: q.query_he, claim_id: q.claim_id, role: q.role,
          origin: "perplexity", title: r.title, url: r.url,
          drop_reason: r.drop_reason || "unknown",
        });
      }
    }

    per_query.push({
      claim_id: q.claim_id,
      role: q.role,
      query_he: q.query_he,
      http: first.http,
      raw_count: first.raw.length,
      discovery_only: rows.filter((r) => r.classified_source_class === "discovery_only").length,
      admitted: admitted.length + followupAdmitted,
      followup_terms: followupTerms,
      followup_admitted: followupAdmitted,
      ms: totalMs,
      results: rows,
    });
  }

  return {
    candidates,
    dropped,
    per_query,
    stage_runs: [{ stage: "perplexity_retrieval", ms: Date.now() - t0, ok: true }],
    ms: Date.now() - t0,
  };
}
