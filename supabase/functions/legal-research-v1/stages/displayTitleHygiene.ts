// Phase A — Display-title hygiene.
//
// Computes a safe, user-facing `display_title` for each source before it is
// shown to the drafter or rendered in footnotes. The raw Perplexity / candidate
// title is preserved as `raw_title` for debug only.
//
// Rules:
//   * Known junk/meta titles ("ניתוח שאילתה", "query analysis", "PDF", empty,
//     etc.) are never shown — replaced by a conservative fallback.
//   * Raw filenames ("25_lst_2970619.docx", "doc-1234.pdf", storage keys) are
//     never shown — replaced by a conservative fallback.  [source_label_quality_v1]
//   * Bare institution names ("בית המשפט העליון", "הכנסת", "משרד המשפטים")
//     are not document titles — replaced unless combined with a concrete
//     document title / docket / statute name.                [source_label_quality_v1]
//   * Titles clipped mid-word (e.g. "...במשפט הישרא") are marked suspicious
//     and replaced by a conservative fallback.
//   * Fallback prefers, in order: docket recovered from title/url/snippet,
//     statute name recovered from title/url/snippet, source-type hint + host,
//     generic "מסמך מאתר <host>".
//
// Pure deterministic — no network, no model calls.

export type DisplayTitleStatus =
  | "ok"
  | "fallback_junk_meta"
  | "fallback_truncated"
  | "fallback_empty"
  | "fallback_generic"
  | "fallback_filename"
  | "fallback_bare_institution";

export interface DisplayTitleResult {
  raw_title: string;
  display_title: string;
  title_status: DisplayTitleStatus;
  title_hygiene_reasons: string[];
  /** Telemetry: which recovery produced the display title. */
  fallback_used:
    | "none"
    | "docket"
    | "statute_name"
    | "type_and_host"
    | "host"
    | "generic";
}

export interface DisplayTitleInput {
  title?: string | null;
  url?: string | null;
  source_type?: string | null;
  origin?: string | null;
  /** Optional body/snippet used only for docket / statute-name recovery. */
  snippet?: string | null;
}

// ── Known junk / meta titles (case-insensitive, trimmed) ───────────────────
const JUNK_META_EXACT = new Set<string>([
  "ניתוח שאילתה",
  "שאילתה",
  "query analysis",
  "query_analysis",
  "analysis",
  "summary",
  "סיכום",
  "תקציר",
  "pdf",
  "document",
  "מסמך",
  "untitled",
  "ללא כותרת",
  "n/a",
  "none",
  "null",
]);

const JUNK_META_PATTERNS: RegExp[] = [
  /^query[\s_-]*analysis$/i,
  /^source[\s_-]*\d*$/i,
  /^result[\s_-]*\d*$/i,
  /^doc(ument)?[\s_-]*\d*$/i,
];

// ── Filename-shaped titles ─────────────────────────────────────────────────
const FILE_EXT_RE = /\.(pdf|docx?|rtf|txt|xlsx?|pptx?|csv|htm|html|aspx?)$/i;

/** A title that is really a file name / storage key, not a document title. */
export function looksLikeFilename(t: string): boolean {
  const s = t.trim();
  if (!s) return false;
  // Any title ending in a document extension and containing no spaces.
  if (FILE_EXT_RE.test(s) && !/\s/.test(s)) return true;
  // "25_lst_2970619.docx" style — extension plus underscore/digit soup.
  if (FILE_EXT_RE.test(s) && /[_\-]\d{4,}/.test(s)) return true;
  // No spaces at all + mostly ascii + digits/underscores → storage-like key.
  if (!/\s/.test(s) && /[_\-]/.test(s) && /\d{3,}/.test(s) && !/[\u05D0-\u05EA]/.test(s)) {
    return true;
  }
  // Pure numeric / hyphenated-numeric identifier.
  if (/^[\d_\-.]{4,}$/.test(s)) return true;
  // UUID / long hex storage key.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)) return true;
  if (/^[0-9a-f]{24,}$/i.test(s)) return true;
  return false;
}

// ── Bare institution titles ────────────────────────────────────────────────
const BARE_INSTITUTIONS = [
  "בית המשפט העליון",
  "בית המשפט המחוזי",
  "בתי המשפט",
  "הרשות השופטת",
  "מערכת בתי המשפט",
  "הכנסת",
  "כנסת ישראל",
  "אתר הכנסת",
  "משרד המשפטים",
  "מדינת ישראל",
  "ממשלת ישראל",
  "השירותים והמידע הממשלתי",
  "נבו",
  "מאגר נבו",
  "תקדין",
  "gov.il",
  "www.gov.il",
  "israel government portal",
  "supreme court of israel",
  "the judicial authority",
  "knesset",
];

function normalizeLabel(s: string): string {
  return s
    .replace(/[\u05F3\u05F4'"״׳]/g, "")
    .replace(/[|\u2013\u2014\-–—:•·]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when the title carries nothing beyond one or more institution names. */
export function isBareInstitutionTitle(t: string): boolean {
  const norm = normalizeLabel(t);
  if (!norm) return false;
  const insts = BARE_INSTITUTIONS.map(normalizeLabel);
  if (insts.includes(norm)) return true;
  // Strip every institution name; if nothing meaningful is left, it's bare.
  let rest = norm;
  for (const i of insts) {
    if (!i) continue;
    rest = rest.split(i).join(" ");
  }
  rest = rest.replace(/\b(אתר|פורטל|דף הבית|הודעות|רשמי|של|ה)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (rest.length === 0) return true;
  // Left-overs that are too short to be a document title.
  return rest.length <= 3 && norm.length !== rest.length;
}

// ── Docket / statute recovery ──────────────────────────────────────────────
const DOCKET_RE =
  /(בג["״׳']?ץ|בגץ|עע["״׳']?ם|ע["״׳']?א|רע["״׳']?א|ע["״׳']?פ|רע["״׳']?פ|בש["״׳']?פ|בש["״׳']?א|ע["״׳']?מ|עה["״׳']?ס|תמ["״׳']?ש|ת["״׳']?א|ה["״׳']?פ|עב["״׳']?ל|ע["״׳']?ע|דנ["״׳']?א|דנג["״׳']?ץ|עמ["״׳']?מ|רע["״׳']?מ)\s*\d{1,5}\s*\/\s*\d{2,4}/;

const STATUTE_NAME_RE =
  /((?:חוק[- ]יסוד\s*:?\s*|חוק\s+|פקודת\s+|תקנות\s+|צו\s+)[\u05D0-\u05EA"״'׳()\u0022\s,\-]{3,70})/;

export function recoverDocket(...texts: Array<string | null | undefined>): string | null {
  for (const t of texts) {
    if (!t) continue;
    let hay = t;
    try {
      hay = decodeURIComponent(t);
    } catch { /* keep raw */ }
    const m = hay.match(DOCKET_RE);
    if (m) return m[0].replace(/\s*\/\s*/, "/").replace(/\s+/g, " ").trim();
  }
  return null;
}

export function recoverStatuteName(...texts: Array<string | null | undefined>): string | null {
  for (const t of texts) {
    if (!t) continue;
    const m = t.match(STATUTE_NAME_RE);
    if (!m) continue;
    const name = m[1].replace(/\s+/g, " ").trim().replace(/[,\-–—]+$/, "").trim();
    if (name.length >= 8) return name;
  }
  return null;
}

// ── Suspicious / truncated detection ───────────────────────────────────────
const HEB = /[\u05D0-\u05EA]/;
const ENDS_HEB_LETTER = /[\u05D0-\u05EA]$/;

function looksTruncated(t: string): boolean {
  const trimmed = t.trim();
  if (trimmed.length < 8) return false;
  // Explicit ellipsis at start or end → clipped.
  if (/^\.{2,}|\u2026/.test(trimmed) || /\u2026|\.{2,}$/.test(trimmed)) return true;
  if (!ENDS_HEB_LETTER.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length < 2) return false;
  const last = words[words.length - 1];
  const COMMON_END = /[\u05D4\u05EA\u05DD\u05DF\u05D9\u05D5\u05DA\u05E5\u05E3]$/;
  if (last.length <= 6 && !COMMON_END.test(last)) return true;
  return false;
}

// ── Host extraction ─────────────────────────────────────────────────────────
function safeHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

// Friendly host → site-name map for common Israeli legal hosts.
const HOST_FRIENDLY: Record<string, string> = {
  "nevo.co.il": "מאגר נבו",
  "takdin.co.il": "תקדין",
  "court.gov.il": "אתר הרשות השופטת",
  "supreme.court.gov.il": "אתר בית המשפט העליון",
  "knesset.gov.il": "אתר הכנסת",
  "main.knesset.gov.il": "אתר הכנסת",
  "fs.knesset.gov.il": "אתר הכנסת",
  "justice.gov.il": "משרד המשפטים",
  "gov.il": "אתר ממשלתי (gov.il)",
  "mevaker.gov.il": "מבקר המדינה",
  "btl.gov.il": "המוסד לביטוח לאומי",
  "taxes.gov.il": "רשות המסים",
};

function friendlyHost(host: string | null): string | null {
  if (!host) return null;
  if (HOST_FRIENDLY[host]) return HOST_FRIENDLY[host];
  if (host.endsWith(".gov.il")) return "אתר ממשלתי (gov.il)";
  if (host.endsWith(".ac.il")) return `אתר אקדמי (${host})`;
  return host;
}

// ── Source-type hint ────────────────────────────────────────────────────────
function typeHint(sourceType: string | null | undefined): string | null {
  const t = (sourceType ?? "").toLowerCase();
  if (!t) return null;
  if (t.includes("statute") || t.includes("legislation")) return "מקור חקיקה";
  if (t.includes("regulation")) return "תקנות";
  if (t === "case" || t.includes("caselaw")) return "פסק דין";
  if (t.includes("academic")) return "מקור אקדמי";
  if (t.includes("government_report") || t.includes("report")) return "דוח ממשלתי";
  return null;
}

interface Fallback {
  title: string;
  fallback_used: DisplayTitleResult["fallback_used"];
}

function buildFallback(input: DisplayTitleInput, rawTitle: string): Fallback {
  const url = input.url ?? null;
  const snippet = input.snippet ?? null;

  // 1. Docket recovered from title / url / snippet.
  const docket = recoverDocket(rawTitle, url, snippet);
  if (docket) {
    const host = safeHost(url);
    const friendly = friendlyHost(host);
    return {
      title: friendly ? `${docket} (${friendly})` : docket,
      fallback_used: "docket",
    };
  }

  // 2. Statute name recovered from title / snippet / url.
  let decodedUrl = url ?? "";
  try {
    decodedUrl = decodeURIComponent(decodedUrl);
  } catch { /* keep raw */ }
  const statute = recoverStatuteName(rawTitle, snippet, decodedUrl);
  if (statute) return { title: statute, fallback_used: "statute_name" };

  // 3. Type hint + host.
  const host = safeHost(url);
  const friendly = friendlyHost(host);
  const hint = typeHint(input.source_type);
  if (hint && friendly) return { title: `${hint} מתוך ${friendly}`, fallback_used: "type_and_host" };
  if (hint && host) return { title: `${hint} מתוך ${host}`, fallback_used: "type_and_host" };
  if (hint) return { title: hint, fallback_used: "type_and_host" };
  if (friendly) return { title: `מסמך מאתר ${friendly}`, fallback_used: "host" };
  if (host) return { title: `מסמך מאתר ${host}`, fallback_used: "host" };
  return { title: "מקור משפטי", fallback_used: "generic" };
}

// ── Legitimacy / specificity scoring (over_fallback_fix_v1) ────────────────
const PARTIES_RE = /\s(נ['׳"״]?|נגד)\s/;

/** A title that is clearly a legitimate legal document title. */
export function looksLikeLegalTitle(t: string): boolean {
  const s = t.trim();
  if (!s) return false;
  if (DOCKET_RE.test(s)) return true;
  if (PARTIES_RE.test(s)) return true;
  const st = s.match(STATUTE_NAME_RE);
  if (st && st.index !== undefined && st.index <= 2) return true;
  return false;
}

/**
 * Rough specificity score. Higher = more informative label.
 * Used to guarantee a fallback is only applied when strictly better.
 */
export function specificityScore(
  t: string,
  kind?: DisplayTitleResult["fallback_used"],
): number {
  const s = (t ?? "").trim();
  if (!s) return -1;
  if (kind === "generic") return 0;
  if (kind === "host") return 1;
  if (kind === "type_and_host") return 2;
  let score = 0;
  if (DOCKET_RE.test(s)) score += 5;
  if (PARTIES_RE.test(s)) score += 3;
  if (STATUTE_NAME_RE.test(s)) score += 4;
  const hebWords = s.split(/\s+/).filter((w) => HEB.test(w)).length;
  if (hebWords >= 4) score += 2;
  else if (hebWords >= 2) score += 1;
  if (s.length >= 25) score += 1;
  return score;
}

// ── Main evaluator ──────────────────────────────────────────────────────────
export function computeDisplayTitle(input: DisplayTitleInput): DisplayTitleResult {
  const raw = String(input.title ?? "").trim();
  const reasons: string[] = [];

  const fail = (
    status: Exclude<DisplayTitleStatus, "ok">,
    reason: string,
  ): DisplayTitleResult => {
    reasons.push(reason);
    const fb = buildFallback(input, raw);
    // over_fallback_fix_v1 — only swap in the fallback when it is strictly more
    // informative than the raw title. Otherwise keep the original label.
    const rawScore = status === "fallback_empty" ? -1 : specificityScore(raw);
    const fbScore = specificityScore(fb.title, fb.fallback_used);
    if (fbScore <= rawScore) {
      return {
        raw_title: raw,
        display_title: raw,
        title_status: "ok",
        title_hygiene_reasons: reasons,
        fallback_used: "none",
        fallback_applied: false,
        fallback_candidate: fb.title,
        fallback_rejected_reason: `fallback_not_more_informative(${fb.fallback_used}:${fbScore}<=raw:${rawScore})`,
      };
    }
    return {
      raw_title: raw,
      display_title: fb.title,
      title_status: status,
      title_hygiene_reasons: reasons,
      fallback_used: fb.fallback_used,
      fallback_applied: true,
      fallback_candidate: fb.title,
      fallback_improvement_reason: `${fb.fallback_used}:${fbScore}>raw:${rawScore}`,
    };
  };

  const ok = (): DisplayTitleResult => ({
    raw_title: raw,
    display_title: raw,
    title_status: "ok",
    title_hygiene_reasons: reasons,
    fallback_used: "none",
    fallback_applied: false,
  });

  // Empty.
  if (!raw) return fail("fallback_empty", "title_empty");

  // Junk / meta titles.
  const lower = raw.toLowerCase();
  if (JUNK_META_EXACT.has(lower) || JUNK_META_PATTERNS.some((re) => re.test(raw))) {
    return fail("fallback_junk_meta", "title_junk_meta");
  }

  // Raw filenames / storage keys — always rejectable.
  if (looksLikeFilename(raw)) return fail("fallback_filename", "title_raw_filename");

  // over_fallback_fix_v1 — legitimate legal titles (docket, parties, statute)
  // are never rejected for institution/truncation heuristics.
  if (looksLikeLegalTitle(raw)) {
    reasons.push("legal_title_protected");
    return ok();
  }

  // Bare institution names (only when nothing else is in the title).
  if (isBareInstitutionTitle(raw)) {
    return fail("fallback_bare_institution", "title_bare_institution");
  }

  // Truncated.
  if (looksTruncated(raw)) return fail("fallback_truncated", "title_truncated_mid_word");

  // Very short non-Hebrew non-numeric titles → generic.
  if (raw.length < 4 && !HEB.test(raw)) return fail("fallback_generic", "title_too_short");

  return ok();
}


// ── Aggregate counters (debug) ──────────────────────────────────────────────
export interface DisplayTitleCounts {
  total: number;
  ok: number;
  fallback_junk_meta: number;
  fallback_truncated: number;
  fallback_empty: number;
  fallback_generic: number;
  fallback_filename: number;
  fallback_bare_institution: number;
}

export function emptyDisplayTitleCounts(): DisplayTitleCounts {
  return {
    total: 0,
    ok: 0,
    fallback_junk_meta: 0,
    fallback_truncated: 0,
    fallback_empty: 0,
    fallback_generic: 0,
    fallback_filename: 0,
    fallback_bare_institution: 0,
  };
}

export function accumulateDisplayTitleCounts(
  counts: DisplayTitleCounts,
  r: DisplayTitleResult,
): void {
  counts.total += 1;
  counts[r.title_status] += 1;
}
