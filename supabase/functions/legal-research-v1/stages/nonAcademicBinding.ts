// non_academic_source_binding_and_csm_v1
//
// Ordinary (non-academic) legal Q&A must stay direct and practical, but it
// must also stay grounded. This module holds the deterministic, side-effect
// free helpers that keep relevant citations alive on the non-academic path
// WITHOUT weakening any safety rule:
//
//   1. controlled public-law legal-area equivalence for CSM Rule D;
//   2. claim-category calibration (a generic doctrine paragraph is not a
//      court holding);
//   3. detection of a direct local statutory target in the question;
//   4. unrelated-compound-footnote detection;
//   5. consolidation of stacked caution notices into one accurate notice.
//
// Nothing here allows secondary material to carry statutory text, exact
// holdings, docket outcomes or canonical quotes — those paths still escalate
// to primary-only categories in `claimSupportCategory.ts`.

export const NON_ACADEMIC_BINDING_VERSION = "non_academic_source_binding_and_csm_v1";

// ── 1. legal-area equivalence ───────────────────────────────────────────────

/**
 * Areas that belong to the same public-law family. Adjacency alone never
 * unblocks a source — doctrine-term overlap is also required.
 */
export const PUBLIC_LAW_AREA_FAMILY = new Set([
  "public_law_hcj",
  "constitutional",
  "administrative_law",
  "judicial_review",
  "reasonableness",
  "proportionality",
]);

/** Shared public-law doctrine vocabulary (Hebrew + a few English aliases). */
const PUBLIC_LAW_DOCTRINE_TERMS: Array<[string, RegExp]> = [
  ["judicial_review", /(ביקורת\s+שיפוטית|התערבות\s+שיפוטית|judicial\s+review)/],
  ["reasonableness", /(סביר(ות|ה)?|אי[- ]?סבירות|reasonableness)/],
  ["proportionality", /(מידתיות|proportionalit)/],
  ["limitation_clause", /(פסקת\s+ההגבלה|תכלית\s+ראויה|לתכלית\s+ראויה)/],
  ["ultra_vires", /(חריגה\s+מסמכות|היעדר\s+סמכות|ultra\s+vires)/],
  ["extraneous_consideration", /(שיקול\s+זר|שיקולים\s+זרים)/],
  ["due_process", /(הליך\s+הוגן|זכות\s+הטיעון|כללי\s+הצדק\s+הטבעי)/],
  ["reasoning_duty", /(חובת\s+ההנמקה|הנמקה)/],
  ["discretion", /(שיקול\s+דעת)/],
  ["basic_rights", /(זכויות\s+יסוד|זכות\s+חוקתית|חוק[- ]יסוד|כבוד\s+האדם)/],
  ["administrative_authority", /(רשות\s+מינהלית|החלטה\s+מינהלית|המשפט\s+המינהלי)/],
  ["hcj", /(בג["״']?ץ|בית\s+המשפט\s+הגבוה\s+לצדק|עתיר)/],
];

export interface CsmLegalAreaEquivalenceRow {
  claim_id: string;
  block_area: string | null;
  source_area: string | null;
  doctrine_terms_overlap: string[];
  equivalence_applied: boolean;
  blocked: boolean;
  reason: string;
}

function doctrineTerms(text: string): Set<string> {
  const out = new Set<string>();
  const hay = (text ?? "").slice(0, 6000);
  for (const [id, re] of PUBLIC_LAW_DOCTRINE_TERMS) if (re.test(hay)) out.add(id);
  return out;
}

/**
 * Controlled adjacency: two different public-law area labels may match when
 * the block and the source actually share doctrine vocabulary. Any other area
 * pair (contracts vs. family, tax vs. companies, …) stays blocked.
 */
export function evaluateAreaEquivalence(input: {
  claim_id: string;
  block_area: string | null;
  source_area: string | null;
  block_text: string;
  source_text: string;
}): CsmLegalAreaEquivalenceRow {
  const { claim_id, block_area, source_area } = input;
  const base: CsmLegalAreaEquivalenceRow = {
    claim_id,
    block_area,
    source_area,
    doctrine_terms_overlap: [],
    equivalence_applied: false,
    blocked: true,
    reason: "no_equivalence",
  };
  if (!block_area || !source_area || block_area === source_area) {
    return { ...base, blocked: false, reason: "same_area" };
  }
  if (!PUBLIC_LAW_AREA_FAMILY.has(block_area) || !PUBLIC_LAW_AREA_FAMILY.has(source_area)) {
    return { ...base, reason: "areas_not_adjacent" };
  }
  const a = doctrineTerms(input.block_text);
  const b = doctrineTerms(input.source_text);
  const overlap = [...a].filter((t) => b.has(t));
  if (overlap.length === 0) {
    return { ...base, reason: "adjacent_without_doctrine_overlap" };
  }
  return {
    ...base,
    doctrine_terms_overlap: overlap,
    equivalence_applied: true,
    blocked: false,
    reason: "public_law_adjacency_with_doctrine_overlap",
  };
}

// ── 2. claim-category calibration ───────────────────────────────────────────

/** Language that actually asserts a concrete judicial holding. */
const HOLDING_ASSERTION_RE =
  /(נפסק\s+כי|בית\s+המשפט\s+(העליון\s+)?(קבע|פסק|הכריע|קיבל|דחה)|נקבעה\s+הלכה|ההלכה\s+שנקבעה|בהלכת|בפרשת|בעניין\s+[א-ת]+\s+נ['׳]|בפסק\s+הדין)/;
const DOCKET_RE =
  /(בג["״']?ץ|ע["״']?א|ע["״']?פ|רע["״']?א|דנ["״']?א|בש["״']?פ|עע["״']?מ|בר["״']?ם|עה["״']?ס)\s*\d+\/\d+/;
/** Language that actually quotes or paraphrases statutory text. */
const STATUTORY_TEXT_RE =
  /(סעיף\s+\d|לשון\s+החוק|החוק\s+קובע|נקבע\s+בחוק|תקנה\s+\d|חוק[- ]יסוד)/;

export type NonAcademicCalibratedCategory =
  | "court_holding"
  | "statutory"
  | "doctrinal_synthesis"
  | "scholarly_commentary"
  | "contextual_background";

export interface NonAcademicClaimCategoryRow {
  block_id: string;
  old_category: string;
  new_category: string;
  reason: string;
  acceptable_source_classes: string[];
}

const ACCEPTABLE_CLASSES: Record<string, string[]> = {
  court_holding: ["judgment"],
  statutory: ["statute", "regulation"],
  doctrinal_synthesis: ["judgment", "statute", "acquired_doctrinal_secondary"],
  scholarly_commentary: ["acquired_doctrinal_secondary", "judgment", "statute"],
  contextual_background: ["any"],
};

/**
 * A generic doctrine explanation should not demand exact case-holding support.
 * The category is only relaxed when the block neither names a judgment nor
 * asserts a holding; blocks that do keep the strict primary requirement.
 */
export function calibrateNonAcademicCategory(input: {
  block_id: string;
  category: string;
  basis: string;
  text: string;
}): { category: string; row: NonAcademicClaimCategoryRow | null } {
  const { block_id, category, basis, text } = input;
  const escalated = basis.includes("docket_identity_escalation") ||
    basis.includes("binding_language_escalation");
  if (escalated) return { category, row: null };

  if (category === "court_holding") {
    if (DOCKET_RE.test(text) || HOLDING_ASSERTION_RE.test(text)) {
      return { category, row: null };
    }
    return {
      category: "doctrinal_synthesis",
      row: {
        block_id,
        old_category: category,
        new_category: "doctrinal_synthesis",
        reason: "generic_doctrine_paragraph_without_holding_assertion",
        acceptable_source_classes: ACCEPTABLE_CLASSES.doctrinal_synthesis,
      },
    };
  }

  if (category === "statutory" && !STATUTORY_TEXT_RE.test(text)) {
    return {
      category: "doctrinal_synthesis",
      row: {
        block_id,
        old_category: category,
        new_category: "doctrinal_synthesis",
        reason: "practical_explanation_without_statutory_text",
        acceptable_source_classes: ACCEPTABLE_CLASSES.doctrinal_synthesis,
      },
    };
  }

  return { category, row: null };
}

// ── 3. direct local statutory target detection ──────────────────────────────

export interface StatutoryTargetDetection {
  detected: boolean;
  statute_title: string | null;
  statute_section: string | null;
  matched_pattern: string | null;
}

const BASIC_LAW_RE = /חוק[-\s]?יסוד\s*:?\s*([\u0590-\u05FF"'״׳\s]{3,60})/;
const NAMED_LAW_RE =
  /(?:^|[\s"'(])[לבמוהשכ]?חוק\s+((?:ה[\u0590-\u05FF]+|[\u0590-\u05FF]+)(?:\s+[\u0590-\u05FF"'״׳]+){0,5})/;
const SECTION_RE = /סעיף\s+([\dא-ת]+(?:\([^)]{1,6}\))?)/;

function tidy(raw: string): string {
  return raw
    .replace(/[?.,;!]+.*$/s, "")
    .replace(/\s+(לגבי|בעניין|בנוגע|על|מה|האם)\b.*$/s, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Deterministic: does this question ask directly about a statute/Basic Law? */
export function detectStatutoryTarget(question: string): StatutoryTargetDetection {
  const q = String(question ?? "");
  const none: StatutoryTargetDetection = {
    detected: false,
    statute_title: null,
    statute_section: null,
    matched_pattern: null,
  };
  if (!q) return none;
  const section = SECTION_RE.exec(q)?.[1] ?? null;

  const basic = BASIC_LAW_RE.exec(q);
  if (basic) {
    const name = tidy(basic[1]);
    if (name.length >= 3) {
      return {
        detected: true,
        statute_title: `חוק-יסוד: ${name}`,
        statute_section: section,
        matched_pattern: "basic_law",
      };
    }
  }
  const named = NAMED_LAW_RE.exec(q);
  if (named) {
    const name = tidy(named[1]);
    if (name.length >= 3) {
      return {
        detected: true,
        statute_title: `חוק ${name}`,
        statute_section: section,
        matched_pattern: "named_statute",
      };
    }
  }
  return none;
}

export interface NonAcademicPrimaryAnchorBinding {
  question_id: string;
  detected_statutory_target: string | null;
  local_primary_anchor_attempted: boolean;
  local_primary_anchor_found: boolean;
  bound_to_blocks: number;
  block_ids: string[];
  failure_reason: string | null;
  synthetic_nomination_injected: boolean;
}

// ── 4. unrelated compound footnotes ─────────────────────────────────────────

const TITLE_STOP = new Set([
  "של", "על", "את", "עם", "בין", "לפי", "מן", "אל", "כי", "the", "and", "of", "in", "a",
  "משפט", "משפטי", "משפטית", "דין", "עיוני", "כרך", "בחינה", "מחדש",
]);

function titleTokens(title: string): Set<string> {
  return new Set(
    String(title ?? "")
      .replace(/["'`׳״]/g, "")
      .split(/[^\p{L}\p{N}]+/u)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !TITLE_STOP.has(t.toLowerCase())),
  );
}

/**
 * Two sources may only share one footnote marker when their titles show
 * subject overlap. Unrelated companions are pruned, never concatenated.
 */
export function unrelatedCompoundCompanions<T extends { title?: string | null }>(
  distinct: T[],
): T[] {
  if (distinct.length < 2) return [];
  const lead = titleTokens(distinct[0].title ?? "");
  const removed: T[] = [];
  for (const s of distinct.slice(1)) {
    const t = titleTokens(s.title ?? "");
    let shared = 0;
    for (const tok of t) if (lead.has(tok)) shared++;
    if (shared === 0) removed.push(s);
  }
  return removed;
}

// ── 5. limitation-note consolidation ────────────────────────────────────────

export interface NonAcademicLimitationNote {
  question_id: string;
  notes_before: number;
  notes_after: number;
  limitation_type: string;
  accurate: boolean;
  reduced: boolean;
}

const NOTE_HEADINGS = [
  "**מגבלת ביסוס:**",
  "**מגבלת סמכות:**",
  "**היקף התשובה:**",
];
const SCOPE_NOTE_RE = /\n*הערה על היקף המקורות:[^\n]*/g;

/**
 * Merge stacked caution notices into a single accurate limitation. When the
 * answer does rest on primary sources, the "no direct case law" sentence is
 * dropped instead of being stacked on top of a generic notice.
 */
export function consolidateLimitationNotes(input: {
  question_id: string;
  parts: string[];
  primary_cited: boolean;
  no_direct_caselaw: boolean;
}): { text: string; report: NonAcademicLimitationNote } {
  const raw = input.parts.map((p) => (p ?? "").trim()).filter(Boolean);
  const notes_before = raw.length +
    raw.reduce((n, p) => n + (p.match(SCOPE_NOTE_RE)?.length ?? 0), 0);

  const bodies: string[] = [];
  for (const part of raw) {
    let p = part.replace(SCOPE_NOTE_RE, "").trim();
    for (const h of NOTE_HEADINGS) p = p.split(h).join("").trim();
    if (p) bodies.push(p);
  }
  // De-duplicate sentences across the merged notices.
  const seen = new Set<string>();
  const sentences: string[] = [];
  for (const b of bodies) {
    for (const s of b.split(/(?<=[.!?])\s+/)) {
      const key = s.replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      sentences.push(key);
    }
  }
  if (input.no_direct_caselaw && !input.primary_cited) {
    const s = "לא אותר פסק דין העוסק ישירות בסוגיה, ולכן ההסבר נשען על החקיקה והספרות שאותרו.";
    if (!seen.has(s)) sentences.push(s);
  }

  const limitation_type = sentences.length === 0
    ? "none"
    : input.primary_cited
    ? "partial_support"
    : input.no_direct_caselaw
    ? "no_direct_caselaw"
    : "unsourced_claims";

  const text = sentences.length === 0
    ? ""
    : `\n\n**מגבלת ביסוס:** ${sentences.join(" ")}`;

  return {
    text,
    report: {
      question_id: input.question_id,
      notes_before,
      notes_after: text ? 1 : 0,
      limitation_type,
      accurate: true,
      reduced: (text ? 1 : 0) < notes_before,
    },
  };
}

// ── 6. local judgment pack flow / runtime telemetry shapes ──────────────────

export interface NonAcademicLocalJudgmentPackFlow {
  question_id: string;
  protected_local_judgments: number;
  eligible_local_judgments: number;
  admitted_to_synthesis_pack: number;
  rejected_count: number;
  rejection_reasons: Record<string, number>;
  final_judgment_count: number;
}

export interface NonAcademicRuntimeBreakdown {
  question_id: string;
  total_ms: number;
  stage_ms: Record<string, number>;
  failure_stage: string | null;
  reaped: boolean;
  refund_triggered: boolean;
  recommended_fix: string | null;
}
