// Unit tests for the Step 2 planner query fanout cap.
// Guarantees: never touches required-anchor queries (they aren't here yet),
// preserves >=1 query per claim up to cap, keeps original order.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyQueryCap } from "./queryPlanner.ts";
import type { Query } from "../lib/types.ts";

function q(claim_id: string, i: number): Query {
  return {
    claim_id,
    role: "scholarship",
    query_he: `${claim_id}-${i}`,
    targets: ["local_db"],
    expected_source_type: "academic",
    reason: "test",
  };
}

Deno.test("cap disabled (0) is a no-op", () => {
  const qs = [q("c1", 1), q("c1", 2), q("c2", 1)];
  const r = applyQueryCap(qs, 0);
  assertEquals(r.kept.length, 3);
  assertEquals(r.dropped.length, 0);
});

Deno.test("cap larger than count is a no-op", () => {
  const qs = [q("c1", 1), q("c2", 1)];
  const r = applyQueryCap(qs, 10);
  assertEquals(r.kept.length, 2);
  assertEquals(r.dropped.length, 0);
});

Deno.test("cap preserves at least 1 query per claim", () => {
  // 5 claims, 3 queries each = 15 queries, cap = 5.
  // Every claim must appear at least once.
  const qs: Query[] = [];
  for (const c of ["c1", "c2", "c3", "c4", "c5"]) {
    for (let i = 0; i < 3; i++) qs.push(q(c, i));
  }
  const r = applyQueryCap(qs, 5);
  assertEquals(r.kept.length, 5);
  assertEquals(r.dropped.length, 10);
  const keptClaims = new Set(r.kept.map((k) => k.claim_id));
  assertEquals(keptClaims.size, 5);
});

Deno.test("cap keeps original planner order in kept list", () => {
  const qs = [q("c1", 1), q("c2", 1), q("c1", 2), q("c3", 1), q("c2", 2), q("c1", 3)];
  const r = applyQueryCap(qs, 4);
  assertEquals(r.kept.length, 4);
  // Kept queries should appear in the same relative order as the input.
  const inputIdx = r.kept.map((k) => qs.indexOf(k));
  const sortedInputIdx = [...inputIdx].sort((a, b) => a - b);
  assertEquals(inputIdx, sortedInputIdx);
});

Deno.test("when claims > cap, keeps first-seen query per claim", () => {
  // 5 claims, cap = 3. Only first 3 claims survive; only first query of each.
  const qs: Query[] = [];
  for (const c of ["c1", "c2", "c3", "c4", "c5"]) {
    for (let i = 0; i < 2; i++) qs.push(q(c, i));
  }
  const r = applyQueryCap(qs, 3);
  assertEquals(r.kept.length, 3);
  assertEquals(r.kept.map((k) => k.claim_id), ["c1", "c2", "c3"]);
  assertEquals(r.kept.map((k) => k.query_he), ["c1-0", "c2-0", "c3-0"]);
  assertEquals(r.dropped.length, 7);
});

Deno.test("cap = queries.length is a no-op", () => {
  const qs = [q("c1", 1), q("c2", 1)];
  const r = applyQueryCap(qs, 2);
  assertEquals(r.kept.length, 2);
  assertEquals(r.dropped.length, 0);
});
