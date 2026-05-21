/**
 * Citation Resolver (Deno-only) — Milestone C.
 *
 * Used by `legal-qa` Stage E.5 to validate Perplexity-completion candidates.
 * Replaces the brittle STATUTE_CITATION_RE Guard 1 with a structured engine
 * resolution. A candidate is "resolved" when:
 *   1. Classify    — declared Perplexity type ("statute"/"caselaw") maps to
 *                    one of 5 engine source types (basic_law / primary_leg /
 *                    secondary_leg / case_law_published / case_law_database).
 *   2. Extract     — regex extractors pull engine fields from the citation
 *                    text (ported field-for-field from src/lib/citationValidation.ts).
 *   3. Validate    — all REQUIRED fields for the chosen source type are
 *                    present and non-empty.
 *   4. Emit canonical — interpolate ruleSet.template with extracted values.
 *
 * Non-blocking: an unresolved candidate is NOT dropped here. The caller
 * (validatePerplexityCandidate in legal-qa/index.ts) keeps it because the
 * URL-allowlist guard already passed; it just flags engine_resolved=false.
 *
 * IMPORTANT: This logic does NOT exist in the React side. The React app
 * uses validateCitation directly on already-classified types. This file is
 * Deno-only and fully self-contained.
 */

import { CITATION_RULES, validateCitation } from "./citationEngine.ts";

export type EngineSourceType =
  | "primary_legislation"
  | "basic_law"
  | "secondary_legislation"
  | "case_law_published"
  | "case_law_database";

export type DeclaredType = "statute" | "caselaw";

export interface ResolveSuccess {
  resolved: true;
  sourceType: EngineSourceType;
  fields: Record<string, string>;
  /** Canonical citation re-emitted from the engine template. */
  canonical: string;
  missingFields: [];
  /**
   * v4 stage 2 placeholder-emission policy: when `partyLookupRetry` is set
   * and the case_law_database citation was emitted with `[חסר: ...]` markers
   * in place of one or more required fields, this lists the field keys that
   * were filled with placeholders (e.g. ["fullDate", "party2"]). Empty/undef
   * for normal fully-resolved citations.
   */
  placeholders?: string[];
}

export interface ResolveFailure {
  resolved: false;
  /**
   * - `classify_failed`     — declared type didn't map to any engine type.
   * - `extract_failed`      — extractor produced no fields at all.
   * - `missing_required`    — extractor produced some fields but a required
   *                           field is missing AND we have no realistic
   *                           recovery path (e.g. statute hebrewYear when the
   *                           card itself lacks it).
   * - `needs_party_lookup`  — caselaw v4: docket + court info recovered
   *                           locally, but party names are missing AND
   *                           neither the citation text nor the source card
   *                           carries them. The caller should escalate to a
   *                           narrow external party-name lookup before
   *                           treating this as a hard failure.
   */
  reason:
    | "classify_failed"
    | "extract_failed"
    | "missing_required"
    | "needs_party_lookup";
  missingFields: string[];
  partialFields: Record<string, string>;
  /** When reason=missing_required, the chosen sourceType is reported for telemetry. */
  attemptedType?: EngineSourceType;
}

export type ResolveResult = ResolveSuccess | ResolveFailure;

// ─── Classification regex (mirrors plan) ────────────────────────────
const BASIC_LAW_RE = /חוק[-\s]יסוד/;
const SECONDARY_LEG_RE = /\b(?:תקנות|צו|כללי)\b/;
const PUBLISHED_SERIES_RE = /פ["״]ד|פד["״]ע/;

/** Map Perplexity declared type → engine source type. Returns null if unknown. */
function classify(text: string, declared: DeclaredType): EngineSourceType | null {
  if (declared === "statute") {
    if (BASIC_LAW_RE.test(text)) return "basic_law";
    if (SECONDARY_LEG_RE.test(text)) return "secondary_legislation";
    return "primary_legislation";
  }
  if (declared === "caselaw") {
    if (PUBLISHED_SERIES_RE.test(text)) return "case_law_published";
    return "case_law_database";
  }
  return null;
}

// ─── Field extractors (ported from src/lib/citationValidation.ts) ──
// Behavior is intentionally identical to the React-side extractors for the
// 5 source types we support. Do not "improve" without porting back.

// Bare-section reference detector (e.g. "סעיף 17", "ס' 12(א)", "סעיפים 3-5")
const BARE_SECTION_RE = /^\s*(?:סעיפים?|ס['׳']\s*)\s*[\dא-ת()./\\\-–]+\s*$/;

function extractLegislation(text: string, titleHint?: string): Record<string, string> {
  const fields: Record<string, string> = {};
  // If the citation is just a bare section (no law name), pull law name from title
  const isBareSection = BARE_SECTION_RE.test(text);
  if (isBareSection && titleHint) {
    // Use the title's first segment-before-comma as the law name
    const titleMatch = titleHint.match(/^([^,]+)/);
    if (titleMatch) fields.lawName = titleMatch[1].trim();
    // Also try to pull year/collection from the title since the citation lacks them
    const titleYear = titleHint.match(/(הת[שׁש][א-ת]*["״׳][א-ת]["״׳]?[א-ת]?)/);
    if (titleYear) fields.hebrewYear = titleYear[1];
    const titleGreg = titleHint.match(/\b(\d{4})\b/);
    if (titleGreg) fields.gregorianYear = titleGreg[1];
    const titleColl = titleHint.match(/(ס["״]ח|ק["״]ת)/);
    if (titleColl) fields.collection = titleColl[1];
    const titlePage = titleHint.match(/(?:ס["״]ח|ק["״]ת)\s+(\d+)/);
    if (titlePage) fields.firstPage = titlePage[1];
    return fields;
  }
  // Law name = first segment before comma
  const lawMatch = text.match(/^([^,]+)/);
  if (lawMatch) fields.lawName = lawMatch[1].trim();
  // Hebrew year (התש... form)
  const hebrewYearMatch = text.match(/(הת[שׁש][א-ת]*["״׳][א-ת]["״׳]?[א-ת]?)/);
  if (hebrewYearMatch) fields.hebrewYear = hebrewYearMatch[1];
  // Gregorian year
  const gregMatch = text.match(/\b(\d{4})\b/);
  if (gregMatch) fields.gregorianYear = gregMatch[1];
  // Collection
  const collMatch = text.match(/(ס["״]ח|ק["״]ת)/);
  if (collMatch) fields.collection = collMatch[1];
  // First page (single number after collection)
  const pageMatch = text.match(/(?:ס["״]ח|ק["״]ת)\s+(\d+)/);
  if (pageMatch) fields.firstPage = pageMatch[1];
  return fields;
}

function extractBasicLaw(text: string, titleHint?: string): Record<string, string> {
  const fields: Record<string, string> = {};
  // For basic laws, lawName is everything after "חוק-יסוד:" and before the first comma
  const m = text.match(/חוק[-\s]יסוד\s*:?\s*([^,]+)/);
  if (m) fields.lawName = m[1].trim();
  // If still no name (bare section ref), try the title
  if (!fields.lawName && titleHint) {
    const tm = titleHint.match(/חוק[-\s]יסוד\s*:?\s*([^,]+)/);
    if (tm) fields.lawName = tm[1].trim();
  }
  // Reuse legislation patterns for the rest, with title fallback
  const rest = extractLegislation(text, titleHint);
  if (rest.hebrewYear) fields.hebrewYear = rest.hebrewYear;
  if (rest.gregorianYear) fields.gregorianYear = rest.gregorianYear;
  if (rest.collection) fields.collection = rest.collection;
  if (rest.firstPage) fields.firstPage = rest.firstPage;
  return fields;
}

function extractSecondaryLeg(text: string, titleHint?: string): Record<string, string> {
  const fields = extractLegislation(text, titleHint);
  // Rename lawName → regulationName to match the secondary_legislation schema
  if (fields.lawName) {
    fields.regulationName = fields.lawName;
    delete fields.lawName;
  }
  return fields;
}

// Labor-court & other prefixes that lack gershayim (e.g. "עב", "בל").
// We enumerate them explicitly so we don't false-match arbitrary 2-letter
// Hebrew words at the start of a citation.
const UNQUOTED_CASE_PREFIXES = [
  "עב", "בל", "תק", "תא", "תפ", "הפ", "המ", "בש",
];
const UNQUOTED_PREFIX_RE = new RegExp(
  `(?:^|\\s)(${UNQUOTED_CASE_PREFIXES.join("|")})\\s+(\\d+[/\\-]\\d+)`,
);

// v4: bare-docket pattern (e.g. "54321-03-25" / "18225-06-25"). Requires the
// dash-separated date-bucket shape; the 2- or 4-digit year tail is the
// distinguishing feature versus case-number/year shapes like "1234/05".
const BARE_DOCKET_RE = /(?:^|[\s(])(\d{3,6}-\d{1,2}-\d{2,4})(?=[\s).,]|$)/;

/**
 * v4: infer the engine `caseType` from a card title's court-tier hint.
 * Cards in our corpus carry strings like:
 *   "(בתי המשפט המחוזיים)"   → caseType="עת״מ" is too speculative
 *   "(בתי המשפט לענייני משפחה)" → "תמ״ש"
 * So we ONLY infer caseType when the mapping is unambiguous. Otherwise we
 * leave caseType undefined and let the caller decide whether to render a
 * `[סוג ההליך חסר]` placeholder.
 */
function inferCaseTypeFromTitle(titleHint?: string): string | undefined {
  if (!titleHint) return undefined;
  // Unambiguous court-tier → caseType mappings only. Conservative on purpose.
  if (/בית\s+הדין\s+הארצי\s+לעבודה|בתי\s+הדין\s+לעבודה.*ארצי/.test(titleHint)) return "ע״ע";
  if (/בית\s+הדין\s+(?:האזורי\s+)?לעבודה|בתי\s+הדין\s+לעבודה/.test(titleHint)) return "סע״ש";
  if (/בית\s+המשפט\s+לענייני\s+משפחה|בתי\s+המשפט\s+לענייני\s+משפחה/.test(titleHint)) return "תמ״ש";
  // Supreme/district/magistrate are AMBIGUOUS without case-type hints
  // (could be בג״ץ vs ע״א vs רע״א vs ע״פ etc.) — leave undefined.
  return undefined;
}

function matchCaseTypeAndNumber(s: string): { caseType: string; caseNumber: string } | null {
  // Quoted abbreviations: סע"ש, עס"ק, בר"ע, ב"ל, בג"ץ, ע"א, רע"א, ע"פ, דנ"א, ת"א, etc.
  const quoted = s.match(/([א-ת]{1,3}["״׳']+[א-ת]{1,2})\s+(\d+[/\-]\d+)/);
  if (quoted) return { caseType: quoted[1], caseNumber: quoted[2] };
  // Unquoted whitelist (labor court "עב", small claims "תק", etc.)
  const unquoted = s.match(UNQUOTED_PREFIX_RE);
  if (unquoted) return { caseType: unquoted[1], caseNumber: unquoted[2] };
  return null;
}

/**
 * v4: try to extract a bare docket from the text or caseNumberHint.
 * Returns just the docket string — caseType must come from titleHint or
 * remain undefined (handled by caller).
 */
function matchBareDocket(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(BARE_DOCKET_RE);
  return m ? m[1] : null;
}

function extractCaseLawCommon(
  text: string,
  caseNumberHint?: string,
  titleHint?: string,
  party1Hint?: string,
  party2Hint?: string,
  caseTypeHint?: string,
): Record<string, string> {
  const fields: Record<string, string> = {};
  // Tier 1: prefixed shape in citation text
  const fromText = matchCaseTypeAndNumber(text);
  if (fromText) {
    fields.caseType = fromText.caseType;
    fields.caseNumber = fromText.caseNumber;
  } else if (caseNumberHint) {
    // Tier 2: prefixed shape in caseNumberHint
    const fromHint = matchCaseTypeAndNumber(caseNumberHint);
    if (fromHint) {
      fields.caseType = fromHint.caseType;
      fields.caseNumber = fromHint.caseNumber;
    } else {
      // Tier 2b: caseNumberHint is bare (e.g. "1234/56" or "18225-06-25")
      // — accept as caseNumber directly so we can pair it with caseTypeHint
      // / titleHint-inferred caseType. Same shape constraints the bare-docket
      // and unquoted-prefix paths use elsewhere in this file.
      const hintRaw = caseNumberHint.trim();
      if (/^\d+[\/\-]\d+(?:[\/\-]\d+)?$/.test(hintRaw)) {
        fields.caseNumber = hintRaw;
      }
    }
  }
  // Tier 3 (v4): bare docket — text first, then caseNumberHint
  if (!fields.caseNumber) {
    const bare = matchBareDocket(text) ?? matchBareDocket(caseNumberHint);
    if (bare) {
      fields.caseNumber = bare;
      const inferred = inferCaseTypeFromTitle(titleHint);
      if (inferred) fields.caseType = inferred;
    }
  }
  // Tier 4: caller-supplied caseTypeHint (docket prefix from enrichment).
  // Only fill when text extraction couldn't recover one. Never overwrite.
  if (!fields.caseType && caseTypeHint && caseTypeHint.trim()) {
    fields.caseType = caseTypeHint.trim();
  }
  // Parties — bolded **X** OR plain "X נ' Y"
  const boldParties = [...text.matchAll(/\*\*([^*]+)\*\*/g)];
  if (boldParties.length >= 2) {
    fields.party1 = boldParties[0][1].trim();
    fields.party2 = boldParties[1][1].trim();
  } else {
    const plain = text.match(/([^\n,*]+?)\s+נ['׳']\s+([^\n,*(.]+)/);
    if (plain) {
      fields.party1 = plain[1].trim();
      fields.party2 = plain[2].trim();
    }
  }
  // v4 stage 2: party-name hints from the targeted Perplexity helper.
  // Used ONLY when the local extraction above came up empty — never
  // overwrite parties recovered from the citation text itself.
  if (!fields.party1 && party1Hint && party1Hint.trim()) {
    fields.party1 = party1Hint.trim();
  }
  if (!fields.party2 && party2Hint && party2Hint.trim()) {
    fields.party2 = party2Hint.trim();
  }
  return fields;
}

function extractCaseLawPublished(
  text: string,
  caseNumberHint?: string,
  titleHint?: string,
  party1Hint?: string,
  party2Hint?: string,
  yearHint?: string,
): Record<string, string> {
  const fields = extractCaseLawCommon(text, caseNumberHint, titleHint, party1Hint, party2Hint);
  // Series
  const seriesMatch = text.match(/(פ["״]ד|פד["״]ע|פ["״]מ)/);
  if (seriesMatch) fields.series = seriesMatch[1];
  // Volume (after series)
  const volMatch = text.match(/(?:פ["״]ד|פד["״]ע|פ["״]מ)\s+([א-ת]+|\d+)/);
  if (volMatch) fields.volume = volMatch[1];
  // First page (number after closing paren OR after volume)
  const pageMatch = text.match(/\)\s+(\d+)/) || text.match(/(?:פ["״]ד|פד["״]ע|פ["״]מ)\s+(?:[א-ת]+|\d+)\s+(\d+)/);
  if (pageMatch) fields.firstPage = pageMatch[1];
  // Year in parens
  const yearMatch = text.match(/\((\d{4})\)/);
  if (yearMatch) fields.year = yearMatch[1];
  // v4 stage 2: yearHint fallback (party-lookup helper sometimes returns year)
  if (!fields.year && yearHint && /^\d{4}$/.test(yearHint.trim())) {
    fields.year = yearHint.trim();
  }
  return fields;
}

function extractCaseLawDatabase(
  text: string,
  caseNumberHint?: string,
  decisionDateHint?: string,
  titleHint?: string,
  party1Hint?: string,
  party2Hint?: string,
  fullDateHint?: string,
  yearHint?: string,
): Record<string, string> {
  const fields = extractCaseLawCommon(text, caseNumberHint, titleHint, party1Hint, party2Hint);
  // Database name (optional per schema) — scan citation text first, then titleHint.
  // Perplexity often puts the database name (e.g. "נבו") in the title field
  // rather than the citation string itself.
  const scanForDb = (s: string | undefined): string | undefined => {
    if (!s) return undefined;
    if (/נבו/.test(s)) return "נבו";
    if (/פדאור/.test(s)) return "פדאור";
    if (/דינים/.test(s)) return "דינים";
    if (/תקדין|takdin/i.test(s)) return "תקדין";
    return undefined;
  };
  const db = scanForDb(text) ?? scanForDb(titleHint);
  if (db) fields.database = db;
  // Full date — accept dd.mm.yyyy from text OR fall back to decisionDateHint,
  // then to fullDateHint from the v4 party-lookup helper.
  const dateMatch = text.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
  if (dateMatch) fields.fullDate = dateMatch[1];
  else if (decisionDateHint) {
    const hintMatch = decisionDateHint.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
    if (hintMatch) fields.fullDate = hintMatch[1];
    else if (/^\d{4}-\d{2}-\d{2}$/.test(decisionDateHint.trim())) {
      // ISO yyyy-mm-dd → dd.mm.yyyy
      const [y, m, d] = decisionDateHint.trim().split("-");
      fields.fullDate = `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`;
    }
  }
  if (!fields.fullDate && fullDateHint && /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(fullDateHint.trim())) {
    fields.fullDate = fullDateHint.trim();
  }
  // yearHint kept for symmetry — case_law_database doesn't currently use it
  // in its template, but we accept it so callers can pass a uniform shape.
  if (yearHint && !fields.year && /^\d{4}$/.test(yearHint.trim())) {
    fields.year = yearHint.trim();
  }
  return fields;
}

// ─── Canonical emission ──────────────────────────────────────────
/**
 * Interpolate `template` placeholders `{field}` with `fields` values.
 * Missing placeholders collapse to empty, then we tidy stray whitespace
 * and dangling punctuation so a missing optional field doesn't leave a
 * lone comma or double-space.
 */
function emitCanonical(template: string, fields: Record<string, string>): string {
  let out = template.replace(/\{(\w+)\}/g, (_, k) => fields[k] ?? "");
  // Collapse whitespace
  out = out.replace(/[ \t]+/g, " ");
  // Remove sequences like ", ," or " ,," produced by missing optional fields
  out = out.replace(/,\s*,/g, ",");
  out = out.replace(/\(\s*,/g, "(");
  out = out.replace(/,\s*\)/g, ")");
  out = out.replace(/\(\s*\)/g, "");
  // Tidy spaces around punctuation
  out = out.replace(/\s+,/g, ",");
  out = out.replace(/\s+\./g, ".");
  out = out.replace(/\s+\)/g, ")");
  out = out.replace(/\(\s+/g, "(");
  // Remove repeated dots
  out = out.replace(/\.{2,}/g, ".");
  return out.trim();
}

// ─── Public API ──────────────────────────────────────────────────
export interface ResolveCitationOptions {
  /** Optional `case_number` field from the Perplexity candidate. */
  caseNumberHint?: string;
  /** Optional `decision_date` field (ISO or dd.mm.yyyy). */
  decisionDateHint?: string;
  /**
   * Optional `title` field from the Perplexity candidate. Used as a fallback
   * source for the law name when the citation string is a bare section
   * reference (e.g. "סעיף 17"). Perplexity typically puts the full law name
   * in `title` even when the citation lacks it.
   */
  titleHint?: string;
  /**
   * Caselaw v4 stage 2: party-name hints recovered by the targeted Perplexity
   * party-lookup helper. Supplied ONLY after the first resolveCitation pass
   * returned `needs_party_lookup`. The caselaw extractors fall back to these
   * when the citation text + bold-parties scan come up empty.
   *
   * `fullDateHint` / `yearHint` are accepted for symmetry — the helper
   * sometimes returns a decision date alongside the parties, and Perplexity
   * docket records on nevo/supreme.court.gov.il are the same source of
   * truth as for parties so it would be wasteful to drop them.
   */
  party1Hint?: string;
  party2Hint?: string;
  fullDateHint?: string;
  yearHint?: string;
  /**
   * Optional Hebrew docket-prefix hint (e.g. `בג"ץ`, `ע"א`, `רע"א`, `בר"ם`).
   * Used ONLY when the local extractors (citation text + caseNumberHint)
   * could not pull a `caseType`. Never overwrites a caseType found in text.
   */
  caseTypeHint?: string;
  /**
   * v4 stage 2 policy flag: set ONLY by the chapter loop when this call is
   * the *retry* pass after a successful party-lookup. When true, and only
   * for `case_law_database`, `fullDate` is treated as optional provided
   * caseType + caseNumber + party1 + party2 are present and at least one
   * temporal anchor (`year` OR `fullDate`) survived. The canonical emitter
   * falls back to a `(year)` form when `fullDate` is absent.
   *
   * Has no effect on first-pass resolution, on any other source type, or
   * when party names are still missing — failing those preconditions just
   * keeps the existing `missing_required` / `needs_party_lookup` behavior.
   */
  partyLookupRetry?: boolean;
}

/**
 * Resolve a Perplexity-completion candidate into a structured citation.
 *
 * @param candidateText  The raw `citation` string returned by Perplexity.
 * @param declaredType   Perplexity's `type` field ("statute" | "caselaw").
 * @param opts           Extra hint fields (case_number, decision_date, title).
 */
export function resolveCitation(
  candidateText: string,
  declaredType: DeclaredType,
  opts: ResolveCitationOptions = {},
): ResolveResult {
  const text = (candidateText || "").trim();
  if (!text) {
    return {
      resolved: false,
      reason: "extract_failed",
      missingFields: [],
      partialFields: {},
    };
  }

  // 1) Classify (use combined text so titleHint can flip "primary" → "basic_law"
  // when the citation is just "סעיף 17" but the title says "חוק-יסוד: …")
  const classifyText = opts.titleHint ? `${text}\n${opts.titleHint}` : text;
  const sourceType = classify(classifyText, declaredType);
  if (!sourceType) {
    return {
      resolved: false,
      reason: "classify_failed",
      missingFields: [],
      partialFields: {},
    };
  }

  // 2) Extract
  let fields: Record<string, string>;
  switch (sourceType) {
    case "basic_law":
      fields = extractBasicLaw(text, opts.titleHint);
      break;
    case "secondary_legislation":
      fields = extractSecondaryLeg(text, opts.titleHint);
      break;
    case "primary_legislation":
      fields = extractLegislation(text, opts.titleHint);
      break;
    case "case_law_published":
      fields = extractCaseLawPublished(
        text,
        opts.caseNumberHint,
        opts.titleHint,
        opts.party1Hint,
        opts.party2Hint,
        opts.yearHint,
      );
      break;
    case "case_law_database":
      fields = extractCaseLawDatabase(
        text,
        opts.caseNumberHint,
        opts.decisionDateHint,
        opts.titleHint,
        opts.party1Hint,
        opts.party2Hint,
        opts.fullDateHint,
        opts.yearHint,
      );
      break;
  }

  if (Object.keys(fields).length === 0) {
    return {
      resolved: false,
      reason: "extract_failed",
      missingFields: [],
      partialFields: {},
      attemptedType: sourceType,
    };
  }

  // 3) Validate
  let missing = validateCitation(sourceType, fields);

  // v4 stage 2 policy: when this is the *retry* pass after a successful
  // party-lookup, allow `case_law_database` to drop `fullDate` from the
  // required set IF caseType + caseNumber + party1 + party2 are present
  // and at least one temporal anchor (`year` or `fullDate`) survived.
  // Scope is intentionally narrow:
  //   - only `case_law_database` (Bucket 3 in the after4c diagnosis)
  //   - only on the explicit retry flag
  //   - only when parties + docket are all real
  // First-pass calls and all other source types are unaffected.
  let relaxedFullDate = false;
  if (
    opts.partyLookupRetry &&
    sourceType === "case_law_database" &&
    missing.length > 0 &&
    fields.caseType?.trim() &&
    fields.caseNumber?.trim() &&
    fields.party1?.trim() &&
    fields.party2?.trim() &&
    (fields.fullDate?.trim() || fields.year?.trim())
  ) {
    const remaining = missing.filter((f) => f !== "fullDate");
    if (remaining.length === 0) {
      missing = remaining;
      relaxedFullDate = !fields.fullDate?.trim();
    }
  }

  // v4 stage 2 placeholder-emission policy (case_law_database retry only).
  //
  // When the strict relaxation above didn't clear `missing` but Perplexity
  // still gave us enough to identify the case meaningfully (docket + at
  // least ONE of: party1, party2, fullDate, year), emit a best-effort
  // canonical citation with explicit `[חסר: ...]` placeholders for the
  // remaining required fields rather than dropping the whole entry.
  //
  // Scope is intentionally narrow:
  //   - opts.partyLookupRetry must be true (Stage 2 retry pass only)
  //   - sourceType === "case_law_database" (statutes & published reports
  //     untouched)
  //   - caseNumber MUST be present — without a docket we can't claim to
  //     "identify the case meaningfully"
  //   - at least ONE of party1 / party2 / fullDate / year must be present —
  //     a citation that is just a docket + 4 placeholders is not useful
  //
  // If preconditions fail, the original missing_required / needs_party_lookup
  // path runs unchanged.
  let placeholderFields: string[] = [];
  if (
    missing.length > 0 &&
    opts.partyLookupRetry &&
    sourceType === "case_law_database" &&
    fields.caseNumber?.trim()
  ) {
    const hasMeaningfulIdentity =
      Boolean(fields.party1?.trim()) ||
      Boolean(fields.party2?.trim()) ||
      Boolean(fields.fullDate?.trim()) ||
      Boolean(fields.year?.trim());
    if (hasMeaningfulIdentity) {
      // Hebrew descriptions for placeholder labels (mirror citationEngine
      // component descriptions so the markers match what other UI shows).
      const PLACEHOLDER_LABELS: Record<string, string> = {
        caseType: "סוג ההליך",
        caseNumber: "מספר התיק",
        party1: "שם צד א'",
        party2: "שם צד ב'",
        fullDate: "תאריך מלא",
      };
      const filled: Record<string, string> = { ...fields };
      for (const f of missing) {
        const label = PLACEHOLDER_LABELS[f] ?? f;
        filled[f] = `[חסר: ${label}]`;
        placeholderFields.push(f);
      }
      // Choose template variant. If we have neither database nor fullDate
      // but DO have year, fall back to `(year)` form (cleaner than
      // "(פורסם ב, [חסר: תאריך מלא])"). Otherwise keep canonical template
      // and let placeholders fill the gaps.
      const ruleSet = CITATION_RULES[sourceType];
      let template = ruleSet.template;
      if (!fields.fullDate?.trim() && fields.year?.trim()) {
        template = "{caseType} {caseNumber} {party1} נ' {party2} ({year}).";
      } else if (!fields.fullDate?.trim() && !fields.database?.trim()) {
        template = "{caseType} {caseNumber} {party1} נ' {party2} ({fullDate}).";
      }
      const canonical = emitCanonical(template, filled);
      return {
        resolved: true,
        sourceType,
        fields: filled,
        canonical,
        missingFields: [],
        placeholders: placeholderFields,
      };
    }
  }

  if (missing.length > 0) {
    // v4 caselaw escalation: when caseNumber is present (i.e. the docket
    // was recovered locally) and the missing fields are ONLY items a narrow
    // party-lookup can realistically backfill (party1/party2/caseType/fullDate),
    // signal `needs_party_lookup` so the chapter loop can route this entry
    // to the targeted Perplexity fallback instead of dropping it.
    const PARTY_LOOKUP_RECOVERABLE = new Set([
      "party1",
      "party2",
      "caseType",
      "fullDate",
      "year",
      "series",
      "volume",
      "firstPage",
    ]);
    if (
      (sourceType === "case_law_database" || sourceType === "case_law_published") &&
      fields.caseNumber &&
      missing.every((f) => PARTY_LOOKUP_RECOVERABLE.has(f)) &&
      // Must include at least one party — otherwise the missing set is just
      // metadata which `needs_party_lookup` shouldn't claim.
      (missing.includes("party1") || missing.includes("party2"))
    ) {
      return {
        resolved: false,
        reason: "needs_party_lookup",
        missingFields: missing,
        partialFields: fields,
        attemptedType: sourceType,
      };
    }
    return {
      resolved: false,
      reason: "missing_required",
      missingFields: missing,
      partialFields: fields,
      attemptedType: sourceType,
    };
  }

  // 4) Emit canonical
  const ruleSet = CITATION_RULES[sourceType];
  // When fullDate was relaxed away under the partyLookupRetry policy, fall
  // back to a `(year)` form (or omit the database/date parens entirely if
  // neither year nor fullDate survived — should be impossible given the
  // precondition, but kept defensive).
  let template = ruleSet.template;
  if (relaxedFullDate && sourceType === "case_law_database") {
    if (fields.year?.trim()) {
      template = "{caseType} {caseNumber} {party1} נ' {party2} ({year}).";
    } else {
      template = "{caseType} {caseNumber} {party1} נ' {party2}.";
    }
  }
  const canonical = emitCanonical(template, fields);

  return {
    resolved: true,
    sourceType,
    fields,
    canonical,
    missingFields: [],
  };
}
