// Structural view of the retrieval budget, used by retrieval stages that must
// not start new work (or must bound a network call) once the wall-clock
// retrieval budget is spent. `RetrievalBudget` implements this interface.
export interface RetrievalGovernor {
  /** True while it is still safe to START new retrieval work. */
  canLaunch(): boolean;
  /** True once the hard wall-clock deadline has passed. */
  exceeded(): boolean;
  /** Milliseconds left before the hard deadline. */
  remaining(): number;
  /** Per-call abort signal bounded by both `ms` and the retrieval deadline. */
  callSignal(ms: number): AbortSignal;
  /** Count work that was never launched / was aborted by the budget. */
  noteAborted(n?: number): void;
  /** Count a body-acquisition attempt. */
  noteBodyAcquisition?(n?: number): void;
  /** Run-level ledger for uninterruptible binary extraction. */
  allowExtraction?(bytes: number, opts?: { speculative?: boolean }): boolean;
  /** Charge extracted characters back to the extraction ledger. */
  noteExtractionOutput?(chars: number, opts?: { speculative?: boolean }): void;
  /** Record that a usable body was acquired (stops speculative extraction). */
  noteSpeculativeBodyAcquired?(): void;
  /** True once speculative extraction must no longer be attempted. */
  speculativeExtractionBlocked?(): boolean;

  /** Record how long a named retrieval step took. */
  recordStep?(name: string, ms: number): void;
}
