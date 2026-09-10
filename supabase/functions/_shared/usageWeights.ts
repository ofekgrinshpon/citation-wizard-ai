/**
 * Single server-side source of truth for internal usage weights.
 *
 * These are INTERNAL accounting units. They are never rendered to normal
 * users — the product surface only speaks about "מכסת שימוש".
 */
export const USAGE_WEIGHTS = {
  research_answer: 5,
  source_search: 3,
  case_summary_named: 2,
  case_summary_upload: 1,
  academic_chapter: 8,
} as const;

/** Batch-priced utilities: 1 internal unit per N processed items. */
export const USAGE_BATCH_GROUP = {
  /** Uniform citation / footnotes: 1 unit per up to 5 items. */
  citation: 5,
  /** Bibliography: 1 unit per up to 20 entries. */
  bibliography: 20,
} as const;

export type UsageOperation = keyof typeof USAGE_WEIGHTS;

/** ceil(items / group) — used for up-front batch estimates. */
export function batchUnits(items: number, group: number): number {
  if (items <= 0) return 0;
  return Math.ceil(items / group);
}
