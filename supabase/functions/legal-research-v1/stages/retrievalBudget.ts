// Retrieval-stage time budget + crash-visible checkpoints.
//
// Why this exists: when the edge runtime kills the isolate ("CPU Time
// exceeded") mid-retrieval, nothing is written to qa_logs and the job row is
// left stale at `running`. This module persists a small checkpoint trail to
// the job row *as retrieval progresses*, exposes a hard internal deadline so
// the pipeline can fail closed with a real limitation instead of dying, and
// (retrieval_budget_enforcement_v1) governs what may still be *launched*:
//
//   - a wall-clock deadline with an abort signal that every awaited network
//     call can subscribe to;
//   - a launch gate (`canLaunch`) that stops new retrieval work well before
//     the deadline, so in-flight work can still settle;
//   - a run-level extraction ledger, because binary text extraction is a
//     synchronous, uninterruptible CPU step that no deadline can preempt;
//   - counters for aborted / ignored-late tasks and the longest step.
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
  /** Hard wall-clock retrieval budget for everything else. */
  DEFAULT_DEADLINE_MS: 200_000,
  /** Fraction of the deadline after which no *new* retrieval work is started. */
  LAUNCH_STOP_RATIO: 0.75,
  /** Max uninterruptible binary extractions per run. */
  MAX_EXTRACTIONS_PER_RUN: 3,
  /** Max total bytes fed to binary extraction per run. */
  MAX_EXTRACTION_BYTES_PER_RUN: 5 * 1024 * 1024,
} as const;

export interface RetrievalBudgetReport {
  retrieval_budget_ms: number;
  retrieval_elapsed_ms: number;
  budget_exceeded: boolean;
  aborted_tasks_count: number;
  ignored_late_tasks_count: number;
  body_acquisition_count: number;
  extraction_count: number;
  extraction_bytes: number;
  longest_retrieval_step: { name: string; ms: number } | null;
  partial_retrieval_used: boolean;
  // legacy shape (kept so existing telemetry readers keep working)
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
  readonly launch_stop_ms: number;
  readonly checkpoints: RetrievalCheckpoint[] = [];
  private guard_at: string | null = null;
  private readonly persist?: (checkpoints: RetrievalCheckpoint[]) => void | Promise<void>;
  private readonly controller = new AbortController();
  private timer: number | null = null;

  aborted_tasks = 0;
  ignored_late_tasks = 0;
  body_acquisitions = 0;
  extraction_count = 0;
  extraction_bytes = 0;
  partial_retrieval_used = false;
  private longest: { name: string; ms: number } | null = null;

  constructor(
    deadlineMs: number,
    persist?: (c: RetrievalCheckpoint[]) => void | Promise<void>,
  ) {
    this.deadline_ms = deadlineMs;
    this.launch_stop_ms = Math.floor(deadlineMs * RETRIEVAL_BUDGET.LAUNCH_STOP_RATIO);
    this.persist = persist;
    this.timer = setTimeout(() => {
      try { this.controller.abort(new Error("retrieval_budget_exceeded")); } catch { /* noop */ }
    }, deadlineMs) as unknown as number;
  }

  /** Abort signal fired when the wall-clock deadline is reached. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Release the deadline timer once retrieval is over. */
  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
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

  /** True while it is still safe to START new retrieval work. */
  canLaunch(): boolean {
    return this.elapsed() < this.launch_stop_ms;
  }

  /** A per-call abort signal bounded by both `ms` and the retrieval deadline. */
  callSignal(ms: number): AbortSignal {
    const capped = Math.max(1_000, Math.min(ms, Math.max(1_000, this.remaining())));
    // deno-lint-ignore no-explicit-any
    const any = (AbortSignal as any).any;
    const timeout = AbortSignal.timeout(capped);
    return typeof any === "function" ? any([timeout, this.controller.signal]) : timeout;
  }

  noteAborted(n = 1): void {
    this.aborted_tasks += n;
  }

  noteIgnoredLate(n = 1): void {
    this.ignored_late_tasks += n;
  }

  noteBodyAcquisition(n = 1): void {
    this.body_acquisitions += n;
  }

  /**
   * Run-level ledger for uninterruptible binary extraction. Returns false when
   * this run has already spent its extraction allowance — the caller must skip
   * extraction instead of risking an isolate kill.
   */
  allowExtraction(bytes: number): boolean {
    if (this.extraction_count >= RETRIEVAL_BUDGET.MAX_EXTRACTIONS_PER_RUN) return false;
    if (this.extraction_bytes + bytes > RETRIEVAL_BUDGET.MAX_EXTRACTION_BYTES_PER_RUN) return false;
    this.extraction_count++;
    this.extraction_bytes += bytes;
    return true;
  }

  /** Record how long a named retrieval step took (tracks the longest). */
  recordStep(name: string, ms: number): void {
    if (!this.longest || ms > this.longest.ms) this.longest = { name, ms };
  }

  /** Time an awaited step and record it. */
  async timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      this.recordStep(name, Date.now() - t);
    }
  }

  /**
   * Await `p`, but never past the retrieval deadline. When the deadline hits
   * first, the pending task is ignored (counted) and `fallback` is returned;
   * the underlying work is abandoned, not awaited.
   */
  async raceDeadline<T>(name: string, p: Promise<T>, fallback: T): Promise<T> {
    const left = this.remaining();
    if (left <= 0) {
      this.noteIgnoredLate();
      this.mark("retrieval_late_task_ignored", { name, reason: "already_expired" });
      p.catch(() => {});
      return fallback;
    }
    let timer: number | undefined;
    const expiry = new Promise<typeof SENTINEL>((res) => {
      timer = setTimeout(() => res(SENTINEL), left) as unknown as number;
    });
    const winner = await Promise.race([p.catch(() => SENTINEL_ERR), expiry]);
    if (timer !== undefined) clearTimeout(timer);
    if (winner === SENTINEL) {
      this.noteIgnoredLate();
      this.partial_retrieval_used = true;
      p.catch(() => {});
      this.mark("retrieval_late_task_ignored", { name, elapsed_ms: this.elapsed() });
      return fallback;
    }
    if (winner === SENTINEL_ERR) return fallback;
    return winner as T;
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

  /**
   * Record a checkpoint and AWAIT its persistence. Used for the first
   * checkpoint of a stage, so an isolate killed immediately afterwards still
   * leaves a durable trail showing where it died.
   */
  async markDurable(name: string, detail?: Record<string, unknown>): Promise<void> {
    this.checkpoints.push({ name, at_ms: this.elapsed(), ...(detail ? { detail } : {}) });
    try {
      await this.persist?.(this.checkpoints);
    } catch {
      /* checkpoint persistence must never break retrieval */
    }
  }

  /** Mark the hard deadline as hit at a named place in the pipeline. */
  trigger(where: string): void {
    this.guard_at = where;
    this.mark("retrieval_budget_exceeded", { where, elapsed_ms: this.elapsed() });
    this.mark("retrieval_cpu_guard_triggered", { where, elapsed_ms: this.elapsed() });
  }

  report(): RetrievalBudgetReport {
    return {
      retrieval_budget_ms: this.deadline_ms,
      retrieval_elapsed_ms: this.elapsed(),
      budget_exceeded: this.exceeded(),
      aborted_tasks_count: this.aborted_tasks,
      ignored_late_tasks_count: this.ignored_late_tasks,
      body_acquisition_count: this.body_acquisitions,
      extraction_count: this.extraction_count,
      extraction_bytes: this.extraction_bytes,
      longest_retrieval_step: this.longest,
      partial_retrieval_used: this.partial_retrieval_used,
      deadline_ms: this.deadline_ms,
      elapsed_ms: this.elapsed(),
      exceeded: this.exceeded(),
      guard_triggered: this.guard_at !== null,
      guard_triggered_at: this.guard_at,
      checkpoints: this.checkpoints,
    };
  }
}

const SENTINEL = Symbol("retrieval_deadline");
const SENTINEL_ERR = Symbol("retrieval_task_error");
