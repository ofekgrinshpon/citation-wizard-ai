/**
 * Israeli party-name search (Branch B): one open-web complementary search
 * when the restricted legal domains return nothing relevant. Runs the real
 * citation-chat handler; every network call is a scripted fixture.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TextEncoder } from "node:util";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as articles from "../../supabase/functions/_shared/hebrewArticleEvidence";
import * as dockets from "../../supabase/functions/_shared/caseTypePrefixes";
import * as pastedCitation from "../../supabase/functions/_shared/pastedCitation";
import * as hosts from "../../supabase/functions/_shared/trustedHosts";
import * as caseLawQuery from "../../supabase/functions/_shared/caseLawQuery";
import { groundOpenWebPartyResults, SNIPPET_EVIDENCE_DB_NAME } from "../../supabase/functions/_shared/caseLawQuery";
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

const WIKI = {
  url: "https://he.wikipedia.org/wiki/בג״ץ_קול_העם",
  title: "בג\"ץ קול העם – ויקיפדיה",
  snippet: "בג\"ץ 73/53 חברת \"קול העם\" בע\"מ נ' שר הפנים, פ\"ד ז 871 (1953), ניתן ביום 16.10.1953 בבית המשפט העליון.",
};
const KOL_HAAM = {
  found: true, caseType: "בג״ץ", caseNumber: "73/53", party1: "חברת קול העם בע״מ", party2: "שר הפנים",
  date: "16.10.1953", court: "בית המשפט העליון", isPublished: true, padi_volume: "ז", padi_part: "", padi_page: "871",
  databaseName: "נבו", year: "1953", source_url: WIKI.url,
};

describe("groundOpenWebPartyResults", () => {
  it("keeps a result whose docket and both parties appear in one returned page", () => {
    const { accepted, rejected } = groundOpenWebPartyResults([KOL_HAAM], [WIKI], "קול העם", "שר הפנים");
    expect(rejected).toBe(0);
    expect(accepted).toHaveLength(1);
    const r = accepted[0];
    expect(r.caseNumber).toBe("73/53");
    expect(r.caseType).toBe("בג״ץ");
    expect(r.party1).toBe("חברת קול העם בע״מ");
    expect(r.date).toBe("16.10.1953");
    expect(r.year).toBe("1953");
    expect(r.source_url).toBe(WIKI.url);
    // Not a legal database: the page is labelled as snippet evidence, and the
    // פ"ד claim is flagged so the caller still verifies it with trusted publishers.
    expect(r.databaseName).toBe(SNIPPET_EVIDENCE_DB_NAME);
    expect(r.openWebProof).toBe(true);
  });

  it("rejects a docket no returned page shows", () => {
    const invented = { ...KOL_HAAM, caseNumber: "74/53" };
    expect(groundOpenWebPartyResults([invented], [WIKI], "קול העם", "שר הפנים")).toEqual({ accepted: [], rejected: 1 });
  });

  it("rejects when the page names only one of the parties", () => {
    const page = { ...WIKI, snippet: "בג\"ץ 73/53 חברת \"קול העם\" בע\"מ, פ\"ד ז 871." };
    expect(groundOpenWebPartyResults([KOL_HAAM], [page], "קול העם", "שר הפנים").accepted).toHaveLength(0);
  });

  it("rejects a result without a usable case number", () => {
    expect(groundOpenWebPartyResults([{ ...KOL_HAAM, caseNumber: "" }], [WIKI], "קול העם", "שר הפנים").rejected).toBe(1);
  });

  it("drops a date, year, court or case type the page does not show", () => {
    const page = { ...WIKI, snippet: "פסק הדין 73/53 קול העם נ' שר הפנים עסק בחופש הביטוי." };
    const [r] = groundOpenWebPartyResults([{ ...KOL_HAAM, date: "01.01.1953" }], [page], "קול העם", "שר הפנים").accepted;
    expect(r.date).toBe("");
    expect(r.year).toBe("");
    expect(r.court).toBe("");
    expect(r.caseType).toBe("");
    // The model's fuller first party is not in the page → the typed name is used.
    expect(r.party1).toBe("קול העם");
  });

  it("names a trusted legal database by its address, not the snippet label", () => {
    const nevo = { ...WIKI, url: "https://www.nevo.co.il/psika_html/elyon/kol-haam.htm" };
    const [r] = groundOpenWebPartyResults([KOL_HAAM], [nevo], "קול העם", "שר הפנים").accepted;
    expect(r.databaseName).toBe("");
  });
});

// ── Real handler ─────────────────────────────────────────────────────────────
type Handler = (req: Request) => Promise<Response>;
let handler: Handler;
type Call = { url: string; body: Record<string, unknown> };
const calls: Call[] = [];
let fixture: { tier1: unknown; openWeb: unknown; openWebSearch: unknown[]; verify: unknown; date: unknown };

const chat = (content: unknown, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], ...extra }), { status: 200 });

const contentOf = (c: Call) => JSON.stringify(c.body.messages ?? "");
const isTier1Party = (c: Call) => Array.isArray(c.body.search_domain_filter) && (c.body.search_domain_filter as string[]).includes("lite.takdin.co.il") && contentOf(c).includes("בין");
const isOpenWebParty = (c: Call) => c.url.includes("perplexity") && !("search_domain_filter" in c.body) && contentOf(c).includes("source_url");

function install() {
  const guardContext = createContext({ exports: {}, crypto: webcrypto, TextEncoder, Uint8Array,
    require: (name: string) => { if (name === "node:async_hooks") return { AsyncLocalStorage }; if (name === "./citationRecovery.ts") return recovery; throw new Error(name); } });
  const compile = (input: string) => ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInContext(compile(readFileSync(resolve(__dirname, "../../supabase/functions/_shared/citationUsageGuard.ts"), "utf8")), guardContext);
  const modules: Record<string, unknown> = {
    "https://deno.land/std@0.168.0/http/server.ts": { serve: (fn: Handler) => { handler = fn; } },
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => ({
      auth: { getClaims: async () => ({ data: { claims: { sub: "test-user" } }, error: null }) },
      rpc: async (name: string, args: Record<string, unknown>) => ({ data: name === "begin_citation_request"
        ? { ok: true, execute: true, status: "in_progress", request_id: args._request_id, retry_of_request_id: null, attempt_token: "fixture-attempt-token" }
        : name === "finish_citation_request" ? { ok: true, status: args._outcome, result_stored: true, refunded: false, refund_receipt: { status: "not_applicable", refunded: false, units_refunded: 0, request_id: args._request_id } }
        : { ok: true }, error: null }),
      from: () => { const chain = { select: () => chain, eq: () => chain, or: () => chain, ilike: () => chain, abortSignal: () => chain, limit: async () => ({ data: [] }), maybeSingle: async () => ({ data: null, error: null }) }; return chain; },
    }) },
    "../_shared/costTelemetry.ts": { trackedFetch: async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const call = { url, body };
      calls.push(call);
      if (url.includes("ai.gateway.lovable.dev")) return chat("formatter-fixture");
      if (isTier1Party(call)) return chat(fixture.tier1, { citations: [] });
      if (isOpenWebParty(call)) return chat(fixture.openWeb, { search_results: fixture.openWebSearch, citations: fixture.openWebSearch.map((r) => (r as { url: string }).url) });
      if (contentOf(call).includes("פורסם בפד")) return chat(fixture.verify);
      return chat(fixture.date);
    }, withCostTelemetry: (_n: string, fn: () => unknown) => fn(), setTelemetryFromBody: () => {}, recordZeroWork: () => {} },
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
  const source = readFileSync(resolve(__dirname, "../../supabase/functions/citation-chat/index.ts"), "utf8");
  runInContext(compile(source), createContext({ exports: {}, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected module: ${name}`);
    return modules[name];
  }, console: { log: () => {}, error: () => {}, warn: () => {} }, URL, Request, Response, Headers, crypto: webcrypto, TextEncoder,
  Deno: { env: { get: (name: string) => name === "CITATION_CHAT_OPENWEB_FALLBACK" ? "off" : "mock-only" } },
  fetch: () => { throw new Error("Unmocked network is prohibited"); } }));
}

async function post(raw: string, id: string) {
  const content = `[סיווג אוטומטי: פסיקה (דפוס)]\n${raw}`;
  const res = await handler(new Request("https://local.test/citation-chat", {
    method: "POST", headers: { Authorization: "Bearer mock-token", "Content-Type": "application/json" },
    body: JSON.stringify({ citationRequestVersion: 3, requestId: id, messages: [{ role: "user", content }], rawInput: raw }),
  }));
  expect(res.status).toBe(200);
  const gateway = calls.find((c) => c.url.includes("ai.gateway.lovable.dev"));
  return gateway ? JSON.stringify(gateway.body.messages) : "";
}

function reset(next: Partial<typeof fixture>) {
  calls.length = 0;
  fixture = { tier1: { results: [] }, openWeb: { results: [] }, openWebSearch: [], verify: { isPublished: false }, date: {}, ...next };
}

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
  install();
});

describe("party-name search with an open-web complementary pass", () => {
  it("finds the docket on the open web when the legal databases return nothing", async () => {
    reset({ openWeb: { results: [KOL_HAAM] }, openWebSearch: [WIKI], verify: { isPublished: true, padi_volume: "ז", padi_page: "871", year: "1953" }, date: { date: "16.10.1953", year: "1953" } });
    const prompt = await post("קול העם נ' שר הפנים", "party-openweb-0001");
    expect(calls.filter(isTier1Party)).toHaveLength(1);
    expect(calls.filter(isOpenWebParty)).toHaveLength(1);
    expect(prompt).toContain("73/53");
    expect(prompt).toContain("פ\\\"ד ז 871");
  });

  it("keeps the case unpublished and labelled as snippet evidence when trusted publishers do not confirm פ\"ד", async () => {
    reset({ openWeb: { results: [KOL_HAAM] }, openWebSearch: [WIKI], verify: { isPublished: false } });
    const prompt = await post("קול העם נ' שר הפנים", "party-openweb-0002");
    expect(prompt).toContain("73/53");
    expect(prompt).not.toContain("פ\\\"ד ז 871");
    expect(prompt).toContain(SNIPPET_EVIDENCE_DB_NAME);
  });

  it("still verifies an open-web פ\"ד claim even when the proof page is a trusted database", async () => {
    const nevoPage = { ...WIKI, url: "https://www.nevo.co.il/psika_html/elyon/kol-haam.htm" };
    reset({ openWeb: { results: [{ ...KOL_HAAM, source_url: nevoPage.url }] }, openWebSearch: [nevoPage], verify: { isPublished: false } });
    const prompt = await post("קול העם נ' שר הפנים", "party-openweb-0005");
    expect(calls.some((c) => contentOf(c).includes("פורסם בפד"))).toBe(true);
    expect(prompt).toContain("73/53");
    expect(prompt).not.toContain("פ\\\"ד ז 871");
  });

  it("uses nothing from the open web when no page proves the docket and parties", async () => {
    reset({ openWeb: { results: [{ ...KOL_HAAM, caseNumber: "999/53" }] }, openWebSearch: [WIKI] });
    const prompt = await post("קול העם נ' שר הפנים", "party-openweb-0003");
    expect(calls.filter(isOpenWebParty)).toHaveLength(1);
    expect(prompt).not.toContain("999/53");
    expect(prompt).toContain("לא נמצאו פסקי דין רלוונטיים");
  });

  it("does not search the open web when the legal databases already found the case", async () => {
    const nevo = { ...KOL_HAAM, isPublished: false, padi_volume: "", padi_page: "", source_url: "https://www.nevo.co.il/x" };
    reset({ tier1: { results: [nevo] } });
    await post("קול העם נ' שר הפנים", "party-openweb-0004");
    expect(calls.filter(isTier1Party)).toHaveLength(1);
    expect(calls.filter(isOpenWebParty)).toHaveLength(0);
  });
});
