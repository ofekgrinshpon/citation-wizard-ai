// source_use_intent_planning_v1
//
// Normalizes the analyzer's optional `source_use_plan` into a plan the
// downstream stages can trust, and applies deterministic *safety-only*
// overrides. This stage never invents an answer template and never widens
// authority: it can only tighten requirements (docket → judgment body,
// statute section → official statute) and pin invariants
// (`found_only_can_support_claims` is always false).

import {
  AnalyzerOutput,
  AnswerStrategy,
  AuthorityRequirements,
  SourceUseIntent,
  SourceUsePlan,
  UserTaskIntent,
} from "../lib/types.ts";
import { detectDockets } from "./docketDetection.ts";
import { detectStatuteSections } from "./statuteSectionDetection.ts";

export interface SourceUseIntentReport {
  version: "source_use_intent_planning_v1";
  /** Whether the analyzer emitted a usable plan (vs deterministic fallback). */
  model_plan_present: boolean;
  fallback_reason: string | null;
  plan: SourceUsePlan;
  /** Deterministic safety overrides that were applied, in order. */
  overrides: string[];
  explicit_docket_detected: boolean;
  explicit_statute_section_detected: boolean;
}

const RESEARCH_GUIDANCE_TASKS: ReadonlySet<UserTaskIntent> = new Set<UserTaskIntent>([
  "source_recommendation",
  "literature_map",
  "seminar_planning",
  "legal_research_guidance",
]);

/** Tasks whose answers are ordinary legal statements about the law. */
const LEGAL_STATEMENT_TASKS: ReadonlySet<UserTaskIntent> = new Set<UserTaskIntent>([
  "case_holding",
  "statute_explanation",
  "doctrinal_explanation",
  "case_law_synthesis",
  "argument_development",
]);

export function isResearchGuidanceTask(t: UserTaskIntent | null | undefined): boolean {
  return !!t && RESEARCH_GUIDANCE_TASKS.has(t);
}

export function isLegalStatementTask(t: UserTaskIntent | null | undefined): boolean {
  return !!t && LEGAL_STATEMENT_TASKS.has(t);
}

/**
 * The plan permits research-guidance behaviour (describing/recommending
 * sources) either as the primary task or as the secondary half of a mixed
 * plan.
 */
export function planAllowsResearchGuidance(plan: SourceUsePlan | null | undefined): boolean {
  if (!plan) return false;
  return isResearchGuidanceTask(plan.user_task_intent) ||
    (plan.mixed_plan && isResearchGuidanceTask(plan.secondary_task_intent));
}

/** The plan still owes the user a substantive statement about the law. */
export function planRequiresLegalStatement(plan: SourceUsePlan | null | undefined): boolean {
  if (!plan) return true;
  return isLegalStatementTask(plan.user_task_intent) ||
    (plan.mixed_plan && isLegalStatementTask(plan.secondary_task_intent));
}

function defaultPlan(): SourceUsePlan {
  // Conservative fallback == today's behaviour: ordinary doctrinal answer,
  // primary law preferred, no bibliography behaviour.
  return {
    user_task_intent: "doctrinal_explanation",
    source_use_intent: ["binding_authority", "statutory_text", "doctrinal_support"],
    answer_strategy: "explain_law",
    authority_requirements: {
      requires_judgment_body: false,
      requires_official_statute: false,
      secondary_sources_can_support: true,
      found_only_allowed_as_reading_list: false,
      found_only_can_support_claims: false,
    },
    plan_confidence: "low",
    mixed_plan: false,
    reason: "deterministic_fallback_no_model_plan",
  };
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

// ─── academic_writing_intent_and_drafting_v1 ────────────────────────────────

export interface AcademicWritingDetection {
  genre:
    | "introduction"
    | "theoretical_background"
    | "argument_paragraph"
    | "chapter_outline"
    | "research_question"
    | "generic_academic";
  matched: string;
}

const ACADEMIC_WRITING_VERB_RE =
  /(?:כתוב|כתבי|כתבו|נסח|נסחי|נסחו|ניסחו|הרחב|הרחיבי|הרחיבו|גבש|גבשי|הצג|הציגי)/;
const ACADEMIC_OBJECT_RE =
  /(?:פרק\s+מבוא|פרק(?:\s+ה)?\s*ראשון|מבוא|רקע\s+תיאורטי|רקע\s+תיאורטי|פרק\s+תיאורטי|הצגת\s+נושא|פסקה\s+אקדמית|פסקת\s+טיעון|מתווה\s+(?:פרקים|העבודה|הסמינריון)|סמינריון|עבודה\s+אקדמית|עבודת\s+(?:גמר|סמינר)|עבודה\s+סמינריונית|שאלת\s+(?:ה)?מחקר)/;
const ACADEMIC_RESEARCH_QUESTION_RE = /שאלת\s+(?:ה)?מחקר/;
/** Explicit source-seeking — suppresses the academic-writing override. */
const SOURCE_SEEKING_RE =
  /(?:תן\s+לי\s+מקורות|תני\s+לי\s+מקורות|מקורות\s+(?:לביבליוגרפיה|לקריאה|לסמינריון|לעבודה)|מצא\s+(?:לי\s+)?(?:פסיקה|מקורות|מאמרים|ספרות)|איתור\s+מקורות|ביבליוגרפיה|רשימת\s+קריאה|רשימת\s+מקורות|המלצות\s+לקריאה)/;

/**
 * Detects requests to WRITE academic text ("כתוב פרק מבוא לסמינריון…").
 * Deterministic; does not depend on the model plan. Returns null when the
 * request is explicitly source-seeking or carries no writing signal.
 */
export function detectAcademicWritingRequest(question: string): AcademicWritingDetection | null {
  const q = question ?? "";
  if (!q.trim()) return null;
  if (SOURCE_SEEKING_RE.test(q)) return null;
  const hasVerb = ACADEMIC_WRITING_VERB_RE.test(q);
  const hasObject = ACADEMIC_OBJECT_RE.test(q);
  if (!hasVerb || !hasObject) return null;

  let genre: AcademicWritingDetection["genre"] = "generic_academic";
  if (/מתווה|מבנה\s+(?:ה)?עבודה|חלוקה\s+לפרקים/.test(q)) genre = "chapter_outline";
  else if (/פרק\s+מבוא|מבוא/.test(q)) genre = "introduction";
  else if (/רקע\s+תיאורטי|פרק\s+תיאורטי/.test(q)) genre = "theoretical_background";
  else if (/פסקת\s+טיעון|פסקה\s+אקדמית|טיעון/.test(q)) genre = "argument_paragraph";
  else if (ACADEMIC_RESEARCH_QUESTION_RE.test(q) && /גבש|נסח/.test(q)) genre = "research_question";
  return { genre, matched: "writing_verb+academic_object" };
}

export function isAcademicWritingTask(t: UserTaskIntent | null | undefined): boolean {
  return t === "academic_writing";
}

/** True when the plan's primary or secondary task is academic writing. */
export function planRequestsAcademicWriting(plan: SourceUsePlan | null | undefined): boolean {
  if (!plan) return false;
  return isAcademicWritingTask(plan.user_task_intent) ||
    (plan.mixed_plan && isAcademicWritingTask(plan.secondary_task_intent));
}

export function planSourceUseIntent(
  question: string,
  analyzer: AnalyzerOutput | null | undefined,
): SourceUseIntentReport {
  const overrides: string[] = [];
  const modelPlan = analyzer?.source_use_plan;
  let plan: SourceUsePlan = modelPlan
    ? { ...modelPlan, authority_requirements: { ...modelPlan.authority_requirements } }
    : defaultPlan();

  const dockets = detectDockets(question);
  const statuteSections = detectStatuteSections(question);
  const hasDocket = dockets.length > 0;
  const hasStatuteSection = statuteSections.length > 0;

  const req: AuthorityRequirements = plan.authority_requirements;

  // ── Safety floor 1: an explicit docket always demands a judgment body ────
  if (hasDocket) {
    if (!req.requires_judgment_body) {
      req.requires_judgment_body = true;
      overrides.push("explicit_docket_requires_judgment_body");
    }
    if (isResearchGuidanceTask(plan.user_task_intent) && !plan.mixed_plan) {
      // Never downgrade a named-judgment question into a reading list.
      plan = {
        ...plan,
        mixed_plan: true,
        secondary_task_intent: plan.user_task_intent,
        user_task_intent: "case_holding",
        answer_strategy: "summarize_case",
      };
      overrides.push("explicit_docket_forces_case_holding_primary");
    }
  }

  // ── Safety floor 2: explicit statute section demands official text ──────
  if (hasStatuteSection && !req.requires_official_statute) {
    req.requires_official_statute = true;
    overrides.push("explicit_statute_section_requires_official_statute");
  }

  // ── Safety floor 3: case_holding never rests on secondary sources ───────
  if (plan.user_task_intent === "case_holding") {
    if (!req.requires_judgment_body) {
      req.requires_judgment_body = true;
      overrides.push("case_holding_requires_judgment_body");
    }
    if (req.secondary_sources_can_support) {
      req.secondary_sources_can_support = false;
      overrides.push("case_holding_blocks_secondary_support");
    }
  }

  // ── Safety floor 4: bibliography-only is reserved for genuine requests ──
  const bibliographyOnly = plan.source_use_intent.includes("bibliography_only");
  if (bibliographyOnly && !isResearchGuidanceTask(plan.user_task_intent)) {
    plan = {
      ...plan,
      source_use_intent: plan.source_use_intent.filter((i) => i !== "bibliography_only"),
    };
    overrides.push("bibliography_only_dropped_for_legal_task");
  }

  // ── Guardrail: low confidence + plausible dual task → prefer mixed ──────
  if (
    plan.plan_confidence === "low" && !plan.mixed_plan &&
    !hasDocket && !hasStatuteSection
  ) {
    const dual = isResearchGuidanceTask(plan.user_task_intent)
      ? "doctrinal_explanation"
      : "legal_research_guidance";
    plan = { ...plan, mixed_plan: true, secondary_task_intent: dual as UserTaskIntent };
    overrides.push("low_confidence_prefers_mixed_plan");
  }

  // ── Invariants ──────────────────────────────────────────────────────────
  req.found_only_can_support_claims = false;
  if (planAllowsResearchGuidance(plan) && !req.found_only_allowed_as_reading_list) {
    req.found_only_allowed_as_reading_list = true;
    overrides.push("research_guidance_allows_reading_list");
  }
  if (!planAllowsResearchGuidance(plan) && req.found_only_allowed_as_reading_list) {
    req.found_only_allowed_as_reading_list = false;
    overrides.push("legal_task_suppresses_reading_list");
  }

  const strategy: AnswerStrategy = plan.answer_strategy;
  const sourceUse: SourceUseIntent[] = uniq(plan.source_use_intent);
  plan = { ...plan, answer_strategy: strategy, source_use_intent: sourceUse, authority_requirements: req };

  return {
    version: "source_use_intent_planning_v1",
    model_plan_present: !!modelPlan,
    fallback_reason: modelPlan ? null : "analyzer_plan_absent_or_invalid",
    plan,
    overrides,
    explicit_docket_detected: hasDocket,
    explicit_statute_section_detected: hasStatuteSection,
  };
}

// ─── Source buckets ─────────────────────────────────────────────────────────

export interface SourceBucketInput {
  ref: string;
  title: string;
  body_acquired?: boolean;
  snippet?: string | null;
  topical_text?: string;
  source_type?: string;
}

export interface SourceBuckets {
  read_in_full: string[];
  found_only: string[];
  dropped_unrelated: string[];
}

/**
 * Buckets sources for the drafter and for telemetry:
 *  - read_in_full: real acquired body text (citable for substantive claims);
 *  - found_only: located but not acquired — reading candidates only, and only
 *    when the plan allows a reading list AND the source is on-topic;
 *  - dropped_unrelated: located, not acquired, and not topically related.
 */
export function bucketSources(
  sources: SourceBucketInput[],
  topicalRefs: Iterable<string>,
): SourceBuckets {
  const topical = new Set(topicalRefs);
  const read_in_full: string[] = [];
  const found_only: string[] = [];
  const dropped_unrelated: string[] = [];
  for (const s of sources) {
    if (s.body_acquired === true) {
      read_in_full.push(s.ref);
    } else if (topical.has(s.ref)) {
      found_only.push(s.ref);
    } else {
      dropped_unrelated.push(s.ref);
    }
  }
  return { read_in_full, found_only, dropped_unrelated };
}
