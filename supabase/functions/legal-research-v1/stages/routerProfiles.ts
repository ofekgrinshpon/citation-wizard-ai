// router_profiles_v1 — turn the existing research-mode classification into a
// real pipeline router.
//
// Scope: selection + knobs + telemetry only. This module never performs
// retrieval, never calls a model, and never removes an existing gate. It only
// answers: "which profile is this question, and what budgets/ceilings apply?"
//
// Profiles:
//   A statute_first      — explicit statute section lookup
//   B exact_case         — docket / specific judgment (existing fast lane)
//   C doctrine_explainer — doctrinal explanation, no docket, no section
//   D research_memo      — explicit broad synthesis / memo (today's heavy path)
//   E citation_only      — pure citation formatting (no retrieval/verifier/drafter)

import { RETRIEVAL_BUDGET } from "./retrievalBudget.ts";
import { detectStatuteSections } from "./statuteSectionDetection.ts";
import { detectDockets } from "./docketDetection.ts";

export const ROUTER_PROFILES = [
  "statute_first",
  "exact_case",
  "doctrine_explainer",
  "research_memo",
  "citation_only",
] as const;
export type RouterProfile = typeof ROUTER_PROFILES[number];

export interface RouterDecision {
  version: "router_profiles_v1";
  selected_router_profile: RouterProfile;
  profile_reason: string;
  skipped_stages: string[];
  /** Hard wall-clock retrieval budget for this path. */
  path_budget_ms: number;
  /** Max retrieval queries admitted (required anchors are always kept). */
  max_retrieval_queries: number;
  /** Bounded case-law second pass (profile A only). */
  max_case_law_second_pass_queries: number;
  /** Max speculative (non-requested-docket) judgment acquisitions. */
  max_speculative_acquisitions: number;
  /** Max doctrinal facets kept from claim_facet_expansion_v1 (0 = disabled). */
  max_facets: number;
  /** Verifier sees only candidates inside the locked legal area. */
  verifier_same_area_only: boolean;
  /** Drafter block ceiling (null = no ceiling, today's behaviour). */
  drafter_block_ceiling: number | null;
  /** Drop blocks with no verified source instead of padding them. */
  drop_unsupported_blocks: boolean;
  /** True when the run would previously have taken the full heavy memo path. */
  downgraded_from_research_memo: boolean;
  /** Presentation-only limitation text for statute-first runs without case law. */
  statute_first_limitation: string | null;
  signals: {
    research_mode: string | null;
    output_shape: string | null;
    has_statute_section: boolean;
    has_docket: boolean;
    memo_cue: boolean;
    citation_cue: boolean;
    statute_cue: boolean;
    question_length: number;
    claim_count: number;
  };
}

export const STATUTE_FIRST_LIMITATION =
  "לא אותרה פסיקה ברת-שימוש במסגרת החיפוש; התשובה מתמקדת בלשון הסעיף.";

/** "מה קובע סעיף X", "לפי סעיף X", "נוסח סעיף X", "מה אומר סעיף X" */
const STATUTE_CUE =
  /(מה\s+(קובע|אומר|מורה|מגדיר)\s+סעיף|לפי\s+סעיף|על\s+פי\s+סעיף|נוסח\s+(של\s+)?סעיף|לשון\s+(ה)?סעיף|מכוח\s+סעיף|תנאי\s+סעיף|הוראת\s+סעיף)/;

/** Explicit broad synthesis / memo request. */
const MEMO_CUE =
  /(חוו?ת\s+דעת|תזכיר|memo|סקירה\s+מקיפה|סקירה\s+רחבה|ניתוח\s+מקיף|מחקר\s+מקיף|כתוב\s+פרק|סקור\s+את|מסמך\s+עמדה|ניתוח\s+מעמיק)/i;

/** Pure citation-formatting request (no substantive legal question). */
const CITATION_CUE =
  /(כללי\s+הציטוט\s+האחיד|עצב\s+(לי\s+)?(את\s+)?(ה)?(הפניה|ציטוט|ביבליוגרפיה)|פרמט\s+(לי\s+)?(את\s+)?(ה)?(הפניה|ציטוט|ביבליוגרפיה)|איך\s+מצטטים|כתוב\s+(לי\s+)?הערת\s+שוליים|רשימה\s+ביבליוגרפית|בנה\s+ביבליוגרפיה)/;

/** Substantive-question cues that veto the citation_only bypass. */
const SUBSTANTIVE_VETO =
  /(מהי?\s|מהם|מדוע|כיצד|האם|מתי|אמת\s+המידה|היקף|תנאים|הלכה|עילה|סעד)/;

const NO_STAGES: string[] = [];

export function selectRouterProfile(input: {
  question: string;
  research_mode: string | null;
  output_shape: string | null;
  claim_count: number;
  is_sources_only?: boolean;
}): RouterDecision {
  const q = input.question ?? "";
  const has_statute_section = detectStatuteSections(q).length > 0;
  const has_docket = detectDockets(q).length > 0;
  const memo_cue = MEMO_CUE.test(q);
  const citation_cue = CITATION_CUE.test(q) && !SUBSTANTIVE_VETO.test(q);
  const statute_cue = STATUTE_CUE.test(q);
  const mode = input.research_mode;

  const signals = {
    research_mode: mode,
    output_shape: input.output_shape,
    has_statute_section,
    has_docket,
    memo_cue,
    citation_cue,
    statute_cue,
    question_length: q.length,
    claim_count: input.claim_count,
  };

  let profile: RouterProfile;
  let reason: string;

  if (citation_cue && !has_docket && !input.is_sources_only) {
    profile = "citation_only";
    reason = "citation_formatting_cue";
  } else if (mode === "specific_case" || has_docket) {
    profile = "exact_case";
    reason = has_docket ? "docket_detected" : "mode=specific_case";
  } else if (
    has_statute_section &&
    (statute_cue || mode === "statute_section_definition" || mode === "canonical_quote")
  ) {
    profile = "statute_first";
    reason = statute_cue
      ? "statute_section+statute_cue"
      : `statute_section+mode=${mode ?? "unknown"}`;
  } else if (memo_cue || (input.claim_count >= 5 && q.length >= 400)) {
    profile = "research_memo";
    reason = memo_cue ? "memo_cue" : "many_claims_long_question";
  } else {
    profile = "doctrine_explainer";
    reason = `default_doctrine:mode=${mode ?? "unknown"};shape=${input.output_shape ?? "unknown"}`;
  }

  const base = {
    version: "router_profiles_v1" as const,
    selected_router_profile: profile,
    profile_reason: reason,
    downgraded_from_research_memo: profile !== "research_memo",
    statute_first_limitation: null as string | null,
    signals,
  };

  switch (profile) {
    case "statute_first":
      return {
        ...base,
        skipped_stages: ["judgment_discovery", "judgment_text_acquisition", "claim_facet_expansion"],
        path_budget_ms: 90_000,
        max_retrieval_queries: 8,
        max_case_law_second_pass_queries: 2,
        max_speculative_acquisitions: 0,
        max_facets: 0,
        verifier_same_area_only: false,
        drafter_block_ceiling: 5,
        drop_unsupported_blocks: true,
        statute_first_limitation: STATUTE_FIRST_LIMITATION,
      };
    case "exact_case":
      return {
        ...base,
        skipped_stages: ["claim_facet_expansion"],
        path_budget_ms: RETRIEVAL_BUDGET.SPECIFIC_CASE_DEADLINE_MS,
        max_retrieval_queries: 20,
        max_case_law_second_pass_queries: 0,
        max_speculative_acquisitions: 3,
        max_facets: 0,
        verifier_same_area_only: false,
        drafter_block_ceiling: null,
        drop_unsupported_blocks: false,
      };
    case "doctrine_explainer":
      return {
        ...base,
        skipped_stages: NO_STAGES,
        path_budget_ms: 140_000,
        max_retrieval_queries: 14,
        max_case_law_second_pass_queries: 0,
        max_speculative_acquisitions: 2,
        max_facets: 3,
        verifier_same_area_only: true,
        drafter_block_ceiling: 7,
        drop_unsupported_blocks: true,
      };
    case "research_memo":
      return {
        ...base,
        skipped_stages: NO_STAGES,
        path_budget_ms: RETRIEVAL_BUDGET.DEFAULT_DEADLINE_MS,
        max_retrieval_queries: 40,
        max_case_law_second_pass_queries: 0,
        max_speculative_acquisitions: 4,
        max_facets: 8,
        verifier_same_area_only: false,
        drafter_block_ceiling: null,
        drop_unsupported_blocks: false,
      };
    case "citation_only":
    default:
      return {
        ...base,
        skipped_stages: [
          "retrieval",
          "judgment_discovery",
          "judgment_text_acquisition",
          "claim_facet_expansion",
          "verifier",
          "drafter",
        ],
        path_budget_ms: 0,
        max_retrieval_queries: 0,
        max_case_law_second_pass_queries: 0,
        max_speculative_acquisitions: 0,
        max_facets: 0,
        verifier_same_area_only: false,
        drafter_block_ceiling: null,
        drop_unsupported_blocks: false,
      };
  }
}

// ─── Query admission ────────────────────────────────────────────────────────

export interface QueryAdmissionReport {
  admitted: number;
  dropped: number;
  anchor_kept: number;
  cap: number;
}

/**
 * Cap the retrieval query set for the selected profile. Required-anchor
 * queries are never dropped: they carry the deterministic primary-source
 * obligations (docket / statute-section anchors).
 */
export function admitQueries<T extends { metadata?: Record<string, unknown> }>(
  decision: RouterDecision,
  anchorQueries: T[],
  otherQueries: T[],
): { queries: T[]; report: QueryAdmissionReport } {
  const cap = decision.max_retrieval_queries;
  const room = Math.max(0, cap - anchorQueries.length);
  const kept = otherQueries.slice(0, room);
  return {
    queries: [...anchorQueries, ...kept],
    report: {
      admitted: anchorQueries.length + kept.length,
      dropped: otherQueries.length - kept.length,
      anchor_kept: anchorQueries.length,
      cap,
    },
  };
}

// ─── Drafter block ceiling ──────────────────────────────────────────────────

export interface BlockTrimReport {
  applied: boolean;
  ceiling: number | null;
  blocks_before: number;
  blocks_after: number;
  dropped_unsupported: number;
  dropped_overflow: number;
}

interface TrimmableBlock {
  source_refs?: unknown;
  [k: string]: unknown;
}

/**
 * Deterministically enforce the profile's block ceiling *before* footnotes are
 * built. Unsupported blocks (no source_refs) are dropped first — a light path
 * should say less, not pad. The first block is always kept.
 */
export function applyBlockCeiling<T extends TrimmableBlock>(
  blocks: T[],
  opts: { ceiling: number | null; dropUnsupported: boolean },
): { blocks: T[]; report: BlockTrimReport } {
  const before = blocks.length;
  const ceiling = opts.ceiling;
  const noop: BlockTrimReport = {
    applied: false,
    ceiling,
    blocks_before: before,
    blocks_after: before,
    dropped_unsupported: 0,
    dropped_overflow: 0,
  };
  if (!ceiling || before <= ceiling) return { blocks, report: noop };

  const supported = (b: T) => Array.isArray(b.source_refs) && b.source_refs.length > 0;
  let out = blocks;
  let dropped_unsupported = 0;
  if (opts.dropUnsupported) {
    const keep: T[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (i === 0 || supported(b) || keep.length + (blocks.length - i - 1) < ceiling) {
        keep.push(b);
      } else {
        dropped_unsupported++;
      }
      if (keep.length >= ceiling && dropped_unsupported >= before - ceiling) break;
    }
    out = keep;
  }
  const dropped_overflow = Math.max(0, out.length - ceiling);
  out = out.slice(0, ceiling);
  return {
    blocks: out,
    report: {
      applied: true,
      ceiling,
      blocks_before: before,
      blocks_after: out.length,
      dropped_unsupported,
      dropped_overflow,
    },
  };
}
