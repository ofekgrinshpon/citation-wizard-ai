/**
 * The compiled citation-chat handler and the real runForeignLookup.
 * Network, auth, database and environment are fixtures. The handler,
 * bindFreeformLookup and the lookup are not stubbed.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TextEncoder } from "node:util";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { citationTextOnly } from "@/lib/citationSegments";
import { CHAT_HOST, foreignFreeformSourceType, planCitationEvidence, planLocalCitation, planTypedRequest, resolveCitationResponse, selectForeignCaseChoice } from "@/lib/citationPlanner";
import * as articles from "../../supabase/functions/_shared/hebrewArticleEvidence";
import * as dockets from "../../supabase/functions/_shared/caseTypePrefixes";
import * as pastedCitation from "../../supabase/functions/_shared/pastedCitation";
import * as hosts from "../../supabase/functions/_shared/trustedHosts";
import * as caseLawQuery from "../../supabase/functions/_shared/caseLawQuery";
import * as ranges from "../../supabase/functions/_shared/hebrewNumberRange";
import * as editors from "../../supabase/functions/_shared/articleCitationValidator";
import * as knesset from "../../supabase/functions/_shared/knessetTerms";
import * as diagnostic from "../../supabase/functions/_shared/citationDiagnostic";
import * as recovery from "../../supabase/functions/_shared/citationRecovery";
import * as diagnosticGate from "../../supabase/functions/_shared/citationDiagnosticGate";
import * as bookFinal from "../../supabase/functions/_shared/citationPure/bookFinal";
import * as freeformInterpret from "../../supabase/functions/_shared/citationPure/freeformInterpret";
import * as statuteRoute from "../../supabase/functions/citation-chat/statuteRoute";
import { articleLookupFallback, runForeignLookup } from "../../supabase/functions/citation-chat/foreignLookup";
import { installFreeformParserTransportForTests } from "../../supabase/functions/_shared/citationPure/freeformInterpret";

const source = readFileSync(resolve(__dirname, "../../supabase/functions/citation-chat/index.ts"), "utf8");
const compile = (input: string) => ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const guardContext = createContext({ exports: {}, crypto: webcrypto, TextEncoder, Uint8Array,
  require: (name: string) => { if (name === "node:async_hooks") return { AsyncLocalStorage }; if (name === "./citationRecovery.ts") return recovery; throw new Error(name); },
});
runInContext(compile(readFileSync(resolve(__dirname, "../../supabase/functions/_shared/citationUsageGuard.ts"), "utf8")), guardContext);

type Hit = { title: string; url: string; snippet: string };
type Handler = (req: Request) => Promise<Response>;

let handler: Handler;
const calls: Array<{ url: string; body: string }> = [];
let script: { hits: Hit[]; page: string | null; throwOnSearch: number | null; searches: number };

function installHandler() {
  const modules: Record<string, unknown> = {
    "https://deno.land/std@0.168.0/http/server.ts": { serve: (fn: Handler) => { handler = fn; } },
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => ({
      auth: { getClaims: async () => ({ data: { claims: { sub: "test-user" } }, error: null }) },
      rpc: async (name: string, args: Record<string, unknown>) => ({ data: name === "begin_citation_request"
        ? { ok: true, execute: true, status: "in_progress", request_id: args._request_id, retry_of_request_id: args._retry_of_request_id ?? null, attempt_token: "fixture-attempt-token" }
        : name === "finish_citation_request" ? { ok: true, status: args._outcome, result_stored: true, refunded: false, refund_receipt: { status: "not_applicable", refunded: false, units_refunded: 0, request_id: args._request_id } }
        : { ok: true }, error: null }),
      from: () => { const chain = { select: () => chain, eq: () => chain, or: () => chain, abortSignal: () => chain, limit: async () => ({ data: [] }), maybeSingle: async () => ({ data: null, error: null }) }; return chain; },
    }) },
    "../_shared/costTelemetry.ts": { trackedFetch: async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? "") });
      if (url.includes("ai.gateway.lovable.dev")) return new Response(JSON.stringify({ choices: [{ message: { content: "formatter-fixture" } }] }), { status: 200 });
      if (url.includes("api.perplexity.ai/search")) {
        script.searches += 1;
        if (script.throwOnSearch === script.searches) throw new Error("socket hang up");
        return new Response(JSON.stringify({ results: script.hits }), { status: 200 });
      }
      if (script.page === null) throw new Error("page fetch was not part of this fixture");
      return new Response(script.page, { status: 200 });
    }, withCostTelemetry: (_name: string, fn: () => unknown) => fn(), setTelemetryFromBody: () => {}, recordZeroWork: () => {} },
    "../_shared/hebrewArticleEvidence.ts": articles,
    "../_shared/caseTypePrefixes.ts": dockets,
    "../_shared/pastedCitation.ts": pastedCitation,
    "../_shared/trustedHosts.ts": hosts,
    "../_shared/caseLawQuery.ts": caseLawQuery,
    "../_shared/hebrewNumberRange.ts": ranges,
    "../_shared/articleCitationValidator.ts": editors,
    "../_shared/knessetTerms.ts": knesset,
    "../_shared/citationUsageGuard.ts": guardContext.exports,
    "../_shared/citationRecovery.ts": recovery,
    "../_shared/citationDiagnostic.ts": diagnostic,
    "../_shared/citationDiagnosticGate.ts": diagnosticGate,
    "./foreignLookup.ts": { runForeignLookup, articleLookupFallback },
    "./statuteRoute.ts": statuteRoute,
    "../_shared/citationPure/bookFinal.ts": bookFinal,
    "../_shared/citationPure/freeformInterpret.ts": freeformInterpret,
  };
  runInContext(compile(source), createContext({ exports: {}, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected real module boundary: ${name}`);
    return modules[name];
  }, console: { log: () => {}, error: () => {}, warn: () => {} }, URL, Request, Response, Headers, crypto: webcrypto, TextEncoder,
  Deno: { env: { get: (name: string) => name === "CITATION_CHAT_OPENWEB_FALLBACK" ? "off" : "mock-only" } },
  fetch: () => { throw new Error("Unmocked network is prohibited"); },
  }));
}

function reset(next: Partial<typeof script> = {}) {
  calls.length = 0;
  script = { hits: [], page: null, throwOnSearch: null, searches: 0, ...next };
}

function planned(raw: string) {
  const sourceType = foreignFreeformSourceType(raw);
  const evidence = planCitationEvidence(raw, null);
  const input = { evidence, sourceType, input: raw, isPinpoint: false, manual: false };
  const local = planLocalCitation(input, CHAT_HOST);
  if ("resolution" in local) return { local: local.resolution, typed: null };
  return { local: null, typed: planTypedRequest({ ...input, statutePrep: local.statutePrep, canonicalRaw: raw }, CHAT_HOST) };
}

async function post(raw: string, foreignLookup: unknown, requestId = "handler-fixture-0001") {
  const response = await handler(new Request("https://local.test/citation-chat", {
    method: "POST",
    headers: { Authorization: "Bearer mock-token", "Content-Type": "application/json" },
    body: JSON.stringify({
      citationRequestVersion: 3, requestId, messages: [{ role: "user", content: raw }], rawInput: raw,
      ...(foreignLookup ? { foreignLookup } : {}),
    }),
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function searchCalls() {
  return calls.filter((call) => call.url.includes("api.perplexity.ai/search"));
}
function gatewayCalls() {
  return calls.filter((call) => call.url.includes("ai.gateway.lovable.dev"));
}

afterAll(() => installFreeformParserTransportForTests(null));

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
  installHandler();
});

describe("real citation-chat handler", () => {
  it("cites the matching Smith edition and does not call the formatter", async () => {
    reset({ hits: [
      { title: "National Identity", url: "https://press.example.edu/joan", snippet: "Joan Other, National Identity (2001)." },
      { title: "National Identity — Anthony D. Smith", url: "https://press.example.edu/smith", snippet: "Anthony D. Smith, National Identity (1991)." },
    ] });
    const raw = "National identity by Smith, Anthony D";
    const plan = planned(raw);
    const posted = await post(raw, plan.typed?.foreignLookup);
    expect(posted.status).toBe(200);
    expect(gatewayCalls()).toHaveLength(0);
    expect(searchCalls().length).toBeGreaterThan(0);
    expect(searchCalls().length).toBeLessThanOrEqual(2);
    const chat = resolveCitationResponse(plan.typed!, { foreignLookup: posted.body.foreignLookup }, CHAT_HOST);
    expect(chat.kind).toBe("terminal");
    if (chat.kind !== "terminal") return;
    const text = citationTextOnly(chat.resolution.citation);
    expect(text).toContain("Smith, Anthony D");
    expect(text).toContain("National identity");
    expect(text).toContain("1991");
    expect(text).not.toContain("2001");
    expect(text).not.toContain("Joan");
    const lookup = posted.body.foreignLookup as { fields: Record<string, string>; identity: { matched: boolean } };
    expect(lookup.identity.matched).toBe(true);
    expect(lookup.fields.year).toBe("1991");
    expect(lookup.fields.publisher).toBeUndefined();
  });

  it("does not ground a year for Anthony J. Smith or a page that names a different author", async () => {
    reset({ hits: [{ title: "National Identity — Anthony J. Smith", url: "https://press.example.edu/j", snippet: "Anthony J. Smith, National Identity (1980)." }] });
    const raw = "National Identity by Anthony Smith";
    const plan = planned(raw);
    const ambiguous = await post(raw, plan.typed?.foreignLookup, "handler-fixture-0002");
    expect(gatewayCalls()).toHaveLength(0);
    const lookup = ambiguous.body.foreignLookup as { fields: Record<string, string> };
    expect(lookup.fields.year).toBeUndefined();
    expect(JSON.stringify(lookup.fields)).not.toContain("1980");

    reset({
      hits: [{ title: "National Identity — Anthony Smith", url: "https://press.example.edu/page", snippet: "A catalog entry for Anthony Smith." }],
      page: "Anthony J. Smith, National Identity (3rd ed. 1970).",
    });
    const paged = await post(raw, plan.typed?.foreignLookup, "handler-fixture-0003");
    expect(searchCalls()).toHaveLength(1);
    expect(calls.filter((call) => call.url.includes("press.example.edu"))).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(gatewayCalls()).toHaveLength(0);
    const pageLookup = paged.body.foreignLookup as { fields: Record<string, string> };
    expect(pageLookup.fields.year).toBeUndefined();
    expect(pageLookup.fields.edition).toBeUndefined();
  });

  it("accepts Smith, Anthony and Hart, H.L.A. from the handler lookup", async () => {
    reset({ hits: [{ title: "National Identity — Anthony Smith", url: "https://press.example.edu/smith", snippet: "Anthony Smith, National Identity (1991)." }] });
    const smith = "National identity by Smith, Anthony";
    const smithPlan = planned(smith);
    expect(smithPlan.typed?.foreignLookup).toBeUndefined();
    const smithPosted = await post(smith, { enabled: true, freeformHandoff: true, kind: "book", jurisdiction: "OTHER", rawInput: smith, parsedFields: { bookTitle: "National identity", authors: "Smith, Anthony" } }, "handler-fixture-0004");
    expect(gatewayCalls()).toHaveLength(0);
    expect(searchCalls()).toHaveLength(0);
    expect(smithPosted.body.foreignLookup).toBeUndefined();
    expect(String(smithPosted.body.content ?? "")).not.toContain("1991");

    reset({ hits: [{ title: "Privacy — Louis Warren", url: "https://press.example.edu/warren", snippet: "Louis Warren, Privacy (1990)." }] });
    const warren = "Privacy by Warren, Louis";
    const warrenPosted = await post(warren, { enabled: true, freeformHandoff: true, kind: "book", jurisdiction: "OTHER", rawInput: warren, parsedFields: { bookTitle: "Privacy", authors: "Warren, Louis" } }, "handler-fixture-0004b");
    expect(searchCalls()).toHaveLength(0);
    expect(gatewayCalls()).toHaveLength(0);
    expect(String(warrenPosted.body.content ?? "")).not.toContain("1990");

    reset({ hits: [{ title: "The Concept of Law — H.L.A. Hart", url: "https://press.example.edu/hart", snippet: "H.L.A. Hart, The Concept of Law (1961)." }] });
    const hart = "The Concept of Law by Hart, H.L.A.";
    const hartPlan = planned(hart);
    const hartPosted = await post(hart, hartPlan.typed?.foreignLookup, "handler-fixture-0005");
    expect((hartPosted.body.foreignLookup as { fields: { year?: string } }).fields.year).toBe("1961");
    expect(gatewayCalls()).toHaveLength(0);
  });

  it("does not treat a same-year edition on a second record as the shared edition", async () => {
    reset({ hits: [
      { title: "National Identity", url: "https://press.example.edu/a", snippet: "Anthony D. Smith, National Identity (1991)." },
      { title: "National Identity", url: "https://press.example.edu/b", snippet: "Anthony D. Smith, National Identity (2nd ed. 1991)." },
    ] });
    const raw = "National identity by Smith, Anthony D";
    const plan = planned(raw);
    const posted = await post(raw, plan.typed?.foreignLookup, "handler-fixture-0006");
    const lookup = posted.body.foreignLookup as { fields: Record<string, string>; provenance: Record<string, unknown> };
    expect(lookup.fields.year).toBe("1991");
    expect(lookup.fields.edition).toBeUndefined();
    expect(lookup.provenance.edition).toBeUndefined();
    expect(searchCalls()).toHaveLength(1);
    expect(gatewayCalls()).toHaveLength(0);
  });

  it("does not fetch a page after two searches and does not retry an unknown search", async () => {
    reset();
    const raw = "National identity by Smith, Anthony D";
    const plan = planned(raw);
    await post(raw, plan.typed?.foreignLookup, "handler-fixture-0007");
    expect(searchCalls()).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(gatewayCalls()).toHaveLength(0);

    reset({ throwOnSearch: 1, page: "Anthony D. Smith, National Identity (1991)." });
    await post(raw, plan.typed?.foreignLookup, "handler-fixture-0008");
    expect(searchCalls()).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(gatewayCalls()).toHaveLength(0);
  });

  it("formats a chosen case report with no further retrieval", async () => {
    reset({ hits: [{ title: "Donoghue v Stevenson [1932] UKHL 100 (26 May 1932)", url: "https://www.bailii.org/uk/cases/UKHL/1932/100.html", snippet: "Donoghue v Stevenson [1932] UKHL 100, [1932] AC 562, 1932 SC (HL) 31." }] });
    const raw = "Donoghue v Stevenson";
    const evidence = planCitationEvidence(raw, null);
    const base = { evidence, sourceType: "foreign" as const, input: raw, isPinpoint: false, manual: false };
    const local = planLocalCitation(base, CHAT_HOST);
    const typed = planTypedRequest({ ...base, statutePrep: "statutePrep" in local ? local.statutePrep : null, canonicalRaw: raw }, CHAT_HOST);
    const posted = await post(raw, typed.foreignLookup, "handler-fixture-0009");
    expect(gatewayCalls()).toHaveLength(0);
    expect(searchCalls().length).toBeLessThanOrEqual(2);
    const before = calls.length;
    const chat = resolveCitationResponse(typed, { foreignLookup: posted.body.foreignLookup }, CHAT_HOST);
    expect(chat.kind).toBe("terminal");
    if (chat.kind !== "terminal") return;
    const picked = chat.resolution.foreignChoice?.options.find((option) => option.label.includes("SC (HL)"));
    expect(picked).toBeTruthy();
    const chosen = selectForeignCaseChoice(chat.resolution.foreignChoice!, picked!.id, [raw], CHAT_HOST);
    expect(chosen.kind).toBe("resolved");
    if (chosen.kind !== "resolved") return;
    expect(citationTextOnly(chosen.resolution.citation)).toContain("1932 SC (HL) 31");
    expect(calls).toHaveLength(before);
  });

  it("sends a Hebrew-wrapped foreign case through the case lookup and an article through the article lookup", async () => {
    reset({ hits: [{ title: "Donoghue v Stevenson [1932] UKHL 100 (26 May 1932)", url: "https://www.bailii.org/uk/cases/UKHL/1932/100.html", snippet: "Donoghue v Stevenson [1932] UKHL 100, [1932] AC 562, 1932 SC (HL) 31." }] });
    const raw = "הספר Donoghue v Stevenson";
    const plan = planned(raw);
    expect(plan.typed?.foreignLookup?.kind).toBe("case");
    const posted = await post(raw, plan.typed?.foreignLookup, "handler-fixture-0010");
    expect(gatewayCalls()).toHaveLength(0);
    const lookup = posted.body.foreignLookup as { kind: string; identity: { anchors: string[] }; locationChoiceRequired?: boolean };
    expect(lookup.kind).toBe("case");
    expect(JSON.stringify(lookup.identity.anchors)).toContain("donoghue v stevenson");
    expect(JSON.stringify(lookup.identity.anchors)).not.toMatch(/הספר/);
    const before = calls.length;
    const chat = resolveCitationResponse(plan.typed!, { foreignLookup: posted.body.foreignLookup }, CHAT_HOST);
    expect(chat.kind).toBe("terminal");
    if (chat.kind !== "terminal") return;
    expect(chat.resolution.foreignChoice?.options.length).toBeGreaterThan(1);
    const picked = chat.resolution.foreignChoice!.options.find((option) => option.label.includes("SC (HL)"))!;
    const chosen = selectForeignCaseChoice(chat.resolution.foreignChoice!, picked.id, [raw], CHAT_HOST);
    expect(chosen.kind).toBe("resolved");
    if (chosen.kind !== "resolved") return;
    expect(citationTextOnly(chosen.resolution.citation)).toContain("1932 SC (HL) 31");
    expect(calls).toHaveLength(before);

    reset({ hits: [{ title: "The Path of the Law — Oliver Wendell Holmes", url: "https://lawreview.example.edu/path", snippet: "Oliver Wendell Holmes, The Path of the Law, 10 Harvard Law Review 457 (1897)." }] });
    const article = "The Path of the Law by Holmes, Oliver Wendell, Harvard Law Review";
    const articlePlan = planned(article);
    const articlePosted = await post(article, articlePlan.typed?.foreignLookup, "handler-fixture-0011");
    expect(gatewayCalls()).toHaveLength(0);
    const articleLookup = articlePosted.body.foreignLookup as { fields: Record<string, string> };
    expect(articleLookup.fields.year).toBe("1897");
    expect(articleLookup.fields.firstPage).toBe("457");
    const articleChat = resolveCitationResponse(articlePlan.typed!, { foreignLookup: articlePosted.body.foreignLookup }, CHAT_HOST);
    expect(articleChat.kind).toBe("terminal");
    if (articleChat.kind !== "terminal") return;
    const articleText = citationTextOnly(articleChat.resolution.citation);
    expect(articleText).toContain("1897");
    expect(articleText).toContain("Harv. L. Rev.");
    expect(articleText).not.toContain("1901");
  });

  it("does not turn an Israeli docket into a free-form book lookup", async () => {
    reset({ page: "" });
    const raw = "ע\"א 240/95";
    const posted = await post(raw, undefined, "handler-fixture-0012");
    expect(planned(raw).typed?.foreignLookup ?? null).toBeNull();
    expect(searchCalls()).toHaveLength(0);
    expect(JSON.stringify(posted.body)).not.toContain("freeformHandoff");
    expect(JSON.stringify(posted.body.foreignLookup ?? {})).not.toContain("National identity");
    for (const call of gatewayCalls()) expect(call.body).not.toContain("gemini-3.8-flash");
    for (const call of gatewayCalls()) expect(call.body).toContain("google/gemini-2.5-flash");
  });
});

describe("wired parser stays off unless a test transport is installed", () => {
  const prose = "Anthony D. Smith wrote the book National Identity.";
  const bookPayload = {
    kind: "book",
    fields: {
      bookTitle: { value: "National Identity", quote: "National Identity" },
      authors: { value: "Anthony D. Smith", quote: "Anthony D. Smith" },
      year: { value: "1991", quote: "1991" },
    },
  };
  let parserCalls = 0;

  function install(body: unknown, fail = false) {
    parserCalls = 0;
    installFreeformParserTransportForTests(async (request) => {
      parserCalls += 1;
      expect(request.model).toBe("google/gemini-3.8-flash");
      expect(request.endpoint).toBe("https://ai.gateway.lovable.dev/v1/chat/completions");
      if (fail) throw new Error("socket hang up");
      return { status: 200, text: typeof body === "string" ? body : JSON.stringify(body) };
    });
  }

  afterAll(() => installFreeformParserTransportForTests(null));

  it("does not call the parser for a deterministic book, and does not call it when the gate is off", async () => {
    install(bookPayload);
    reset({ hits: [{ title: "National Identity — Anthony D. Smith", url: "https://press.example.edu/smith", snippet: "Anthony D. Smith, National Identity (1991)." }] });
    const raw = "National identity by Smith, Anthony D";
    const plan = planned(raw);
    const posted = await post(raw, plan.typed?.foreignLookup, "handler-parser-0001");
    expect(parserCalls).toBe(0);
    expect(gatewayCalls()).toHaveLength(0);
    expect((posted.body.foreignLookup as { fields: { year?: string } }).fields.year).toBe("1991");

    installFreeformParserTransportForTests(null);
    parserCalls = 0;
    reset({ hits: [] });
    const off = await post(prose, { enabled: true, freeformHandoff: true, kind: "book", jurisdiction: "OTHER", rawInput: prose, parsedFields: { bookTitle: "National Identity", authors: "Anthony D. Smith" } }, "handler-parser-0002");
    expect(parserCalls).toBe(0);
    expect(searchCalls()).toHaveLength(0);
    expect(gatewayCalls()).toHaveLength(0);
    expect(String(off.body.content ?? "")).not.toContain("1991");
  });

  it("grounds a prose book from quoted model fields and does not call the formatter", async () => {
    install(bookPayload);
    reset({ hits: [
      { title: "National Identity", url: "https://press.example.edu/joan", snippet: "Joan Other, National Identity (2001)." },
      { title: "National Identity — Anthony D. Smith", url: "https://press.example.edu/smith", snippet: "Anthony D. Smith, National Identity (1991)." },
    ] });
    const posted = await post(prose, { enabled: true, freeformHandoff: true, kind: "book", jurisdiction: "OTHER", rawInput: prose, parsedFields: { year: "1800" } }, "handler-parser-0003");
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(parserCalls).toBe(1);
    expect(gatewayCalls()).toHaveLength(0);
    expect(searchCalls().length).toBeGreaterThan(0);
    expect(searchCalls().length).toBeLessThanOrEqual(2);
    const lookup = posted.body.foreignLookup as { fields: Record<string, string>; identity: { matched: boolean } };
    expect(lookup.identity.matched).toBe(true);
    expect(lookup.fields.year).toBe("1991");
    expect(lookup.fields.publisher).toBeUndefined();
    const chat = resolveCitationResponse(planned("National identity by Anthony D. Smith").typed!, { foreignLookup: posted.body.foreignLookup }, CHAT_HOST);
    expect(chat.kind).toBe("terminal");
    if (chat.kind !== "terminal") return;
    const text = citationTextOnly(chat.resolution.citation);
    expect(text).toContain("1991");
    expect(text.toLowerCase()).toContain("national identity");
    expect(text).not.toContain("2001");
    expect(text).not.toContain("Joan");
    expect(text).not.toContain("Polity");
  });

  it("drops a malformed model payload and does not fall through to the formatter", async () => {
    install("not-json");
    reset({ hits: [{ title: "National Identity", url: "https://press.example.edu/smith", snippet: "Anthony D. Smith, National Identity (1991)." }] });
    const posted = await post(prose, { enabled: true, freeformHandoff: true, kind: "book", jurisdiction: "OTHER", rawInput: prose, parsedFields: {} }, "handler-parser-0004");
    expect(parserCalls).toBe(1);
    expect(searchCalls()).toHaveLength(0);
    expect(gatewayCalls()).toHaveLength(0);
    expect(posted.body.foreignLookup).toBeUndefined();
  });

  it("does not retry or call the formatter when the parser outcome is unknown", async () => {
    install(bookPayload, true);
    reset({ hits: [{ title: "National Identity", url: "https://press.example.edu/smith", snippet: "Anthony D. Smith, National Identity (1991)." }] });
    const posted = await post(prose, { enabled: true, freeformHandoff: true, kind: "book", jurisdiction: "OTHER", rawInput: prose, parsedFields: {} }, "handler-parser-0005");
    expect(parserCalls).toBe(1);
    expect(searchCalls()).toHaveLength(0);
    expect(gatewayCalls()).toHaveLength(0);
    expect(String(posted.body.content ?? "")).not.toContain("1991");
  });

  it("does not let the model certify an ambiguous byline or an Israeli docket", async () => {
    install({ kind: "book", fields: { bookTitle: { value: "Privacy", quote: "Privacy" }, authors: { value: "Louis Warren", quote: "Louis Warren" }, year: { value: "1990", quote: "1990" } } });
    reset({ hits: [{ title: "Privacy — Louis Warren", url: "https://press.example.edu/warren", snippet: "Louis Warren, Privacy (1990)." }] });
    const warren = "Privacy by Warren, Louis";
    const posted = await post(warren, { enabled: true, freeformHandoff: true, kind: "book", jurisdiction: "OTHER", rawInput: warren, parsedFields: { authors: "Louis Warren" } }, "handler-parser-0006");
    expect(parserCalls).toBe(0);
    expect(searchCalls()).toHaveLength(0);
    expect(String(posted.body.content ?? "")).not.toContain("1990");

    const israeli = await post("ע\"א 240/95", { enabled: true, freeformHandoff: true, kind: "book", jurisdiction: "OTHER", rawInput: "ע\"א 240/95", parsedFields: { bookTitle: "National Identity" } }, "handler-parser-0007");
    expect(parserCalls).toBe(0);
    expect(searchCalls()).toHaveLength(0);
    expect(JSON.stringify(israeli.body.foreignLookup ?? {})).not.toContain("National Identity");
  });

  it("sends a prose case and a prose article through lookup without a formatter call", async () => {
    install({ kind: "case", fields: { caseName: { value: "Donoghue v Stevenson", quote: "Donoghue v Stevenson" }, year: { value: "1932", quote: "1932" } } });
    reset({ hits: [{ title: "Donoghue v Stevenson [1932] UKHL 100 (26 May 1932)", url: "https://www.bailii.org/uk/cases/UKHL/1932/100.html", snippet: "Donoghue v Stevenson [1932] UKHL 100, [1932] AC 562, 1932 SC (HL) 31." }] });
    const caseRaw = "Readers still discuss Donoghue v Stevenson.";
    const casePosted = await post(caseRaw, { enabled: true, freeformHandoff: true, kind: "case", jurisdiction: "UNKNOWN", rawInput: caseRaw, parsedFields: {} }, "handler-parser-0008");
    expect(parserCalls).toBe(1);
    expect(gatewayCalls()).toHaveLength(0);
    expect(searchCalls().length).toBeLessThanOrEqual(2);
    const before = calls.length;
    const chat = resolveCitationResponse(planned("Donoghue v Stevenson").typed!, { foreignLookup: casePosted.body.foreignLookup }, CHAT_HOST);
    expect(chat.kind).toBe("terminal");
    if (chat.kind !== "terminal") return;
    const picked = chat.resolution.foreignChoice?.options.find((option) => option.label.includes("SC (HL)"));
    expect(picked).toBeTruthy();
    const chosen = selectForeignCaseChoice(chat.resolution.foreignChoice!, picked!.id, ["Donoghue v Stevenson"], CHAT_HOST);
    expect(chosen.kind).toBe("resolved");
    expect(calls).toHaveLength(before);

    install({ kind: "journal_article", fields: {
      articleTitle: { value: "The Path of the Law", quote: "The Path of the Law" },
      authors: { value: "Oliver Wendell Holmes", quote: "Oliver Wendell Holmes" },
      journal: { value: "Harvard Law Review", quote: "Harvard Law Review" },
      year: { value: "1901", quote: "1901" },
    } });
    reset({ hits: [{ title: "The Path of the Law — Oliver Wendell Holmes", url: "https://lawreview.example.edu/path", snippet: "Oliver Wendell Holmes, The Path of the Law, 10 Harvard Law Review 457 (1897)." }] });
    const articleRaw = "Oliver Wendell Holmes published The Path of the Law in the Harvard Law Review.";
    const articlePosted = await post(articleRaw, { enabled: true, freeformHandoff: true, articleResponseVersion: 1, kind: "journal_article", jurisdiction: "OTHER", rawInput: articleRaw, parsedFields: { year: "1901" } }, "handler-parser-0009");
    expect(parserCalls).toBe(1);
    expect(gatewayCalls()).toHaveLength(0);
    const articleLookup = articlePosted.body.foreignLookup as { fields: Record<string, string> };
    expect(articleLookup.fields.year).toBe("1897");
    expect(articleLookup.fields.year).not.toBe("1901");
  });
});
