// Deterministic escalation rules: gpt-5-mini → gpt-5.
// Per the approved plan, scoped per-stage, at most one retry per stage.

import { AnalyzerOutput, PlannerOutput, SourceRole } from "./types.ts";

// ─── Pre-stage triggers ─────────────────────────────────────────────────────
export function shouldPreEscalateAnalyzer(question: string): string[] {
  const reasons: string[] = [];
  if (question.length > 200) reasons.push("A1:question.length>200");
  return reasons;
}

// ─── Analyzer post-checks ───────────────────────────────────────────────────
export function analyzerEscalationReasons(
  schemaValid: boolean,
  analyzer: AnalyzerOutput | undefined,
): string[] {
  const r: string[] = [];
  if (!schemaValid || !analyzer) {
    r.push("B1:schema_invalid");
    return r;
  }
  if (analyzer.confidence < 0.7) r.push("B2:confidence<0.7");
  if (analyzer.claims.length < 2) r.push("B3:claims<2");
  if (analyzer.claims.some((c) => c.required_roles.length === 0)) r.push("B4:claim_no_roles");
  return r;
}

// ─── Planner post-checks ───────────────────────────────────────────────────
const PRIMARY_LAW_ROLES: SourceRole[] = ["primary_statute", "regulation", "binding_case_law"];

function countHebrewLetters(s: string): number {
  let n = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x0590 && code <= 0x05ff) n++;
  }
  return n;
}

export function plannerEscalationReasons(
  schemaValid: boolean,
  planner: PlannerOutput | undefined,
  analyzer: AnalyzerOutput,
): string[] {
  const r: string[] = [];
  if (!schemaValid || !planner) {
    r.push("C1:schema_invalid");
    return r;
  }
  if (planner.queries.length < 3) r.push("C2:queries<3");

  const byClaim = new Map<string, typeof planner.queries>();
  for (const q of planner.queries) {
    const arr = byClaim.get(q.claim_id) ?? [];
    arr.push(q);
    byClaim.set(q.claim_id, arr);
  }
  for (const claim of analyzer.claims) {
    const qs = byClaim.get(claim.claim_id) ?? [];
    if (qs.length === 0) {
      r.push(`C3:claim_${claim.claim_id}_no_queries`);
      continue;
    }
    if (
      claim.is_black_letter &&
      !qs.some((q) => PRIMARY_LAW_ROLES.includes(q.role))
    ) {
      r.push(`C4:claim_${claim.claim_id}_missing_primary_law`);
    }
  }

  const total = planner.queries.length;
  if (total > 0) {
    const tooShort = planner.queries.filter((q) => countHebrewLetters(q.query_he) < 12).length;
    if (tooShort / total > 0.5) r.push("C5:>50%_short_queries");
  }
  return r;
}
