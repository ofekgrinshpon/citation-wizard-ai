import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildRequiredAnchorQueries,
  computeRequiredAnchorStatuses,
  pickAnchorsRequiringDrafterLimitation,
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

// ─── Docket-anchored-judgment anchors ────────────────────────────────────

import { buildDocketAnchors } from "./requiredAnchors.ts";

const caseAnalyzer = {
  confidence: 0.8,
  legal_area: "משפט חוקתי",
  answer_type: "doctrinal_explanation" as const,
  claims: [
    {
      claim_id: "C1",
      text_he: "פסק הדין",
      required_roles: ["binding_case_law" as const],
      is_black_letter: false,
      reason: "",
    },
  ],
};

Deno.test("buildDocketAnchors — Hebrew bagatz emits anchor with variants", () => {
  const anchors = buildDocketAnchors('מהי ההלכה בבג"ץ 5555/18?');
  assertEquals(anchors.length, 1);
  const a = anchors[0];
  assertEquals(a.anchor_id, "docket:bagatz-5555-18");
  assertEquals(a.is_docket_anchor, true);
  assertEquals(a.anchor_type, "binding_case_law");
  assertEquals(a.target, "both");
  // suggested_queries include Hebrew canonical, gershayim, English, dash form
  const qs = a.suggested_queries;
  if (!qs.some((q) => q.includes('בג"ץ'))) throw new Error("no canonical HE");
  if (!qs.some((q) => q.includes("HCJ"))) throw new Error("no english alias");
});

Deno.test("buildRequiredAnchorQueries — docket queries carry docket_variants metadata", () => {
  const anchors = buildDocketAnchors('בג"ץ 5555/18');
  const queries = buildRequiredAnchorQueries(caseAnalyzer, anchors);
  assertEquals(queries.length > 0, true);
  for (const q of queries) {
    assertEquals(q.role, "binding_case_law");
    const meta = (q as { metadata?: Record<string, unknown> }).metadata ?? {};
    assertEquals(meta.is_docket_anchor, true);
    assertEquals(Array.isArray(meta.docket_variants), true);
  }
});

Deno.test("computeRequiredAnchorStatuses — docket anchor: adjacent case does NOT satisfy", () => {
  const anchors = buildDocketAnchors('בג"ץ 5555/18');
  // Adjacent case: same claim/role/query, but no docket_match flag.
  const cand = {
    candidate_id: "c-adj",
    claim_id: "C1",
    role: "binding_case_law" as const,
    origin: "local_db" as const,
    retrieval_method: "text" as const,
    title: 'בג"ץ 1234/22 אחר',
    source_type: "caselaw",
    query_he: anchors[0].suggested_queries[0],
    score: 0.9,
    metadata: { required_anchor_id: anchors[0].anchor_id }, // NO docket_match
  };
  const statuses = computeRequiredAnchorStatuses({
    anchors,
    candidates: [cand],
    usableIds: new Set(["c-adj"]),
    verdicts: [{ candidate_id: "c-adj", support: "direct" }],
    usedCandidateIds: new Set(["c-adj"]),
  });
  assertEquals(statuses[0].status, "missing"); // no docket_match candidates
  assertEquals(statuses[0].cited, false);
});

Deno.test("computeRequiredAnchorStatuses — docket anchor: docket_match + direct → cited", () => {
  const anchors = buildDocketAnchors('בג"ץ 5555/18');
  const cand = {
    candidate_id: "c-hit",
    claim_id: "C1",
    role: "binding_case_law" as const,
    origin: "local_db" as const,
    retrieval_method: "text" as const,
    title: 'בג"ץ 5555/18 עדאלה',
    source_type: "supreme_court_il",
    query_he: anchors[0].suggested_queries[0],
    score: 0.95,
    metadata: {
      required_anchor_id: anchors[0].anchor_id,
      docket_match: true,
    },
  };
  const statuses = computeRequiredAnchorStatuses({
    anchors,
    candidates: [cand],
    usableIds: new Set(["c-hit"]),
    verdicts: [{ candidate_id: "c-hit", support: "direct" }],
    usedCandidateIds: new Set(["c-hit"]),
  });
  assertEquals(statuses[0].status, "cited");
  assertEquals(statuses[0].cited, true);
  assertEquals(statuses[0].is_docket_anchor, true);
});

Deno.test("computeRequiredAnchorStatuses — docket anchor: docket_match + tangential → missing (support gate)", () => {
  const anchors = buildDocketAnchors('בג"ץ 5555/18');
  const cand = {
    candidate_id: "c-weak",
    claim_id: "C1",
    role: "binding_case_law" as const,
    origin: "perplexity" as const,
    retrieval_method: "perplexity" as const,
    title: 'בג"ץ 5555/18 rehash blog post',
    source_type: "other",
    query_he: anchors[0].suggested_queries[0],
    score: 0.7,
    metadata: {
      required_anchor_id: anchors[0].anchor_id,
      docket_match: true,
    },
  };
  const statuses = computeRequiredAnchorStatuses({
    anchors,
    candidates: [cand],
    usableIds: new Set(),
    verdicts: [{ candidate_id: "c-weak", support: "tangential" }],
    usedCandidateIds: new Set(),
  });
  // reached_verifier=false → retrieved_unverified
  assertEquals(statuses[0].status, "retrieved_unverified");
  assertEquals(pickMissingAnchors(statuses).length, 1);
});

Deno.test("computeRequiredAnchorStatuses — user-uploaded judgment satisfies docket anchor", () => {
  const anchors = buildDocketAnchors('בג"ץ 5555/18');
  const userDoc = {
    id: "u1",
    file_name: 'בג"ץ 5555/18.pdf',
    mime_type: "application/pdf",
    storage_path: "user/research/5555-18.pdf",
    signed_url: null,
    chunks: [{ ref: "u1p1", page: 1, text: 'בג"ץ 5555/18 עדאלה' }],
    total_chars: 100,
    truncated: false,
    docket_match: true,
    matched_dockets: ["bagatz-5555-18"],
  };
  const statuses = computeRequiredAnchorStatuses({
    anchors,
    candidates: [],
    usableIds: new Set(),
    verdicts: [],
    usedCandidateIds: new Set(),
    userDocs: [userDoc],
  });
  assertEquals(statuses[0].status, "cited");
  assertEquals(statuses[0].verified_support, "direct");
  assertEquals(statuses[0].cited, true);
  assertEquals(statuses[0].candidate_ids.includes("u1p1"), true);
});

Deno.test("computeRequiredAnchorStatuses — user doc without matching docket does not satisfy anchor", () => {
  const anchors = buildDocketAnchors('בג"ץ 5555/18');
  const userDoc = {
    id: "u1",
    file_name: "some-other-case.pdf",
    mime_type: "application/pdf",
    storage_path: "user/research/other.pdf",
    signed_url: null,
    chunks: [{ ref: "u1p1", page: 1, text: 'ע"א 1234/22' }],
    total_chars: 100,
    truncated: false,
    docket_match: false,
    matched_dockets: [],
  };
  const statuses = computeRequiredAnchorStatuses({
    anchors,
    candidates: [],
    usableIds: new Set(),
    verdicts: [],
    usedCandidateIds: new Set(),
    userDocs: [userDoc],
  });
  assertEquals(statuses[0].status, "missing");
  assertEquals(statuses[0].cited, false);
});

Deno.test("pickAnchorsRequiringDrafterLimitation — definition requires direct statute-section support", () => {
  const statuses = [
    {
      anchor_id: "statute_section:income_tax_ordinance-s32-9",
      description: "הנוסח המחייב של סעיף 32(9) לפקודת מס הכנסה",
      anchor_type: "primary_statute" as const,
      is_docket_anchor: false,
      is_statute_section_anchor: true,
      emitted: true,
      queries: [],
      candidate_ids: ["c1"],
      reached_verifier: true,
      verified_support: "partial" as const,
      cited: false,
      status: "verified_unused" as const,
    },
  ];

  assertEquals(pickMissingAnchors(statuses).length, 0);
  assertEquals(pickAnchorsRequiringDrafterLimitation(statuses, "definition").length, 1);
  assertEquals(pickAnchorsRequiringDrafterLimitation(statuses, "quote").length, 1);
  assertEquals(pickAnchorsRequiringDrafterLimitation(statuses, "analysis").length, 0);
});
