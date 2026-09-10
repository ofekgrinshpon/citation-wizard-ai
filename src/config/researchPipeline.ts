/**
 * Which legal-research pipeline the beta experience calls.
 *
 * Rollback: set RESEARCH_PIPELINE back to "v1" — one line, no other change.
 * V1 stays deployed and fully functional either way.
 */
export const RESEARCH_PIPELINE: "v1" | "v2" = "v2";

export const RESEARCH_FUNCTIONS = {
  v1: "legal-research-v1",
  v2: "legal-research-v2",
} as const;

/**
 * File attachments are read by the V1 document pipeline only, so a question
 * with attached files keeps using V1 instead of silently losing the files.
 */
export function researchFunctionFor(opts: { hasAttachments: boolean }): string {
  if (RESEARCH_PIPELINE === "v2" && !opts.hasAttachments) return RESEARCH_FUNCTIONS.v2;
  return RESEARCH_FUNCTIONS.v1;
}

export const V1_STAGES: Array<{ key: string; label: string }> = [
  { key: "analyzer", label: "מנתח את השאלה" },
  { key: "planner", label: "מתכנן חיפושים משפטיים" },
  { key: "retrieval", label: "מחפש מקורות" },
  { key: "verifier", label: "מאמת את המקורות" },
  { key: "drafter", label: "כותב תשובה" },
  { key: "finalize", label: "מסדר הערות שוליים" },
];

/** V2 progress states — presentation only, monotonic, never a research gate. */
export const V2_STAGES: Array<{ key: string; label: string }> = [
  { key: "searching", label: "מחפש מקורות" },
  { key: "reading", label: "קורא מקורות" },
  { key: "verifying", label: "מאמת מקורות" },
  { key: "writing", label: "כותב תשובה" },
];

/** Source search never drafts an answer — same keys, honest labels. */
export const V2_SOURCE_STAGES: Array<{ key: string; label: string }> = [
  { key: "searching", label: "חושב על כיווני חיפוש" },
  { key: "reading", label: "קורא מקורות" },
  { key: "verifying", label: "מאמת ומדרג מקורות" },
];
