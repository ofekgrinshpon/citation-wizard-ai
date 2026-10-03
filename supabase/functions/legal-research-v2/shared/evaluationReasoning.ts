/** Internal evaluation only. Public intake never accepts this override. */
export type EvaluationReasoningEffort = "medium" | "high" | "max";

export function reasoningEffortError(model: string, effort: unknown): string | null {
  if (effort === undefined) return null;
  if (effort !== "medium" && effort !== "high" && effort !== "max") {
    return "invalid_agent_reasoning_effort";
  }
  if (effort === "max" && model !== "openai/gpt-6-sol") {
    return "max_reasoning_requires_gpt_6_sol";
  }
  return null;
}

export function parseEvaluationReasoningEffort(input: {
  isSmoke: boolean;
  model: string;
  value: unknown;
}): { ok: true; effort?: EvaluationReasoningEffort } | { ok: false; error: string } {
  // Ignore public fields completely, even invalid values or an unsupported model.
  if (!input.isSmoke) return { ok: true };
  const error = reasoningEffortError(input.model, input.value);
  if (error) return { ok: false, error };
  return { ok: true, effort: input.value as EvaluationReasoningEffort | undefined };
}
