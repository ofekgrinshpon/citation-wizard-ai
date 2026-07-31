// Synthesis snippet budget.
//
// Scope: text budget only. This module does NOT change planner strategy,
// verifier labels, sufficiency thresholds, the drafter prompt/skeleton,
// source-integrity classification, or any deterministic branch.
//
// Rule: for case-law synthesis runs only, sources that are actually capable of
// carrying a line-of-authority answer (real judgments in a case-law synthesis
// role, and statute text in a statutory-background role) may receive a larger
// snippet. Everything else — commentary, mirrors, law-firm pages,
// metadata-only pages — keeps the existing default cap.

import type { SynthesisRole } from "./synthesisRole.ts";

/** Existing drafter-side cap. Never raised globally. */
export const SNIPPET_DEFAULT_BUDGET = 500;
const BUDGET_LEADING_JUDGMENT = 1200;
const BUDGET_OTHER_JUDGMENT = 900;
const BUDGET_STATUTORY_BACKGROUND = 1200;

/** Only these research modes may spend an expanded budget. */
export const SYNTHESIS_MODES = new Set(["case_law_synthesis"]);

/** Text-usability labels that mean "there is no real text here". */
const NON_TEXT_USABILITY = new Set(["metadata_only", "unusable", "unknown"]);

export interface SnippetBudgetInput {
  research_mode?: string | null;
  citable_as?: string | null;
  synthesis_role?: SynthesisRole | string | null;
  text_usability?: string | null;
}

export interface SnippetBudgetDecision {
  budget: number;
  expanded: boolean;
  reason:
    | "not_synthesis_mode"
    | "leading_judgment"
    | "applying_judgment"
    | "limiting_judgment"
    | "statutory_background"
    | "no_real_text"
    | "not_eligible";
}

export function resolveSnippetBudget(input: SnippetBudgetInput): SnippetBudgetDecision {
  const mode = String(input.research_mode ?? "");
  if (!SYNTHESIS_MODES.has(mode)) {
    return { budget: SNIPPET_DEFAULT_BUDGET, expanded: false, reason: "not_synthesis_mode" };
  }

  const citable = String(input.citable_as ?? "");
  const role = String(input.synthesis_role ?? "");
  const usability = String(input.text_usability ?? "unknown");

  const eligible =
    (citable === "judgment" &&
      (role === "leading_candidate" ||
        role === "applying_candidate" ||
        role === "limiting_or_distinguishing_candidate")) ||
    (citable === "statute" && role === "statutory_background");

  if (!eligible) {
    return { budget: SNIPPET_DEFAULT_BUDGET, expanded: false, reason: "not_eligible" };
  }
  // Metadata-only / unusable pages never become long just because their role
  // looks right — there is no actual text to spend the budget on.
  if (NON_TEXT_USABILITY.has(usability)) {
    return { budget: SNIPPET_DEFAULT_BUDGET, expanded: false, reason: "no_real_text" };
  }

  if (citable === "statute") {
    return { budget: BUDGET_STATUTORY_BACKGROUND, expanded: true, reason: "statutory_background" };
  }
  if (role === "leading_candidate") {
    return { budget: BUDGET_LEADING_JUDGMENT, expanded: true, reason: "leading_judgment" };
  }
  if (role === "applying_candidate") {
    return { budget: BUDGET_OTHER_JUDGMENT, expanded: true, reason: "applying_judgment" };
  }
  return { budget: BUDGET_OTHER_JUDGMENT, expanded: true, reason: "limiting_judgment" };
}

export interface SnippetBudgetEntry {
  ref: string;
  citable_as: string;
  synthesis_role: string;
  text_usability: string;
  budget: number;
  expanded: boolean;
  reason: SnippetBudgetDecision["reason"];
  snippet_length: number;
  available_text_length: number;
  has_holding_text: boolean;
  has_statutory_text: boolean;
}

export interface SnippetBudgetReport {
  research_mode: string | null;
  synthesis_run: boolean;
  snippet_budget_by_source: SnippetBudgetEntry[];
  expanded_source_count: number;
  judgment_sources_ge_900: number;
  statute_sources_ge_900: number;
  max_snippet_length: number;
  commentary_max_snippet_length: number;
}

/** Deterministic cue that a chunk carries actual statutory wording. */
const STATUTORY_TEXT_CUE = /(סעיף\s*\d|\(\s*[אבגדהוזחט]\s*\)|תיקון\s+מס|חוק\s+ה)/;

export function hasStatutoryText(text: string | null | undefined): boolean {
  const s = (text || "").trim();
  if (s.length < 40) return false;
  return STATUTORY_TEXT_CUE.test(s);
}

export function summarizeSnippetBudget(
  research_mode: string | null,
  entries: SnippetBudgetEntry[],
): SnippetBudgetReport {
  const commentary = entries.filter(
    (e) => e.citable_as !== "judgment" && e.citable_as !== "statute",
  );
  return {
    research_mode,
    synthesis_run: SYNTHESIS_MODES.has(String(research_mode ?? "")),
    snippet_budget_by_source: entries,
    expanded_source_count: entries.filter((e) => e.expanded).length,
    judgment_sources_ge_900: entries.filter(
      (e) => e.citable_as === "judgment" && e.snippet_length >= 900,
    ).length,
    statute_sources_ge_900: entries.filter(
      (e) => e.citable_as === "statute" && e.snippet_length >= 900,
    ).length,
    max_snippet_length: entries.reduce((m, e) => Math.max(m, e.snippet_length), 0),
    commentary_max_snippet_length: commentary.reduce((m, e) => Math.max(m, e.snippet_length), 0),
  };
}
