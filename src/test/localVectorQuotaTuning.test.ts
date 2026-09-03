// local_retrieval_precision_tuning_v1 — bounded local vector quota + rerank.
import { describe, expect, it } from "vitest";
import { buildCandidatePool } from "../../supabase/functions/legal-research-v1/stages/candidatePool.ts";

// deno-lint-ignore-file no-explicit-any
function cand(over: Record<string, unknown>): any {
  return {
    candidate_id: String(over.candidate_id ?? Math.random()),
    claim_id: "c1",
    role: "scholarship",
    origin: "local_db",
    retrieval_method: "text",
    title: "כותרת",
    source_type: "journal_article",
    document_id: null,
    source_url: null,
    snippet: "טקסט משפטי מהותי על מידתיות וביקורת חוקתית",
    query_he: "מידתיות",
    score: 0.1,
    metadata: {},
    ...over,
  };
}

function localVectors(n: number, sim: number) {
  return Array.from({ length: n }, (_, i) =>
    cand({
      candidate_id: `v${i}`,
      retrieval_method: "vector",
      title: `מאמר מידתיות ${i}`,
      source_url: `https://law.example.ac.il/article-${i}`,
      score: sim * 0.6,
    }));
}

function weakTexts(n: number) {
  return Array.from({ length: n }, (_, i) =>
    cand({
      candidate_id: `t${i}`,
      retrieval_method: "text",
      title: `החלטה כללית ${i}`,
      source_url: `https://law.example.ac.il/text-${i}`,
      score: 0.02,
    }));
}

describe("local vector quota tuning", () => {
  it("is disabled for narrow intents", () => {
    const pool = buildCandidatePool([...localVectors(6, 0.4), ...weakTexts(4)], {
      task_intent: "case_holding",
    });
    expect(pool.vector_tuning).toBeNull();
    const vec = pool.candidates.filter((c) => c.retrieval_method === "vector");
    expect(vec.length).toBeLessThanOrEqual(2);
  });

  it("admits up to 4 strong local vector candidates per claim in academic mode", () => {
    const pool = buildCandidatePool([...localVectors(6, 0.4), ...weakTexts(4)], {
      task_intent: "academic_writing",
    });
    expect(pool.vector_tuning?.enabled).toBe(true);
    const vec = pool.candidates.filter((c) => c.retrieval_method === "vector");
    expect(vec.length).toBe(4);
    expect(pool.vector_tuning!.vector_candidates_admitted_after)
      .toBeGreaterThan(pool.vector_tuning!.vector_candidates_admitted_before);
  });

  it("does not increase the final pool size", () => {
    const pool = buildCandidatePool([...localVectors(6, 0.4), ...weakTexts(40)], {
      task_intent: "academic_writing",
    });
    expect(pool.vector_tuning!.final_pool_size_after)
      .toBeLessThanOrEqual(pool.vector_tuning!.final_pool_size_before);
  });

  it("does not promote weak-similarity vector candidates", () => {
    const pool = buildCandidatePool([...localVectors(6, 0.12), ...weakTexts(4)], {
      task_intent: "academic_writing",
    });
    const vec = pool.candidates.filter((c) => c.retrieval_method === "vector");
    expect(vec.length).toBeLessThanOrEqual(2);
    expect(pool.reranking.length).toBe(0);
  });

  it("records rerank rows when a strong local vector outranks weak text", () => {
    const pool = buildCandidatePool([...localVectors(4, 0.5), ...weakTexts(4)], {
      task_intent: "academic_writing",
    });
    expect(pool.reranking.length).toBeGreaterThan(0);
    expect(pool.reranking[0].new_rank).toBeLessThan(pool.reranking[0].old_rank);
  });
});

describe("replacement-only guard", () => {
  it("never exceeds the untuned pool size even when the cap is not binding", () => {
    const pool = buildCandidatePool([...localVectors(8, 0.45), ...weakTexts(3)], {
      task_intent: "academic_writing",
    });
    expect(pool.candidates.length)
      .toBeLessThanOrEqual(pool.vector_tuning!.final_pool_size_before);
  });
});
