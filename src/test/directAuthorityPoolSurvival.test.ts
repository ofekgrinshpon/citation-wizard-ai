// direct_authority_pool_survival_v1 — origin diversity is soft pool shaping.
import { describe, expect, it } from "vitest";
import { buildCandidatePool } from "../../supabase/functions/legal-research-v1/stages/candidatePool.ts";

// deno-lint-ignore-file no-explicit-any
function cand(over: Record<string, unknown>): any {
  return {
    candidate_id: String(over.candidate_id ?? Math.random()),
    claim_id: "c1",
    role: "binding_case_law",
    origin: "local_db",
    retrieval_method: "text",
    title: "כותרת",
    source_type: "caselaw",
    document_id: null,
    source_url: null,
    snippet: "טקסט משפטי מהותי",
    query_he: "ביקורת שיפוטית",
    score: 0.5,
    metadata: {},
    ...over,
  };
}

/** Many weak local candidates that would otherwise occupy the whole pool. */
function weakLocals(n: number) {
  return Array.from({ length: n }, (_, i) =>
    cand({
      candidate_id: `w${i}`,
      retrieval_method: "vector",
      title: `החלטה שולית ${i}`,
      source_url: `https://local.example.co.il/doc-${i}`,
      claim_id: `c${i % 6}`,
      score: 0.2,
    }));
}

/** Deep web judgments from one origin, each with an exact docket identity. */
function webJudgments(n: number, score = 0.75) {
  return Array.from({ length: n }, (_, i) =>
    cand({
      candidate_id: `j${i}`,
      origin: "perplexity",
      retrieval_method: "perplexity",
      title: `בג"ץ ${1000 + i}/92 פלוני נ' בית הדין הרבני הגדול`,
      source_url: `https://www.judgments.org.il/judgments/case-${i}/`,
      score,
      metadata: { classified_source_class: "court_case" },
    }));
}

function buildDeepPool(judgmentScore = 0.75) {
  return buildCandidatePool([...weakLocals(40), ...webJudgments(8, judgmentScore)], {
    task_intent: "doctrinal_explanation",
  });
}

describe("direct authority pool survival", () => {
  it("keeps more than one deep web judgment despite the origin cap", () => {
    const pool = buildDeepPool();
    const judgments = pool.candidates.filter((c) => c.origin === "perplexity");
    expect(judgments.length).toBeGreaterThan(1);
  });

  it("records bounded exemption telemetry", () => {
    const pool = buildDeepPool();
    const pc = pool.pool_collapse!;
    expect(pc.authority_exemption_budget).toBeGreaterThanOrEqual(3);
    expect(pc.authority_exemptions_used ?? 0).toBeLessThanOrEqual(
      pc.authority_exemption_budget!,
    );
    for (const row of pc.authority_exemptions ?? []) {
      expect(row.reason).toMatch(/protected:|classified:|integrity:/);
    }
  });

  it("preserves diversity — other origins keep pool slots", () => {
    const pool = buildDeepPool();
    const locals = pool.candidates.filter((c) => c.origin === "local_db");
    expect(locals.length).toBeGreaterThan(5);
  });

  it("does not exempt weak non-authority candidates from the origin cap", () => {
    const weakWeb = Array.from({ length: 8 }, (_, i) =>
      cand({
        candidate_id: `n${i}`,
        origin: "perplexity",
        retrieval_method: "perplexity",
        role: "scholarship",
        source_type: "web_page",
        title: `בלוג משפטי ${i}`,
        source_url: `https://blog.example.com/post-${i}`,
        score: 0.2,
        metadata: {},
      }));
    const pool = buildCandidatePool([...weakLocals(40), ...weakWeb], {
      task_intent: "doctrinal_explanation",
    });
    const exemptions = pool.pool_collapse?.authority_exemptions ?? [];
    expect(exemptions.length).toBe(0);
  });

  it("never exceeds the global pool cap", () => {
    const pool = buildDeepPool(0.95);
    expect(pool.candidates.length).toBeLessThanOrEqual(30);
  });
});
