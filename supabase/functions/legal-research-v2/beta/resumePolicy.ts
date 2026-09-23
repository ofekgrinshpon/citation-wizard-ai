/**
 * legal-research-v2 — unattended checkpoint recovery policy
 * (automatic_resume_v1).
 *
 * WHAT STALLS. A chunked run persists a checkpoint (`agent_state.resume`) and
 * then hands itself to a fresh worker with one self-invocation. Everything the
 * next worker needs is already in the row — manual resumes in Acceptance #4
 * succeeded immediately and produced correct answers. The only missing piece
 * was a supervisor: when that single hand-off request is lost, or the worker is
 * killed between its last checkpoint write and the hand-off, the row keeps a
 * perfectly good checkpoint and no executor ever picks it up.
 *
 * WHAT THIS ADDS. A bounded, deterministic watchdog decision. It does not
 * change the research loop, the agent, the verifier, the drafter or any budget:
 * it only decides whether an abandoned checkpoint may be handed to one new
 * worker, and refuses to do so more than a fixed number of times.
 */

export const RESUME_WATCHDOG = {
  /** No liveness beat for this long ⇒ no executor owns the run. */
  STALE_MS: 180_000,
  /** Hard bound on watchdog-issued resumes per run. */
  MAX_AUTO_RESUMES: 4,
  /** A claimed run is off-limits to any other sweeper for this long. */
  CLAIM_TTL_MS: 180_000,
  /** Rows examined per sweep. */
  BATCH: 5,
  /** Minimum spacing between run-row liveness writes. */
  BEAT_MIN_INTERVAL_MS: 15_000,
  /**
   * A run older than this was abandoned long ago (a historical eval row, a
   * pre-watchdog stall). Finishing it would be useless work against a stale
   * question, so it is never revived.
   */
  MAX_RUN_AGE_MS: 45 * 60_000,
} as const;

export type StallClass =
  | "recoverable_no_executor"
  | "still_alive"
  | "terminal_status"
  | "no_checkpoint"
  | "resume_budget_exhausted"
  | "abandoned_too_old"
  | "claimed_by_other";

export interface WatchdogRow {
  run_id: string;
  status: string | null;
  /** The persisted checkpoint envelope: `{ resume, intake, job?, stage? }`. */
  agent_state: { resume?: unknown; stage?: string | null } | null;
  last_beat_at: string | null;
  created_at: string | null;
  auto_resume_count: number | null;
  watchdog_claimed_at: string | null;
}

export interface ResumeDecision {
  run_id: string;
  automatic_resume_triggered: boolean;
  automatic_resume_reason: StallClass;
  automatic_resume_checkpoint: string | null;
  automatic_resume_count: number;
  automatic_resume_terminal_failure: boolean;
  manual_resume_required: boolean;
  duplicate_resume_prevented: boolean;
}

/** Statuses a watchdog may ever touch. Anything else is finished business. */
const RESUMABLE_STATUS = new Set(["running", "paused"]);

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/**
 * Why this row is (or is not) an abandoned checkpoint. Terminal classes are
 * deliberately separate from recoverable ones: a failed, errored, refused or
 * budget-exhausted run is never retried.
 */
export function classifyStall(row: WatchdogRow, now: number): StallClass {
  if (!RESUMABLE_STATUS.has(String(row.status ?? ""))) return "terminal_status";
  const beat = ms(row.last_beat_at) ?? ms(row.created_at) ?? 0;
  if (now - beat < RESUME_WATCHDOG.STALE_MS) return "still_alive";
  const claimed = ms(row.watchdog_claimed_at);
  if (claimed !== null && now - claimed < RESUME_WATCHDOG.CLAIM_TTL_MS) return "claimed_by_other";
  if (!row.agent_state?.resume) return "no_checkpoint";
  const created = ms(row.created_at);
  if (created !== null && now - created > RESUME_WATCHDOG.MAX_RUN_AGE_MS) {
    return "abandoned_too_old";
  }
  if ((row.auto_resume_count ?? 0) >= RESUME_WATCHDOG.MAX_AUTO_RESUMES) {
    return "resume_budget_exhausted";
  }
  return "recoverable_no_executor";
}

/** The full, observable decision for one row. Pure. */
export function decideAutoResume(row: WatchdogRow, now: number): ResumeDecision {
  const reason = classifyStall(row, now);
  const count = row.auto_resume_count ?? 0;
  return {
    run_id: row.run_id,
    automatic_resume_triggered: reason === "recoverable_no_executor",
    automatic_resume_reason: reason,
    automatic_resume_checkpoint: row.agent_state?.stage ?? null,
    automatic_resume_count: count,
    // Only an exhausted bound is a terminal watchdog failure; a run with no
    // checkpoint at all cannot be recovered either and needs a human.
    automatic_resume_terminal_failure: reason === "resume_budget_exhausted" ||
      reason === "abandoned_too_old",
    manual_resume_required: reason === "resume_budget_exhausted" ||
      reason === "no_checkpoint" || reason === "abandoned_too_old",
    duplicate_resume_prevented: reason === "claimed_by_other",
  };
}

export function emptyResumeTelemetry() {
  return {
    automatic_resume_triggered: 0,
    automatic_resume_success: 0,
    automatic_resume_terminal_failure: 0,
    manual_resume_required: 0,
    duplicate_resume_prevented: 0,
  };
}
