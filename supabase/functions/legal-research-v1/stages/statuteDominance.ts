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

