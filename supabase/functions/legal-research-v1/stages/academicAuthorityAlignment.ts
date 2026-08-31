/**
 * academic_citation_authority_alignment_v1
 *
 * Aligns three things that drifted apart in academic_writing runs:
 *   1. the claim category an academic block actually asserts,
 *   2. the authority the run managed to acquire (usually doctrinal secondary),
 *   3. what claim-source-match will accept.
 *
 * Safety invariants this module never touches:
 *   - a doctrinal secondary source can never support a court holding,
 *     statutory text, an explicit docket outcome or binding-law wording;
 *   - `partial` verifier support may only carry cautious formulations;
 *   - rewrites are conservative: local, grammatical substitutions only, and
 *     otherwise the block is *reported*, not rewritten.
 */

import type { DrafterInputSource } from "./drafter.ts";
import {
  type ClaimSupportCategory,
  detectBindingLawLanguage,
  isAcademicClaimCategory,
} from "./claimSupportCategory.ts";

// ── 1. Categorical / binding-sounding wording ───────────────────────────────

/**
 * Broad, categorical or absolute formulations. With only `partial` verifier
 * support a doctrinal secondary may not carry these.
 */
const CATEGORICAL_LANGUAGE_RE =
  /(תמיד|בכל\s+מקרה|בכל\s+המקרים|לעולם\s+לא|אין\s+ספק|חד[- ]משמעי|באופן\s+מוחלט|כלל\s+ברור|מחייב\s+בהכרח|כל\s+בתי\s+המשפט|המסקנה\s+ברורה)/;

export function isCategoricalClaim(text: string): boolean {
  const t = String(text ?? "");
  return CATEGORICAL_LANGUAGE_RE.test(t) || detectBindingLawLanguage(t).binding;
}

// ── 2. Conservative primary-language guard ──────────────────────────────────

/** Local substitutions that are grammatical and preserve legal meaning. */
const SAFE_SUBSTITUTIONS: Array<{ from: RegExp; to: string }> = [
  { from: /ההלכה\s+היא\s+כי\s/g, to: "בספרות מקובל לראות כי " },
  { from: /ההלכה\s+היא\s+ש/g, to: "בספרות מקובל לראות ש" },
  { from: /הדין\s+הוא\s+כי\s/g, to: "הדיון הדוקטרינרי מציג כי " },
  { from: /החוק\s+קובע\s+כי\s/g, to: "המקורות המשניים מתארים כי " },
  { from: /התקנות\s+קובעות\s+כי\s/g, to: "המקורות המשניים מתארים כי " },
  { from: /בית\s+המשפט\s+קבע\s+כי\s/g, to: "הדיון הדוקטרינרי מציג כי " },
  { from: /הפסיקה\s+(?:קבעה|הכריעה)\s+כי\s/g, to: "הדיון הדוקטרינרי מציג כי " },
  { from: /נפסק\s+כי\s/g, to: "בספרות מתואר כי " },
];

export interface PrimaryLanguageBlockReport {
  block_index: number;
  matches: string[];
  action: "rewritten" | "reported_unsupported";
  rewritten_phrases?: string[];
}

/**
 * Conservative guard. Returns the (possibly) rewritten text plus what was
 * done. Never rewrites when the substitution is not one of the safe local
 * forms — in that case the block is reported as unsupported primary language.
 */
export function guardPrimaryLanguage(
  text: string,
  block_index: number,
): { text: string; report: PrimaryLanguageBlockReport | null } {
  const detected = detectBindingLawLanguage(text);
  if (!detected.binding) return { text, report: null };

  let out = text;
  const rewritten: string[] = [];
  for (const s of SAFE_SUBSTITUTIONS) {
    if (s.from.test(out)) {
      const before = out;
      out = out.replace(s.from, s.to);
      if (out !== before) rewritten.push(s.to.trim());
    }
  }

  const stillBinding = detectBindingLawLanguage(out).binding;
  if (rewritten.length > 0 && !stillBinding) {
    return {
      text: out,
      report: {
        block_index,
        matches: detected.matches,
        action: "rewritten",
        rewritten_phrases: rewritten,
      },
    };
  }
  // Not safely rewritable — report, do not mangle the prose.
  return {
    text,
    report: { block_index, matches: detected.matches, action: "reported_unsupported" },
  };
}

// ── 3. Subject-matter fit for academic doctrinal citations ──────────────────

const GENERIC_TERMS = new Set([
  "משפט", "משפטי", "משפטית", "המשפט", "בית", "בתי", "המשפטי", "דין", "הדין", "חוק",
  "החוק", "חוקי", "פסק", "פסיקה", "הפסיקה", "ישראל", "הישראלי", "סעיף", "כללי",
  "עבודה", "מאמר", "ספר", "מחקר", "סמינריון", "אקדמית", "אקדמי", "כתוב", "נסח",
  "פרק", "מבוא", "רקע", "תיאורטי", "טיוטה", "שאלת", "נושא", "הצגת", "פסקת", "טיעון",
]);

function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of String(text ?? "").split(/[^\u0590-\u05FFA-Za-z]+/)) {
    const w = raw.trim();
    if (w.length < 4) continue;
    if (GENERIC_TERMS.has(w)) continue;
    // strip common Hebrew prefixes for a crude stem
    const s = w.replace(/^(ו|ה|ב|ל|מ|כ|ש)(?=[\u0590-\u05FF]{3,})/, "");
    out.add(s.slice(0, 5));
  }
  return out;
}

export interface TopicalFitResult {
  fit: boolean;
  shared: string[];
  score: number;
}

/**
 * Subject-matter fit between the user's question (+ block text) and the
 * source. Deliberately crude but deterministic: it only rejects sources that
 * share *no* meaningful subject vocabulary with the question.
 */
export function academicTopicalFit(
  question: string,
  blockText: string,
  source: DrafterInputSource,
  minScore = 2,
): TopicalFitResult {
  const q = stems(`${question} ${blockText}`);
  const s = stems(`${source.title ?? ""} ${source.snippet ?? ""} ${(source.supported_points ?? []).join(" ")}`);
  const shared: string[] = [];
  for (const t of q) if (s.has(t)) shared.push(t);
  return { fit: shared.length >= minScore, shared: shared.slice(0, 8), score: shared.length };
}

// ── 4. Soft academic source roles ───────────────────────────────────────────

export const ACADEMIC_SOURCE_ROLES = [
  "primary_legal_anchor",
  "doctrinal_background_source",
  "theoretical_normative_source",
  "critique_or_counterposition_source",
  "implementation_or_example_source",
] as const;
export type AcademicSourceRole = typeof ACADEMIC_SOURCE_ROLES[number];

const THEORY_CUE = /(תאורי|תיאורי|תורת|פילוסופי|נורמטיב|עקרונות|צדק|מוסר|לגיטימי|רציונל)/;
const CRITIQUE_CUE = /(ביקורת|ביקורתי|הסתייגות|עמדה\s+מנוגדת|התנגדות|כשל|שגוי|מנוגד|דעת\s+מיעוט|בעייתי)/;
const EXAMPLE_CUE = /(יישום|יישומ|דוגמ|מקרה\s+מבחן|בפועל|הלכה\s+למעשה|נתונים|מחקר\s+אמפירי|סטטיסט)/;

function isPrimaryAnchor(s: DrafterInputSource): boolean {
  const c = String(s.citable_as ?? "");
  return (c === "judgment" || c === "statute" || c === "regulation") && s.body_acquired === true;
}

export function classifyAcademicSourceRoles(
  sources: DrafterInputSource[],
  eligibleRefs: Set<string>,
): { filled: AcademicSourceRole[]; missing: AcademicSourceRole[]; by_role: Record<string, string[]> } {
  const by_role: Record<string, string[]> = {};
  const add = (role: AcademicSourceRole, ref: string) => {
    (by_role[role] ??= []).push(ref);
  };
  for (const s of sources) {
    const hay = `${s.title ?? ""} ${s.snippet ?? ""}`;
    if (isPrimaryAnchor(s)) add("primary_legal_anchor", s.ref);
    const doctrinal = eligibleRefs.has(s.ref);
    if (doctrinal) {
      add("doctrinal_background_source", s.ref);
      if (THEORY_CUE.test(hay)) add("theoretical_normative_source", s.ref);
      if (CRITIQUE_CUE.test(hay)) add("critique_or_counterposition_source", s.ref);
      if (EXAMPLE_CUE.test(hay)) add("implementation_or_example_source", s.ref);
    }
  }
  const filled = ACADEMIC_SOURCE_ROLES.filter((r) => (by_role[r]?.length ?? 0) > 0);
  const missing = ACADEMIC_SOURCE_ROLES.filter((r) => !filled.includes(r));
  return { filled: [...filled], missing: [...missing], by_role };
}

// ── 5. Telemetry ────────────────────────────────────────────────────────────

export interface AcademicAuthorityAlignmentReport {
  applied: boolean;
  academic_claim_categories_used: Record<string, number>;
  primary_language_blocks: number;
  unsupported_primary_language_suppressed: number;
  doctrinal_secondary_refs_allowed: number;
  doctrinal_secondary_refs_rejected_for_primary_claims: number;
  commentary_only_claims_kept: string[];
  source_roles_expected: string[];
  source_roles_filled: string[];
  source_roles_missing: string[];
  /** pre/post funnel */
  source_refs_emitted: number;
  refs_kept_by_claim_source_match: number;
  refs_dropped_by_authority_category: number;
  rendered_footnotes: number;
  primary_language_details: PrimaryLanguageBlockReport[];
  off_topic_refs_dropped: number;
  partial_support_refs_dropped: number;
  /** academic_declared_category_remap_and_body_acquisition_v2 */
  declared_categories_remapped: number;
  declared_category_remaps: Array<{
    block_index: number;
    from: string;
    to: string;
    basis: string;
  }>;
  declared_categories_kept_primary: number;
}


export function emptyAcademicAuthorityAlignment(): AcademicAuthorityAlignmentReport {
  return {
    applied: false,
    academic_claim_categories_used: {},
    primary_language_blocks: 0,
    unsupported_primary_language_suppressed: 0,
    doctrinal_secondary_refs_allowed: 0,
    doctrinal_secondary_refs_rejected_for_primary_claims: 0,
    commentary_only_claims_kept: [],
    source_roles_expected: [...ACADEMIC_SOURCE_ROLES],
    source_roles_filled: [],
    source_roles_missing: [...ACADEMIC_SOURCE_ROLES],
    source_refs_emitted: 0,
    refs_kept_by_claim_source_match: 0,
    refs_dropped_by_authority_category: 0,
    rendered_footnotes: 0,
    primary_language_details: [],
    off_topic_refs_dropped: 0,
    partial_support_refs_dropped: 0,
  };
}

export { isAcademicClaimCategory };
export type { ClaimSupportCategory };
