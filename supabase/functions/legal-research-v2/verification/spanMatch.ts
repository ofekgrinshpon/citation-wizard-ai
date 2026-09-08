/**
 * legal-research-v2 — CHECK 3: verbatim span presence.
 *
 * Deterministic and tolerant only of extraction noise (Hebrew Unicode forms,
 * whitespace, punctuation, PDF ligature/soft-hyphen artefacts). Semantic
 * similarity is never accepted here.
 */

export const MIN_SPAN_CHARS = 15;

const NIQQUD_RE = /[\u0591-\u05C7]/g;
const QUOTE_RE = /["'`״׳“”„‟’‘‚‛«»]/g;
const DASH_RE = /[\u2010-\u2015\u2212\u05be–—−]/g;
const BIDI_RE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\u00ad\ufeff]/g;

/** Normalize for comparison: keep letters/digits, drop presentation noise. */
export function normalizeForMatch(input: string): string {
  return (input ?? "")
    .normalize("NFKC")
    .replace(BIDI_RE, "")
    .replace(DASH_RE, "-")
    .replace(/\u2026/g, "...")
    .replace(NIQQUD_RE, "")
    .replace(QUOTE_RE, '"')
    .replace(DASH_RE, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Aggressive form: also drop every punctuation/space (PDF artefact tolerance). */
export function denseForm(input: string): string {
  return normalizeForMatch(input).replace(/[^\p{L}\p{N}]/gu, "");
}

export type SpanMatchStatus = "exact" | "normalized" | "dense" | "not_found" | "too_short";

export interface SpanMatchResult {
  status: SpanMatchStatus;
  matched: boolean;
  /** The span as it appears in the document (verbatim) when recoverable. */
  verified_span: string;
  detail: string;
}

export function matchSpan(body: string, span: string): SpanMatchResult {
  const raw = (span ?? "").trim();
  if (normalizeForMatch(raw).length < MIN_SPAN_CHARS) {
    return { status: "too_short", matched: false, verified_span: raw, detail: `span shorter than ${MIN_SPAN_CHARS} normalized chars` };
  }
  const text = body ?? "";
  if (text.includes(raw)) {
    return { status: "exact", matched: true, verified_span: raw, detail: "exact substring" };
  }
  const nBody = normalizeForMatch(text);
  const nSpan = normalizeForMatch(raw);
  if (nBody.includes(nSpan)) {
    return { status: "normalized", matched: true, verified_span: raw, detail: "matched after unicode/whitespace normalization" };
  }
  const dBody = denseForm(text);
  const dSpan = denseForm(raw);
  if (dSpan.length >= MIN_SPAN_CHARS && dBody.includes(dSpan)) {
    return { status: "dense", matched: true, verified_span: raw, detail: "matched after punctuation-insensitive comparison (extraction noise)" };
  }
  return { status: "not_found", matched: false, verified_span: raw, detail: "span not present in the fetched body" };
}
