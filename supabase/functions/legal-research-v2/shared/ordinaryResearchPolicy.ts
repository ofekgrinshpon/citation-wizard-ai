/**
 * New ordinary research runs use the approved SOL 6.1 medium policy.
 * Exact ID verified against the Oct 5 native experiment, not the older SOL 6.
 * Gateway availability must be verified separately before deploying this policy.
 * Persist at intake creation; never rewrite an existing checkpoint on resume.
 */
export const ORDINARY_RESEARCH_MODEL = "openai/gpt-6.1-sol";
export const ORDINARY_RESEARCH_REASONING_EFFORT = "medium" as const;

/** Server-owned settings, never copied from a public request or env override. */
export const ORDINARY_RESEARCH_SETTINGS = {
  agent_model: ORDINARY_RESEARCH_MODEL,
  agent_reasoning_effort: ORDINARY_RESEARCH_REASONING_EFFORT,
} as const;

/**
 * Transport for NEW ordinary jobs only, read once at intake creation.
 * Default and any unrecognized value: Lovable gateway (field omitted).
 * Existing/resumed jobs keep whatever their checkpointed intake recorded.
 */
export function resolveOrdinaryTransport(
  get: (k: string) => string | undefined = k => (typeof Deno !== "undefined" ? Deno.env.get(k) : undefined),
): "openai_direct" | undefined {
  return get("V2_ORDINARY_TRANSPORT") === "openai_direct" ? "openai_direct" : undefined;
}
declare const Deno: { env: { get(key: string): string | undefined } };
