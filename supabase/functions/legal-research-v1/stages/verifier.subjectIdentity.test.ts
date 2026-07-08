import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { enforceSubjectIdentity } from "./verifier.ts";
import type { Candidate, Verdict } from "../lib/types.ts";

function mkCand(overrides: Partial<Candidate> = {}): Candidate {
  return {
    candidate_id: "cand1",
    claim_id: "C1",
    role: "scholarship",
    origin: "local_db",
    retrieval_method: "vector",
    title: "כותרת מקור",
    source_type: "academic",
    document_id: null,
    source_url: null,
    snippet:
      "This is a substantive candidate snippet that comfortably exceeds the landing-page threshold. It describes the specific statute, cites the relevant section, quotes the operative rule, and provides the doctrinal context needed to establish real subject identity with the claim under review by the verifier for the purposes of this unit test.",
    query_he: "q",
    score: 0.9,
    ...overrides,
  };
}

function mkVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    candidate_id: "cand1",
    claim_id: "C1",
    support: "direct",
    role_match: true,
    supported_points: ["p"],
    reason: "המקור עוסק ישירות בטענה",
    ...overrides,
  };
}

Deno.test("wrong_subject forces unrelated regardless of model support", () => {
  const v = mkVerdict({ support: "direct", support_subtype: "wrong_subject" });
  const r = enforceSubjectIdentity(v, mkCand());
  assertEquals(r.verdict.support, "unrelated");
  assertEquals(r.demotion?.rule, "wrong_subject");
  assertEquals(r.demotion?.from, "direct");
});

Deno.test("analogical + direct → partial", () => {
  const v = mkVerdict({ support: "direct", support_subtype: "analogical" });
  const r = enforceSubjectIdentity(v, mkCand());
  assertEquals(r.verdict.support, "partial");
  assertEquals(r.demotion?.rule, "analogical");
});

Deno.test("background + direct → partial", () => {
  const v = mkVerdict({ support: "direct", support_subtype: "background" });
  const r = enforceSubjectIdentity(v, mkCand());
  assertEquals(r.verdict.support, "partial");
  assertEquals(r.demotion?.rule, "background");
});

Deno.test("Hebrew self-contradiction demotes direct → partial", () => {
  const v = mkVerdict({
    support: "direct",
    reason: "המקור אינו עוסק בפקודת מס הכנסה עצמה אלא בחקיקה אחרת",
  });
  const r = enforceSubjectIdentity(v, mkCand());
  assertEquals(r.verdict.support, "partial");
  assertEquals(r.demotion?.rule, "self_contradiction");
});

Deno.test("English self-contradiction demotes direct → partial", () => {
  const v = mkVerdict({
    support: "direct",
    reason: "This article does not address the Income Tax Ordinance directly.",
  });
  const r = enforceSubjectIdentity(v, mkCand());
  assertEquals(r.verdict.support, "partial");
  assertEquals(r.demotion?.rule, "self_contradiction");
});

Deno.test("landing page (empty/thin snippet) + direct → partial", () => {
  const v = mkVerdict({ support: "direct" });
  const cand = mkCand({ snippet: "" });
  const r = enforceSubjectIdentity(v, cand);
  assertEquals(r.verdict.support, "partial");
  assertEquals(r.demotion?.rule, "landing_page");
});

Deno.test("landing page below threshold + direct → partial", () => {
  const v = mkVerdict({ support: "direct" });
  const cand = mkCand({ snippet: "כתב עת למשפט וממשל — אינדקס" });
  const r = enforceSubjectIdentity(v, cand);
  assertEquals(r.verdict.support, "partial");
  assertEquals(r.demotion?.rule, "landing_page");
});

Deno.test("clean direct with matching subject passes through", () => {
  const v = mkVerdict({ support: "direct", support_subtype: "exact_subject" });
  const r = enforceSubjectIdentity(v, mkCand());
  assertEquals(r.verdict.support, "direct");
  assertEquals(r.demotion, null);
});

Deno.test("already-tangential verdict is not promoted or demoted (no subtype)", () => {
  const v = mkVerdict({ support: "tangential" });
  const r = enforceSubjectIdentity(v, mkCand());
  assertEquals(r.verdict.support, "tangential");
  assertEquals(r.demotion, null);
});

Deno.test("already-partial with analogical is not further demoted", () => {
  const v = mkVerdict({ support: "partial", support_subtype: "analogical" });
  const r = enforceSubjectIdentity(v, mkCand());
  assertEquals(r.verdict.support, "partial");
  assertEquals(r.demotion, null);
});

Deno.test("wrong_subject on tangential still forces unrelated", () => {
  const v = mkVerdict({ support: "tangential", support_subtype: "wrong_subject" });
  const r = enforceSubjectIdentity(v, mkCand());
  assertEquals(r.verdict.support, "unrelated");
  assertEquals(r.demotion?.rule, "wrong_subject");
});
