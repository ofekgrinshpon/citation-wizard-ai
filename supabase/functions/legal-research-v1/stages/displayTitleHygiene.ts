// Phase A — Display-title hygiene.
//
// Computes a safe, user-facing `display_title` for each source before it is
// shown to the drafter or rendered in footnotes. The raw Perplexity / candidate
// title is preserved as `raw_title` for debug only.
//
// Rules:
//   * Known junk/meta titles ("ניתוח שאילתה", "query analysis", "PDF", empty,
//     etc.) are never shown — replaced by a conservative fallback.
//   * Titles clipped mid-word (e.g. "...במשפט הישרא") are marked suspicious
//     and replaced by a conservative fallback.
//   * Fallback prefers, in order: explicit statute/case name in metadata,
//     source-type hint + host, generic "מסמך מאתר <host>".
//
// Pure deterministic — no network, no model calls.

export type DisplayTitleStatus =
  | "ok"
  | "fallback_junk_meta"
  | "fallback_truncated"
  | "fallback_empty"
  | "fallback_generic";

export interface DisplayTitleResult {
  raw_title: string;
  display_title: string;
  title_status: DisplayTitleStatus;
  title_hygiene_reasons: string[];
}

export interface DisplayTitleInput {
  title?: string | null;
  url?: string | null;
  source_type?: string | null;
  origin?: string | null;
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

// ── Suspicious / truncated detection ───────────────────────────────────────
// Hebrew letter range. A title that ENDS with a Hebrew letter (no closing
// punctuation, no quote, no paren) and is reasonably long (>= 8 chars) is
// flagged as "looks truncated mid-word". This is conservative; perfectly
// titled Hebrew names usually end with a word boundary like punctuation, a
// closing quote, a closing paren, or a known full word. Pure heuristic — we
// only use it to *downgrade*, not to invent content.
const HEB = /[\u05D0-\u05EA]/;
const ENDS_HEB_LETTER = /[\u05D0-\u05EA]$/;

function looksTruncated(t: string): boolean {
  const trimmed = t.trim();
  if (trimmed.length < 8) return false;
  // Explicit ellipsis at start or end → clipped.
  if (/^\.{2,}|\u2026/.test(trimmed) || /\u2026|\.{2,}$/.test(trimmed)) return true;
  // Ends with a Hebrew letter AND the last word is short (≤ 4 letters)
  // AND we have more than one word — likely cut mid-word.
  if (!ENDS_HEB_LETTER.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length < 2) return false;
  const last = words[words.length - 1];
  // Common Hebrew word endings — if the last word ends with one of these
  // AND is reasonably long, it's probably a complete word. Otherwise it
  // looks like a mid-word truncation (e.g. "הישרא" missing final "לי").
  // Endings list: ה ת ם ן י ו ך (very common) and final-form letters ץ ף.
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
  // gov.il subdomains → "אתר ממשלתי"
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

function buildFallback(input: DisplayTitleInput): string {
  const host = safeHost(input.url ?? null);
  const friendly = friendlyHost(host);
  const hint = typeHint(input.source_type);
  if (hint && friendly) return `${hint} מתוך ${friendly}`;
  if (hint && host) return `${hint} מתוך ${host}`;
  if (hint) return hint;
  if (friendly) return `מסמך מאתר ${friendly}`;
  if (host) return `מסמך מאתר ${host}`;
  return "מקור משפטי";
}

// ── Main evaluator ──────────────────────────────────────────────────────────
export function computeDisplayTitle(input: DisplayTitleInput): DisplayTitleResult {
  const raw = String(input.title ?? "").trim();
  const reasons: string[] = [];

  // Empty.
  if (!raw) {
    return {
      raw_title: raw,
      display_title: buildFallback(input),
      title_status: "fallback_empty",
      title_hygiene_reasons: ["title_empty"],
    };
  }

  // Junk / meta titles.
  const lower = raw.toLowerCase();
  if (JUNK_META_EXACT.has(lower) || JUNK_META_PATTERNS.some((re) => re.test(raw))) {
    reasons.push("title_junk_meta");
    return {
      raw_title: raw,
      display_title: buildFallback(input),
      title_status: "fallback_junk_meta",
      title_hygiene_reasons: reasons,
    };
  }

  // Truncated.
  if (looksTruncated(raw)) {
    reasons.push("title_truncated_mid_word");
    return {
      raw_title: raw,
      display_title: buildFallback(input),
      title_status: "fallback_truncated",
      title_hygiene_reasons: reasons,
    };
  }

  // Very short non-Hebrew non-numeric titles → generic.
  if (raw.length < 4 && !HEB.test(raw)) {
    reasons.push("title_too_short");
    return {
      raw_title: raw,
      display_title: buildFallback(input),
      title_status: "fallback_generic",
      title_hygiene_reasons: reasons,
    };
  }

  return {
    raw_title: raw,
    display_title: raw,
    title_status: "ok",
    title_hygiene_reasons: [],
  };
}

// ── Aggregate counters (debug) ──────────────────────────────────────────────
export interface DisplayTitleCounts {
  total: number;
  ok: number;
  fallback_junk_meta: number;
  fallback_truncated: number;
  fallback_empty: number;
  fallback_generic: number;
}

export function emptyDisplayTitleCounts(): DisplayTitleCounts {
  return {
    total: 0,
    ok: 0,
    fallback_junk_meta: 0,
    fallback_truncated: 0,
    fallback_empty: 0,
    fallback_generic: 0,
  };
}

export function accumulateDisplayTitleCounts(
  counts: DisplayTitleCounts,
  r: DisplayTitleResult,
): void {
  counts.total += 1;
  counts[r.title_status] += 1;
}
