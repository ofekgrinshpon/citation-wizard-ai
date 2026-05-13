// Phase 6.5 — Deterministic citation quality scorer.
//
// Computed by code, NOT by the LLM classifier. The classifier's job is
// role assignment ("is this a doctrinal anchor or an application example?").
// Citation quality is purely a shape question:
//
//   strong      → has the bibliographic shape needed to act as a central authority.
//   weak        → resolvable but incomplete (docket-only, missing year, etc.).
//   placeholder → effectively unusable as a citation (placeholder markers,
//                 no substantive metadata).
//
// Reasons are returned as enum codes so telemetry can aggregate them.

import type { CitationQuality, CitationQualityReason } from "./contracts.ts";

export interface CitationQualityInput {
  citation: string;
  sourceType?: string;
  caseNumber?: string;
  url?: string;
}

export interface CitationQualityResult {
  quality: CitationQuality;
  reasons: CitationQualityReason[];
}

const CASE_DOCKET_RE =
  /^(?:בג"ץ|בג״ץ|ע"א|ע״א|ע"פ|ע״פ|רע"א|רע״א|דנ"א|דנ״א|ת"א|ת״א|ע"ע|ע״ע|עע"מ|עע״מ|בש"פ|בש״פ|ת"פ|ת״פ|תפ"ח|תפ״ח|עמ"ה|עמ״ה|בר"ם|בר״ם)\s+\d+[\d\/\-]+/;

const HEBREW_LETTERS_RE = /[א-ת]/;
const PLACEHOLDER_RE = /\[חסר:[^\]]+\]/;
const HEBREW_YEAR_RE = /הת[שׁש][א-ת]*["״]?/;
const GREG_YEAR_RE = /\((?:19|20)\d{2}\)/;
const NUMERIC_YEAR_RE = /[–\-]\s*(?:19|20)\d{2}\b/;

function isLegislationType(t: string): boolean {
  const s = (t || "").toLowerCase();
  return (
    s.includes("law") ||
    s.includes("legislation") ||
    s.includes("regulation") ||
    s === "ordinance" ||
    s === "basic_law" ||
    s === "israeli_law" ||
    s === "חקיקה ישראלית"
  );
}

function isCaselawType(t: string): boolean {
  const s = (t || "").toLowerCase();
  return (
    s === "caselaw" ||
    s === "case_law" ||
    s === "פסיקה" ||
    s === "case_law_database" ||
    s.startsWith("supreme_court") ||
    s.startsWith("district_court") ||
    s.startsWith("labor_court") ||
    s === "family_court"
  );
}

function isAcademicType(t: string): boolean {
  const s = (t || "").toLowerCase();
  return (
    s === "journal_article" ||
    s === "מאמר אקדמי" ||
    s === "article" ||
    s === "academic_book" ||
    s === "book" ||
    s === "book_chapter"
  );
}

function isOnlyDocket(citation: string): boolean {
  const trimmed = citation.trim().replace(/[.,;]+$/, "");
  if (!CASE_DOCKET_RE.test(trimmed)) return false;
  // Strip the docket prefix+number; if nothing meaningful remains, it's docket-only.
  const after = trimmed.replace(CASE_DOCKET_RE, "").trim();
  // Allow trailing pinpoint, parens, dates — but require at least one Hebrew name token.
  // "name" = 2+ consecutive Hebrew chars, not just connectives.
  const nameMatch = after.match(/[א-ת]{2,}/g) || [];
  // Connective-only words that don't count as a real name.
  const STOP = new Set(["נ", "נ׳", "נ'", "נגד", "פסק", "דין", "פד", "פס", "ע"]);
  const real = nameMatch.filter((n) => !STOP.has(n));
  return real.length === 0;
}

function hasBalancedParens(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function looksTruncated(s: string): boolean {
  const t = s.trim();
  if (/,\s*$/.test(t)) return true;
  if (/\s+ל\s*$/.test(t)) return true;
  if (/הת[שש][א-ת]?\.\s*$/.test(t)) return true;
  // Mid-word ending: ends in a Hebrew letter immediately followed by EOF
  // and the citation is suspiciously short — combined heuristic.
  if (t.length < 25 && /[א-ת]$/.test(t) && !/[).!]$/.test(t)) return true;
  return false;
}

/**
 * Score a citation deterministically. Always returns a quality and a list
 * of reason codes. Never throws.
 */
export function scoreCitationQuality(input: CitationQualityInput): CitationQualityResult {
  const reasons: CitationQualityReason[] = [];
  const citation = (input.citation || "").trim();
  const sourceType = input.sourceType || "";

  // Hard placeholder cases first.
  if (!citation || citation.length < 8) {
    reasons.push("no_substantive_content");
    return { quality: "placeholder", reasons };
  }
  if (citation.length < 12) {
    reasons.push("too_short");
  }
  if (PLACEHOLDER_RE.test(citation)) {
    reasons.push("placeholder_marker");
  }
  if (!hasBalancedParens(citation)) {
    reasons.push("unbalanced_parentheses");
  }
  if (looksTruncated(citation)) {
    reasons.push("truncated_court");
  }

  if (isCaselawType(sourceType)) {
    if (isOnlyDocket(citation)) {
      reasons.push("docket_only");
      reasons.push("missing_case_name");
    } else if (!HEBREW_LETTERS_RE.test(citation) && !CASE_DOCKET_RE.test(citation)) {
      reasons.push("missing_case_name");
    }
  }

  if (isLegislationType(sourceType) || isAcademicType(sourceType)) {
    if (
      !HEBREW_YEAR_RE.test(citation) &&
      !GREG_YEAR_RE.test(citation) &&
      !NUMERIC_YEAR_RE.test(citation)
    ) {
      reasons.push("missing_year");
    }
  }

  // "court_only" — generic court mention with nothing else (e.g. "בית המשפט העליון").
  if (
    isCaselawType(sourceType) &&
    /^בית\s+המשפט/.test(citation) &&
    !CASE_DOCKET_RE.test(citation) &&
    citation.length < 40
  ) {
    reasons.push("court_only");
  }

  // De-dup
  const uniq = Array.from(new Set(reasons));

  // Severity:
  //   placeholder = effectively unusable
  //   weak        = resolvable but incomplete
  //   strong      = no quality flags raised
  const placeholderTriggers: CitationQualityReason[] = [
    "placeholder_marker",
    "no_substantive_content",
    "court_only",
    "missing_case_name",
  ];
  const weakTriggers: CitationQualityReason[] = [
    "docket_only",
    "too_short",
    "truncated_court",
    "missing_year",
    "unbalanced_parentheses",
  ];

  if (uniq.some((r) => placeholderTriggers.includes(r))) {
    return { quality: "placeholder", reasons: uniq };
  }
  if (uniq.some((r) => weakTriggers.includes(r))) {
    return { quality: "weak", reasons: uniq };
  }
  return { quality: "strong", reasons: [] };
}
