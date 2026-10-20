import { AsyncLocalStorage } from "node:async_hooks";
import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as articles from "../../supabase/functions/_shared/hebrewArticleEvidence";
import * as dockets from "../../supabase/functions/_shared/caseTypePrefixes";
import * as hosts from "../../supabase/functions/_shared/trustedHosts";
import * as caseLawQuery from "../../supabase/functions/_shared/caseLawQuery";
import * as ranges from "../../supabase/functions/_shared/hebrewNumberRange";
import * as editors from "../../supabase/functions/_shared/articleCitationValidator";
import * as knesset from "../../supabase/functions/_shared/knessetTerms";
import * as usage from "../../supabase/functions/_shared/usageWeights";
import * as diagnostic from "../../supabase/functions/_shared/citationDiagnostic";
import * as recovery from "../../supabase/functions/_shared/citationRecovery";
import * as diagnosticGate from "../../supabase/functions/_shared/citationDiagnosticGate";
import { buildForeignArticleRequest } from "@/lib/foreignArticleAdapter";
import { articleLookupFallback, runForeignLookup as actualForeignLookup, type ForeignLookupInput, type LookupDeps } from "../../supabase/functions/citation-chat/foreignLookup";
import { buildEnginePromptHint } from "@/lib/citationValidation";
import * as statuteRoute from "../../supabase/functions/citation-chat/statuteRoute";
import { CITATION_RULES } from "@/data/citationEngine";

const natural = "המאמר של דפנה ברק־ארז על כתיבה שיפוטית, בעמודים 291 עד 293.";
const right = 'דפנה ברק-ארז "כתיבה שיפוטית" משפטים מו 269 (תשע״ז)';
const wrong = 'דפנה ברק-ארז "כתיבה שיפוטית" משפטים מח 291 (2018)';
const proposed = { found: true, articleTitle: "כתיבה שיפוטית", author: "דפנה ברק-ארז", journalName: "משפטים", volume: "מח", firstPage: "291", year: 2018 };
const result = (snippet = right, title = "כתיבה שיפוטית") => ({ title, snippet, url: "https://lawjournal.huji.ac.il/article/example", date: "2018-02-26" });
const request = (raw = natural) => articles.createHebrewArticleRequest(raw);
const resolveArticle = (snippets: string[], raw = natural) => articles.resolveHebrewArticle(request(raw), articles.collectHebrewArticleEvidence(request(raw), proposed, snippets.map(s => result(s))));

describe("Hebrew article evidence records", () => {
  it("recovers the publication tuple from the requested work, not the model answer", () => {
    const r = resolveArticle([right]);
    expect(r.fields).toMatchObject({ author: "דפנה ברק־ארז", articleTitle: "כתיבה שיפוטית", journalName: "משפטים", volume: "מו", firstPage: "269", hebrewYear: "תשע״ז" });
    expect(r.fields.year).toBeUndefined();
    expect(r.request.pinpoint).toBe("291–293");
    expect(r.provenance.firstPage?.status).toBe("evidence");
  });

  it("accepts a compact own-record header with printed Hebrew year", () => {
    const r = resolveArticle(["כתיבה שיפוטית דפנה ברק-ארז משפטים מו 269 תשע״ז"]);
    expect(r.fields).toMatchObject({ volume: "מו", firstPage: "269", hebrewYear: "תשע״ז" });
    expect(r.fields.year).toBeUndefined();
  });

  it("retains useful own-record partial fields without requiring all fields", () => {
    const r = resolveArticle(["מאת: דפנה ברק-ארז; כתב עת: משפטים; כרך: מו"]);
    expect(r.fields).toMatchObject({ articleTitle: "כתיבה שיפוטית", journalName: "משפטים", volume: "מו" });
    expect(r.fields.firstPage).toBeUndefined();
    expect(articles.renderHebrewArticle(r)).toContain("[חסר: עמוד ראשון]");
  });

  it("does not borrow header fields from an article that only mentions the target", () => {
    const rows = [{ ...result("דפנה ברק-ארז כתיבה שיפוטית מוזכר כאן.\nכתב עת: המשפט\nכרך: מח\nעמוד ראשון: 291\nשנה: 2018"), title: "הערות על שופטים" }];
    const r = articles.resolveHebrewArticle(request(), articles.collectHebrewArticleEvidence(request(), proposed, rows));
    expect(r.matched).toBe(false);
    expect(r.fields).toEqual({ author: "דפנה ברק־ארז" });
  });

  it("can use a coherent full citation in a citing work without its header metadata", () => {
    const rows = [result(`כתב עת: המשפט; כרך: מח; שנה: 2018\n${right}`, "הערות על שופטים")];
    const r = articles.resolveHebrewArticle(request(), articles.collectHebrewArticleEvidence(request(), proposed, rows));
    expect(r.fields).toMatchObject({ volume: "מו", firstPage: "269", hebrewYear: "תשע״ז" });
    expect(r.fields.year).toBeUndefined();
  });

  it("keeps conflicting recovered fields unresolved and keeps nonconflicting fields", () => {
    const r = resolveArticle([right, wrong]);
    expect(r.fields.journalName).toBe("משפטים");
    expect(r.fields.volume).toBeUndefined();
    expect(r.fields.firstPage).toBeUndefined();
    expect(r.conflicts).toEqual(expect.arrayContaining(["volume", "firstPage"]));
    expect(r.fields.year).toBeUndefined();
    expect(r.fields.hebrewYear).toBeUndefined();
  });

  it("preserves complete supplied metadata and multiple authors even when sources conflict", () => {
    const raw = 'יעל כהן ואורי לוי "שוויון במשפט" **עיוני משפט** לד(2) 183, 183–185 (2011).';
    const req = request(raw);
    const rows = articles.collectHebrewArticleEvidence(req, {}, [result('יעל כהן ואורי לוי "שוויון במשפט" עיוני משפט לה 190 (2012)', "שוויון במשפט")]);
    const r = articles.resolveHebrewArticle(req, rows);
    expect(articles.renderHebrewArticle(r)).toContain('יעל כהן ואורי לוי "שוויון במשפט" **עיוני משפט** לד(2) 183, 183–185 (2011).');
    expect(r.provenance.year?.status).toBe("supplied");
  });

  it("allows opening page to equal a requested pinpoint when evidence supports it", () => {
    const r = resolveArticle([right], "המאמר של דפנה ברק־ארז על כתיבה שיפוטית, בעמוד 269.");
    expect(r.fields.firstPage).toBe("269");
    expect(articles.renderHebrewArticle(r)).toContain("269, 269");
  });

  it("rejects another work by the same author and another author of the same title", () => {
    expect(resolveArticle(['דפנה ברק-ארז "מחשבות על המשפט" משפטים מו 269 (2017)']).matched).toBe(false);
    expect(resolveArticle(['רונית כהן "כתיבה שיפוטית" משפטים מו 269 (2017)']).matched).toBe(false);
  });

  it("never treats a page timestamp or loose numbers as publication metadata", () => {
    const r = resolveArticle(["מאת: דפנה ברק-ארז; כתב עת: משפטים\nעודכן בתאריך 26.02.2018. באתר 291 ביקורים וכרכים רבים."]);
    expect(r.fields.year).toBeUndefined();
    expect(r.fields.firstPage).toBeUndefined();
    expect(r.fields.volume).toBeUndefined();
  });

  it("cleans legacy engine examples and cached hints from the user request", () => {
    const prompt = `[סיווג אוטומטי: מאמר]\n${buildEnginePromptHint("article")}${natural}\n\n══ מקור מאומת (מאמר) ══\nאזכור מלא: ${wrong}\n══════════════════════════════════`;
    expect(articles.articleRawInput(prompt)).toBe(natural);
    expect(articles.articleRawInput(prompt, natural)).toBe(natural);
  });

  it("retains complete article-in-book input and its editor inside the date parentheses", () => {
    const raw = 'אייל גרוס "בריאות בישראל: בין זכות למצרך" **זכויות כלכליות, חברתיות ותרבותיות בישראל** 437, 440 (יורם רבין ויובל שני עורכים 2004).';
    const req = articles.createHebrewArticleRequest(raw, true);
    const r = articles.resolveHebrewArticle(req, []);
    expect(articles.isCompleteHebrewArticle(r)).toBe(true);
    expect(articles.renderHebrewArticle(r)).toBe(raw);
  });

  it.each(["מג(2)(א)", "ט/4", "12(3)"])("preserves supported volume/issue notation %s", notation => {
    const raw = `יעל כהן ואורי לוי "שוויון במשפט" **עיוני משפט** ${notation} 183, 184–185 (2011).`;
    const r = articles.resolveHebrewArticle(request(raw), []);
    expect(articles.renderHebrewArticle(r)).toBe(raw);
  });

  it("keeps partial online-journal metadata when pagination is unavailable", () => {
    const raw = 'יעל כהן "משפט ברשת" **המשפט המקוון** י (2020).';
    const r = articles.resolveHebrewArticle(request(raw), []);
    expect(r.fields).toMatchObject({ journalName: "המשפט המקוון", volume: "י", year: "2020" });
    expect(articles.renderHebrewArticle(r)).toContain("[חסר: עמוד ראשון]");
  });

  it("rejects a publication donor as a whole when it conflicts with the supplied volume", () => {
    const raw = "מחבר: דפנה ברק-ארז; שם המאמר: כתיבה שיפוטית; כתב עת: משפטים; כרך: מו";
    const r = resolveArticle([wrong], raw);
    expect(r.fields.volume).toBe("מו");
    expect(r.fields.firstPage).toBeUndefined();
    expect(r.fields.year).toBeUndefined();
    expect(r.matched).toBe(false);
    expect(articles.renderHebrewArticle(r)).toContain("[חסר: עמוד ראשון]");
  });

  it("does not mistake the final word of a journal name for a Hebrew volume", () => {
    const raw = 'יעל כהן "שוויון במשפט" הפרקליט ברשת 3, 5 (2020).';
    const r = articles.resolveHebrewArticle(request(raw), []);
    expect(r.fields.journalName).toBe("הפרקליט ברשת");
    expect(r.fields.volume).toBeUndefined();
    expect(articles.renderHebrewArticle(r)).toContain('**הפרקליט ברשת** 3, 5 (2020).');
  });

  it("preserves complete supplied fields when a requested page follows the citation", () => {
    const r = articles.resolveHebrewArticle(request(`${right}, בעמודים 291 עד 293.`), []);
    expect(r.fields).toMatchObject({ journalName: "משפטים", volume: "מו", firstPage: "269", hebrewYear: "תשע״ז" });
    expect(r.request.pinpoint).toBe("291–293");
  });

  it("preserves the existing Rule 24.11 volume-label example", () => {
    const raw = 'אהרן ברק "עוולת הרשלנות" **מבחר כתבים** כרך ב 1083 (חיים ה׳ כהן ויצחק זמיר עורכים 2000).';
    const r = articles.resolveHebrewArticle(articles.createHebrewArticleRequest(raw, true), []);
    expect(articles.renderHebrewArticle(r)).toBe(raw);
  });

  it("preserves a publication year used as the volume without repeating it", () => {
    const raw = 'שם מחבר "שם מאמר" **עיוני משפט** תשפ״א 13.';
    const r = articles.resolveHebrewArticle(request(raw), []);
    expect(articles.isCompleteHebrewArticle(r)).toBe(true);
    expect(articles.renderHebrewArticle(r)).toBe(raw);
  });

  it("retains a supplied issue when no volume was supplied", () => {
    const raw = 'מחבר: יעל כהן; שם המאמר: שוויון במשפט; כתב עת: עיוני משפט; חוברת: 2; עמוד ראשון: 13; שנה: 2020';
    expect(articles.renderHebrewArticle(articles.resolveHebrewArticle(request(raw), []))).toContain("**עיוני משפט** (2) 13");
  });

  it.each(["article", "article_in_book"] as const)("preserves every fact in the canonical %s rule example", kind => {
    const raw = CITATION_RULES[kind].example;
    const req = articles.createHebrewArticleRequest(raw, kind === "article_in_book");
    expect(articles.renderHebrewArticle(articles.resolveHebrewArticle(req, []))).toBe(raw);
  });

  it("retains unrepresented complete special forms with an honest formatting warning", () => {
    const raw = 'יעל כהן "משפט ופרשה" **פרשת השבוע** 398 (פרשת וירא התשע״ב).';
    const r = articles.resolveHebrewArticle(request(raw), []);
    const output = articles.renderHebrewArticle(r);
    expect(output.startsWith(raw)).toBe(true);
    expect(output).toContain("⚠️");
  });
});

// Execute the complete real edge entrypoint, not a duplicated/sliced algorithm.
// URL imports and provider/auth/database boundaries are the only mocks. This
// test runs in the repository's jsdom environment and setup.ts unchanged.
const source = readFileSync(resolve(__dirname, "../../supabase/functions/citation-chat/index.ts"), "utf8");
const compileEntrypoint = (input: string) => ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const compiled = compileEntrypoint(source);
const guardContext = createContext({ exports: {}, crypto: webcrypto, TextEncoder, Uint8Array,
  require: (name: string) => { if (name === "node:async_hooks") return { AsyncLocalStorage }; if (name === "./citationRecovery.ts") return recovery; throw new Error(name); },
});
runInContext(compileEntrypoint(readFileSync(resolve(__dirname, "../../supabase/functions/_shared/citationUsageGuard.ts"), "utf8")), guardContext);
const guardModule = guardContext.exports;
type RpcResult = { data: Record<string, unknown> | null; error: { message: string } | null };
type TestRpc = (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
async function runHandler(options: { raw?: string; rawInputNull?: boolean; records?: unknown[]; candidate?: Record<string, unknown>; cached?: Array<Record<string, unknown>>; fail?: boolean; fallback?: boolean; label?: string; noPplx?: boolean; foreign?: Record<string, unknown>; foreignResult?: Record<string, unknown>; foreignThrows?: boolean; formatterReply?: string; compiledEntrypoint?: string; baselineGuard?: unknown; diagnostic?: unknown; admin?: boolean; roleFails?: boolean; preflightOnly?: boolean; realForeign?: boolean; requestId?: string | null; retryOfRequestId?: unknown; batchId?: string | null; rpcImpl?: TestRpc; providerStatus?: number; providerThrows?: boolean; failStage?: string; malformedStage?: string; providerJson?: unknown; onProvider?: () => void; providerGate?: Promise<void>; serviceUnavailable?: boolean; version?: number | null; providerJsonStage?: string; stageJson?: unknown; statusStage?: { stage: string; status: number } } = {}) {
  const calls: Array<{ stage: string; body: Record<string, unknown> }> = [];
  const claimClients: Array<{ key: string; options?: unknown }> = [];
  const rpc = vi.fn(options.rpcImpl || (async (name: string, args: Record<string, unknown>) => ({ data: name === "begin_citation_request"
    ? { ok: true, execute: true, status: "in_progress", request_id: args._request_id, retry_of_request_id: args._retry_of_request_id, attempt_token: "fixture-attempt-token" }
    : name === "finish_citation_request" ? { ok: true, status: args._outcome, result_stored: args._outcome === "succeeded", refunded: args._outcome === "failed", refund_receipt: fixtureReceipt(String(args._request_id), args._outcome === "failed") }
    : { ok: true }, error: null })));
  const zero = vi.fn();
  const roleRead = vi.fn(async () => options.roleFails ? { data: null, error: { message: "fixture-only" } } : { data: options.admin ? { role: "admin" } : null, error: null });
  const client = {
    auth: { getClaims: async () => ({ data: { claims: { sub: "test-user" } }, error: null }) },
    rpc,
    from: () => {
      const chain = { select: () => chain, eq: () => chain, or: () => chain, abortSignal: () => chain,
        limit: async () => ({ data: options.cached || [] }), maybeSingle: roleRead };
      return chain;
    },
  };
  let handler: (req: Request) => Promise<Response>;
  const fetchProvider = async (_url: string, init: RequestInit, meta: { stage: string }) => {
    const body = JSON.parse(String(init.body));
    calls.push({ stage: meta.stage, body });
    options.onProvider?.();
    if (options.providerGate) await options.providerGate;
    if (options.statusStage?.stage === meta.stage) return new Response("Ambiguous gateway failure", { status: options.statusStage.status });
    if (options.failStage === meta.stage) throw new Error("Ambiguous upstream provider outcome");
    if (options.malformedStage === meta.stage) return new Response("{invalid-json");
    if (options.providerJsonStage === meta.stage) return new Response(JSON.stringify(options.stageJson));
    if (options.providerThrows) throw new Error("Ambiguous provider transport outcome");
    if (options.providerStatus) return new Response("Provider rejection", { status: options.providerStatus });
    if (options.providerJson !== undefined) return new Response(JSON.stringify(options.providerJson));
    if (meta.stage === "formatter") return new Response(JSON.stringify({ choices: [{ message: { content: options.formatterReply || wrong } }] }));
    if (options.fail) return new Response("offline test failure", { status: 503 });
    const isFallback = meta.stage === "biblio_fallback";
    const candidate = meta.stage === "author_check" ? { author: "דפנה ברק-ארז", confidence: "high" } : options.fallback && !isFallback ? { found: false } : isFallback ? { ...proposed, kind: "journal", title: proposed.articleTitle } : options.candidate || proposed;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate) } }], citations: [result().url], search_results: options.fallback && !isFallback ? [] : options.records || [result()] }));
  };
  const modules: Record<string, unknown> = {
    "https://deno.land/std@0.168.0/http/server.ts": { serve: (f: typeof handler) => { handler = f; } },
    "https://esm.sh/@supabase/supabase-js@2": { createClient: (_url: string, key: string, configuration?: unknown) => ({
      ...client,
      rpc: (name: string, args: Record<string, unknown>) => {
        if (name === "begin_citation_request" || name === "finish_citation_request") claimClients.push({ key, options: configuration });
        return rpc(name, args);
      },
    }) },
    "../_shared/costTelemetry.ts": { trackedFetch: fetchProvider, withCostTelemetry: (_name: string, fn: () => unknown) => fn(), setTelemetryFromBody: () => {}, recordZeroWork: zero },
    "../_shared/hebrewArticleEvidence.ts": articles,
    "../_shared/caseTypePrefixes.ts": dockets,
    "../_shared/trustedHosts.ts": hosts,
    "../_shared/caseLawQuery.ts": caseLawQuery,
    "../_shared/hebrewNumberRange.ts": ranges,
    "../_shared/articleCitationValidator.ts": editors,
    "../_shared/knessetTerms.ts": knesset,
    "../_shared/usageWeights.ts": usage,
    "../_shared/citationUsageGuard.ts": options.baselineGuard ?? guardModule,
    "../_shared/citationRecovery.ts": recovery,
    "../_shared/citationDiagnostic.ts": diagnostic,
    "../_shared/citationDiagnosticGate.ts": diagnosticGate,
    "./foreignLookup.ts": { runForeignLookup: async (input: ForeignLookupInput, deps: LookupDeps) => {
      if (options.foreignThrows) throw new Error("Mock lookup boundary failed");
      if (!options.realForeign) return options.foreignResult;
      return actualForeignLookup(input, { ...deps, fetchImpl: (async (_url: unknown, init?: RequestInit, meta?: { stage?: string }) => {
        calls.push({ stage: meta?.stage || "foreign_page", body: init?.body ? JSON.parse(String(init.body)) : {} });
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }) as typeof fetch });
    }, articleLookupFallback },
    "./statuteRoute.ts": statuteRoute,
  };
  runInContext(options.compiledEntrypoint || compiled, createContext({ exports: {}, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected real module boundary: ${name}`);
    return modules[name];
  }, console: { log: () => {}, error: () => {}, warn: () => {} }, URL, Request, Response, Headers, crypto, TextEncoder,
  Deno: { env: { get: (name: string) => name === "SUPABASE_SERVICE_ROLE_KEY" && options.serviceUnavailable ? undefined : name === "SUPABASE_SERVICE_ROLE_KEY" ? "fixture-service" : name === "SUPABASE_ANON_KEY" ? "fixture-anon" : name === "CITATION_CHAT_OPENWEB_FALLBACK" ? "off" : name === "PERPLEXITY_API_KEY" && options.noPplx ? undefined : "mock-only" } },
  fetch: () => { throw new Error("Unmocked network is prohibited"); },
  }));
  const raw = options.raw || natural;
  const label = options.label || "מאמר";
  const message = `[סיווג אוטומטי: ${label}]\n${label === "מאמר" ? buildEnginePromptHint("article") : ""}${raw}`;
  const response = await handler!(new Request("https://local.test/citation-chat", { method: "POST", headers: { Authorization: "Bearer mock-token", "Content-Type": "application/json" }, body: JSON.stringify({ citationRequestVersion: options.version === null ? undefined : options.version ?? 3, requestId: options.requestId === null ? undefined : options.requestId ?? "fixture-request-0001", ...(options.batchId !== undefined ? { batchId: options.batchId } : {}), ...(options.retryOfRequestId !== undefined ? { retryOfRequestId: options.retryOfRequestId } : {}), ...(options.preflightOnly ? {} : { messages: [{ role: "user", content: message }], rawInput: options.rawInputNull ? null : raw }), ...(options.foreign ? { foreignLookup: options.foreign } : {}), ...(options.diagnostic ? { citationDiagnostic: options.diagnostic } : {}) }) }));
  return { body: await response.json(), status: response.status, usageStatus: response.headers.get("X-Usage-Status"), calls, rpc, zero, roleRead, claimClients };
}

describe("article boundary through the real edge handler", () => {
  it("passes authorized observation through the real handler and lookup without changing requests, output or credit calls", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-11T10:00:00Z"));
    try {
      const foreign = { ...buildForeignArticleRequest(diagnosticGate.CITATION_DIAGNOSTIC_FIXTURE) };
      const normal = await runHandler({ foreign, realForeign: true });
      const observed = await runHandler({ foreign, realForeign: true, admin: true,
        diagnostic: { tag: "relex-en-20261011-0123456789abcdef" } });
      const { citationDiagnostic: trace, ...body } = observed.body;
      expect(body).toEqual(normal.body);
      expect(observed.calls).toEqual(normal.calls);
      expect(observed.calls.map((call) => call.stage)).toEqual(["foreign_search_tier1", "foreign_search_tier2"]);
      expect(observed.rpc.mock.calls.map(([name, args]) => [name, { ...(args as object), _request_id: "normalized-generated-id" }]))
        .toEqual(normal.rpc.mock.calls.map(([name, args]) => [name, { ...(args as object), _request_id: "normalized-generated-id" }]));
      expect(trace).toMatchObject({ phase: "lookup_complete", build: diagnosticGate.CITATION_DIAGNOSTIC_BUILD,
        trace: { searches: { tier1: { status: "ok", httpStatus: 200, resultCount: 0 }, tier2: { status: "ok", httpStatus: 200, resultCount: 0 } },
          stopReason: "tier2_exhausted", final: { resolution: "incomplete", identityMatched: false,
            missingFields: ["journal", "volume", "firstPage", "year"] } } });
      expect(normal.body.citationDiagnostic).toBeUndefined();
    } finally { clock.mockRestore(); }
  });

  it("serves diagnostic readiness only after current admin authorization, before any credit/provider work", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-11T10:00:00Z"));
    try {
      const r = await runHandler({ admin: true, preflightOnly: true,
        diagnostic: { tag: "relex-en-20261011-0123456789abcdef", preflight: true },
        foreign: { ...buildForeignArticleRequest(diagnosticGate.CITATION_DIAGNOSTIC_FIXTURE) } });
      expect(r.status).toBe(200);
      expect(r.body.citationDiagnostic).toMatchObject({ phase: "ready", build: diagnosticGate.CITATION_DIAGNOSTIC_BUILD });
      expect(r.roleRead).toHaveBeenCalledTimes(1);
      expect(r.rpc).not.toHaveBeenCalled();
      expect(r.calls).toHaveLength(0);
    } finally { clock.mockRestore(); }
  });

  it.each([{ admin: false }, { admin: true, roleFails: true }])("refuses diagnostic preflight without verified current admin role %#", async (role) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-11T10:00:00Z"));
    try {
      const r = await runHandler({ ...role, preflightOnly: true,
        diagnostic: { tag: "relex-en-20261011-0123456789abcdef", preflight: true },
        foreign: { ...buildForeignArticleRequest(diagnosticGate.CITATION_DIAGNOSTIC_FIXTURE) } });
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ error: "DIAGNOSTIC_NOT_AVAILABLE" });
      expect(r.rpc).not.toHaveBeenCalled();
      expect(r.calls).toHaveLength(0);
    } finally { clock.mockRestore(); }
  });

  it("does not authorize or charge an expired diagnostic readiness request", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(diagnosticGate.CITATION_DIAGNOSTIC_EXPIRES);
    try {
      const r = await runHandler({ admin: true, preflightOnly: true,
        diagnostic: { tag: "relex-en-20261011-0123456789abcdef", preflight: true },
        foreign: { ...buildForeignArticleRequest(diagnosticGate.CITATION_DIAGNOSTIC_FIXTURE) } });
      expect(r.status).toBe(403);
      expect(r.roleRead).not.toHaveBeenCalled();
      expect(r.rpc).not.toHaveBeenCalled();
      expect(r.calls).toHaveLength(0);
    } finally { clock.mockRestore(); }
  });

  it("preserves normal foreign citation output and credit behavior when diagnostic authorization fails", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-11T10:00:00Z"));
    try {
      const foreign = { ...buildForeignArticleRequest(diagnosticGate.CITATION_DIAGNOSTIC_FIXTURE) };
      const foreignResult = { identity: { matched: false }, fields: {}, articleResolution: "incomplete" };
      const normal = await runHandler({ foreign, foreignResult });
      const denied = await runHandler({ foreign, foreignResult, diagnostic: { tag: "relex-en-20261011-0123456789abcdef" } });
      expect(denied.body).toEqual(normal.body);
      expect(denied.rpc.mock.calls.map(([name]) => name)).toEqual(normal.rpc.mock.calls.map(([name]) => name));
      expect(normal.roleRead).not.toHaveBeenCalled();
      expect(denied.roleRead).toHaveBeenCalledTimes(1);
      expect(normal.calls).toEqual(denied.calls);
    } finally { clock.mockRestore(); }
  });

  it("renders grounded facts with the supplied pinpoint and makes no formatter call", async () => {
    const r = await runHandler();
    expect(r.status).toBe(200);
    expect(r.body.content).toContain('"כתיבה שיפוטית" **משפטים** מו 269, 293–291 (התשע״ז).');
    expect(r.body.content).not.toContain("2018");
    expect(r.calls.map(c => c.stage)).toEqual(["article_retrieval_tier1", "author_check"]);
    expect(r.calls.every(c => c.body.model === "sonar-pro")).toBe(true);
    expect(r.rpc.mock.calls.filter(c => c[0] === "begin_citation_request")).toHaveLength(1);
    expect(r.rpc.mock.calls.at(-1)).toMatchObject(["finish_citation_request", { _outcome: "succeeded" }]);
  });

  it("ignores unranked and wrong-work cache records", async () => {
    const r = await runHandler({ cached: [{ source_name: "מאמר אחר", full_citation: 'דפנה ברק-ארז "מחשבות על המשפט" משפטים מח 291 (2018)', source_type: "article" }] });
    expect(r.body.content).toContain("מו 269");
    expect(r.body.content).not.toContain("2018");
    expect(r.calls.some(c => c.stage === "article_retrieval_tier1")).toBe(true);
  });

  it("uses a coherent cache record while preserving a pinpoint", async () => {
    const r = await runHandler({ cached: [{ source_name: "כתיבה שיפוטית", full_citation: right, source_type: "article" }] });
    expect(r.body.content).toContain("מו 269, 293–291");
    expect(r.calls).toHaveLength(0);
  });

  it("keeps a complete supplied article usable when search fails", async () => {
    const r = await runHandler({ raw: right + ".", fail: true });
    expect(r.body.content).toContain('דפנה ברק-ארז "כתיבה שיפוטית" **משפטים** מו 269 (התשע״ז).');
    expect(r.calls.some(c => c.stage === "formatter")).toBe(false);
  });

  it("marks a complete supplied citation with conflicting evidence using the client warning contract", async () => {
    const r = await runHandler({ raw: right + ".", records: [result(wrong)] });
    expect(r.body.content).toContain("מו 269");
    expect(r.body.content).not.toContain("2018");
    expect(r.body.content).toContain("⚠️");
  });

  it("keeps incomplete supplied identity and honest markers when search is unavailable", async () => {
    const r = await runHandler({ noPplx: true });
    expect(r.body.content).toContain("דפנה ברק־ארז");
    expect(r.body.content).toContain("[חסר: עמוד ראשון]");
    expect(r.body.content).toContain("293–291");
    expect(r.calls).toHaveLength(0);
  });

  it("applies the same field contract to the bibliographic fallback", async () => {
    const r = await runHandler({ fallback: true });
    expect(r.calls.map(c => c.stage)).toEqual(["article_retrieval_tier1", "biblio_fallback"]);
    expect(r.body.content).toContain("מו 269");
    expect(r.body.content).not.toContain("2018");
  });

  it.each([{ records: [] }, { records: [{ title: "כתיבה שיפוטית", url: result().url, date: "2018-02-26" }] }])("returns honest gaps for a real sparse provider envelope %#", async ({ records }) => {
    const r = await runHandler({ records });
    expect(r.body.content).toContain("דפנה ברק־ארז");
    expect(r.body.content).toContain("[חסר: כתב עת]");
    expect(r.body.content).toContain("[חסר: עמוד ראשון]");
    expect(r.body.content).toContain("293–291");
    expect(r.body.content).not.toContain("2018");
    expect(r.calls.map(c => c.stage)).toEqual(["article_retrieval_tier1", "biblio_fallback"]);
  });

  it("keeps the existing exact-case cache route free and unchanged", async () => {
    const citation = 'בג״ץ 1308/17 **עיריית סלואד** נ׳ **הכנסת** (נבו 9.6.2020).';
    const r = await runHandler({ raw: "1308/17", label: "פסיקה (מאגר)", cached: [{ source_name: "1308/17", full_citation: citation, source_type: "case_law_database" }] });
    expect(r.body.content).toBe(citation);
    expect(r.calls).toHaveLength(0);
    expect(r.rpc).not.toHaveBeenCalled();
    expect(r.zero).toHaveBeenCalledWith("server_verified_store", "cache_hit");
  });

  it("does not change the existing non-article formatter route", async () => {
    const r = await runHandler({ raw: "מקור משפטי לבדיקת מסלול הבקרה", label: "אחר", noPplx: true });
    expect(r.calls.map(c => c.stage)).toEqual(["formatter"]);
    expect(r.calls[0].body.model).toBe("google/gemini-2.5-flash");
  });

  it("returns terminal foreign article resolution without calling the formatter", async () => {
    const foreignResult = { identity: { matched: false }, fields: {}, provenance: {}, articleResolution: "incomplete" };
    const r = await runHandler({ raw: 'Jane Doe, "Legal Writing"', label: "מאמר לועזי", foreign: { enabled: true, articleResponseVersion: 1, kind: "journal_article", jurisdiction: "US", rawInput: "Legal Writing" }, foreignResult });
    expect(r.body.foreignLookup).toEqual(foreignResult);
    expect(r.calls).toHaveLength(0);
  });

  it.each([false, true])("foreign article cannot reach the formatter after missing key/throw: %s", async foreignThrows => {
    const foreignResult = { identity: { matched: false }, fields: {}, provenance: {}, articleResolution: "incomplete" };
    const r = await runHandler({ raw: 'Jane Doe, "Legal Writing"', label: "מאמר לועזי", noPplx: true, foreign: { enabled: true, articleResponseVersion: 1, kind: "journal_article", jurisdiction: "US", rawInput: 'Jane Doe, "Legal Writing"' }, foreignResult, foreignThrows,
      cached: [{ source_name: 'Jane Doe, "Legal Writing"', full_citation: "unrelated cache donor", source_type: "article" }],
    });
    expect(r.body.foreignLookup.articleResolution).toBe("incomplete");
    expect(r.calls).toHaveLength(0);
    expect(r.body.content).toBe("");
  });

  it("gives stale typed clients unchanged supplied identity/pinpoint without unsafe legacy merging", async () => {
    const raw = 'Samuel Warren and Louis Brandeis, "The Right to Privacy", at 205';
    const r = await runHandler({ raw, label: "מאמר לועזי", foreign: { enabled: true, kind: "journal_article", jurisdiction: "US", rawInput: raw }, foreignResult: {
      identity: { matched: true }, fields: { journal: "Harvard Law Review", year: "1890" }, provenance: {}, articleResolution: "incomplete",
    } });
    expect(r.body.foreignLookup).toBeUndefined();
    expect(r.body.content.startsWith(raw + "\n")).toBe(true);
    expect(r.body.content).toContain("⚠️");
    expect(r.calls).toHaveLength(0);
  });
});

describe("Stage 4 typed statute requests through the real edge handler", () => {
  const raw = "Civil Rights Act § 1983";
  const statute = { enabled: true, statuteResponseVersion: 1, kind: "statute", jurisdiction: "US", rawInput: raw, parsedFields: { statuteName: "Civil Rights Act", section: "1983" } };
  const cached = [{ source_name: raw, full_citation: "unrelated cache donor", source_type: "חקיקה זרה" }];
  const outcomes = (r: { rpc: { mock: { calls: unknown[][] } } }) => r.rpc.mock.calls.filter(([n]) => n === "finish_citation_request").map(([, a]) => (a as { _outcome: string })._outcome);

  it.each([
    ["missing key", { noPplx: true }, "missing_perplexity_credentials"],
    ["thrown/timeout", { foreignThrows: true }, "lookup_failed"],
    ["empty result", {}, "empty_result"],
    ["malformed result", { foreignResult: {} }, "empty_result"],
  ] as const)("%s terminates with a typed warning and never reaches a model, cache donor or retry", async (_n, extra, error) => {
    const r = await runHandler({ raw, label: "חקיקה זרה", foreign: statute, cached, ...extra });
    expect(r.status).toBe(200);
    expect(r.body.content).toBe("");
    expect(r.body.foreignLookup).toMatchObject({ statuteResponseVersion: 1, kind: "statute", error, identity: { matched: false } });
    expect(Object.keys(r.body.foreignLookup.fields)).toHaveLength(0);
    expect(r.calls).toHaveLength(0);
    // Existing delivery semantics (same as the typed article path): one terminal settlement, no new refund.
    expect(outcomes(r)).toEqual(["succeeded"]);
  });

  it("an invalid / version-missing statute request is rejected before any usage claim", async () => {
    const r = await runHandler({ raw, label: "חקיקה זרה", foreign: { ...statute, statuteResponseVersion: undefined } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_INPUT");
    expect(r.rpc.mock.calls.some(([n]) => n === "begin_citation_request")).toBe(false);
    expect(r.calls).toHaveLength(0);
  });

  it("a grounded result is returned typed and versioned, with no model call", async () => {
    const foreignResult = { kind: "statute", jurisdiction: "US", fields: { titleNumber: "42", code: "U.S.C." }, grounded: {}, provenance: {}, sources: [],
      identity: { matched: true, jurisdiction: "US", anchors: [], conflicts: [] }, diagnostics: { tier1Queried: true, tier2Fired: false } };
    const r = await runHandler({ raw, label: "חקיקה זרה", foreign: statute, foreignResult });
    expect(r.body.foreignLookup).toMatchObject({ statuteResponseVersion: 1, identity: { matched: true }, fields: { titleNumber: "42" } });
    expect(r.calls).toHaveLength(0);
  });
});

describe("chapter routing remains outside the journal article correction", () => {
  const complete = CITATION_RULES.article_in_book.example;
  const incomplete = 'אייל גרוס "בריאות בישראל: בין זכות למצרך"';
  const chapter = { found: true, type: "article_in_book", author: "אייל גרוס", articleTitle: "בריאות בישראל: בין זכות למצרך", bookTitle: "זכויות כלכליות, חברתיות ותרבותיות בישראל", firstPage: "437", editor: "יורם רבין ויובל שני עורכים", year: 2004 };
  const chapterOptions = { label: "מאמר שפורסם בספר", candidate: chapter, records: [{ title: chapter.articleTitle, url: "https://law.tau.ac.il/chapter", snippet: complete }], formatterReply: complete };

  it.each([complete, incomplete])("retains chapter retrieval and generic formatter for %s", async raw => {
    const r = await runHandler({ ...chapterOptions, raw });
    expect(r.calls.some(c => c.stage === "book_retrieval_tier1")).toBe(true);
    expect(r.calls.some(c => c.stage === "article_retrieval_tier1")).toBe(true);
    expect(r.calls.at(-1)?.stage).toBe("formatter");
    expect(r.body.content).toContain('"בריאות בישראל: בין זכות למצרך"');
  });

  it("retains the chapter direct-cache shortcut and zero-work telemetry", async () => {
    const r = await runHandler({ ...chapterOptions, raw: chapter.articleTitle, cached: [{ source_name: chapter.articleTitle, full_citation: complete, source_type: "article_in_book" }] });
    expect(r.body.content).toBe(complete);
    expect(r.calls).toEqual([]);
    expect(r.rpc).not.toHaveBeenCalled();
    expect(r.zero).toHaveBeenCalledWith("server_verified_store", "cache_hit");
  });

  // Optional local comparison executes the unmodified baseline entrypoint from
  // the source export. Ordinary CI still runs the fixed chapter contract above.
  const baselinePath = process.env.RELEX_CITATION_BASELINE;
  it.skipIf(!baselinePath)("matches complete/incomplete/cache/failure chapter behavior against the real baseline", async () => {
    const baselineSource = readFileSync(baselinePath!, "utf8");
    const baseline = compileEntrypoint(baselineSource);
    const baselineGuardContext = createContext({ exports: {}, crypto: webcrypto, TextEncoder, Uint8Array,
      require: (name: string) => { if (name === "node:async_hooks") return { AsyncLocalStorage }; throw new Error(name); },
    });
    const baselineGuardPath = resolve(baselinePath!, "../../_shared/citationUsageGuard.ts");
    if (baselineSource.includes("new CitationUsageGuard(")) {
      runInContext(compileEntrypoint(readFileSync(baselineGuardPath, "utf8")), baselineGuardContext);
    }
    const cases = [
      { ...chapterOptions, raw: complete },
      { ...chapterOptions, raw: incomplete },
      { ...chapterOptions, raw: incomplete, fail: true },
      { ...chapterOptions, raw: chapter.articleTitle, cached: [{ source_name: chapter.articleTitle, full_citation: complete, source_type: "article_in_book" }] },
      { ...chapterOptions, raw: `${complete} בעמ׳ 440` },
      // Stale messages-only foreign clients retain their baseline generic
      // retrieval/formatter route until they adopt the typed request adapter.
      { label: "מאמר לועזי", raw: 'Samuel Warren and Louis Brandeis "The Right to Privacy"', candidate: { found: true, type: "journal", author: "Samuel Warren and Louis Brandeis", articleTitle: "The Right to Privacy", journalName: "Harvard Law Review", volume: "4", firstPage: "193", year: 1890 }, records: [{ title: "The Right to Privacy", url: "https://www.jstor.org/stable/example", snippet: 'Samuel Warren and Louis Brandeis "The Right to Privacy" Harvard Law Review 4 193 (1890)' }], formatterReply: 'Warren & Brandeis, The Right to Privacy, 4 Harv. L. Rev. 193 (1890).' },
    ];
    for (const input of cases) {
      const before = await runHandler({ ...input, compiledEntrypoint: baseline, baselineGuard: baselineGuardContext.exports, version: 2 });
      const after = await runHandler(input);
      expect(after.status).toBe(before.status);
      const { requestId: _requestId, recoveryAvailability: _recovery, ...afterComparable } = after.body;
      const { requestId: _beforeId, recoveryAvailability: _beforeRecovery, ...beforeComparable } = before.body;
      expect(afterComparable).toEqual(beforeComparable);
      expect(after.calls).toEqual(before.calls);
      // The security repair intentionally replaces billing RPCs. Keep the
      // retrieval, formatter, citation output and free-path parity assertions.
      expect(after.rpc.mock.calls.filter(([name]) => name === "begin_citation_request").length)
        .toBe(before.rpc.mock.calls.filter(([name]) => name === (baselineSource.includes("new CitationUsageGuard(") ? "begin_citation_request" : "consume_credits")).length);
      expect(after.zero.mock.calls).toEqual(before.zero.mock.calls);
    }
  });
});

// In-memory transaction-boundary double, not evidence that the SQL migration
// was run. It deliberately distinguishes an execution claim from a charge.
function fixtureReceipt(requestId: string, refunded: boolean) {
  return { status: refunded ? "refunded" : "not_applicable", refunded, units_refunded: refunded ? 1 : 0, request_id: requestId };
}
function usageFixture() {
  const rows = new Map<string, { fingerprint: unknown; status: string; token: string; retryOf: string | null }>();
  let consumed = 0, refunded = 0;
  const rpc: TestRpc = async (name, args) => {
    const key = String(args._request_id);
    const row = rows.get(key);
    if (name === "begin_citation_request") {
      const retryOf = typeof args._retry_of_request_id === "string" ? args._retry_of_request_id : null;
      const parent = retryOf ? rows.get(retryOf) : undefined;
      const denial = (error: string) => ({ data: { ok: false, error }, error: null });
      if (retryOf && !parent) return denial("RETRY_PARENT_NOT_FOUND");
      if (parent && parent.status !== "failed") return denial("RETRY_PARENT_NOT_FAILED");
      if (parent && parent.fingerprint !== args._fingerprint) return denial("RETRY_FINGERPRINT_MISMATCH");
      if (row && row.retryOf !== retryOf) return denial("REQUEST_ANCESTRY_MISMATCH");
      if (row && row.fingerprint !== args._fingerprint) return denial("REQUEST_FINGERPRINT_MISMATCH");
      const canonical = row ? [key, row] as const : retryOf ? [...rows].find(([, candidate]) => candidate.retryOf === retryOf) : undefined;
      const parentReceipt = parent && retryOf ? fixtureReceipt(retryOf, true) : undefined;
      if (canonical) return { data: { ok: true, execute: false, status: canonical[1].status,
        request_id: canonical[0], retry_of_request_id: canonical[1].retryOf,
        refunded: canonical[1].status === "failed", refund_receipt: fixtureReceipt(canonical[0], canonical[1].status === "failed"),
        retry_parent_refund_receipt: parentReceipt }, error: null };
      const token = "server-attempt-" + key;
      rows.set(key, { fingerprint: args._fingerprint, status: "in_progress", token, retryOf });
      consumed++;
      return { data: { ok: true, execute: true, status: "in_progress", request_id: key,
        retry_of_request_id: retryOf, retry_parent_refund_receipt: parentReceipt, attempt_token: token }, error: null };
    }
    if (name === "finish_citation_request" && row?.status === "in_progress" && row.token === args._attempt_token) {
      row.status = String(args._outcome);
      if (row.status === "failed") refunded++;
      return { data: { ok: true, status: row.status, result_stored: row.status === "succeeded", refunded: row.status === "failed",
        refund_receipt: fixtureReceipt(key, row.status === "failed") }, error: null };
    }
    return { data: { ok: false, error: "NOT_ELIGIBLE" }, error: null };
  };
  return { rpc, rows, totals: () => ({ consumed, refunded }) };
}

const paidFixture = { raw: "מקור משפטי לבדיקת מסלול הבקרה", label: "אחר", noPplx: true };

describe("citation paid execution ownership through the real edge handler", () => {
  it("executes once for overlapping identical IDs and returns a status for both in-flight and completed replays", async () => {
    const db = usageFixture();
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const first = runHandler({ ...paidFixture, rpcImpl: db.rpc, providerGate: gate, onProvider: started });
    await entered;
    const overlap = await runHandler({ ...paidFixture, rpcImpl: db.rpc });
    expect(overlap.status).toBe(409);
    expect(overlap.body).toMatchObject({ error: "REQUEST_ALREADY_STARTED", status: "in_progress" });
    expect(overlap.calls).toHaveLength(0);
    release();
    const original = await first;
    expect(original.status).toBe(200);
    expect(original.calls).toHaveLength(1);
    expect(original.claimClients).toEqual([
      { key: "fixture-service", options: undefined }, { key: "fixture-service", options: undefined },
    ]);
    const replay = await runHandler({ ...paidFixture, rpcImpl: db.rpc });
    expect(replay.body.status).toBe("succeeded");
    expect(replay.calls).toHaveLength(0);
    expect(db.totals()).toEqual({ consumed: 1, refunded: 0 });
  });

  it.each([
    { raw: "מקור משפטי אחר לבדיקת הבקרה" },
    { batchId: "different-batch-0001" },
    { foreign: { enabled: false, rawInput: "different payload" } },
  ])("rejects changed paid inputs under an existing ID before provider work %#", async (change) => {
    const db = usageFixture();
    await runHandler({ ...paidFixture, rpcImpl: db.rpc });
    const second = await runHandler({ ...paidFixture, ...change, rpcImpl: db.rpc });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("REQUEST_FINGERPRINT_MISMATCH");
    expect(second.calls).toHaveLength(0);
    expect(db.totals().consumed).toBe(1);
  });

  it.each(["plan_expired", "plan_allowance", "short_window", "trial_exhausted"])("rejects %s before any provider work", async (block_reason) => {
    const r = await runHandler({ ...paidFixture, rpcImpl: async () => ({ data: { ok: false, error: "INSUFFICIENT_CREDITS", block_reason }, error: null }) });
    expect(r.status).toBe(402);
    expect(r.body.block_reason).toBe(block_reason);
    expect(r.calls).toHaveLength(0);
    expect(r.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    { data: { ok: true, replayed: true }, error: null },
    { data: { ok: true, execute: true, status: "in_progress" }, error: null },
    { data: { ok: false, error: "REQUEST_ID_ALREADY_USED" }, error: null },
    { data: null, error: { message: "unknown committed outcome" } },
  ])("never interprets ambiguous or legacy charge replies as execution permission %#", async (result) => {
    const r = await runHandler({ ...paidFixture, rpcImpl: async () => result });
    expect(r.status).not.toBe(200);
    expect(r.calls).toHaveLength(0);
    expect(r.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([402, 403, 429, 500])("refunds a confirmed provider rejection %i only once", async (providerStatus) => {
    const db = usageFixture();
    const first = await runHandler({ ...paidFixture, providerStatus, rpcImpl: db.rpc });
    expect(first.body.refunded).toBe(true);
    const replay = await runHandler({ ...paidFixture, providerStatus, rpcImpl: db.rpc });
    expect(replay.status).toBe(409);
    expect(replay.body.status).toBe("failed");
    expect(replay.calls).toHaveLength(0);
    expect(db.totals()).toEqual({ consumed: 1, refunded: 1 });
  });

  it.each([{ providerThrows: true }, { providerJson: {} }, { providerJson: { choices: [] } }])("keeps uncertain provider outcomes unrefunded and non-executable %#", async (provider) => {
    const db = usageFixture();
    const first = await runHandler({ ...paidFixture, ...provider, rpcImpl: db.rpc });
    expect(first.status).toBe(500);
    expect(first.body).toMatchObject({ error: "REQUEST_OUTCOME_UNKNOWN", refunded: false });
    const replay = await runHandler({ ...paidFixture, rpcImpl: db.rpc });
    expect(replay.body.status).toBe("unknown");
    expect(replay.calls).toHaveLength(0);
    expect(db.totals()).toEqual({ consumed: 1, refunded: 0 });
  });

  it.each([
    { failStage: "book_retrieval_tier1" }, { malformedStage: "book_retrieval_tier1" },
    { providerJsonStage: "book_retrieval_tier1", stageJson: {} },
    { providerJsonStage: "book_retrieval_tier1", stageJson: { choices: [{ message: { content: "{}" } }] } },
    { providerJsonStage: "book_retrieval_tier1", stageJson: { choices: [{ message: { content: "Malformed inner JSON { broken" } }] } },
  ])("keeps swallowed upstream uncertainty sticky across a later formatter rejection %#", async (uncertain) => {
    const db = usageFixture();
    const r = await runHandler({ raw: "אהרן ברק פרשנות במשפט", label: "ספר", ...uncertain, providerStatus: 429, rpcImpl: db.rpc });
    expect(r.calls.map((call) => call.stage)).toContain("book_retrieval_tier1");
    expect(r.calls.map((call) => call.stage)).toContain("formatter");
    expect(r.body.refunded).toBe(false);
    expect(db.rows.get("fixture-request-0001")?.status).toBe("unknown");
    expect(db.totals().refunded).toBe(0);
  });

  it("does not leak provider uncertainty between concurrent requests", async () => {
    const uncertain = usageFixture(), rejected = usageFixture();
    const [unknown, failed] = await Promise.all([
      runHandler({ raw: "אהרן ברק פרשנות במשפט", label: "ספר", failStage: "book_retrieval_tier1", providerStatus: 429, rpcImpl: uncertain.rpc }),
      runHandler({ ...paidFixture, providerStatus: 429, rpcImpl: rejected.rpc }),
    ]);
    expect(unknown.body.refunded).toBe(false);
    expect(failed.body.refunded).toBe(true);
    expect(rejected.totals().refunded).toBe(1);
  });

  it("does not refund a delivered citation because its title includes a refusal phrase", async () => {
    const db = usageFixture();
    const r = await runHandler({ ...paidFixture, formatterReply: 'Jane Doe, "Cannot Interpret", 10 Legal Journal 1 (2020).', rpcImpl: db.rpc });
    expect(r.status).toBe(200);
    expect(r.body.content).toContain("Cannot Interpret");
    expect(db.rows.get("fixture-request-0001")?.status).toBe("succeeded");
    expect(db.totals().refunded).toBe(0);
  });

  it("keeps a plain-text refusal pending review without granting a refund or new execution", async () => {
    const db = usageFixture();
    const r = await runHandler({ ...paidFixture, formatterReply: "Cannot interpret the requested input.", rpcImpl: db.rpc });
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ error: "AI_RESPONSE_UNVERIFIED", status: "unknown", refunded: false });
    expect(db.totals().refunded).toBe(0);
    const retry = await runHandler({ ...paidFixture, rpcImpl: db.rpc });
    expect(retry.calls).toHaveLength(0);
    expect(retry.body.status).toBe("unknown");
  });

  it.each([null, "", "  "])("refunds a provider-structured refusal with empty content %#, but not delivered content", async (content) => {
    const failed = usageFixture();
    const r = await runHandler({ ...paidFixture, providerJson: { choices: [{ message: { content, refusal: "Request refused" } }] }, rpcImpl: failed.rpc });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ error: "AI_REFUSED", refunded: true });
    const delivered = usageFixture();
    const successful = await runHandler({ ...paidFixture, providerJson: { choices: [{ message: { content: "Valid citation content", refusal: "Metadata must not refund a delivered answer" } }] }, rpcImpl: delivered.rpc });
    expect(successful.status).toBe(200);
    expect(delivered.totals().refunded).toBe(0);
  });

  it("does not announce a refund when terminal persistence is rejected", async () => {
    const db = usageFixture();
    const r = await runHandler({ ...paidFixture, providerStatus: 403, rpcImpl: async (name, args) => name === "finish_citation_request"
      ? { data: { ok: false }, error: { message: "write failed" } } : db.rpc(name, args) });
    expect(r.body.refunded).toBe(false);
    expect(r.body.message).not.toContain("הוחזרו");
    expect(r.rpc.mock.calls.filter(([name]) => name === "finish_citation_request")).toHaveLength(1);
  });

  it("keeps a delivered answer usable after a lost completion acknowledgment without rerunning or refunding", async () => {
    const db = usageFixture();
    const rpcImpl: TestRpc = async (name, args) => {
      const result = await db.rpc(name, args);
      return name === "finish_citation_request" ? { data: null, error: { message: "response lost" } } : result;
    };
    const first = await runHandler({ ...paidFixture, rpcImpl });
    expect(first.status).toBe(200);
    expect(first.body.content).toBeTruthy();
    expect(first.usageStatus).toBe("unconfirmed");
    const replay = await runHandler({ ...paidFixture, rpcImpl });
    expect(replay.body.status).toBe("succeeded");
    expect(replay.calls).toHaveLength(0);
    expect(db.totals()).toEqual({ consumed: 1, refunded: 0 });
  });

  it.each([null, 0, 1, 2, 4])("rejects outdated paid-citation clients before any credit, cache or provider calls %#", async (version) => {
    const r = await runHandler({ ...paidFixture, version });
    expect(r.status).toBe(426);
    expect(r.body.error).toBe("CLIENT_UPDATE_REQUIRED");
    expect(r.calls).toHaveLength(0);
    expect(r.rpc).not.toHaveBeenCalled();
  });

  it.each([null, "short", "x".repeat(201)])("rejects missing or invalid stable IDs before paid work %#", async (requestId) => {
    const r = await runHandler({ ...paidFixture, requestId });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_REQUEST_ID");
    expect(r.calls).toHaveLength(0);
    expect(r.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the service client is unavailable", async () => {
    const r = await runHandler({ ...paidFixture, serviceUnavailable: true });
    expect(r.status).toBe(503);
    expect(r.calls).toHaveLength(0);
    expect(r.rpc).not.toHaveBeenCalled();
  });
});

describe("explicit failed-parent successors through the real edge handler", () => {
  it("executes one canonical child for concurrent distinct successor IDs, never silently retrying a failed child", async () => {
    const db = usageFixture();
    const parentId = "fixture-request-0001";
    await runHandler({ ...paidFixture, providerStatus: 429, rpcImpl: db.rpc });
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const child = runHandler({ ...paidFixture, requestId: "child-request-0001", retryOfRequestId: parentId, rpcImpl: db.rpc, providerStatus: 429, providerGate: gate, onProvider: started });
    await entered;
    const rival = await runHandler({ ...paidFixture, requestId: "child-request-0002", retryOfRequestId: parentId, rpcImpl: db.rpc });
    expect(rival.status).toBe(409);
    expect(rival.body).toMatchObject({ requestId: "child-request-0001", retryOfRequestId: parentId, status: "in_progress", retry_parent_refund_receipt: { status: "refunded", refunded: true } });
    expect(rival.calls).toHaveLength(0);
    release();
    expect((await child).body.status).toBe("failed");
    const stale = await runHandler({ ...paidFixture, requestId: "child-request-0003", retryOfRequestId: parentId, rpcImpl: db.rpc });
    expect(stale.body).toMatchObject({ requestId: "child-request-0001", status: "failed", refund_receipt: { status: "refunded", refunded: true } });
    expect(stale.calls).toHaveLength(0);
    expect(db.totals()).toEqual({ consumed: 2, refunded: 2 });
    expect(db.rows.size).toBe(2);
    expect(db.rows.get(parentId)?.status).toBe("failed");
  });
  it.each(["in_progress", "unknown", "succeeded"])("rejects a %s parent before provider work", async (state) => {
    const db = usageFixture();
    await runHandler({ ...paidFixture, rpcImpl: db.rpc });
    db.rows.get("fixture-request-0001")!.status = state;
    const r = await runHandler({ ...paidFixture, requestId: "child-request-0001", retryOfRequestId: "fixture-request-0001", rpcImpl: db.rpc });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("RETRY_PARENT_NOT_FAILED");
    expect(r.calls).toHaveLength(0);
    expect(db.totals().consumed).toBe(1);
  });
  it("rejects changed input and a child replay that omits its immutable parent", async () => {
    const db = usageFixture();
    await runHandler({ ...paidFixture, providerStatus: 429, rpcImpl: db.rpc });
    const mismatch = await runHandler({ ...paidFixture, raw: "מקור משפטי אחר לבדיקת הבקרה", requestId: "child-request-0001", retryOfRequestId: "fixture-request-0001", rpcImpl: db.rpc });
    expect(mismatch.body.error).toBe("RETRY_FINGERPRINT_MISMATCH");
    expect(mismatch.calls).toHaveLength(0);
    await runHandler({ ...paidFixture, requestId: "child-request-0001", retryOfRequestId: "fixture-request-0001", rpcImpl: db.rpc });
    const detached = await runHandler({ ...paidFixture, requestId: "child-request-0001", rpcImpl: db.rpc });
    expect(detached.body.error).toBe("REQUEST_ANCESTRY_MISMATCH");
    expect(detached.calls).toHaveLength(0);
    expect(db.totals().consumed).toBe(2);
  });
  it.each([null, "short", 42, "fixture-request-0001", "x".repeat(201)])("rejects malformed or self-linked parents before claim %#", async (retryOfRequestId) => {
    const r = await runHandler({ ...paidFixture, retryOfRequestId });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_RETRY_REQUEST");
    expect(r.calls).toHaveLength(0);
    expect(r.rpc).not.toHaveBeenCalled();
  });
  it.each(["deferred", "review_required", "retained", "not_charged"])("reports %s failed settlement without inventing a refund", async (status) => {
    const db = usageFixture();
    const receipt = { status, refunded: false, units_refunded: 0, request_id: "billing-anchor" };
    const r = await runHandler({ ...paidFixture, providerStatus: 403, rpcImpl: async (name, args) => name === "finish_citation_request" ? { data: { ok: true, status: "failed", refunded: false, refund_receipt: receipt }, error: null } : db.rpc(name, args) });
    expect(r.body).toMatchObject({ status: "failed", refunded: false, refund_receipt: receipt });
    expect(r.body.message).not.toContain("הוחזרו");
  });
});


describe("gateway outcomes cannot authorize a paid successor", () => {
  it.each([408, 502, 504])("keeps formatter HTTP %i unknown and unrefunded", async (providerStatus) => {
    const db = usageFixture();
    const r = await runHandler({ ...paidFixture, providerStatus, rpcImpl: db.rpc });
    expect(r.body).toMatchObject({ error: "REQUEST_OUTCOME_UNKNOWN", status: "unknown", refunded: false });
    expect(db.rows.get("fixture-request-0001")?.status).toBe("unknown");
    const child = await runHandler({ ...paidFixture, requestId: "child-request-0001", retryOfRequestId: "fixture-request-0001", rpcImpl: db.rpc });
    expect(child.body.error).toBe("RETRY_PARENT_NOT_FAILED");
    expect(child.calls).toHaveLength(0);
    expect(db.totals()).toEqual({ consumed: 1, refunded: 0 });
  });
  it("keeps retrieval gateway uncertainty sticky across formatter rejection, isolated from a concurrent clean rejection", async () => {
    const uncertain = usageFixture(), known = usageFixture();
    const [a, b] = await Promise.all([
      runHandler({ raw: "אהרן ברק פרשנות במשפט", label: "ספר", statusStage: { stage: "book_retrieval_tier1", status: 502 }, providerStatus: 429, rpcImpl: uncertain.rpc }),
      runHandler({ ...paidFixture, providerStatus: 429, rpcImpl: known.rpc }),
    ]);
    expect(a.calls.map((call) => call.stage)).toContain("formatter");
    expect(a.body).toMatchObject({ error: "REQUEST_OUTCOME_UNKNOWN", status: "unknown", refunded: false });
    expect(b.body).toMatchObject({ status: "failed", refunded: true });
    expect(uncertain.totals().refunded).toBe(0);
    expect(known.totals().refunded).toBe(1);
  });
});


describe("durable execution inputs and results through actual citation handler", () => {
  it("persists exact canonical execution body with the claim and request ID with success", async () => {
    const r = await runHandler(paidFixture);
    const begin = r.rpc.mock.calls.find(([name]) => name === "begin_citation_request")![1];
    expect(begin._recovery_input).toMatchObject({ messages: [{ role: "user" }], rawInput: paidFixture.raw, foreignLookup: null, batchId: null });
    expect(Object.keys(begin._recovery_input as object).sort()).toEqual(["batchId", "foreignLookup", "messages", "rawInput"]);
    const finish = r.rpc.mock.calls.find(([name]) => name === "finish_citation_request")![1];
    expect(finish._result).toEqual({ content: r.body.content });
    expect(r.body).toMatchObject({ requestId: "fixture-request-0001", recoveryAvailability: "available" });
  });
  it("accepts exact recovered nonbatch input including explicit nulls for a failed-parent retry", async () => {
    const db = usageFixture();
    const original = await runHandler({ ...paidFixture, rawInputNull: true, batchId: null, providerStatus: 429, rpcImpl: db.rpc });
    expect(original.body.status).toBe("failed");
    const child = await runHandler({ ...paidFixture, rawInputNull: true, batchId: null, requestId: "child-restored-0001", retryOfRequestId: "fixture-request-0001", rpcImpl: db.rpc });
    expect(child.status).toBe(200);
    const payload = child.rpc.mock.calls.find(([name]) => name === "begin_citation_request")![1]._recovery_input;
    expect(payload).toMatchObject({ rawInput: null, foreignLookup: null, batchId: null });
    expect(db.totals()).toEqual({ consumed: 2, refunded: 1 });
  });
  it("stores valid empty-content structured output without forcing a formatter", async () => {
    const foreignResult = { kind: "journal_article", jurisdiction: "OTHER", fields: { articleTitle: "Fixture Title" }, grounded: { articleTitle: true },
      provenance: { articleTitle: { value: "Fixture Title", basis: "structured_metadata" } }, sources: [],
      identity: { matched: true, anchors: ["title:Fixture Title"], conflicts: [] }, diagnostics: { tier1Queried: false, tier2Fired: false }, articleResolution: "incomplete" };
    const r = await runHandler({ raw: 'Jane Doe, "Fixture Title"', label: "מאמר לועזי", foreign: { enabled: true, articleResponseVersion: 1, kind: "journal_article", jurisdiction: "OTHER", rawInput: "Fixture Title" }, foreignResult });
    expect(r.calls).toHaveLength(0);
    expect(r.body.recoveryAvailability).toBe("available");
    expect(r.rpc.mock.calls.find(([name]) => name === "finish_citation_request")![1]._result).toEqual({ content: "", foreignLookup: foreignResult });
  });
  it("rejects oversized recovery input before cache, claim or providers", async () => {
    const r = await runHandler({ ...paidFixture, raw: "א".repeat(70000) });
    expect([400, 413]).toContain(r.status);
    expect(r.rpc).not.toHaveBeenCalled(); expect(r.calls).toHaveLength(0); expect(r.zero).not.toHaveBeenCalled();
  });
  it("keeps a usable oversized live answer unconfirmed without refund or stored raw output", async () => {
    const r = await runHandler({ ...paidFixture, formatterReply: "Synthetic legal citation ".repeat(12000) });
    expect(r.status).toBe(200); expect(r.body.content.length).toBeGreaterThan(262144);
    expect(r.body.recoveryAvailability).toBe("unconfirmed");
    const terminal = r.rpc.mock.calls.filter(([name]) => name === "finish_citation_request");
    expect(terminal).toHaveLength(1); expect(terminal[0][1]).toMatchObject({ _outcome: "unknown", _result: null });
  });
});
