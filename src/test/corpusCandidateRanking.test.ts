// v2_corpus_candidate_ranking_before_truncation_v1
//
// The corpus retrieval defect was in the SQL candidate stage of
// `search_legal_chunks_text`: matching chunks were truncated with an arbitrary
// `LIMIT 2000` *before* any relevance ordering, so strongly ranked chunks of a
// large match set could be dropped at random.
//
// These tests cover both halves of the fix:
//  1. a pure model of the candidate-selection contract (rank-before-truncate,
//     deterministic tie-break, unchanged behaviour for small match sets);
//  2. structural assertions against the shipped migration SQL, so the deployed
//     function cannot silently regress to arbitrary truncation or grow
//     statute/source-type specific branches.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ── 1. Candidate-selection contract ────────────────────────────────────────

interface Chunk {
  cid: string;
  did: string;
  rank: number;
}

/** The defective behaviour: cut first, rank the survivors. */
export function selectCandidatesArbitrary(chunks: Chunk[], limit: number): Chunk[] {
  return chunks.slice(0, limit).sort((a, b) => b.rank - a.rank || (a.cid < b.cid ? -1 : 1));
}

/** The corrected behaviour: rank first, then cut. Ties break on chunk id. */
export function selectCandidatesRanked(chunks: Chunk[], limit: number): Chunk[] {
  return [...chunks]
    .sort((a, b) => b.rank - a.rank || (a.cid < b.cid ? -1 : a.cid > b.cid ? 1 : 0))
    .slice(0, limit);
}

const LIMIT = 2000;

/** Mirrors the real corpus shape: a strong chunk sitting past the old cutoff. */
function corpusFixture(): Chunk[] {
  const chunks: Chunk[] = [];
  for (let i = 0; i < 2283; i++) {
    chunks.push({ cid: `c${String(i).padStart(5, "0")}`, did: `d${i % 400}`, rank: 0.01 });
  }
  // strong chunk physically located past the arbitrary cutoff
  chunks[2100] = { cid: "c02100", did: "statute-doc", rank: 0.48 };
  return chunks;
}

describe("corpus candidate selection", () => {
  it("A. retains a high-ranking chunk that the arbitrary cutoff dropped", () => {
    const chunks = corpusFixture();
    const before = selectCandidatesArbitrary(chunks, LIMIT);
    const after = selectCandidatesRanked(chunks, LIMIT);
    expect(before.some((c) => c.did === "statute-doc")).toBe(false);
    expect(after.some((c) => c.did === "statute-doc")).toBe(true);
    expect(after[0].did).toBe("statute-doc");
  });

  it("B. orders candidates by relevance before truncating", () => {
    const after = selectCandidatesRanked(corpusFixture(), LIMIT);
    expect(after).toHaveLength(LIMIT);
    for (let i = 1; i < after.length; i++) {
      expect(after[i - 1].rank).toBeGreaterThanOrEqual(after[i].rank);
    }
  });

  it("C. leaves match sets smaller than the candidate limit unchanged", () => {
    const small: Chunk[] = Array.from({ length: 120 }, (_, i) => ({
      cid: `c${String(i).padStart(5, "0")}`,
      did: `d${i}`,
      rank: (i % 7) / 10,
    }));
    const after = selectCandidatesRanked(small, LIMIT);
    expect(after).toHaveLength(small.length);
    expect(new Set(after.map((c) => c.cid))).toEqual(new Set(small.map((c) => c.cid)));
  });

  it("E. is deterministic for equal ranks across repeated runs", () => {
    const tied: Chunk[] = Array.from({ length: 3000 }, (_, i) => ({
      cid: `c${String(i).padStart(5, "0")}`,
      did: `d${i}`,
      rank: 0.25,
    }));
    const a = selectCandidatesRanked(tied, LIMIT).map((c) => c.cid);
    const b = selectCandidatesRanked([...tied].reverse(), LIMIT).map((c) => c.cid);
    expect(a).toEqual(b);
    expect(a[0]).toBe("c00000");
  });
});

// ── 2. Shipped SQL structure ───────────────────────────────────────────────

function latestSearchMigration(): string {
  const dir = path.resolve(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => readFileSync(path.join(dir, f), "utf8").includes("search_legal_chunks_text"));
  if (!file) throw new Error("no migration defining search_legal_chunks_text");
  return readFileSync(path.join(dir, file), "utf8");
}

describe("search_legal_chunks_text migration", () => {
  const sql = latestSearchMigration();

  it("ranks the precise candidate lane before its LIMIT", () => {
    const lane = sql.slice(sql.indexOf("precise_cands AS"), sql.indexOf("broad_cands AS"));
    const orderAt = lane.indexOf("ORDER BY ts_rank");
    const limitAt = lane.indexOf("LIMIT 2000");
    expect(orderAt).toBeGreaterThan(-1);
    expect(limitAt).toBeGreaterThan(orderAt);
  });

  it("uses a deterministic secondary ordering key, not physical row order", () => {
    expect(sql).toMatch(/ORDER BY ts_rank[\s\S]*?DESC, c2\.id ASC/);
    expect(sql).toMatch(/PARTITION BY did ORDER BY content_rank DESC, cid ASC/);
    expect(sql).toMatch(/ORDER BY similarity DESC, d\.id ASC/);
  });

  it("D. introduces no statute-specific or source-type-specific branch", () => {
    expect(sql).not.toContain("israeli_law");
    expect(sql).not.toContain("יחסי ממון");
    expect(sql).not.toContain("c82414f9");
    expect(sql).not.toMatch(/WHERE[^\n]*d\.source_type\s*=/);
  });

  it("keeps the existing final scoring expression", () => {
    expect(sql).toContain("coalesce(m.meta_rank, 0)");
    expect(sql).toContain("coalesce(tc.content_rank, 0)");
    expect(sql).toContain("LIMIT match_count");
  });
});
