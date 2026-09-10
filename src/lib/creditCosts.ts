// Centralized per-action credit costs. Edit in one place.

export const CREDIT_COSTS = {
  /** Single uniform-citation generation (freetext mode). */
  citation: 1,
  /** Verified-source autocomplete hit — pure DB lookup, no AI. */
  verifiedAutocomplete: 0,
  /** Per-source cost in batch footnote builder. */
  batchPerCitation: 1,
  /** Per-source cost in bibliography generator. */
  bibliographyPerSource: 1,
  /** Single Legal Research v1 query (full research pipeline). */
  research: 5,
  /** Source search: same research agent, no answer drafting. */
  sourceSearch: 3,
  /** Single Legal QA question (research / memo / case summary / pleading audit). */
  legalQa: 5,
  /** Academic writing wizard chapter generation. */
  academicChapter: 8,
  /** Surcharge added on top of legalQa when a grounded document is attached. */
  documentGroundingSurcharge: 2,
} as const;

export type CreditCostKey = keyof typeof CREDIT_COSTS;
