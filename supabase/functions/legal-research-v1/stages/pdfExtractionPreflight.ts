// large_pdf_extraction_preemption_v1 — PDF/DOCX extraction preflight.
//
// Why this exists: `extractDocumentText` is a single *uninterruptible,
// synchronous* CPU step. No abort signal, deadline, or budget check can preempt
// it once entered. A 2.34 MB official Supreme Court PDF (R02, ע"א 6821/93)
// reliably exhausts the edge CPU quota inside that call, killing the isolate
// mid-retrieval and leaving the run to be closed by the reaper as a generic
// `retrieval_interrupted_limitation`.
//
// The fix is to never enter extraction we cannot afford. This module is the
// pure decision function: given the downloaded body's shape, the source, the
// remaining budget and the run-level ledger, it says allow / skip and why.
//
// Pure: no network, no model calls, no mutation of pipeline state.

export const PDF_PREFLIGHT = {
  /**
   * Largest binary an *exact-case* (requested docket) acquisition may extract
   * inline. Deliberately below the observed isolate-killing size (2.34 MB):
   * for the requested authority we would rather return a precise
   * "body unavailable" limitation than lose the whole run.
   */
  SAFE_EXACT_CASE_BYTES: 1_400_000,
  /** Speculative acquisition (no requested docket) gets a much tighter cap. */
  SAFE_SPECULATIVE_BYTES: 900_000,
  /** Below this much remaining budget, only very small bodies are extracted. */
  LOW_BUDGET_MS: 15_000,
  LOW_BUDGET_BYTES: 300_000,
  /**
   * A court text endpoint that returns less than this many cleaned characters
   * is a navigation/error stub, not a judgment body.
   */
  TEXT_STUB_MAX_CHARS: 400,
} as const;

export type PdfPreflightDecision =
  | "allow"
  | "skip_too_large"
  | "skip_low_budget"
  | "skip_ledger_spent";

export interface PdfPreflightInput {
  /** Downloaded body size in bytes. */
  bytes: number;
  /** Response content type, if known. */
  contentType?: string;
  /** Source URL (used only for telemetry / domain context). */
  url?: string;
  /** True when this is the requested docket, not a speculative candidate. */
  exactCase?: boolean;
  /** Milliseconds left on the tighter of the stage and retrieval budgets. */
  remainingMs?: number;
  /**
   * Run-level extraction ledger. Called only when the size checks pass, so a
   * refused extraction never consumes ledger allowance.
   */
  ledgerAllows?: (bytes: number) => boolean;
}

export interface PdfPreflightResult {
  decision: PdfPreflightDecision;
  allow: boolean;
  /** Stable machine reason, surfaced as `extraction_skipped_reason`. */
  reason: string | null;
  /** Byte limit that applied to this decision. */
  limit: number;
  size: number;
  exact_case: boolean;
  content_type: string | null;
  /** Estimated extracted characters, used for cost expectation logging. */
  estimated_chars: number;
}

/** Rough extracted-text yield of a legal PDF: ~1 char per 12 bytes. */
export function estimateExtractedChars(bytes: number): number {
  return Math.round(bytes / 12);
}

/**
 * Decide whether synchronous extraction of this body is safe to enter.
 *
 * Order matters: size gates run before the ledger so that an oversized body is
 * refused with `skip_too_large` and never burns the run's extraction budget.
 */
export function assessPdfExtraction(input: PdfPreflightInput): PdfPreflightResult {
  const size = Math.max(0, input.bytes | 0);
  const exactCase = input.exactCase === true;
  const contentType = input.contentType ?? null;
  const base: Omit<PdfPreflightResult, "decision" | "allow" | "reason" | "limit"> = {
    size,
    exact_case: exactCase,
    content_type: contentType,
    estimated_chars: estimateExtractedChars(size),
  };

  const lowBudget = typeof input.remainingMs === "number" &&
    input.remainingMs < PDF_PREFLIGHT.LOW_BUDGET_MS;
  const sizeLimit = lowBudget
    ? PDF_PREFLIGHT.LOW_BUDGET_BYTES
    : exactCase
    ? PDF_PREFLIGHT.SAFE_EXACT_CASE_BYTES
    : PDF_PREFLIGHT.SAFE_SPECULATIVE_BYTES;

  if (size > sizeLimit) {
    return {
      ...base,
      decision: lowBudget ? "skip_low_budget" : "skip_too_large",
      allow: false,
      reason: lowBudget
        ? "pdf_extraction_skipped_low_budget"
        : exactCase
        ? "pdf_extraction_skipped_too_large_exact_case"
        : "pdf_extraction_skipped_too_large",
      limit: sizeLimit,
    };
  }

  if (input.ledgerAllows && !input.ledgerAllows(size)) {
    return {
      ...base,
      decision: "skip_ledger_spent",
      allow: false,
      reason: "pdf_extraction_skipped_ledger_spent",
      limit: sizeLimit,
    };
  }

  return { ...base, decision: "allow", allow: true, reason: null, limit: sizeLimit };
}

/** True when a cleaned text-endpoint body is a stub rather than a judgment. */
export function isTextEndpointStub(chars: number): boolean {
  return chars < PDF_PREFLIGHT.TEXT_STUB_MAX_CHARS;
}
