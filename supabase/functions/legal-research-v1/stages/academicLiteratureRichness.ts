/**
 * academic_literature_richness_without_fixed_source_count_v1
 *
 * Literature-review runs were producing one- or two-source answers while the
 * retrieval had found hundreds of candidates, and the body budget was being
 * spent on off-topic papers that happened to sit on an easy host. This module
 * adds four deterministic, count-free decisions:
 *
 *   1. `scoreLiteratureTopicality` — shared subject vocabulary between the
 *      user's question and a candidate (title / snippet / url).
 *   2. `decideBodyBudget` — should this candidate consume literature body
 *      budget at all, and in what order.
 *   3. `selectLiteraturePack` — dynamic pack selection by role coverage and
 *      topicality; never a fixed size, never padding.
 *   4. `assessResearchRichness` — a sufficiency classification consumed as
 *      telemetry plus (at most) one honest limitation directive.
 *
 * Hard scope: no retrieval increase, no new model call, no minimum source
 * count, no citation target. Every function here is pure except for the
 * telemetry sink passed in by the caller.
 */

export type RichnessDecision =
  | "rich_enough"
  | "thin_but_honest"
  | "thin_due_to_pipeline_loss"
  | "unsafe_or_off_topic";

import { termForms, termKey, tokenize } from "./hebrewTopicTerms.ts";

const GENERIC_STEM_SOURCE = [
  "משפט", "משפטי", "משפטית", "המשפט", "המשפטי", "המשפטית", "בית", "בתי", "דין",
  "הדין", "חוק", "החוק", "חוקי", "פסק", "פסיקה", "הפסיקה", "ישראל", "הישראלי",
  "הישראלית", "סעיף", "כללי", "עבודה", "מאמר", "ספרות", "הספרות", "ספר", "מחקר",
  "סמינריון", "אקדמית", "אקדמי", "כתוב", "נסח", "פרק", "מבוא", "רקע", "תיאורטי",
  "טיוטה", "שאלת", "נושא", "הצגת", "פסקת", "טיעון", "מקורות", "מקור", "הערות",
  "שוליים", "בלבד", "התמקד", "כתיבה", "סקירה", "סקירת", "עברית",
  // fix_topicality_and_role_labelling_v1 — request verbs / connectives carry no
  // subject meaning and must not count as matched topic vocabulary.
  "תעשה", "תכתוב", "תעזור", "תסביר", "לכתוב", "לעשות", "לבנות", "בבקשה", "אנא",
  "לגבי", "בנוגע", "אודות", "היחס", "עבור", "כולל", "אפשר", "צריך",
];

/** Generic vocabulary, expanded morphologically so inflections are covered. */
const GENERIC_FORMS = new Set(GENERIC_STEM_SOURCE.flatMap((w) => termForms(w)));

export interface SubjectTerm {
  word: string;
  key: string;
  forms: string[];
}

/** Distinct subject terms of a text, morphologically normalized. */
export function subjectTerms(text: string): SubjectTerm[] {
  const seen = new Set<string>();
  const out: SubjectTerm[] = [];
  for (const w of tokenize(text)) {
    const forms = termForms(w);
    if (forms.length === 0) continue;
    if (forms.some((f) => GENERIC_FORMS.has(f))) continue;
    // Dedupe morphological variants of the same term within one text.
    if (forms.some((f) => seen.has(f))) continue;
    for (const f of forms) seen.add(f);
    out.push({ word: w, key: termKey(w), forms });
  }
  return out;
}

/**
 * Back-compat haystack: every normalized form of every non-generic word.
 * Membership tests against this set are morphology-tolerant.
 */
export function subjectStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of subjectTerms(text)) for (const f of t.forms) out.add(f);
  return out;
}

/** Question terms that carry the actual doctrine/topic (longest first). */
export function coreTopicTerms(question: string): string[] {
  return subjectTerms(question)
    .slice()
    .sort((a, b) => b.word.length - a.word.length)
    .slice(0, 3)
    .map((t) => t.key);
}

/** Question terms present in `text`, returned as canonical keys. */
export function sharedSubjectTerms(question: string, text: string): string[] {
  const hay = subjectStems(text);
  const shared: string[] = [];
  for (const t of subjectTerms(question)) {
    if (t.forms.some((f) => hay.has(f))) shared.push(t.key);
  }
  return shared;
}

/**
 * fix_topicality_and_role_labelling_v1 — dynamic direct threshold.
 *
 * A fixed "4 matching stems" makes direct classification mathematically
 * impossible for a short natural prompt that only contains 2–3 meaningful
 * legal terms. The requirement now scales with the question's own vocabulary
 * and never drops below 2 matched terms.
 */
export function requiredDirectMatches(
  questionTermCount: number,
  mode: "metadata" | "body" = "metadata",
): number {
  const n = Math.max(1, questionTermCount);
  if (n <= 2) return Math.min(n, 2);
  const ratio = mode === "body" ? 0.6 : 0.5;
  const cap = mode === "body" ? 4 : 3;
  return Math.min(cap, Math.max(2, Math.ceil(n * ratio)));
}

export interface TopicalityResult {
  /** 0..1 — share of question vocabulary present in the source. */
  score: number;
  /** Raw count of shared stems. */
  shared_count: number;
  shared: string[];
  direct: boolean;
  /** fix_topicality_and_role_labelling_v1 telemetry. */
  question_term_count: number;
  required_matches: number;
  match_ratio: number;
  core_topic_match: boolean;
}

/**
 * Topical fit of one candidate against the question. `direct` means the source
 * carries enough of the question's own subject vocabulary to be treated as
 * direct topical scholarship rather than adjacent material.
 */
export function scoreLiteratureTopicality(
  question: string,
  source: { title?: string | null; snippet?: string | null; url?: string | null },
): TopicalityResult {
  let url = String(source.url ?? "");
  try {
    url = decodeURIComponent(url);
  } catch { /* malformed escapes stay as-is */ }
  const qTerms = subjectTerms(question);
  const shared = sharedSubjectTerms(
    question,
    `${source.title ?? ""} ${source.snippet ?? ""} ${url}`,
  );
  const core = new Set(coreTopicTerms(question));
  const core_topic_match = shared.some((s) => core.has(s));
  const denom = Math.max(6, Math.min(qTerms.length, 24));
  const score = Number(Math.min(1, shared.length / denom).toFixed(2));
  const required = requiredDirectMatches(qTerms.length, "metadata");
  const match_ratio = qTerms.length > 0
    ? Number((shared.length / qTerms.length).toFixed(2))
    : 0;
  return {
    score,
    shared_count: shared.length,
    shared: shared.slice(0, 8),
    direct: shared.length >= required && core_topic_match,
    question_term_count: qTerms.length,
    required_matches: required,
    match_ratio,
    core_topic_match,
  };
}


/**
 * A literature-only request: the user asked for a scholarship review and
 * explicitly excluded case law / statutes as substitutes.
 */
export function isLiteratureOnlyRequest(question: string): boolean {
  const q = String(question ?? "");
  const wantsReview = /(סקירת\s+ספרות|סקירה\s+של\s+הספרות|literature\s+review)/.test(q);
  const literatureOnly =
    /(ספרות\s+(?:ה?משפטית\s+)?בלבד|רק\s+ספרות|לספרות\s+משפטית\s+בלבד|אל\s+תכתוב\s+סקירה\s+של\s+פסיקה)/
      .test(q);
  return wantsReview || literatureOnly;
}

// ── 2. body-budget decision ────────────────────────────────────────────────

export interface BodyBudgetInput {
  candidate_id: string;
  title: string;
  url: string | null;
  host: string | null;
  role: string | null;
  source_type: string | null;
  snippet?: string | null;
  /** Already has a substantive body. */
  has_body: boolean;
}

export interface BodyBudgetDecision {
  candidate_id: string;
  title: string;
  host: string | null;
  topicality_score: number;
  role: string | null;
  body_budget_selected: boolean;
  body_budget_rejected: boolean;
  reason: string;
  /** Higher = fetched earlier. */
  priority: number;
}

const SCHOLARSHIP_TYPES = new Set([
  "journal_article", "legal_article", "article", "academic", "scholarship",
  "book", "book_chapter", "book_or_chapter", "chapter", "commentary",
  "doctrinal_commentary", "report", "government_report", "institutional_report",
]);

/**
 * Should this candidate consume literature body budget? Trusted host alone is
 * never enough: an off-topic paper from a law faculty loses to a direct
 * topical article that has not been fetched yet.
 */
export function decideBodyBudget(
  question: string,
  input: BodyBudgetInput,
  opts?: { literature_mode?: boolean; min_score?: number },
): BodyBudgetDecision {
  const t = scoreLiteratureTopicality(question, {
    title: input.title,
    snippet: input.snippet,
    url: input.url,
  });
  const minScore = opts?.min_score ?? 0.08;
  const scholarly = SCHOLARSHIP_TYPES.has(String(input.source_type ?? "").toLowerCase()) ||
    input.role === "scholarship";
  const base = {
    candidate_id: input.candidate_id,
    title: input.title,
    host: input.host,
    topicality_score: t.score,
    role: input.role,
  };
  if (input.has_body) {
    return {
      ...base,
      body_budget_selected: false,
      body_budget_rejected: false,
      reason: "body_already_acquired",
      priority: 0,
    };
  }
  if (opts?.literature_mode && t.shared_count === 0) {
    return {
      ...base,
      body_budget_selected: false,
      body_budget_rejected: true,
      reason: "off_topic_no_shared_subject_vocabulary",
      priority: 0,
    };
  }
  if (opts?.literature_mode && t.score < minScore && !t.direct) {
    return {
      ...base,
      body_budget_selected: false,
      body_budget_rejected: true,
      reason: "topicality_below_literature_threshold",
      priority: 0,
    };
  }
  const priority = t.score * 100 + (t.direct ? 40 : 0) + (scholarly ? 20 : 0);
  return {
    ...base,
    body_budget_selected: true,
    body_budget_rejected: false,
    reason: t.direct
      ? "direct_topical_scholarship"
      : scholarly
      ? "topical_scholarship_candidate"
      : "topical_candidate",
    priority: Number(priority.toFixed(2)),
  };
}

// ── 3. dynamic pack selection ──────────────────────────────────────────────

export interface PackCandidateView {
  ref: string;
  candidate_id?: string;
  title: string;
  url?: string | null;
  snippet?: string | null;
  role?: string | null;
  source_type?: string | null;
  citable_as?: string | null;
  body_available: boolean;
  /** Primary authority (statute / judgment) — never dropped by this module. */
  primary: boolean;
}

export interface PackSelectionDecision {
  candidate_id: string | null;
  ref: string;
  title: string;
  role: string;
  topicality_score: number;
  source_quality: "direct_scholarship" | "adjacent_scholarship" | "primary" | "other";
  body_available: boolean;
  selected_for_pack: boolean;
  rejected_from_pack: boolean;
  reason: string;
}

/**
 * Pack membership by relevance and role coverage — not by count. A narrow
 * question with one strong direct source keeps exactly that source; an
 * off-topic source is never added to reach a number.
 */
export function selectLiteraturePack(
  question: string,
  candidates: PackCandidateView[],
  opts?: { literature_mode?: boolean },
): { kept: PackCandidateView[]; decisions: PackSelectionDecision[] } {
  const decisions: PackSelectionDecision[] = [];
  const kept: PackCandidateView[] = [];
  const scored = candidates.map((c) => ({
    c,
    t: scoreLiteratureTopicality(question, c),
  }));
  const anyDirect = scored.some((x) => !x.c.primary && x.t.direct);

  for (const { c, t } of scored) {
    const role = String(c.role ?? c.source_type ?? "unknown");
    const quality: PackSelectionDecision["source_quality"] = c.primary
      ? "primary"
      : t.direct
      ? "direct_scholarship"
      : t.shared_count > 0
      ? "adjacent_scholarship"
      : "other";
    const push = (selected: boolean, reason: string) => {
      decisions.push({
        candidate_id: c.candidate_id ?? null,
        ref: c.ref,
        title: c.title,
        role,
        topicality_score: t.score,
        source_quality: quality,
        body_available: c.body_available,
        selected_for_pack: selected,
        rejected_from_pack: !selected,
        reason,
      });
      if (selected) kept.push(c);
    };

    if (c.primary) {
      // Primary authority membership is decided by the existing primary-law
      // gates, never here. In a literature-only request it is kept but the
      // drafter is separately forbidden from using it as literature.
      push(true, "primary_authority_not_governed_by_literature_pack");
      continue;
    }
    if (t.shared_count === 0) {
      push(false, "off_topic_no_shared_subject_vocabulary");
      continue;
    }
    if (opts?.literature_mode && anyDirect && !t.direct) {
      push(false, "adjacent_only_while_direct_scholarship_available");
      continue;
    }
    push(true, t.direct ? "direct_topical_scholarship" : "topical_source_kept");
  }
  return { kept, decisions };
}

// ── 4. research-richness sufficiency ───────────────────────────────────────

export interface RichnessInput {
  run_id: string;
  task_type: string;
  literature_mode: boolean;
  /** Candidates whose title/snippet are directly topical scholarship. */
  direct_literature_found: number;
  direct_literature_body_acquired: number;
  /** Strong direct candidates found but never fetched / never admitted. */
  strong_unused_literature_count: number;
  /** Distinct academic roles represented in the pack. */
  role_coverage: string[];
  pack_sources_count: number;
  off_topic_in_pack: number;
}

export interface RichnessAssessment extends RichnessInput {
  final_decision: RichnessDecision;
  reason: string;
  limitation_required: boolean;
  /** Hebrew directive appended to the drafter message when limited. */
  limitation_directive: string | null;
}

export function assessResearchRichness(input: RichnessInput): RichnessAssessment {
  const {
    pack_sources_count: pack,
    direct_literature_found: found,
    strong_unused_literature_count: unused,
    off_topic_in_pack: offTopic,
    role_coverage,
  } = input;

  let decision: RichnessDecision;
  let reason: string;

  if (offTopic > 0 && pack - offTopic <= 1) {
    decision = "unsafe_or_off_topic";
    reason = "off_topic_sources_dominate_pack";
  } else if (pack >= 3 && role_coverage.length >= 2) {
    decision = "rich_enough";
    reason = "multiple_direct_sources_with_role_coverage";
  } else if (pack >= 2 && role_coverage.length >= 2 && unused === 0) {
    decision = "rich_enough";
    reason = "distinct_positions_represented_without_pipeline_loss";
  } else if (unused >= 2 || (pack <= 2 && found >= pack + 2)) {
    decision = "thin_due_to_pipeline_loss";
    reason = `strong_direct_literature_found_but_unused:${unused}`;
  } else {
    decision = "thin_but_honest";
    reason = pack === 0 ? "no_usable_literature_in_pack" : "sparse_field_or_sparse_retrieval";
  }

  const limitation_required = decision !== "rich_enough";
  const limitation_directive = limitation_required
    ? (pack <= 1
      ? "היקף המקורות שאותרו מצומצם: נסח סקירה מוגבלת המבוססת על המקור שאותר בלבד, אמור זאת במפורש במשפט אחד, ואל תציג את הדברים כאילו הם משקפים את מכלול הספרות. אין להשלים את החסר בפסיקה, בחקיקה או בפרוזה כללית."
      : "היקף הספרות שאותרה מצומצם: הצג את הסקירה כמוגבלת למקורות שאותרו, ציין זאת במפורש במשפט אחד, ואל תייחס לספרות עמדות שאין להן מקור מצוטט.")
    : null;

  return {
    ...input,
    final_decision: decision,
    reason,
    limitation_required,
    limitation_directive,
  };
}

/**
 * Literature-review drafting directives: named synthesis instead of anonymous
 * "הספרות טוענת" prose. No citation target and no source minimum.
 */
export function literatureSynthesisDirectives(namedSources: string[]): string[] {
  const lines = [
    'סקירת ספרות: אין לכתוב "הספרות טוענת", "מקובל בספרות" או ניסוח אנונימי דומה אלא אם באותו משפט מצוטט מקור ספציפי שתומך בטענה.',
    "העדף ייחוס בשם: 'X מציע…', 'Y מבקר…', 'הכתיבה המוסדית של המכון מדגישה…'. כל עמדה שמוצגת כחלק מהדיון חייבת להיות מיוחסת למקור שסופק לך.",
    "הבחן במפורש בין תיאור דוקטרינרי, ביקורת נורמטיבית, טיעון מוסדי/מדיניות ופרספקטיבה השוואתית — אל תערבב ביניהם באותה פסקה.",
    "אין למחזר את אותה הערת שוליים על פני פסקאות שאינן קשורות, ואין לעקם את הטקסט כדי להתאים אותו למקור שאינו עוסק בנושא.",
  ];
  if (namedSources.length > 0) {
    lines.push(
      `המקורות שניתן לייחס אליהם עמדות בשמם: ${namedSources.slice(0, 8).join("; ")}.`,
    );
  }
  return lines;
}
