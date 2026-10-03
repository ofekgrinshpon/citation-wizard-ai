import type { DirectProvider } from "./directProviderPolicy.ts";

/** All units are provider-native reported token categories; unknown stays null. */
export interface DirectUsage {
  input_tokens: number | null;
  uncached_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_write_input_tokens: number | null;
  cache_write_5m_input_tokens: number | null;
  cache_write_1h_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  estimated_usd: number | null;
  estimate_complete: boolean;
}
export interface DirectAttempt extends DirectUsage {
  attempt_id: string;
  provider: DirectProvider;
  endpoint: "messages" | "responses";
  requested_model: string;
  response_model: string | null;
  provider_request_id: string | null;
  provider_response_id: string | null;
  http_status: number;
  duration_ms: number;
  outcome: "pending" | "not_sent" | "ok" | "http_error" | "network_unknown" | "stream_unknown" | "aborted_unknown" |
    "incomplete" | "refusal" | "invalid_output" | "model_mismatch" | "usage_missing";
  /** Sol 6.1 pre-dispatch reservation; unknown attempts retain the whole amount. */
  counted_input_tokens?: number;
  reserved_usd?: number;
  settled_upper_usd?: number;
  price_version: "direct-standard-2026-10-03" | "sol61-standard-2026-10-03";
  effort: "medium";
  usage_complete: boolean;
}
export const emptyDirectUsage = (): DirectUsage => ({
  input_tokens: null, uncached_input_tokens: null, cache_read_input_tokens: null,
  cache_write_input_tokens: null, cache_write_5m_input_tokens: null, cache_write_1h_input_tokens: null,
  output_tokens: null, reasoning_tokens: null, estimated_usd: null, estimate_complete: false,
});
export const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const tokenCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
export const safeProviderId = (value: unknown): string | null =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(value) ? value : null;

export const safeProviderModelId = (value: unknown): string | null =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(value) ? value : null;

/** List-price estimate, never an invoice, balance, or spend authorization. */
export function nativeUsage(provider: DirectProvider, raw: unknown, model = "gpt-6-astra"): DirectUsage {
  const u = object(raw), out = emptyDirectUsage();
  out.output_tokens = tokenCount(u.output_tokens);
  if (provider === "anthropic") {
    out.uncached_input_tokens = tokenCount(u.input_tokens);
    out.cache_read_input_tokens = tokenCount(u.cache_read_input_tokens);
    out.cache_write_input_tokens = tokenCount(u.cache_creation_input_tokens);
    const writes = object(u.cache_creation);
    out.cache_write_5m_input_tokens = tokenCount(writes.ephemeral_5m_input_tokens);
    out.cache_write_1h_input_tokens = tokenCount(writes.ephemeral_1h_input_tokens);
    // This adapter requests ONLY a 5m explicit system-prefix cache and no server tools.
    // Missing TTL breakdown is still unknown, not silently assigned to 5m.
    if ([out.uncached_input_tokens, out.cache_read_input_tokens, out.cache_write_input_tokens].every(v => v !== null)) {
      out.input_tokens = out.uncached_input_tokens! + out.cache_read_input_tokens! + out.cache_write_input_tokens!;
    }
    if (out.cache_write_input_tokens === 0 && out.cache_write_5m_input_tokens === null && out.cache_write_1h_input_tokens === null) {
      out.cache_write_5m_input_tokens = 0; out.cache_write_1h_input_tokens = 0;
    }
    if (out.input_tokens !== null && out.output_tokens !== null && out.cache_write_5m_input_tokens !== null &&
      out.cache_write_1h_input_tokens !== null &&
      out.cache_write_5m_input_tokens + out.cache_write_1h_input_tokens === out.cache_write_input_tokens) {
      out.estimated_usd = (out.uncached_input_tokens! * 4 + out.cache_read_input_tokens! * .2 +
        out.cache_write_5m_input_tokens * 5 + out.cache_write_1h_input_tokens * 8 + out.output_tokens * 20) / 1_000_000;
    }
  } else {
    out.input_tokens = tokenCount(u.input_tokens);
    const details = object(u.input_tokens_details);
    out.cache_read_input_tokens = tokenCount(details.cached_tokens);
    out.cache_write_input_tokens = tokenCount(details.cache_write_tokens);
    out.reasoning_tokens = tokenCount(object(u.output_tokens_details).reasoning_tokens);
    if (out.input_tokens !== null && out.cache_read_input_tokens !== null && out.cache_write_input_tokens !== null &&
      out.cache_read_input_tokens + out.cache_write_input_tokens <= out.input_tokens) {
      out.uncached_input_tokens = out.input_tokens - out.cache_read_input_tokens - out.cache_write_input_tokens;
      if (out.output_tokens !== null) {
        const long = out.input_tokens > 272_000;
        const prices = model === "gpt-6.1-sol" ? [2, 0.1, 2.5, 10] : model === "gpt-6-astra" ? [10, 1, 12.5, 50] : null;
        if (prices) out.estimated_usd = ((out.uncached_input_tokens * prices[0] + out.cache_read_input_tokens * prices[1] + out.cache_write_input_tokens * prices[2]) *
          (long ? 2 : 1) + out.output_tokens * prices[3] * (long ? 1.5 : 1)) / 1_000_000;
      }
    }
  }
  // Output already includes thinking. Never add reasoning_tokens again.
  if (out.estimated_usd !== null) out.estimated_usd = Math.round(out.estimated_usd * 1e8) / 1e8;
  // Cache field absence, unexpected service tier, or non-global inference makes pricing unknown.
  const tier = u.service_tier;
  const geo = u.inference_geo;
  if ((tier !== undefined && tier !== "standard" && tier !== "default") || (geo !== undefined && geo !== "global")) {
    out.estimated_usd = null;
  }
  out.estimate_complete = out.estimated_usd !== null;
  return out;
}
