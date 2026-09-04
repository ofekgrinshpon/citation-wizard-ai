// five_mode_source_depth_policy_v1 — early, deterministic research-depth policy.
//
// Scope: decide *how deep* the research should go, before planner queries,
// source nomination, discovery and acquisition. Five research-depth modes
// only — this is NOT a taxonomy of legal subjects and never classifies the
// substantive field of law.
//
// Hard rules for this module:
// - no model call, no doctrine dictionary, no source allowlist;
// - purely structural / phrasing signals (same style as researchMode.ts);
// - it raises *floors* on source-type diversity; it never raises hard caps,
//   never loosens a gate, and never makes anything citable.

import type { AnalyzerOutput, OutputShape, Query, SourceRole } from "../lib/types.ts";
import { detectStatuteSections } from "./statuteSectionDetection.ts";
import { detectDockets } from "./docketDetection.ts";

export const SOURCE_DEPTH_VERSION = "five_mode_source_depth_policy_v1";

export const SOURCE_DEPTH_MODES = [
  "exact_source",
  "specific_case_or_statute",
  "narrow_doctrine",
  "broad_research",
  "academic_research",
] as const;
export type SourceDepthMode = typeof SOURCE_DEPTH_MODES[number];

export type PerplexityPolicy = "never" | "targeted" | "allowed";

export interface SourceMix {
  primary_law: [number, number];
  judgments: [number, number];
  secondary_sources: [number, number];
  institutional_sources: [number, number];
  bills_or_explanatory_notes: [number, number];
}

/** Target *attempts* per depth mode — never required final citations. */
export const SOURCE_MIX: Record<SourceDepthMode, SourceMix> = {
  exact_source: {
    primary_law: [1, 1],
    judgments: [0, 0],
    secondary_sources: [0, 0],
    institutional_sources: [0, 0],
    bills_or_explanatory_notes: [0, 0],
  },
  specific_case_or_statute: {
    primary_law: [1, 1],
    judgments: [0, 1],
    secondary_sources: [0, 0],
    institutional_sources: [0, 0],
    bills_or_explanatory_notes: [0, 0],
  },
  narrow_doctrine: {
    primary_law: [0, 1],
    judgments: [1, 2],
    secondary_sources: [0, 1],
    institutional_sources: [0, 0],
    bills_or_explanatory_notes: [0, 0],
  },
  broad_research: {
    primary_law: [1, 1],
    judgments: [2, 4],
    secondary_sources: [1, 1],
    institutional_sources: [0, 1],
    bills_or_explanatory_notes: [0, 0],
  },
  academic_research: {
    primary_law: [1, 2],
    judgments: [2, 4],
    secondary_sources: [2, 4],
    institutional_sources: [1, 3],
    bills_or_explanatory_notes: [0, 2],
  },
};

const PERPLEXITY_BY_MODE: Record<SourceDepthMode, PerplexityPolicy> = {
  exact_source: "never",
  specific_case_or_statute: "targeted",
  narrow_doctrine: "targeted",
  broad_research: "allowed",
  academic_research: "allowed",
};

/** Minimum kept queries per expected_source_type in query_merge_and_budget. */
export type MinSlots = Record<string, number>;

const MIN_SLOTS: Record<SourceDepthMode, MinSlots> = {
  exact_source: { statute: 1 },
  specific_case_or_statute: { case: 1 },
  narrow_doctrine: { case: 1 },
  broad_research: { statute: 1, case: 2, academic: 1 },
  academic_research: { statute: 1, case: 2, academic: 2, report: 1 },
};

// ─── Structural cues ────────────────────────────────────────────────────────

/** "צטט", "מה לשון", "נוסח מדויק" … */
const QUOTE_CUE =
  /(צטט|ציטוט\s+מדויק|מה\s+לשון|לשון\s+(ה)?סעיף|נוסח\s+(מדויק|מלא)|מילה\s+במילה|verbatim)/i;

/** "מה נקבע ב…", "מה קבע בית המשפט ב…" */
const SPECIFIC_RULING_CUE =
  /(מה\s+נקבע\s+ב|מה\s+קבע(ה)?\s+.{0,20}\bב|מה\s+ההלכה\s+שנקבעה\s+ב|מה\s+עולה\s+מפסק\s+הדין)/;

/** Broad synthesis / survey / memo request. */
const BROAD_CUE =
  /(סקור|סקירה|התפתחות|מבחני|מבחן\s+ה|מהם\s+ה|אילו\s+ה|חוו?ת\s+דעת|תזכיר|memo|ניתוח\s+מקיף|מחקר\s+מקיף|מקיפ|באופן\s+כללי|מה\s+הדין\s+לגבי|אמות?\s+ה?מידה|היקף\s+ה|כיצד\s+התפתח|מגמות)/i;

/** Academic / seminar / literature-review / academic-drafting request.
 *  research_richness_execution_unblock_v1 — the detector previously missed the
 *  most common academic drafting phrasings (רקע תיאורטי, פרק מבוא, פסקת טיעון
 *  אקדמית, הצעת מחקר …), which pushed those runs into narrow-doctrine budgets. */
const ACADEMIC_CUE =
  /(סמינריון|פרק\s+סמינריוני|סמינר|עבודה\s+אקדמית|כתיבה\s+אקדמית|טיוטה\s+אקדמית|סקירת\s+ספרות|ביבליוגרפי|רשימת\s+מקורות|מצא\s+לי\s+מקורות|תעזור\s+לי\s+למצוא\s+מקורות|מאמרים\s+אקדמיים|ספרות\s+מחקרית|תזה|דוקטורט|רקע\s+תיאורטי|תשתית\s+תיאורטית|פרק\s+רקע|פרק\s+מבוא|פרק\s+תיאורטי|מתווה\s+פרקים|הצעת\s+מחקר|שאלת\s+מחקר|פסקת\s+טיעון|דיון\s+ביקורתי|ניתוח\s+דוקטרינרי|literature\s+review)/i;

/** Multi-facet phrasing: several distinct questions in one prompt. */
function multiFacet(question: string, analyzer: AnalyzerOutput): boolean {
  const marks = (question.match(/[?؟]/g) ?? []).length;
  if (marks >= 2) return true;
  // Claim count alone must not promote a short, single-doctrine question: the
  // analyzer routinely emits 3+ claims for a one-line definition request.
  return (analyzer.claims?.length ?? 0) >= 3 && question.length >= 140;
}

export interface SourceDepthDecision {
  version: typeof SOURCE_DEPTH_VERSION;
  /** false = validation control run (policy bypassed end-to-end). */
  enabled: boolean;
  depth_mode: SourceDepthMode;
  reasons: string[];
  source_mix: SourceMix;
  perplexity_policy: PerplexityPolicy;
  min_slots_by_source_type: MinSlots;
  planner_directive_he: string;
  signals: {
    output_shape: OutputShape | null;
    has_docket: boolean;
    has_statute_section: boolean;
    quote_cue: boolean;
    specific_ruling_cue: boolean;
    broad_cue: boolean;
    academic_cue: boolean;
    multi_facet: boolean;
    question_length: number;
    claim_count: number;
  };
}

const DIRECTIVES: Record<SourceDepthMode, string> = {
  exact_source: `עומק מחקר: מקור מדויק (exact_source).
- שאילתה אחת (לכל היותר שתיים) לנוסח הרשמי של ההוראה המבוקשת.
- אל תייצר שאילתות פסיקה, ספרות או דו"חות.`,
  specific_case_or_statute: `עומק מחקר: מקור ספציפי (specific_case_or_statute).
- מקד את השאילתות באיתור פסק הדין/הסעיף הספציפי שנזכר בשאלה.
- מקורות רקע רק אם הם זולים וישירות רלוונטיים. אל תייצר חיפוש ספרות רחב.`,
  narrow_doctrine: `עומק מחקר: דוקטרינה ממוקדת (narrow_doctrine).
- כוון ל-1–3 מקורות חזקים: דין ראשוני רלוונטי ופסיקה מנחה אחת–שתיים.
- ספרות משנית רק אם היא נחוצה ממש (לכל היותר שאילתה אחת).`,
  broad_research: `עומק מחקר: מחקר רחב (broad_research).
חובה לייצר חבילת מקורות מגוונת — אסור להסתפק בשאילתת חוק אחת:
- לפחות שאילתה אחת של דין ראשוני (primary_statute/regulation);
- לפחות שתי שאילתות פסיקה (binding_case_law/persuasive_case_law) בסוגיה עצמה;
- לפחות שאילתת ספרות משנית אחת (scholarship) כשהיא רלוונטית;
- מקור מוסדי/דו"ח רק אם רלוונטי.
לשאילתות פסיקה קבע targets: ["local_db","perplexity"].`,
  academic_research: `עומק מחקר: מחקר אקדמי (academic_research).
חובה לייצר חבילת מקורות אקדמית רחבה:
- דין ראשוני (חוק/תקנות) רלוונטי;
- 2–4 שאילתות פסיקה;
- 2–4 שאילתות ספרות אקדמית (מאמרים, ספרים, פרקים);
- מקורות מוסדיים/דו"חות ציבוריים;
- הצעות חוק ודברי הסבר כשהם רלוונטיים.
הפרד בין מקורות שניתן לצטט מהם טקסט לבין מקורות ביבליוגרפיים בלבד.`,
};

export function classifySourceDepth(input: {
  question: string;
  analyzer: AnalyzerOutput;
}): SourceDepthDecision {
  const question = String(input.question ?? "");
  const analyzer = input.analyzer;
  const shape = analyzer.answer_intent?.output_shape ?? null;
  const has_docket = detectDockets(question).length > 0;
  const has_statute_section = detectStatuteSections(question).length > 0;
  const quote_cue = QUOTE_CUE.test(question);
  const specific_ruling_cue = SPECIFIC_RULING_CUE.test(question);
  const broad_cue = BROAD_CUE.test(question);
  const academic_cue = ACADEMIC_CUE.test(question);
  const multi_facet = multiFacet(question, analyzer);

  const reasons: string[] = [];
  let mode: SourceDepthMode;

  if (academic_cue) {
    mode = "academic_research";
    reasons.push("academic_cue");
  } else if (shape === "quote" || (quote_cue && has_statute_section)) {
    mode = "exact_source";
    reasons.push(shape === "quote" ? "shape=quote" : "quote_cue+statute_section");
  } else if (has_docket || specific_ruling_cue || shape === "case_holding") {
    mode = "specific_case_or_statute";
    reasons.push(
      has_docket ? "docket_detected" : specific_ruling_cue ? "specific_ruling_cue" : "shape=case_holding",
    );
  } else if (has_statute_section && !broad_cue && !multi_facet) {
    mode = "specific_case_or_statute";
    reasons.push("single_statute_section_lookup");
  } else if (broad_cue || multi_facet || question.length >= 220) {
    mode = "broad_research";
    reasons.push(
      broad_cue ? "broad_cue" : multi_facet ? "multi_facet" : "long_question",
    );
  } else {
    mode = "narrow_doctrine";
    reasons.push(`shape=${shape ?? "unknown"}:default_narrow_doctrine`);
  }

  return {
    version: SOURCE_DEPTH_VERSION,
    enabled: true,
    depth_mode: mode,
    reasons,
    source_mix: SOURCE_MIX[mode],
    perplexity_policy: PERPLEXITY_BY_MODE[mode],
    min_slots_by_source_type: MIN_SLOTS[mode],
    planner_directive_he: DIRECTIVES[mode],
    signals: {
      output_shape: shape,
      has_docket,
      has_statute_section,
      quote_cue,
      specific_ruling_cue,
      broad_cue,
      academic_cue,
      multi_facet,
      question_length: question.length,
      claim_count: analyzer.claims?.length ?? 0,
    },
  };
}

/**
 * Control decision for A/B validation runs (smoke mode only): the policy is
 * inert — no directive, no floors, no trim, Perplexity unchanged.
 */
export function disabledSourceDepth(): SourceDepthDecision {
  return {
    version: SOURCE_DEPTH_VERSION,
    enabled: false,
    depth_mode: "narrow_doctrine",
    reasons: ["policy_disabled_control_run"],
    source_mix: SOURCE_MIX.narrow_doctrine,
    perplexity_policy: "allowed",
    min_slots_by_source_type: {},
    planner_directive_he: "",
    signals: {
      output_shape: null,
      has_docket: false,
      has_statute_section: false,
      quote_cue: false,
      specific_ruling_cue: false,
      broad_cue: false,
      academic_cue: false,
      multi_facet: false,
      question_length: 0,
      claim_count: 0,
    },
  };
}

// ─── Deterministic planner top-up / trim ────────────────────────────────────

const CASE_ROLES: SourceRole[] = ["binding_case_law", "persuasive_case_law"];

export interface DepthPlannerAudit {
  depth_mode: SourceDepthMode;
  planner_queries_by_source_type: Record<string, number>;
  missing_categories: string[];
  added_queries: Array<{ role: SourceRole; query_he: string }>;
  trimmed_queries: Array<{ role: SourceRole; query_he: string; reason: string }>;
  satisfied: boolean;
}

function topic(analyzer: AnalyzerOutput, question: string): string {
  const c = analyzer.claims?.[0]?.text_he;
  const base = (c && c.length > 8 ? c : question).replace(/\s+/g, " ").trim();
  return base.slice(0, 120);
}

/**
 * Deterministically top up (broad/academic) or trim (exact/specific) planner
 * output so the source mix floor is met. Never re-prompts a model, never
 * exceeds two added queries per missing category, and never touches
 * required-anchor queries (they are produced elsewhere).
 */
export function applyDepthToPlannerQueries(
  decision: SourceDepthDecision,
  queries: Query[],
  analyzer: AnalyzerOutput,
  question: string,
): { queries: Query[]; audit: DepthPlannerAudit } {
  const byType: Record<string, number> = {};
  for (const q of queries) {
    const t = String(q.expected_source_type ?? "other");
    byType[t] = (byType[t] ?? 0) + 1;
  }
  const added: DepthPlannerAudit["added_queries"] = [];
  const trimmed: DepthPlannerAudit["trimmed_queries"] = [];
  const missing: string[] = [];
  let out = [...queries];
  const claimId = analyzer.claims?.[0]?.claim_id ?? "C1";
  const t = topic(analyzer, question);

  const mode = decision.depth_mode;
  if (!decision.enabled) {
    return {
      queries,
      audit: {
        depth_mode: mode,
        planner_queries_by_source_type: byType,
        missing_categories: [],
        added_queries: [],
        trimmed_queries: [],
        satisfied: true,
      },
    };
  }

  if (mode === "exact_source" || mode === "specific_case_or_statute") {
    const allowScholarship = false;
    out = out.filter((q) => {
      const isScholarship = q.role === "scholarship" || q.expected_source_type === "academic";
      const isCase = CASE_ROLES.includes(q.role) || q.expected_source_type === "case";
      if (isScholarship && !allowScholarship) {
        trimmed.push({ role: q.role, query_he: q.query_he, reason: "depth_no_literature" });
        return false;
      }
      if (mode === "exact_source" && isCase) {
        trimmed.push({ role: q.role, query_he: q.query_he, reason: "depth_no_case_law" });
        return false;
      }
      return true;
    });
    // Never leave the run with zero queries.
    if (out.length === 0) out = [...queries], trimmed.length = 0;
  }

  if (mode === "broad_research" || mode === "academic_research") {
    const mk = (
      role: SourceRole,
      expected: Query["expected_source_type"],
      query_he: string,
      reason: string,
    ): Query => ({
      claim_id: claimId,
      role,
      query_he,
      targets: expected === "case" ? ["local_db", "perplexity"] : ["local_db", "perplexity"],
      expected_source_type: expected,
      reason,
      metadata: { producer: "source_depth_policy", depth_mode: mode },
    });

    const statuteCount = (byType["statute"] ?? 0) + (byType["regulation"] ?? 0);
    const caseCount = byType["case"] ?? 0;
    const academicCount = byType["academic"] ?? 0;
    const reportCount = byType["report"] ?? 0;

    const need = decision.min_slots_by_source_type;

    if ((need["statute"] ?? 0) > statuteCount) {
      missing.push("primary_law");
      const q = mk("primary_statute", "statute", `הסדר סטטוטורי — ${t}`, "depth_floor_primary_law");
      out.push(q);
      added.push({ role: q.role, query_he: q.query_he });
    }
    for (let i = caseCount; i < (need["case"] ?? 0); i++) {
      if (i === caseCount) missing.push("judgments");
      const variant = i === caseCount
        ? `פסיקת בית המשפט העליון — ${t}`
        : `יישום וסייגים בפסיקה — ${t}`;
      const q = mk("binding_case_law", "case", variant, "depth_floor_judgments");
      out.push(q);
      added.push({ role: q.role, query_he: q.query_he });
    }
    if ((need["academic"] ?? 0) > academicCount) {
      missing.push("secondary_sources");
      const q = mk("scholarship", "academic", `מאמר אקדמי / ספרות משפטית — ${t}`, "depth_floor_secondary");
      out.push(q);
      added.push({ role: q.role, query_he: q.query_he });
    }
    if ((need["report"] ?? 0) > reportCount) {
      missing.push("institutional_sources");
      const q = mk("government_report", "report", `דו"ח מוסדי / מסמך ועדה — ${t}`, "depth_floor_institutional");
      out.push(q);
      added.push({ role: q.role, query_he: q.query_he });
    }

    // academic_citation_authority_alignment_v1 — soft academic roles.
    // Two extra scholarship slots so an academic pack can carry a
    // critique/counter-position source and an applied/example source.
    // These are roles, not requirements: an empty result is reported, never
    // fabricated and never a refusal trigger.
    if (mode === "academic_research") {
      const critique = mk(
        "scholarship",
        "academic",
        `ביקורת אקדמית ועמדה מנוגדת — ${t}`,
        "academic_soft_role_critique",
      );
      out.push(critique);
      added.push({ role: critique.role, query_he: critique.query_he });
      const example = mk(
        "scholarship",
        "academic",
        `יישום בפועל ודוגמאות — ${t}`,
        "academic_soft_role_example",
      );
      out.push(example);
      added.push({ role: example.role, query_he: example.query_he });
    }
  }


  const finalByType: Record<string, number> = {};
  for (const q of out) {
    const k = String(q.expected_source_type ?? "other");
    finalByType[k] = (finalByType[k] ?? 0) + 1;
  }

  return {
    queries: out,
    audit: {
      depth_mode: mode,
      planner_queries_by_source_type: finalByType,
      missing_categories: missing,
      added_queries: added,
      trimmed_queries: trimmed,
      satisfied: Object.entries(decision.min_slots_by_source_type).every(
        ([k, v]) => (finalByType[k] ?? 0) >= v,
      ),
    },
  };
}
