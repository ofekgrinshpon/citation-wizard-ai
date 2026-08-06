// Retrieval-stage time budget + crash-visible checkpoints.
//
// Why this exists: when the edge runtime kills the isolate ("CPU Time
// exceeded") mid-retrieval, nothing is written to qa_logs and the job row is
// left stale at `running`. This module persists a small checkpoint trail to
// the job row *as retrieval progresses*, and exposes a hard internal deadline
// so the pipeline can fail closed with a real limitation instead of dying.
//
// Pure bookkeeping: no network beyond the injected persist callback, no model
// calls, no effect on retrieval semantics.

export interface RetrievalCheckpoint {
  name: string;
  at_ms: number;
  detail?: Record<string, unknown>;
}

export const RETRIEVAL_BUDGET = {
  /** Specific-case runs get a tight deadline: the deterministic fast lane is
   *  the only path that matters, and broad web retrieval is the CPU sink. */
  SPECIFIC_CASE_DEADLINE_MS: 90_000,
  /** Everything else keeps its historical envelope. */
  DEFAULT_DEADLINE_MS: 240_000,
} as const;

export interface RetrievalBudgetReport {
  deadline_ms: number;
  elapsed_ms: number;
  exceeded: boolean;
  guard_triggered: boolean;
  guard_triggered_at: string | null;
  checkpoints: RetrievalCheckpoint[];
}

export class RetrievalBudget {
  readonly t0 = Date.now();
  readonly deadline_ms: number;
  readonly checkpoints: RetrievalCheckpoint[] = [];
  private guard_at: string | null = null;
  private readonly persist?: (checkpoints: RetrievalCheckpoint[]) => void;

  constructor(deadlineMs: number, persist?: (c: RetrievalCheckpoint[]) => void) {
    this.deadline_ms = deadlineMs;
    this.persist = persist;
  }

  elapsed(): number {
    return Date.now() - this.t0;
  }

  exceeded(): boolean {
    return this.elapsed() > this.deadline_ms;
  }

  /** Milliseconds left before the hard deadline (never negative-infinite). */
  remaining(): number {
    return this.deadline_ms - this.elapsed();
  }


  /** Record a checkpoint and (fire-and-forget) persist the trail. */
  mark(name: string, detail?: Record<string, unknown>): void {
    this.checkpoints.push({ name, at_ms: this.elapsed(), ...(detail ? { detail } : {}) });
    try {
      this.persist?.(this.checkpoints);
    } catch {
      /* checkpoint persistence must never break retrieval */
    }
  }

  /** Mark the hard deadline as hit at a named place in the pipeline. */
  trigger(where: string): void {
    this.guard_at = where;
    this.mark("retrieval_cpu_guard_triggered", { where, elapsed_ms: this.elapsed() });
  }

  report(): RetrievalBudgetReport {
    return {
      deadline_ms: this.deadline_ms,
      elapsed_ms: this.elapsed(),
      exceeded: this.exceeded(),
      guard_triggered: this.guard_at !== null,
      guard_triggered_at: this.guard_at,
      checkpoints: this.checkpoints,
    };
  }
}
