/** Internal-only pilots. No request URL, secret, or arbitrary model is accepted. */
export type DirectProvider = "anthropic" | "openai";
export interface DirectProviderConfig {
  provider: DirectProvider;
  /** Explicit pilot limit, includes thinking. No implicit quality downgrade. */
  max_output_tokens: number;
}
export const DIRECT_MODELS = {
  anthropic: "claude-opus-5-5",
  openai: "openai/gpt-6-astra",
} as const;
export const DIRECT_LIMITS = {
  maxOutputTokens: 128_000,
  maxRequestBytes: 4_000_000,
  maxResponseBytes: 8_000_000,
  maxAttempts: 256,
  timeoutMs: 240_000,
} as const;

export function directProviderConfigError(config: DirectProviderConfig, model: string, effort?: unknown): string | null {
  if (!config || !["anthropic", "openai"].includes(config.provider)) return "invalid_direct_provider";
  if (model !== DIRECT_MODELS[config.provider]) return "direct_provider_model_mismatch";
  if (!Number.isSafeInteger(config.max_output_tokens) || config.max_output_tokens < 1024 ||
    config.max_output_tokens > DIRECT_LIMITS.maxOutputTokens) return "direct_output_limit_required";
  // First pilot is a medium-effort transport comparison. No silent remapping.
  if (effort !== undefined && effort !== "medium") return "direct_pilot_requires_medium_effort";
  return null;
}

export function parseDirectProvider(input: {
  isSmoke: boolean; provider: unknown; model: unknown; maxOutputTokens: unknown;
}): { ok: true; config?: DirectProviderConfig; model?: string } | { ok: false; error: string } {
  // Auth is decided by the existing service-role/smoke-token gate, never a body flag.
  if (!input.isSmoke) return { ok: true };
  if (input.provider === undefined || input.provider === "lovable_gateway") return { ok: true };
  if (input.provider !== "anthropic" && input.provider !== "openai") return { ok: false, error: "invalid_direct_provider" };
  const model = input.model === undefined || input.model === null || input.model === ""
    ? DIRECT_MODELS[input.provider] : input.model;
  if (typeof model !== "string") return { ok: false, error: "direct_provider_model_mismatch" };
  const config = { provider: input.provider, max_output_tokens: input.maxOutputTokens } as DirectProviderConfig;
  const error = directProviderConfigError(config, model);
  return error ? { ok: false, error } : { ok: true, config, model };
}

/** One server-approved, non-secret UUID is also the pilot row's primary key. */
export function directPilotRunError(runId: unknown, approvedRunId: unknown): string | null {
  return typeof approvedRunId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(approvedRunId) &&
    runId === approvedRunId ? null : "direct_pilot_run_not_approved";
}

/** A malformed pilot marker still opts out of automatic crash recovery. */
export function isDirectPilotState(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;
  const intake = (state as Record<string, unknown>).intake;
  return !!intake && typeof intake === "object" &&
    (intake as Record<string, unknown>).agent_direct_provider !== undefined;
}

export function directPilotPauseId(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const id = (state as Record<string, unknown>).direct_pause_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
