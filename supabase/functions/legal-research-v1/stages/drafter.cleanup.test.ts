// Unit tests for applyCitationCleanup — Phase 1 chronological renumbering,
// Phase 2 punctuation normalization, and cluster telemetry.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { applyCitationCleanup } from "./drafter.ts";

const u = (n: number) => ({ ref: `s${n}`, number: n, candidate_id: `c${n}` });

Deno.test("phase1: renumbers out-of-order markers by first appearance", () => {
  const answer = "טקסט אחד² ועוד טקסט¹ ושלישי³.";
  const used = [u(1), u(2), u(3)];
  const r = applyCitationCleanup(answer, used);
  assert(r.report.phase1.applied);
  assert(r.report.phase1.changed);
  assertEquals(r.report.phase1.after_order, [1, 2, 3]);
  // First marker in text should now be ¹
  assert(/אחד¹/.test(r.answer));
  assert(/אחד¹.*טקסט²/.test(r.answer));
  // used_sources renumbered too
  const numbers = r.used.map((x) => x.number).sort();
  assertEquals(numbers, [1, 2, 3]);
});

Deno.test("phase1: pass-through when already sorted", () => {
  const answer = "אחד¹ שני² שלישי³.";
  const r = applyCitationCleanup(answer, [u(1), u(2), u(3)]);
  assert(r.report.phase1.applied);
  assertEquals(r.report.phase1.changed, false);
  assertEquals(r.report.phase1.after_order, [1, 2, 3]);
});

Deno.test("phase2: hops marker across each terminal/clause punctuation", () => {
  for (const [src, want] of [
    ["טקסט¹.", "טקסט.¹"],
    ["טקסט¹,", "טקסט,¹"],
    ["טקסט¹;", "טקסט;¹"],
    ["טקסט¹:", "טקסט:¹"],
    ["טקסט¹?", "טקסט?¹"],
    ["טקסט¹!", "טקסט!¹"],
  ] as const) {
    const r = applyCitationCleanup(src, [u(1)]);
    assertEquals(r.answer, want, `${src} → ${want}`);
    assert(r.report.phase2.applied);
    assertEquals(r.report.phase2.punct_swaps, 1);
  }
});

Deno.test("phase2: no hop when whitespace separates marker from punctuation", () => {
  const src = "קוראים¹ לי אופק.";
  const r = applyCitationCleanup(src, [u(1)]);
  assertEquals(r.answer, src);
  assertEquals(r.report.phase2.punct_swaps, 0);
});

Deno.test("phase2: idempotent — second pass produces no further swaps", () => {
  const src = "טקסט¹.";
  const r1 = applyCitationCleanup(src, [u(1)]);
  const r2 = applyCitationCleanup(r1.answer, r1.used);
  assertEquals(r2.answer, r1.answer);
  assertEquals(r2.report.phase2.punct_swaps, 0);
});

Deno.test("cluster telemetry: detects adjacent superscript runs without mutating answer", () => {
  const src = "אחריות¹²³⁴ ואחרי כך.";
  const r = applyCitationCleanup(src, [u(1), u(2), u(3), u(4)]);
  // No punctuation adjacent to the run, so answer unchanged after Phase 2.
  assertEquals(r.answer, src);
  assertEquals(r.report.clusters.count, 1);
  assertEquals(r.report.clusters.examples[0].run, "¹²³⁴");
});

Deno.test("marker count invariant under Phase 1 + Phase 2", () => {
  const src = "אחד², שני¹; שלישי³.";
  const before = (src.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/gu) ?? []).length;
  const r = applyCitationCleanup(src, [u(1), u(2), u(3)]);
  const after = (r.answer.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/gu) ?? []).length;
  assertEquals(after, before);
});
