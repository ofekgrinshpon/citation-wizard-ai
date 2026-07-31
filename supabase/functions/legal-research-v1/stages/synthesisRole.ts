// Synthesis-role labelling for case-law synthesis packs.
//
// Scope: labelling / observability only. This module does NOT change planner
// strategy, retrieval, verifier labels, sufficiency thresholds, the drafter
// prompt, or any deterministic branch. It attaches a `synthesis_role` label to
// admitted candidates so the source pack becomes auditable.
//
// Rule: the planner retrieval role only *seeds* the label. Candidate content
// (source-integrity typing + phrasing cues) can override it — scholarship
// retrieved under a caselaw role becomes secondary_commentary, statute text
// retrieved under any role becomes statutory_background, and only real
// judgments stay case-law candidates.

import type { SourceIntegrity } from "./sourceIntegrity.ts";

export const SYNTHESIS_ROLES = [
  "leading_candidate",
  "applying_candidate",
  "limiting_or_distinguishing_candidate",
  "statutory_background",
  "secondary_commentary",
  "unknown",
] as const;
export type SynthesisRole = typeof SYNTHESIS_ROLES[number];

/** Limits / exceptions / distinctions / criticism. */
const LIMITING_CUE =
  /(חריג|סייג|צמצום|הבחנה|הבחין|אין\s+להחיל|אי[- ]?תחולה|גבולות|מגבל|דעת\s+מיעוט|ביקורת\s+על\s+הלכת|סטייה\s+מהלכ)/;
/** Application of an existing rule to new facts / follow-on case law. */
const APPLYING_CUE =
  /(יישום|יישמ|הוחל[הו]?\s|בעקבות\s+הלכת|לאחר\s+הלכת|החיל[ה]?\s+את\s+הלכת|בהתאם\s+להלכת|אימץ\s+את\s+הלכת)/;
/** Language that marks a rule-setting / leading authority. */
const LEADING_CUE =
  /(הלכת|נקבעה\s+הלכה|ההלכה\s+ש|פסק\s+דין\s+מנחה|אבן\s+דרך|הלכה\s+מחייבת|דיון\s+נוסף|דנ["״']?א|דנג["״']?ץ)/;

export interface SynthesisRoleInput {
  /** Planner retrieval role (binding_case_law, primary_statute, …). */
  role?: string | null;
  integrity: SourceIntegrity;
  title?: string | null;
  snippet?: string | null;
}

export interface SynthesisRoleResult {
  synthesis_role: SynthesisRole;
  seeded_from: SynthesisRole;
  overridden: boolean;
  override_reason?: string;
}

function seedFromRole(role: string): SynthesisRole {
  switch (role) {
    case "binding_case_law":
      return "leading_candidate";
    case "persuasive_case_law":
      return "applying_candidate";
    case "primary_statute":
    case "regulation":
      return "statutory_background";
    case "scholarship":
      return "secondary_commentary";
    default:
      return "unknown";
  }
}

export function assignSynthesisRole(input: SynthesisRoleInput): SynthesisRoleResult {
  const seeded = seedFromRole(String(input.role ?? ""));
  const integ = input.integrity;
  const hay = `${input.title ?? ""} ${input.snippet ?? ""}`;

  const done = (
    role: SynthesisRole,
    reason?: string,
  ): SynthesisRoleResult => ({
    synthesis_role: role,
    seeded_from: seeded,
    overridden: role !== seeded,
    override_reason: role !== seeded ? reason : undefined,
  });

  // Content overrides, strongest signal first.
  if (integ.citable_as === "not_citable") {
    return done("unknown", "not_citable_source");
  }
  if (integ.citable_as === "statute") {
    return done("statutory_background", "statute_text_under_other_role");
  }
  if (integ.citable_as === "scholarship" || integ.citable_as === "commentary") {
    return done("secondary_commentary", "non_authority_text_under_caselaw_role");
  }

  const isJudgment = integ.citable_as === "judgment" || integ.is_judgment_document === true;
  if (isJudgment) {
    if (LIMITING_CUE.test(hay)) {
      return done("limiting_or_distinguishing_candidate", "limiting_language_in_source");
    }
    if (seeded === "leading_candidate" && APPLYING_CUE.test(hay) && !LEADING_CUE.test(hay)) {
      return done("applying_candidate", "applying_language_in_source");
    }
    if (seeded === "leading_candidate" || seeded === "applying_candidate") {
      return done(seeded);
    }
    return done(LEADING_CUE.test(hay) ? "leading_candidate" : "applying_candidate", "judgment_without_caselaw_role");
  }

  // Unknown citable_as: keep a statutory/commentary seed, otherwise unknown.
  if (seeded === "statutory_background" || seeded === "secondary_commentary") return done(seeded);
  return done("unknown", seeded === "unknown" ? undefined : "unresolved_source_type");
}

export interface SynthesisPackSummary {
  judgment_count: number;
  statute_count: number;
  commentary_count: number;
  scholarship_count: number;
  not_citable_count: number;
  by_synthesis_role: Record<string, number>;
  has_judgment: boolean;
  has_statutory_background: boolean;
  has_usable_holding_text: boolean;
  judgments_with_holding_text: number;
}

export interface SynthesisPackRow {
  citable_as: string;
  text_usability: string;
  synthesis_role: SynthesisRole;
  has_holding_text?: boolean;
}

export function summarizeSynthesisPack(rows: SynthesisPackRow[]): SynthesisPackSummary {
  const by_synthesis_role: Record<string, number> = {};
  let judgment_count = 0;
  let statute_count = 0;
  let commentary_count = 0;
  let scholarship_count = 0;
  let not_citable_count = 0;
  let judgments_with_holding_text = 0;

  for (const r of rows) {
    by_synthesis_role[r.synthesis_role] = (by_synthesis_role[r.synthesis_role] ?? 0) + 1;
    if (r.citable_as === "judgment") judgment_count++;
    else if (r.citable_as === "statute") statute_count++;
    else if (r.citable_as === "commentary") commentary_count++;
    else if (r.citable_as === "scholarship") scholarship_count++;
    else if (r.citable_as === "not_citable") not_citable_count++;
    const usable = r.text_usability === "full_text" || r.text_usability === "substantive_excerpt";
    if (r.citable_as === "judgment" && usable && r.has_holding_text) judgments_with_holding_text++;
  }

  return {
    judgment_count,
    statute_count,
    commentary_count,
    scholarship_count,
    not_citable_count,
    by_synthesis_role,
    has_judgment: judgment_count > 0,
    has_statutory_background: (by_synthesis_role["statutory_background"] ?? 0) > 0,
    has_usable_holding_text: judgments_with_holding_text > 0,
    judgments_with_holding_text,
  };
}
