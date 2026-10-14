/**
 * Ordinary-direct repair/fallback phase handling. Repair research calls get the
 * same durable pre-dispatch checkpoint as the pilot, stamped with an explicit
 * repair phase. A resume that finds that phase fails closed (actionable
 * terminal state, no automatic resend/refund) instead of replaying the repair
 * as initial research. Gateway runs are unchanged (no checkpoint option).
 */
export const ORDINARY_REPAIR_PHASE = "repair_research" as const;

interface IntakeLike { agent_direct_provider?: unknown; agent_transport?: string }

export function repairCheckpointOption<S>(intake: IntakeLike, save: (s: S) => Promise<boolean>): { checkpoint?: (s: S) => Promise<boolean> } {
  return intake.agent_direct_provider || intake.agent_transport === "openai_direct" ? { checkpoint: save } : {};
}

/** Extra resume fields written by a repair checkpoint (ordinary only). */
export function repairCheckpointFields(intake: IntakeLike, directRepair: boolean): Record<string, unknown> {
  if (!directRepair) return {};
  return intake.agent_transport === "openai_direct" && !intake.agent_direct_provider
    ? { direct_repair_checkpoint: true, repair_phase: ORDINARY_REPAIR_PHASE }
    : { direct_repair_checkpoint: true };
}

export function ordinaryRepairResumeError(intake: IntakeLike, resume: { direct_repair_checkpoint?: boolean; repair_phase?: unknown } | null | undefined): string | null {
  if (intake.agent_transport !== "openai_direct" || !resume) return null;
  return resume.direct_repair_checkpoint || resume.repair_phase !== undefined ? "ordinary_repair_resume_requires_review" : null;
}
