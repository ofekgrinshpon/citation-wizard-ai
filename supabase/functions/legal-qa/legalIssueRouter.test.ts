// Phase 1 tests for the Legal Issue Router.
//
// These tests exercise pure helpers only (no network). The actual model call
// (`routeLegalIssue`) is integration-tested via the eval suite, not here, so
// a missing OPENAI_API_KEY / LOVABLE_API_KEY in CI doesn't fail the suite.

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildDecompositionBias, raceWithTimeout, type LegalIssueRoute } from "./legalIssueRouter.ts";
import type { StageRun } from "./aiProvider.ts";

function fakeRun(status: StageRun["status"] = "success"): StageRun {
  const now = new Date().toISOString();
  return {
    stage: "legal_issue_router",
    provider: "gemini",
    model: "google/gemini-2.5-flash",
    started_at: now,
    completed_at: now,
    duration_ms: 12,
    status,
  };
}

function sampleRoute(): LegalIssueRoute {
  return {
    query_type: "statutory_amendment_comparison",
    legal_domain: "contract_law",
    secondary_domains: [],
    forbidden_domains: ["family_law"],
    forbidden_topics: ["מזונות", "משמורת"],
    target_statute: { name: "חוק החוזים (חלק כללי)", section: null, amendment: "latest" },
    requires_current_context: true,
    ambiguous_terms: { "הפרה": "הפרה חוזית" },
    confidence: 0.82,
    notes: "amendment comparison Q on contract law",
  };
}

Deno.test("buildDecompositionBias: empty when route is null", () => {
  assertEquals(buildDecompositionBias(null), "");
  assertEquals(buildDecompositionBias(undefined), "");
});

Deno.test("buildDecompositionBias: includes domain, statute, forbidden topics, ambiguity", () => {
  const text = buildDecompositionBias(sampleRoute());
  assertStringIncludes(text, "תחום משפטי עיקרי: contract_law");
  assertStringIncludes(text, "חוק יעד: חוק החוזים (חלק כללי)");
  assertStringIncludes(text, "(התיקון האחרון)");
  assertStringIncludes(text, "להימנע מסטייה לנושאים: מזונות, משמורת");
  assertStringIncludes(text, "הפרה → הפרה חוזית");
});

Deno.test("buildDecompositionBias: skips empty fields gracefully", () => {
  const minimal: LegalIssueRoute = {
    query_type: "doctrinal",
    legal_domain: "unknown",
    secondary_domains: [],
    forbidden_domains: [],
    forbidden_topics: [],
    target_statute: { name: null, section: null, amendment: null },
    requires_current_context: false,
    ambiguous_terms: {},
    confidence: 0.4,
    notes: "",
  };
  assertEquals(buildDecompositionBias(minimal), "");
});

Deno.test("raceWithTimeout: returns the underlying result when fast", async () => {
  const fastPromise = Promise.resolve({ data: { ok: 1 }, run: fakeRun("success") });
  const result = await raceWithTimeout(fastPromise, 1000, "legal_issue_router");
  assertEquals(result.timed_out, false);
  assertEquals(result.data, { ok: 1 });
  assertEquals(result.run.status, "success");
});

Deno.test("raceWithTimeout: synthesizes a timeout StageRun when slow", async () => {
  let slowTimer: number | undefined;
  const slow = new Promise<{ data: null; run: StageRun }>((resolve) => {
    slowTimer = setTimeout(() => resolve({ data: null, run: fakeRun("success") }), 200) as unknown as number;
  });
  const result = await raceWithTimeout(slow, 30, "legal_issue_router");
  if (slowTimer !== undefined) clearTimeout(slowTimer);
  assertEquals(result.timed_out, true);
  assertEquals(result.data, null);
  assertEquals(result.run.status, "timeout");
  assertStringIncludes(result.run.error_message ?? "", "wall-clock timeout");
});

Deno.test("raceWithTimeout: catches rejected promises into a synthesized error run", async () => {
  const failing = Promise.reject(new Error("boom"));
  const result = await raceWithTimeout(
    failing as unknown as Promise<{ data: null; run: StageRun }>,
    1000,
    "legal_issue_router",
  );
  assertEquals(result.timed_out, false);
  assertEquals(result.data, null);
  assertEquals(result.run.status, "error");
  assertStringIncludes(result.run.error_message ?? "", "boom");
});
