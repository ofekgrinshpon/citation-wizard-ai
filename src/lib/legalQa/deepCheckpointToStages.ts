/**
 * Maps a backend `qa_logs.metadata.checkpoint` value (as returned by
 * `legal-qa-status` polling) to the cumulative `StageEvent[]` expected by
 * <StageProgressList mode="research_deep" />.
 *
 * Deep mode runs async (HTTP 202 + run_id polling), so it never emits SSE
 * `stage` events. Without this translation the progress bar sits at 1% for
 * the entire run.
 *
 * Stage id vocabulary must match DEEP_MANIFEST in src/components/StageProgressList.tsx.
 */
import type { StageEvent } from "@/components/StageProgressList";

const DEEP_STAGE_ORDER = [
  "plan",
  "retrieval",
  "verify",
  "ledger",
  "draft",
  "enrich_citations",
  "post_processing",
] as const;

type DeepStageId = typeof DEEP_STAGE_ORDER[number];

const DEEP_STAGE_LABELS: Record<DeepStageId, string> = {
  plan: "תכנון מחקר",
  retrieval: "אחזור מקורות",
  verify: "אימות וסינון",
  ledger: "מיפוי טענות",
  draft: "כתיבת התשובה",
  enrich_citations: "השלמת ציטוטים",
  post_processing: "בדיקת איכות סופית",
};

// Maps backend checkpoint -> which manifest stage is *currently running*.
// Earlier stages in DEEP_STAGE_ORDER are marked "complete".
const CHECKPOINT_TO_RUNNING: Record<string, DeepStageId | "__none__" | "__all_done__"> = {
  queued: "__none__",
  running: "__none__",
  legal_issue_router: "plan",
  decomposition: "plan",
  open_web_discovery: "retrieval",
  retrieval: "retrieval",
  claim_verification: "verify",
  claim_map: "ledger",
  drafting: "draft",
  drafting_failed: "draft",
  anchor_pass: "enrich_citations",
  completed: "__all_done__",
};

export function deepCheckpointToStages(checkpoint?: string | null): StageEvent[] {
  if (!checkpoint) return [];
  const target = CHECKPOINT_TO_RUNNING[checkpoint];
  if (!target || target === "__none__") return [];

  if (target === "__all_done__") {
    return DEEP_STAGE_ORDER.map((id) => ({
      stage: id,
      status: "complete" as const,
      label: DEEP_STAGE_LABELS[id],
    }));
  }

  const runningIdx = DEEP_STAGE_ORDER.indexOf(target);
  const events: StageEvent[] = [];
  for (let i = 0; i < runningIdx; i++) {
    const id = DEEP_STAGE_ORDER[i];
    events.push({ stage: id, status: "complete", label: DEEP_STAGE_LABELS[id] });
  }
  events.push({
    stage: target,
    status: "running",
    label: DEEP_STAGE_LABELS[target],
  });
  return events;
}
