import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildRequiredAnchorQueries,
  computeRequiredAnchorStatuses,
  pickMissingAnchors,
  resolveRequiredAnchors,
} from "./requiredAnchors.ts";

const baseAnalyzer = {
  confidence: 0.8,
  legal_area: "מס הכנסה",
  answer_type: "doctrinal_explanation" as const,
  claims: [
    {
      claim_id: "C1",
      text_he: "סטטוס פקודת מס הכנסה",
      required_roles: ["primary_statute" as const],
      is_black_letter: true,
      reason: "",
    },
    {
      claim_id: "C2",
      text_he: "פרשנותה",
      required_roles: ["scholarship" as const],
      is_black_letter: false,
      reason: "",
    },
  ],
};

Deno.test("resolveRequiredAnchors fires on 'מנדט' interpretation_note", () => {
  const a = resolveRequiredAnchors({
    ...baseAnalyzer,
    interpretation_note: "מנדטורי פורש כפקודה מתקופת המנדט הבריטי",
  });
  assertEquals(a.length, 1);
  assertEquals(a[0].anchor_id, "mandate_continuity_s11");
});

Deno.test("resolveRequiredAnchors empty when no note", () => {
  const a = resolveRequiredAnchors(baseAnalyzer);
  assertEquals(a.length, 0);
});

Deno.test("buildRequiredAnchorQueries attaches to most relevant claim and tags metadata", () => {
  const anchors = resolveRequiredAnchors({ ...baseAnalyzer, interpretation_note: "מנדט" });
  const queries = buildRequiredAnchorQueries(baseAnalyzer, anchors);
  assertEquals(queries.length, 3);
  for (const q of queries) {
    assertEquals(q.claim_id, "C1"); // primary_statute role lives on C1
    assertEquals(q.role, "primary_statute");
    assertEquals(q.expected_source_type, "statute");
    assertEquals((q as { metadata?: Record<string, unknown> }).metadata?.required_anchor_id, "mandate_continuity_s11");
    assertEquals(q.targets.length, 2);
  }
});

Deno.test("computeRequiredAnchorStatuses reports missing when no candidates", () => {
  const anchors = resolveRequiredAnchors({ ...baseAnalyzer, interpretation_note: "מנדט" });
  const statuses = computeRequiredAnchorStatuses({
    anchors,
    candidates: [],
    usableIds: new Set(),
    verdicts: [],
    usedCandidateIds: new Set(),
  });
  assertEquals(statuses[0].status, "missing");
  assertEquals(pickMissingAnchors(statuses).length, 1);
});

Deno.test("computeRequiredAnchorStatuses reports cited when in usedSources", () => {
  const anchors = resolveRequiredAnchors({ ...baseAnalyzer, interpretation_note: "מנדט" });
  const cand = {
    candidate_id: "c-1",
    claim_id: "C1",
    role: "primary_statute" as const,
    origin: "local_db" as const,
    retrieval_method: "text" as const,
    title: "פקודת סדרי השלטון והמשפט",
    source_type: "legislation",
    query_he: anchors[0].suggested_queries[0],
    score: 0.9,
    metadata: { required_anchor_id: anchors[0].anchor_id },
  };
  const statuses = computeRequiredAnchorStatuses({
    anchors,
    candidates: [cand],
    usableIds: new Set(["c-1"]),
    verdicts: [{ candidate_id: "c-1", support: "direct" }],
    usedCandidateIds: new Set(["c-1"]),
  });
  assertEquals(statuses[0].status, "cited");
  assertEquals(statuses[0].verified_support, "direct");
});
