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
