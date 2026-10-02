// Versioned "memo_ready" resume marker. Saved once, after the INITIAL research
// call returned a memo and before first verification, so a recovered worker
// reuses that completed paid call instead of redoing it. Only the initial
// research call is bypassed; every verification/repair/render gate still runs.
// Not a fencing / exactly-once mechanism: downstream verification may repeat.
import type { AgentRunResult } from "../agent/researchAgent.ts";

export const MEMO_READY_VERSION = 1 as const;

export interface MemoReadyMarker {
  pipeline_phase: "memo_ready";
  pipeline_phase_version: typeof MEMO_READY_VERSION;
}

/** True only for an exact, current-version marker carrying a memo object. */
export function isValidMemoReady(resume: unknown): boolean {
  const r = resume as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return false;
  if (r.pipeline_phase !== "memo_ready" || r.pipeline_phase_version !== MEMO_READY_VERSION) return false;
  const st = r.agent_state as Record<string, unknown> | null;
  if (!st || typeof st !== "object") return false;
  const memo = st.memo as Record<string, unknown> | null;
  return !!memo && typeof memo === "object" && Array.isArray(st.messages) && !!st.store && !!st.policy;
}

/** Rebuild the accepted initial result from a deserialized memo_ready state. */
export function restoreMemoReadyResult(prior: {
  memo: AgentRunResult["memo"];
  messages: AgentRunResult["messages"];
  policy: AgentRunResult["policy"];
  discovered: AgentRunResult["discovered"];
  commit: AgentRunResult["commit"];
  ledger: AgentRunResult["ledger"];
  trace: AgentRunResult["trace"];
  stats: AgentRunResult["stats"];
}): AgentRunResult {
  return {
    memo: prior.memo,
    paused: false,
    trace: prior.trace,
    policy: prior.policy,
    discovered: prior.discovered,
    messages: prior.messages,
    commit: prior.commit,
    ledger: prior.ledger,
    stats: prior.stats,
  };
}

/** Deep-copies so later repairs cannot mutate the saved checkpoint. */
export function freezeForCheckpoint<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
