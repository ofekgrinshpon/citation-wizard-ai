/**
 * Bounded, explicitly allowlisted ordinary-direct attempt receipts for the
 * durable terminal result. Scalars only: reconciliation ids, model/effort,
 * outcome, numeric usage/timing/USD, completeness, price version. Never
 * prompts, questions, answers, tool args/results, reasoning, replay or secrets.
 */
export const MAX_ORDINARY_RECEIPTS = 64;

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set(["pending", "not_sent", "ok", "http_error", "network_unknown", "stream_unknown", "aborted_unknown",
  "incomplete", "refusal", "invalid_output", "model_mismatch", "usage_missing"]);
const ID_FIELDS = ["provider_request_id", "provider_response_id", "requested_model", "response_model"] as const;
const NUM_FIELDS = ["http_status", "duration_ms", "input_count_ms", "checkpoint_ms", "counted_input_tokens", "input_tokens",
  "uncached_input_tokens", "cache_read_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_tokens",
  "reserved_usd", "settled_upper_usd", "estimated_usd"] as const;

export type OrdinaryReceipt = Record<string, string | number | boolean | null>;

const id = (v: unknown) => typeof v === "string" && ID.test(v) ? v : null;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null => allowed.includes(v as T) ? v as T : null;

export function ordinaryReceipts(attempts: unknown): OrdinaryReceipt[] {
  if (!Array.isArray(attempts)) return [];
  return attempts.slice(0, MAX_ORDINARY_RECEIPTS).map((raw) => {
    const a = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const r: OrdinaryReceipt = {
      attempt_id: typeof a.attempt_id === "string" && UUID.test(a.attempt_id) ? a.attempt_id : null,
      provider: a.provider === "openai" ? "openai" : null,
      outcome: typeof a.outcome === "string" && OUTCOMES.has(a.outcome) ? a.outcome : null,
      effort: pick(a.effort, ["medium", "high"] as const),
      effort_returned: pick(a.effort_returned, ["medium", "high", "other"] as const),
      effort_status: pick(a.effort_status, ["matched", "not_reported", "mismatch"] as const),
      price_version: pick(a.price_version, ["sol61-standard-2026-10-03", "direct-standard-2026-10-03"] as const),
      usage_complete: a.usage_complete === true,
      estimate_complete: a.estimate_complete === true,
    };
    for (const k of ID_FIELDS) r[k] = id(a[k]);
    for (const k of NUM_FIELDS) r[k] = num(a[k]);
    return r;
  });
}

/** Adds receipts to a terminal result only for runs that made ordinary attempts. */
export function withOrdinaryReceipts<T extends Record<string, unknown>>(result: T, attempts: unknown): T {
  const receipts = ordinaryReceipts(attempts);
  return receipts.length || Array.isArray(attempts) && attempts.length
    ? { ...result, ordinary_direct_receipts: receipts, ordinary_direct_receipts_truncated: Array.isArray(attempts) && attempts.length > MAX_ORDINARY_RECEIPTS }
    : result;
}
