/**
 * natural_literature_mode_and_topic_guard_v1
 *
 * Three deterministic, count-free pieces:
 *
 *   1. `detectNaturalLiteratureMode` — natural Hebrew literature-review /
 *      seminar / theoretical-background prompts activate the academic
 *      literature machinery, not only the narrow lab phrasing.
 *   2. `assessCenterOfGravity` — telemetry (+ a single honest directive) that
 *      records whether scholarship stayed central and whether adjacent
 *      scholarship was presented as direct.
 *   3. `buildUnusedLiteraturePackTelemetry` — report-only view of direct
 *      scholarship that reached the pack and was never cited.
 *
 * Hard scope: no new model call, no new retrieval stage, no recovery layer,
 * no citation minimum, no forced named synthesis, no drafter retry.
 */

export const NATURAL_LITERATURE_MODE_VERSION = "natural_literature_mode_and_topic_guard_v1";

// ── 1. activation ──────────────────────────────────────────────────────────

interface Signal {
  id: string;
  re: RegExp;
}

/** General Hebrew signals — phrase families, never whole prompts. */
const ACTIVATION_SIGNALS: Signal[] = [
  { id: "seqirat_sifrut", re: /סקיר(?:ת|ה)\s+(?:של\s+ה)?ספרות/ },
  { id: "literature_review_en", re: /literature\s+review/i },
  { id: "mapat_sifrut", re: /מפ(?:ת|ה\s+של\s+ה)ספרות/ },
  { id: "reka_teoreti", re: /רקע\s+תיאורטי/ },
  { id: "perek_sifrut", re: /פרק\s+(?:ה)?(?:סקירת\s+)?ספרות/ },
  { id: "sifrut_mehkarit", re: /ספרות\s+(?:מחקרית|אקדמית|משפטית)/ },
  { id: "ktiva_akademit", re: /כתיבה\s+אקדמית/ },
  { id: "seminar", re: /(?:ל)?סמינריון|עבוד(?:ה|ת)\s+סמינריונית/ },
  { id: "thesis", re: /תזה|דוקטורט|עבודת\s+גמר/ },
  { id: "academic_research", re: /מחקר\s+אקדמי/ },
];

/** Explicit exclusion of primary law by the user — the only way it is banned. */
const EXCLUSION_RE =
  /(בלי\s+פסיק|ללא\s+פסיק|בלי\s+חקיקה|ללא\s+חקיקה|אל\s+תשתמש\s+בפסיק|רק\s+ספרות|ספרות\s+(?:ה?משפטית\s+)?בלבד|לספרות\s+משפטית\s+בלבד|בלי\s+חוקים|ללא\s+חוקים)/;

export interface NaturalLiteratureModeResult {
  run_id: string;
  original_query: string;
  user_task_intent: string | null;
  answer_strategy: string | null;
  academic_literature_mode_before: boolean;
  academic_literature_mode_after: boolean;
  activation_signals: string[];
  explicit_exclusion_of_case_law_or_statutes: boolean;
  case_law_allowed_as_context: boolean;
  statutes_allowed_as_context: boolean;
}

export function detectNaturalLiteratureMode(input: {
  run_id: string;
  question: string;
  user_task_intent?: string | null;
  answer_strategy?: string | null;
  asks_for_sources?: boolean;
  mode_before: boolean;
}): NaturalLiteratureModeResult {
  const q = String(input.question ?? "");
  const signals = ACTIVATION_SIGNALS.filter((s) => s.re.test(q)).map((s) => s.id);
  const intent = input.user_task_intent ?? null;
  const strategy = input.answer_strategy ?? null;

  if (intent === "literature_map") signals.push("intent_literature_map");
  if (strategy === "map_literature") signals.push("strategy_map_literature");
  if (intent === "academic_writing" && (input.asks_for_sources === true || signals.length > 0)) {
    signals.push("academic_writing_with_literature_request");
  }

  const excluded = EXCLUSION_RE.test(q);
  const after = input.mode_before || signals.length > 0;
  return {
    run_id: input.run_id,
    original_query: q.slice(0, 400),
    user_task_intent: intent,
    answer_strategy: strategy,
    academic_literature_mode_before: input.mode_before,
    academic_literature_mode_after: after,
    activation_signals: [...new Set(signals)],
    explicit_exclusion_of_case_law_or_statutes: excluded,
    // Activation never bans primary law: only the user can.
    case_law_allowed_as_context: !excluded,
    statutes_allowed_as_context: !excluded,
  };
}

// ── 2. scholarship as centre of gravity ────────────────────────────────────

export type PackSourceKind =
  | "direct_scholarship"
  | "adjacent_scholarship"
  | "case_law"
  | "statute"
  | "other";

export interface CenterOfGravityView {
  ref: string;
  candidate_id?: string | null;
  title: string;
  kind: PackSourceKind;
  cited: boolean;
}

export interface CenterOfGravityReport {
  run_id: string;
  scholarship_sources_in_pack: number;
  direct_scholarship_sources_in_pack: number;
  adjacent_scholarship_sources_in_pack: number;
  case_law_sources_in_pack: number;
  statute_sources_in_pack: number;
  final_cited_scholarship_sources: number;
  final_cited_case_law_sources: number;
  final_cited_statute_sources: number;
  primary_law_crowded_out_scholarship: boolean;
  adjacent_source_used_as_direct: boolean;
  notes: string;
}

export function assessCenterOfGravity(
  run_id: string,
  views: CenterOfGravityView[],
): CenterOfGravityReport {
  const n = (k: PackSourceKind) => views.filter((v) => v.kind === k).length;
  const c = (k: PackSourceKind) => views.filter((v) => v.kind === k && v.cited).length;
  const direct = n("direct_scholarship");
  const adjacent = n("adjacent_scholarship");
  const citedDirect = c("direct_scholarship");
  const citedAdjacent = c("adjacent_scholarship");
  const citedCase = c("case_law");
  const citedStatute = c("statute");
  const citedPrimary = citedCase + citedStatute;
  const citedScholarship = citedDirect + citedAdjacent;

  const crowdedOut = citedPrimary > 0 && citedScholarship === 0 && direct + adjacent > 0;
  const adjacentAsDirect = citedAdjacent > 0 && citedDirect === 0 && direct > 0;

  const notes = crowdedOut
    ? "primary_law_cited_while_scholarship_available_in_pack"
    : direct === 0 && adjacent > 0
    ? "only_adjacent_scholarship_available"
    : direct === 0 && adjacent === 0
    ? "no_scholarship_reached_pack"
    : citedScholarship === 0
    ? "scholarship_in_pack_but_uncited"
    : "scholarship_central";

  return {
    run_id,
    scholarship_sources_in_pack: direct + adjacent,
    direct_scholarship_sources_in_pack: direct,
    adjacent_scholarship_sources_in_pack: adjacent,
    case_law_sources_in_pack: n("case_law"),
    statute_sources_in_pack: n("statute"),
    final_cited_scholarship_sources: citedScholarship,
    final_cited_case_law_sources: citedCase,
    final_cited_statute_sources: citedStatute,
    primary_law_crowded_out_scholarship: crowdedOut,
    adjacent_source_used_as_direct: adjacentAsDirect,
    notes,
  };
}

/**
 * At most one honest directive: keep scholarship central, mark adjacent
 * material as adjacent. Never a citation count, never a named-author demand.
 */
export function buildCenterOfGravityDirectives(input: {
  direct_scholarship_in_pack: number;
  adjacent_scholarship_in_pack: number;
  primary_in_pack: number;
}): string[] {
  const lines: string[] = [];
  if (input.direct_scholarship_in_pack === 0 && input.adjacent_scholarship_in_pack > 0) {
    lines.push(
      "מצב מקורות: לא אותרה ספרות אקדמית ישירה בנושא. המקורות הספרותיים שסופקו הם סמוכים בלבד — " +
        "יש לציין זאת במפורש בגוף התשובה, ולא להציגם כספרות ישירה על הסוגיה.",
    );
  }
  if (input.direct_scholarship_in_pack > 0 && input.primary_in_pack > 0) {
    lines.push(
      "בסקירת ספרות מרכז הכובד הוא הספרות האקדמית. חקיקה ופסיקה מותרות כרקע דוקטרינרי ולהקשר, " +
        "אך אין להעמידן במקום סקירת הספרות עצמה.",
    );
  }
  return lines;
}

// ── 3. unused direct pack sources (telemetry only) ─────────────────────────

export interface UnusedPackSourceRecord {
  run_id: string;
  source_id: string;
  title: string;
  author: string | null;
  topicality: number;
  in_pack: boolean;
  body_available: boolean;
  verifier_usable: boolean;
  model_emitted: boolean;
  cited: boolean;
  omission_reason_if_available: string | null;
}

export function buildUnusedLiteraturePackTelemetry(
  run_id: string,
  rows: Array<{
    source_id: string;
    title: string;
    author?: string | null;
    topicality: number;
    body_available: boolean;
    verifier_usable: boolean;
    model_emitted: boolean;
    cited: boolean;
    omission_reason?: string | null;
  }>,
): UnusedPackSourceRecord[] {
  return rows.map((r) => ({
    run_id,
    source_id: r.source_id,
    title: r.title,
    author: r.author ?? null,
    topicality: r.topicality,
    in_pack: true,
    body_available: r.body_available,
    verifier_usable: r.verifier_usable,
    model_emitted: r.model_emitted,
    cited: r.cited,
    omission_reason_if_available: r.cited
      ? null
      : r.omission_reason ??
        (r.model_emitted
          ? "emitted_by_model_but_not_rendered_as_footnote"
          : "silently_omitted_by_drafter"),
  }));
}
