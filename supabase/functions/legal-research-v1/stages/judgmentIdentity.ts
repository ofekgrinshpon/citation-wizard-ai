// identity_hardening_and_cache_purge_v1
//
// Strict identity validation for acquired judgment bodies.
//
// The defect this module fixes: a nominated docket (ע"א 6821/93) was accepted
// on a *name-token* fallback inside a huge פ"ד volume PDF that actually held a
// different case (בג"ץ 8276/05 עדאלה), and the write path then recorded
// `identity_terms_matched: ["aa:6821/93"]`, disguising a weak token match as a
// docket match. The poisoned row was later served as a pure cache hit with no
// re-validation, so a wrong judgment body reached a footnote.
//
// Rules here:
//   * When the target has a docket, a loose name-token match can NEVER satisfy
//     identity. Strong docket evidence is required (body / title head / URL or
//     official file name), or an official search result that tied the URL to
//     that docket *plus* real party/court/year corroboration in the body.
//   * Evidence types are recorded separately and never collapsed into a
//     synthetic "docket matched" claim.
//   * Cached judgment bodies are re-validated with the same rules before reuse.
//
// This module only validates. It never cites, drafts, or relaxes any gate.

import {
  detectDockets,
  type DocketRef,
  normalizedDocketId,
  textContainsExactDocket,
} from "./docketDetection.ts";

export const IDENTITY_VALIDATION_VERSION = "identity_hardening_v1";

export type IdentityEvidence =
  | "docket_in_body"
  | "docket_in_title"
  | "docket_in_url"
  | "docket_from_official_search_result"
  | "party_tokens_in_body"
  | "court_marker"
  | "year_match"
  | "weak_name_token_fallback"
  | "conflicting_docket_in_url"
  | "cache_revalidation_passed"
  | "cache_revalidation_failed";

export type IdentityConfidence = "high" | "medium" | "low" | "none";

export interface StrictIdentityInput {
  text: string;
  /** Docket of the requested judgment, when the target has one. */
  docket?: DocketRef | null;
  /** Nomination label / canonical title — may itself carry the docket. */
  label?: string | null;
  url?: string | null;
  /** True when an official/high-trust search result tied this URL to the docket. */
  url_from_official_search?: boolean;
  name_tokens: string[];
  year?: number | null;
}

export interface StrictIdentityResult {
  validated: boolean;
  docket_present: boolean;
  docket_match: boolean;
  evidence: IdentityEvidence[];
  evidence_summary: string;
  confidence: IdentityConfidence;
  name_hits: number;
  name_required: number;
  year_match: boolean;
  court_match: boolean;
  reason: string;
  validated_docket: string | null;
  validation_source: string;
  version: string;
}

const COURT_MARKER_RE =
  /(בבית\s+המשפט\s+העליון|בית\s+המשפט\s+העליון|בשבתו\s+כבית\s+משפט\s+גבוה\s+לצדק|בית\s+הדין|בית\s+המשפט\s+המחוזי)/;

const TITLE_HEAD_CHARS = 2_500;
const BODY_SCAN_CHARS = 40_000;

/** `6821/93` → `6821`, `93`; tolerant of the `-` used in file names. */
function docketParts(docket: string): { num: string; year: string } | null {
  const m = String(docket).match(/(\d{1,6})\s*[/\-]\s*(\d{2,4})/);
  if (!m) return null;
  return { num: m[1], year: m[2] };
}

export function docketInUrl(url: string | null | undefined, docket: string): boolean {
  if (!url) return false;
  const p = docketParts(docket);
  if (!p) return false;
  let decoded = String(url);
  try {
    decoded = decodeURIComponent(decoded);
  } catch { /* keep raw */ }
  const yy = p.year.length === 4 ? p.year.slice(2) : p.year;
  const re = new RegExp(`${p.num}\\s*[-/_.]?\\s*(?:${p.year}|${yy})(?!\\d)`);
  return re.test(decoded.replace(/\\/g, "/"));
}

/** Docket-shaped tokens inside a court file name (`SB1_1_8276-05.pdf`). */
export function conflictingDocketInUrl(url: string | null | undefined, docket: string): boolean {
  if (!url) return false;
  const p = docketParts(docket);
  if (!p) return false;
  let decoded = String(url);
  try {
    decoded = decodeURIComponent(decoded);
  } catch { /* keep raw */ }
  const fileName = decoded.split(/[?&]/).find((s) => /fileName=/i.test(s))?.split("=")[1] ??
    decoded.split("/").pop() ?? "";
  const found = [...fileName.matchAll(/(\d{3,5})[-/](\d{2})(?!\d)/g)];
  if (found.length === 0) return false;
  const yy = p.year.length === 4 ? p.year.slice(2) : p.year;
  return !found.some((m) => m[1] === p.num && m[2] === yy);
}

export function nameHitCount(text: string, toks: string[]): number {
  const t = String(text ?? "").replace(/["'`׳״]/g, "");
  let n = 0;
  for (const tok of toks) if (t.includes(tok)) n++;
  return n;
}

/** Extracts a docket from the nomination label when the target has none. */
export function docketFromLabel(label: string | null | undefined): DocketRef | null {
  const found = detectDockets(String(label ?? ""));
  return found.length > 0 ? found[0] : null;
}

export function validateJudgmentIdentityStrict(
  input: StrictIdentityInput,
): StrictIdentityResult {
  const text = String(input.text ?? "");
  const head = text.slice(0, BODY_SCAN_CHARS);
  const titleHead = text.slice(0, TITLE_HEAD_CHARS);
  const toks = (input.name_tokens ?? []).filter(Boolean);
  const hits = nameHitCount(head, toks);
  const required = toks.length >= 2 ? 2 : 1;
  const year_match = !!input.year && head.includes(String(input.year));
  const court_match = COURT_MARKER_RE.test(head);

  const docket: DocketRef | null = input.docket ?? docketFromLabel(input.label);
  const docket_present = !!docket;

  const evidence: IdentityEvidence[] = [];
  if (hits >= required && toks.length > 0) evidence.push("party_tokens_in_body");
  if (court_match) evidence.push("court_marker");
  if (year_match) evidence.push("year_match");

  const base = {
    docket_present,
    name_hits: hits,
    name_required: required,
    year_match,
    court_match,
    version: IDENTITY_VALIDATION_VERSION,
  };

  if (!docket_present) {
    // No docket anywhere: the historical name-token rule stands unchanged.
    if (toks.length === 0) {
      return {
        ...base,
        validated: false,
        docket_match: false,
        evidence,
        evidence_summary: evidence.join(","),
        confidence: "none",
        reason: "no_distinctive_tokens",
        validated_docket: null,
        validation_source: "name_tokens",
      };
    }
    if (hits < required) {
      return {
        ...base,
        validated: false,
        docket_match: false,
        evidence,
        evidence_summary: evidence.join(","),
        confidence: "none",
        reason: "insufficient_name_tokens",
        validated_docket: null,
        validation_source: "name_tokens",
      };
    }
    if (!court_match && !year_match) {
      return {
        ...base,
        validated: false,
        docket_match: false,
        evidence,
        evidence_summary: evidence.join(","),
        confidence: "none",
        reason: "no_court_or_year_corroboration",
        validated_docket: null,
        validation_source: "name_tokens",
      };
    }
    return {
      ...base,
      validated: true,
      docket_match: false,
      evidence,
      evidence_summary: evidence.join(","),
      confidence: "medium",
      reason: "name_tokens_with_corroboration",
      validated_docket: null,
      validation_source: "name_tokens_with_corroboration",
    };
  }

  // ── Known docket: strong evidence only. ────────────────────────────────
  const d = docket as DocketRef;
  const inTitle = textContainsExactDocket(titleHead, d) || docketInUrl(titleHead, d.number);
  const inBody = textContainsExactDocket(head, d);
  const inUrl = docketInUrl(input.url, d.number);
  const conflicting = conflictingDocketInUrl(input.url, d.number);
  if (inBody) evidence.push("docket_in_body");
  if (inTitle) evidence.push("docket_in_title");
  if (inUrl) evidence.push("docket_in_url");
  if (conflicting) evidence.push("conflicting_docket_in_url");
  if (input.url_from_official_search) evidence.push("docket_from_official_search_result");

  const strong = inBody || inTitle || inUrl;
  if (strong) {
    return {
      ...base,
      validated: true,
      docket_match: true,
      evidence,
      evidence_summary: evidence.join(","),
      confidence: "high",
      reason: inBody ? "docket_in_body" : inTitle ? "docket_in_title" : "docket_in_url",
      validated_docket: normalizedDocketId(d),
      validation_source: inBody ? "body_text" : inTitle ? "body_title_head" : "official_url",
    };
  }

  // Official search tie is only acceptable with genuine corroboration in the
  // body and no competing docket in the file name.
  if (
    input.url_from_official_search && !conflicting &&
    toks.length >= 2 && hits >= 2 && (court_match || year_match)
  ) {
    return {
      ...base,
      validated: true,
      docket_match: false,
      evidence,
      evidence_summary: evidence.join(","),
      confidence: "medium",
      reason: "official_search_result_with_party_corroboration",
      validated_docket: null,
      validation_source: "official_search_result",
    };
  }

  if (hits >= required) evidence.push("weak_name_token_fallback");
  return {
    ...base,
    validated: false,
    docket_match: false,
    evidence,
    evidence_summary: evidence.join(","),
    confidence: "none",
    reason: conflicting
      ? "conflicting_docket_in_url"
      : hits >= required
      ? "weak_name_token_fallback_rejected"
      : "docket_required_no_docket_evidence",
    validated_docket: null,
    validation_source: "none",
  };
}

/** Terms safe to persist: never a normalized docket without docket evidence. */
export function identityTermsFor(
  result: StrictIdentityResult,
  toks: string[],
): string[] {
  const terms = new Set<string>();
  if (result.docket_match && result.validated_docket) terms.add(result.validated_docket);
  for (const t of toks.slice(0, 8)) terms.add(t);
  return [...terms];
}
