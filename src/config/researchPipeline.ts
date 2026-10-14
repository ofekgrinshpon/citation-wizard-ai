/**
 * The supported legal-research execution pipeline.
 * V1 is retired; its historical results and stage labels remain readable.
 */
export const RESEARCH_PIPELINE = "v2" as const;

export const RESEARCH_FUNCTIONS = {
  v2: "legal-research-v2",
} as const;

/**
 * One destination for normal Legal Research, attachments or not.
 *
 * V2 reads user uploads as first-class preloaded evidence sources.
 * Keep the options signature for existing callers; attachments never change
 * the execution endpoint.
 */
export function researchFunctionFor(_opts: { hasAttachments: boolean } = { hasAttachments: false }): string {
  return RESEARCH_FUNCTIONS.v2;
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
