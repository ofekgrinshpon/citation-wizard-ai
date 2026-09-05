/**
 * web_source_usability_and_authority_selection_v1 — fix 3.
 *
 * Statute dominance invariant. When the question is primarily about the text,
 * scope or content of a statute / Basic Law, an available and verified statute
 * source must be the leading citation for statutory claims — case law may
 * accompany it, never replace it.
 *
 * This module never adds a source. It only reorders/permits sources that are
 * already in the drafter pack, and reports honestly when no statute source is
 * available.
 */

import type { DrafterInputSource } from "./drafter.ts";
import { classifySource } from "./topicAwareAlignment.ts";

export const STATUTE_DOMINANCE_VERSION = "web_source_usability_and_authority_selection_v1";

const STATUTORY_QUESTION_RE =
  /(חוק[- ]יסוד|חוק\s+יסוד|נוסח\s+הסעיף|לשון\s+החוק|לשון\s+הסעיף|סעיף\s+\d+|תקנה\s+\d+|מה\s+קובע\s+החוק|הוראת\s+החוק|פסקת\s+ההגבלה|תיקון\s+לחוק|החוק\s+קובע|על\s+פי\s+החוק|פקודת)/;

const STATUTORY_CLAIM_RE =
  /(חוק[- ]יסוד|סעיף\s+\d+|תקנה\s+\d+|פסקת\s+ההגבלה|הוראת\s+החוק|לשון\s+החוק|נוסח)/;

export interface StatuteDominanceReport {
  version: string;
  statutory_question: boolean;
  question_signals: string[];
  statute_sources_available: string[];
  statutory_claims: string[];
  promoted_refs: Array<{ claim_id: string; ref: string }>;
  statute_absent_declared: boolean;
  notice_he: string | null;
}

export function isStatutoryQuestion(question: string): { hit: boolean; signals: string[] } {
  const signals: string[] = [];
  const q = String(question ?? "");
  const m = q.match(STATUTORY_QUESTION_RE);
  if (m) signals.push(m[0]);
  return { hit: signals.length > 0, signals };
}

/** Statute sources currently in the drafter pack (already verified upstream). */
export function statuteSources(sources: DrafterInputSource[]): DrafterInputSource[] {
  return sources.filter((s) => classifySource(s) === "statute");
}

export interface StatuteDominanceInput {
  question: string;
  claims: Array<{ claim_id: string; text_he: string }>;
  sources: DrafterInputSource[];
  /** Mutable per-claim preferred ref lists from the claim-source plan. */
  preferredByClaim: Map<string, string[]>;
  /** Mutable per-claim acceptable ref lists (allowed to cite). */
  allowedByClaim?: Map<string, string[]>;
}

/**
 * Applies the invariant in place on the plan maps and returns telemetry.
 */
export function applyStatuteDominance(input: StatuteDominanceInput): StatuteDominanceReport {
  const { hit, signals } = isStatutoryQuestion(input.question);
  const statutes = statuteSources(input.sources);
  const report: StatuteDominanceReport = {
    version: STATUTE_DOMINANCE_VERSION,
    statutory_question: hit,
    question_signals: signals,
    statute_sources_available: statutes.map((s) => s.ref),
    statutory_claims: [],
    promoted_refs: [],
    statute_absent_declared: false,
    notice_he: null,
  };
  if (!hit) return report;

  if (statutes.length === 0) {
    report.statute_absent_declared = true;
    report.notice_he =
      "לא אותר במקורות שעברו אימות נוסח מוסמך של הוראת החוק הרלוונטית; ההסבר נסמך על מקורות משניים ופסיקה בלבד.";
    return report;
  }

  const promote = (claim_id: string) => {
    const preferred = input.preferredByClaim.get(claim_id) ?? [];
    const allowed = input.allowedByClaim?.get(claim_id);
    const statuteRefs = statutes.map((s) => s.ref);
    const lead = statuteRefs.find((r) => preferred.includes(r)) ?? statuteRefs[0];
    if (!lead) return;
    const next = [lead, ...preferred.filter((r) => r !== lead)];
    input.preferredByClaim.set(claim_id, next);
    if (allowed && !allowed.includes(lead)) {
      input.allowedByClaim?.set(claim_id, [lead, ...allowed]);
    }
    if (!preferred.includes(lead) || preferred[0] !== lead) {
      report.promoted_refs.push({ claim_id, ref: lead });
    }
  };

  for (const cl of input.claims) {
    const statutory = STATUTORY_CLAIM_RE.test(cl.text_he ?? "");
    if (!statutory) continue;
    report.statutory_claims.push(cl.claim_id);
    promote(cl.claim_id);
  }

  // Fallback: the question is squarely statutory but no individual claim carried
  // an explicit statutory marker (common when claims paraphrase the provision).
  // Reorder only — a statute already in the pack leads every claim that may
  // already cite it. No source is added and no citation is forced.
  if (report.statutory_claims.length === 0) {
    for (const cl of input.claims) {
      report.statutory_claims.push(cl.claim_id);
      promote(cl.claim_id);
    }
  }
  return report;
}


// ── canonical_registry_discovery_and_representative_source_use_v1 (fix 4) ──
//
// Live validation showed a square statutory-text question (Q2) finalizing with
// a judgment as its only footnote. Reordering the plan is not enough when the
// drafter simply never emits the statute ref, so the invariant is also checked
// and repaired ON THE DRAFT, before every downstream gate runs.
//
// The correction only promotes a statute source that is ALREADY admitted,
// verified and allowed for the claim. It adds no source, forces no footnote
// count, and never removes case law — case law stays supplemental.

import type { StructuredDraft } from "./structuredValidation.ts";

/** Telemetry row: `statute_dominance_check`. */
export interface StatuteDominanceCheck {
  run_id: string | null;
  query_type: "statutory_text" | "other";
  statute_claims_detected: string[];
  answer_level_statutory_question: boolean;
  relevant_statute_available: boolean;
  statute_source_id: string | null;
  statute_cited: boolean;
  statute_first_or_primary: boolean;
  case_law_used_as_substitute: boolean;
  correction_applied: boolean;
  blocked_reason: string | null;
}

function isVerifiedStatute(s: DrafterInputSource): boolean {
  if (classifySource(s) !== "statute") return false;
  if (s.body_acquired === true) return true;
  return /full_text|substantive_excerpt|has_statutory_text/.test(
    `${s.text_usability ?? ""} ${s.has_statutory_text ? "has_statutory_text" : ""}`,
  );
}

/**
 * Applies (and reports) statute dominance on the structured draft.
 * Mutates `draft.blocks[].source_refs` only.
 */
export function enforceStatuteDominanceOnDraft(
  draft: StructuredDraft | null,
  input: {
    question: string;
    sources: DrafterInputSource[];
    /** claim_id → refs the plan allows for that claim. */
    allowedByClaim?: Map<string, string[]>;
    statutoryClaimIds?: string[];
    run_id?: string | null;
  },
): { draft: StructuredDraft | null; check: StatuteDominanceCheck } {
  const statutory = isStatutoryQuestion(input.question);
  const statutes = input.sources.filter(isVerifiedStatute);
  const check: StatuteDominanceCheck = {
    run_id: input.run_id ?? null,
    query_type: statutory.hit ? "statutory_text" : "other",
    statute_claims_detected: input.statutoryClaimIds ?? [],
    answer_level_statutory_question: statutory.hit,
    relevant_statute_available: statutes.length > 0,
    statute_source_id: statutes[0]?.ref ?? null,
    statute_cited: false,
    statute_first_or_primary: false,
    case_law_used_as_substitute: false,
    correction_applied: false,
    blocked_reason: null,
  };
  const blocks = (draft?.blocks ?? []).filter((b) => b.kind !== "heading") as Array<
    { claim_id?: string | null; source_refs: string[] }
  >;
  const cited = new Set(blocks.flatMap((b) => b.source_refs ?? []));
  const statuteRefs = new Set(statutes.map((s) => s.ref));
  check.statute_cited = [...cited].some((r) => statuteRefs.has(r));
  const firstBlockWithRefs = blocks.find((b) => (b.source_refs ?? []).length > 0);
  check.statute_first_or_primary = !!firstBlockWithRefs &&
    statuteRefs.has(firstBlockWithRefs.source_refs[0]);
  check.case_law_used_as_substitute = statutory.hit && statutes.length > 0 &&
    !check.statute_cited && cited.size > 0;

  if (!statutory.hit || statutes.length === 0 || !draft) {
    if (statutory.hit && statutes.length === 0) {
      check.blocked_reason = "no_verified_statute_source_available";
    }
    return { draft, check };
  }

  const lead = statutes[0];
  const allowedFor = (claimId: string | null | undefined): boolean => {
    if (!input.allowedByClaim) return true;
    const allowed = input.allowedByClaim.get(String(claimId ?? ""));
    return !allowed || allowed.length === 0 || allowed.includes(lead.ref);
  };

  if (!check.statute_cited) {
    // Prefer a statutory claim block; otherwise the first block that already
    // carries citations (the statute is what that proposition rests on).
    const target = blocks.find((b) =>
        (input.statutoryClaimIds ?? []).includes(String(b.claim_id ?? "")) && allowedFor(b.claim_id)
      ) ??
      blocks.find((b) => (b.source_refs ?? []).length > 0 && allowedFor(b.claim_id)) ??
      blocks.find((b) => allowedFor(b.claim_id));
    if (target) {
      target.source_refs = [lead.ref, ...(target.source_refs ?? []).filter((r) => r !== lead.ref)];
      check.correction_applied = true;
      check.statute_cited = true;
      check.statute_first_or_primary = true;
    } else {
      check.blocked_reason = "no_block_allows_statute_ref";
    }
  } else if (!check.statute_first_or_primary && firstBlockWithRefs) {
    const b = blocks.find((x) => (x.source_refs ?? []).some((r) => statuteRefs.has(r)));
    if (b) {
      const statuteRef = b.source_refs.find((r) => statuteRefs.has(r))!;
      b.source_refs = [statuteRef, ...b.source_refs.filter((r) => r !== statuteRef)];
      check.correction_applied = true;
      check.statute_first_or_primary = true;
    }
  }
  return { draft, check };
}

/** Post-footnote verification: did the statute survive to the final answer? */
export function verifyStatuteDominanceInFootnotes(
  check: StatuteDominanceCheck,
  citedRefs: string[],
): StatuteDominanceCheck {
  if (!check.answer_level_statutory_question || !check.relevant_statute_available) return check;
  const cited = check.statute_source_id ? citedRefs.includes(check.statute_source_id) : false;
  return {
    ...check,
    statute_cited: cited,
    statute_first_or_primary: cited && citedRefs[0] === check.statute_source_id,
    case_law_used_as_substitute: !cited && citedRefs.length > 0,
    blocked_reason: cited
      ? check.blocked_reason
      : citedRefs.length > 0
      ? "statute_available_but_only_case_law_cited"
      : check.blocked_reason,
  };
}
