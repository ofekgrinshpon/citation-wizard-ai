/**
 * substance_based_doctrinal_sufficiency_v1 — substance-based claim support
 * categories.
 *
 * The rule this stage encodes: *the substance of a legal claim determines the
 * source support it requires.* Classification is NOT lexical — no fixed
 * Hebrew phrase list is consulted. A block is classified from:
 *
 *   1. the drafter's own substance tag (`claim_category`), when present;
 *   2. otherwise its `proposition_type` (also a substance tag);
 *   3. structural identity signals in the block (does it name a concrete
 *      judgment by docket?), used only to *raise* the required support level.
 *
 * The five categories and their required support:
 *
 *   court_holding          → acquired, identity-validated judgment body
 *   statutory              → acquired official statute/regulation text
 *   doctrinal_synthesis    → primary law OR eligible doctrinal secondary
 *   scholarly_commentary   → eligible doctrinal secondary (full text)
 *   contextual_background  → any acquired, validated source; background only
 *
 * The stage only *removes* support that cannot carry the claim and reports
 * authority-overstatement events. It never adds citations, never loosens
 * judgment identity, docket validation or primary-law integrity, and never
 * makes a secondary source able to carry a binding court holding.
 */

import type { DrafterInputSource } from "./drafter.ts";
import { assessDoctrinalEligibility, isDoctrinalType } from "./doctrinalSourceTyping.ts";

export type ClaimSupportCategory =
  | "court_holding"
  | "statutory"
  | "doctrinal_synthesis"
  | "scholarly_commentary"
  | "contextual_background"
  // academic_citation_authority_alignment_v1 — academic-writing categories.
  | "doctrinal_background"
  | "academic_framing"
  | "theoretical_explanation"
  | "literature_synthesis"
  | "critique_or_counterposition"
  | "methodological_framing";

/** academic_citation_authority_alignment_v1 — academic-writing categories. */
export const ACADEMIC_CLAIM_CATEGORIES: ClaimSupportCategory[] = [
  "doctrinal_background",
  "academic_framing",
  "theoretical_explanation",
  "literature_synthesis",
  "critique_or_counterposition",
  "methodological_framing",
];

export function isAcademicClaimCategory(v: unknown): v is ClaimSupportCategory {
  return typeof v === "string" && (ACADEMIC_CLAIM_CATEGORIES as string[]).includes(v);
}

export const CLAIM_SUPPORT_CATEGORIES: ClaimSupportCategory[] = [
  "court_holding",
  "statutory",
  "doctrinal_synthesis",
  "scholarly_commentary",
  "contextual_background",
  ...ACADEMIC_CLAIM_CATEGORIES,
];

export function isClaimSupportCategory(v: unknown): v is ClaimSupportCategory {
  return typeof v === "string" && (CLAIM_SUPPORT_CATEGORIES as string[]).includes(v);
}

/**
 * Structural identity signal: the block names a concrete judicial decision by
 * docket number. This is an identifier pattern, not a phrase list.
 */
const DOCKET_IDENTITY_RE = /\b\d{1,5}\/\d{2}\b/;

/**
 * academic_citation_authority_alignment_v1 — binding-law wording.
 * A block phrased as a statement of binding law requires primary authority
 * whatever mode produced it. Two families, so the escalation can pick the
 * right primary category.
 */
export const BINDING_CASELAW_LANGUAGE_RE =
  /(בית\s+המשפט\s+(קבע|פסק|הכריע|קבעה)|בג["״']?ץ\s+קבע|ההלכה\s+היא|נפסק\s+כי|הפסיקה\s+(קבעה|הכריעה)|הלכה\s+פסוקה\s+היא|נקבעה\s+ההלכה)/;
export const BINDING_STATUTORY_LANGUAGE_RE =
  /(החוק\s+קובע|הדין\s+הוא|החוק\s+מחייב|סעיף\s+[\d״"'א-ת().\/]+\s+(קובע|מחייב|מורה)|התקנות\s+קובעות|הוראת\s+החוק\s+קובעת)/;

export function detectBindingLawLanguage(
  text: string,
): { binding: boolean; kind: "caselaw" | "statutory" | null; matches: string[] } {
  const t = String(text ?? "");
  const matches: string[] = [];
  const c = t.match(BINDING_CASELAW_LANGUAGE_RE);
  const s = t.match(BINDING_STATUTORY_LANGUAGE_RE);
  if (c) matches.push(c[0]);
  if (s) matches.push(s[0]);
  if (!matches.length) return { binding: false, kind: null, matches };
  return { binding: true, kind: c ? "caselaw" : "statutory", matches };
}


export interface SourceSupportProfile {
  ref: string;
  /** Acquired, identity-validated judgment body. */
  judgment_authority: boolean;
  /** Acquired official statute/regulation text. */
  statutory_authority: boolean;
  /** Eligible doctrinal/secondary source (see doctrinalSourceTyping). */
  doctrinal_authority: boolean;
  /** Acquired + validated, but only usable as framing/background. */
  background_only: boolean;
  eligibility_reason: string;
}

export function profileSource(s: DrafterInputSource): SourceSupportProfile {
  const citable = String(s.citable_as ?? "");
  const usable = !["metadata_only", "listing_page"].includes(String(s.text_usability ?? "unknown"));
  const doctrinal = assessDoctrinalEligibility(s);

  const judgment_authority = citable === "judgment" &&
    s.is_judgment_document === true &&
    s.body_acquired === true &&
    usable;

  const statutory_authority = (citable === "statute" || citable === "regulation") &&
    s.body_acquired === true &&
    usable;

  const doctrinal_authority = doctrinal.eligible;

  return {
    ref: s.ref,
    judgment_authority,
    statutory_authority,
    doctrinal_authority,
    background_only: !judgment_authority && !statutory_authority && !doctrinal_authority &&
      usable && citable !== "not_citable",
    eligibility_reason: doctrinal.reason,
  };
}

/** Support levels a category will accept, in preference order. */
export function categoryAccepts(
  category: ClaimSupportCategory,
  p: SourceSupportProfile,
): boolean {
  switch (category) {
    case "court_holding":
      return p.judgment_authority;
    case "statutory":
      return p.statutory_authority || p.judgment_authority;
    case "doctrinal_synthesis":
      return p.judgment_authority || p.statutory_authority || p.doctrinal_authority;
    case "scholarly_commentary":
      return p.doctrinal_authority || p.judgment_authority || p.statutory_authority;
    case "contextual_background":
      return p.judgment_authority || p.statutory_authority || p.doctrinal_authority ||
        p.background_only;
    // academic_citation_authority_alignment_v1 — academic categories accept an
    // acquired, eligible doctrinal secondary as well as primary authority.
    // They never accept metadata-only/background-only material.
    case "doctrinal_background":
    case "academic_framing":
    case "theoretical_explanation":
    case "literature_synthesis":
    case "critique_or_counterposition":
    case "methodological_framing":
      return p.judgment_authority || p.statutory_authority || p.doctrinal_authority;
  }
}

/**
 * Derive the effective substance category of a block.
 * `declared` is the drafter's own tag; `propositionType` is the pre-existing
 * substance tag; `text` contributes the structural docket signal and (for
 * academic runs) the binding-law wording signal.
 */
export function deriveClaimCategory(input: {
  declared?: string | null;
  propositionType?: string | null;
  text?: string;
  /** academic_citation_authority_alignment_v1 */
  academicMode?: boolean;
}): { category: ClaimSupportCategory; basis: string } {
  const declared = isClaimSupportCategory(input.declared) ? input.declared : null;
  const academic = input.academicMode === true;
  let category: ClaimSupportCategory;
  let basis: string;

  if (declared) {
    category = declared;
    basis = "declared_claim_category";
  } else if (academic) {
    // Academic drafts state doctrine, theory and literature — not holdings.
    // Wording (below) is what can raise a block back to primary-required.
    switch (input.propositionType) {
      case "black_letter_rule":
      case "application":
        category = "theoretical_explanation";
        basis = "academic_proposition_theoretical";
        break;
      case "practical_guidance":
        category = "methodological_framing";
        basis = "academic_proposition_methodological";
        break;
      case "background":
      case "limitation":
        category = "doctrinal_background";
        basis = "academic_proposition_background";
        break;
      default:
        category = "doctrinal_background";
        basis = "academic_default_doctrinal_background";
    }
  } else {
    switch (input.propositionType) {
      case "black_letter_rule":
        category = "court_holding";
        basis = "proposition_type_black_letter_rule";
        break;
      case "application":
        category = "court_holding";
        basis = "proposition_type_application";
        break;
      case "practical_guidance":
        category = "statutory";
        basis = "proposition_type_practical_guidance";
        break;
      case "background":
      case "limitation":
        category = "contextual_background";
        basis = "proposition_type_background";
        break;
      default:
        category = "doctrinal_synthesis";
        basis = "default_doctrinal_synthesis";
    }
  }

  const text = String(input.text ?? "");

  // Structural escalation: a block that identifies a concrete judgment by
  // docket is asserting something about that judgment, whatever it declared.
  if (category !== "court_holding" && DOCKET_IDENTITY_RE.test(text)) {
    return { category: "court_holding", basis: `${basis}+docket_identity_escalation` };
  }

  // academic_citation_authority_alignment_v1 — wording escalation. A block
  // phrased as binding law ("החוק קובע", "בית המשפט קבע", "ההלכה היא") stays
  // primary-authority-required even in an academic draft.
  if (category !== "court_holding" && category !== "statutory") {
    const binding = detectBindingLawLanguage(text);
    if (binding.binding) {
      return {
        category: binding.kind === "statutory" ? "statutory" : "court_holding",
        basis: `${basis}+binding_language_escalation`,
      };
    }
  }
  return { category, basis };
}


export interface AuthorityOverstatement {
  block_index: number;
  category: ClaimSupportCategory;
  reason:
    | "court_holding_supported_only_by_secondary"
    | "docket_identity_without_judgment_body";
  refs_dropped: string[];
}

export const AUTHORITY_OVERSTATEMENT_LIMITATION_HE =
  "\n\n**מגבלת סמכות:** קביעות שהתמיכה היחידה להן היא ספרות משפטית, פרשנות או חומר מוסדי " +
  "אינן מוצגות כאן כהלכה מחייבת או כתוצאה של פסק דין מסוים. יש לאמת אותן מול פסיקה או חקיקה " +
  "לפני הסתמכות.";

export const NARROW_LIMITED_DOCTRINAL_NOTICE_HE =
  "\n\n**היקף התשובה:** התשובה מבוססת על ספרות משפטית שנקראה במלואה, ולא על פסק דין מחייב " +
  "שאותר ונקרא במלואו. לכן היא מציגה הסבר דוקטרינרי מוגבל ואינה קביעה הלכתית.";

export const LIMITED_DOCTRINAL_ANSWER_NOTICE_HE =
  "\n\n**היקף התשובה:** התשובה שלהלן נסמכת על חקיקה ו/או על ספרות ופרשנות משפטית שאותרו במלואן, " +
  "ולא על פסיקה שנוסחה המלא אותר. היא מסבירה את המסגרת הדוקטרינרית בלבד ואינה קובעת הלכה.";
