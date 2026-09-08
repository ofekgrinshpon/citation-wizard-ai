/**
 * legal-research-v2 — user-facing progress presentation layer.
 *
 * This is PRESENTATION ONLY. It never constrains the agent: the research loop
 * stays free to alternate search → fetch → search → lookup → … . Real V2
 * activity is mapped onto four stable user-facing states and the mapping is
 * monotonic, so the user never sees the progression jump backwards while the
 * agent internally revisits earlier actions.
 */

export type ProgressStage = "searching" | "reading" | "verifying" | "writing";

export const PROGRESS_ORDER: ProgressStage[] = ["searching", "reading", "verifying", "writing"];

export const PROGRESS_LABELS_HE: Record<ProgressStage, string> = {
  searching: "מחפש מקורות",
  reading: "קורא מקורות",
  verifying: "מאמת מקורות",
  writing: "כותב תשובה",
};

export interface ProgressSink {
  /** Advance to `stage` if it is ahead of the current one. Never regresses. */
  advance(stage: ProgressStage): Promise<void>;
  /** Mark every stage complete (terminal success/refusal/failure). */
  finish(): Promise<void>;
  current(): ProgressStage | null;
}

interface JobWriter {
  from(table: string): {
    update(patch: Record<string, unknown>): { eq(col: string, val: string): Promise<unknown> };
  };
}

/**
 * Progress is persisted on the existing job row, so a worker chunk resume
 * simply picks the stored stage back up instead of restarting the UI.
 */
export function createProgressSink(
  admin: JobWriter | null,
  jobId: string | null,
  initial: ProgressStage | null,
): ProgressSink & { trace: Array<{ at: number; stage: ProgressStage }> } {
  let current: ProgressStage | null = initial;
  const trace: Array<{ at: number; stage: ProgressStage }> = [];
  const started = Date.now();

  const persist = async (stage: ProgressStage | null, done: ProgressStage[]) => {
    if (!admin || !jobId) return;
    try {
      await admin.from("legal_research_jobs").update({
        current_stage: stage,
        progress_label_he: stage ? PROGRESS_LABELS_HE[stage] : null,
        completed_stages: done,
      }).eq("id", jobId);
    } catch {/* progress is best-effort, never fails a run */}
  };

  return {
    trace,
    current: () => current,
    async advance(stage: ProgressStage) {
      const next = PROGRESS_ORDER.indexOf(stage);
      const now = current ? PROGRESS_ORDER.indexOf(current) : -1;
      if (next <= now) return;
      current = stage;
      trace.push({ at: Date.now() - started, stage });
      await persist(stage, PROGRESS_ORDER.slice(0, next));
    },
    async finish() {
      current = null;
      await persist(null, [...PROGRESS_ORDER]);
    },
  };
}
