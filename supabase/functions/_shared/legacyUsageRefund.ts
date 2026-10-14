/**
 * Legacy caller compatibility for the service-only failure-attestation RPC.
 * A consume replay is never an execution grant. Only the worker that observed
 * a definitive failure may attest it; client reasons and transport uncertainty
 * are not evidence. Citation requests use their separately fenced lifecycle.
 */
export interface UsageRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: unknown;
  }>;
}

export class DefinitiveUsageFailure extends Error {}

export async function attestUsageFailure(
  admin: UsageRpcClient,
  userId: string,
  requestId: string,
  reason: string,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("attest_usage_failure", {
      _user_id: userId,
      _request_id: requestId,
      _reason: reason,
    });
    const result = data as { ok?: unknown; refunded?: unknown } | null;
    // Includes actual/prior-refund confirmation only. A no-op, RPC error or
    // lost response must never be presented as a successful refund.
    return !error && result?.ok === true && result.refunded === true;
  } catch {
    return false;
  }
}

/** SQL rejected this INSERT atomically. Network/PostgREST failures are unknown. */
export function isDefinitiveInsertFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^(22|23)[0-9A-Z]{3}$/.test(code);
}

/** A diagnostic timeout/transport failure cannot authorize an automatic refund. */
export function hasAmbiguousFailure(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const seen = new Set<unknown>();
  const uncertainText = /timeout|timed.?out|abort|network|fetch failed|failed to fetch|connection|socket|transport|unknown|stream|incomplete|\beof\b|parse|unexpected token|syntaxerror|tls|econn|drafter_no_blocks|(?:model|drafter)_error_(?:0|408|502|504)(?:\D|$)/i;
  const walk = (node: unknown, depth: number, diagnostic = false): boolean => {
    if (typeof node === "string") return diagnostic && uncertainText.test(node);
    if (!node || typeof node !== "object" || depth > 12 || seen.has(node)) return false;
    seen.add(node);
    for (const [key, entry] of Object.entries(node)) {
      const isDiagnostic = diagnostic || /error|failure|timeout|timed_out|abort|unknown|transport|detail|reason/i.test(key);
      if (/timeout|timed_out|unknown|transport_failed/i.test(key) && entry === true) return true;
      if (walk(entry, depth + 1, isDiagnostic)) return true;
    }
    return false;
  };
  return walk(value, 0);
}
