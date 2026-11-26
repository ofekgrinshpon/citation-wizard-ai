import * as articleValidation from "../../supabase/functions/_shared/hebrewArticleValidation";
import * as pure_render from "../../supabase/functions/_shared/citationPure/render";
import * as pure_completion from "../../supabase/functions/_shared/citationPure/completion";
import * as pure_countryLookup from "../../supabase/functions/_shared/citationPure/countryLookup";
import * as referralQualification from "../../supabase/functions/citation-chat/referralQualification";
import * as padiEvidence from "../../supabase/functions/_shared/padiPublicationEvidence";
import * as neutralDocket from "../../supabase/functions/citation-chat/neutralDocket";
import * as hebrewBookChoice from "../../supabase/functions/_shared/citationPure/hebrewBookChoice";
import * as bookEvidenceRoute from "../../supabase/functions/citation-chat/bookEvidenceRoute";
import * as bookCrossrefTarget from "../../supabase/functions/citation-chat/bookCrossrefTarget";
import * as bookCrossrefRoute from "../../supabase/functions/citation-chat/bookCrossrefRoute";
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
import * as articleRecords from "../../supabase/functions/_shared/hebrewArticleRecord";
import * as partyRoleWords from "../../supabase/functions/_shared/partyRoleWords";
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
import * as countryRoute from "../../supabase/functions/citation-chat/countryRoute";
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
let fixture: { tier1: unknown; openWeb: unknown; openWebSearch: unknown[]; verify: unknown; verifySearch?: unknown[]; date: unknown;
  docket?: unknown; docketSearch?: unknown[]; formatter?: string };

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
    "../_shared/hebrewArticleValidation.ts": articleValidation,
    "../_shared/citationPure/hebrewBookChoice.ts": hebrewBookChoice,
    "https://deno.land/std@0.168.0/http/server.ts": { serve: (fn: Handler) => { handler = fn; } },
    "npm:@supabase/supabase-js@2.117.2": { createClient: () => ({
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
      if (url.includes("ai.gateway.lovable.dev")) return chat(fixture.formatter ?? "formatter-fixture");
      if (fixture.docket && url.includes("perplexity") && !("search_domain_filter" in body) && !isOpenWebParty(call)) {
        return chat(fixture.docket, { search_results: fixture.docketSearch ?? [] });
      }
      if (isTier1Party(call)) return chat(fixture.tier1, { citations: [] });
      if (isOpenWebParty(call)) return chat(fixture.openWeb, { search_results: fixture.openWebSearch, citations: fixture.openWebSearch.map((r) => (r as { url: string }).url) });
      if (contentOf(call).includes("פורסם בפד")) return chat(fixture.verify, { search_results: fixture.verifySearch ?? [] });
      return chat(fixture.date);
    }, withCostTelemetry: (_n: string, fn: () => unknown) => fn(), setTelemetryFromBody: () => {}, recordZeroWork: () => {} },
    "../_shared/hebrewArticleEvidence.ts": articles,
    "../_shared/hebrewArticleRecord.ts": articleRecords,
    "../_shared/partyRoleWords.ts": partyRoleWords,
    "../_shared/caseTypePrefixes.ts": dockets,
    "../_shared/pastedCitation.ts": pastedCitation,
    "../_shared/padiPublicationEvidence.ts": padiEvidence,
    "./neutralDocket.ts": neutralDocket,
    "./referralQualification.ts": referralQualification,
    "../_shared/citationPure/render.ts": pure_render,
    "../_shared/citationPure/completion.ts": pure_completion,
    "../_shared/citationPure/countryLookup.ts": pure_countryLookup,
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
    "./bookEvidenceRoute.ts": bookEvidenceRoute,
    "./bookCrossrefTarget.ts": bookCrossrefTarget,
    "./bookCrossrefRoute.ts": bookCrossrefRoute,
    "./countryRoute.ts": countryRoute,
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

async function postResponse(raw: string, id: string) {
  const content = `[סיווג אוטומטי: פסיקה (דפוס)]\n${raw}`;
  const res = await handler(new Request("https://local.test/citation-chat", {
    method: "POST", headers: { Authorization: "Bearer mock-token", "Content-Type": "application/json" },
    body: JSON.stringify({ citationRequestVersion: 3, requestId: id, messages: [{ role: "user", content }], rawInput: raw }),
  }));
  expect(res.status).toBe(200);
  const gateway = calls.find((c) => c.url.includes("ai.gateway.lovable.dev"));
  return { prompt: gateway ? JSON.stringify(gateway.body.messages) : "", body: await res.json() };
}
async function post(raw: string, id: string) {
  return (await postResponse(raw, id)).prompt;
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
    reset({ openWeb: { results: [KOL_HAAM] }, openWebSearch: [WIKI], verify: { isPublished: true, padi_volume: "ז", padi_page: "871", year: "1953" }, verifySearch: [{ ...WIKI, url: "https://www.gov.il/reports/kol-haam.pdf" }], date: { date: "16.10.1953", year: "1953" } });
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

describe("typed Supreme reporter verification through the real handler, offline", () => {
  const raw = 'בג״ץ 73/53';
  const kol = 'בג״ץ 73/53 **חברת קול העם בע״מ** נ׳ **שר הפנים**, פ״ד ז 871 (1953).';
  const govRow = (snippet: string) => ({ title: raw, url:'https://www.gov.il/fixture', snippet });
  const publicationChecks = () => calls.filter((c) => c.url.includes("perplexity") && Array.isArray(c.body.search_domain_filter) && contentOf(c).includes("פורסם בפד"));
  const mainDocket = () => calls.filter((c) => c.url.includes("perplexity") && !("search_domain_filter" in c.body));
  it("keeps historical year, correct reporter without part, and literal docket, with no new provider call", async () => {
    reset({ docket:{...KOL_HAAM,year:'2053',date:'16.10.2053'}, docketSearch:[govRow(kol)], formatter:kol });
    const {body,prompt} = await postResponse(raw, "typed-padi-00001");
    expect(body.content).toBe(kol);
    expect(prompt).toContain("שנה: 1953");
    expect(prompt).not.toContain("2053");
    expect(mainDocket()).toHaveLength(1);
    expect(publicationChecks()).toHaveLength(0);
    expect(calls).toHaveLength(2);
  });
  it("binds a four-digit historical source without changing the user's docket", async () => {
    reset({ docket: KOL_HAAM,
      docketSearch: [{ title:"פסק דין", url:"https://www.gov.il/fixture", snippet:kol.replace("73/53","73/1953") }],
      formatter:kol });
    const {body} = await postResponse(raw, "typed-padi-00011");
    expect(body.content).toBe(kol);
    expect(mainDocket()).toHaveLength(2); // unchanged unanchored party follow-up, not an old-docket retry
    expect(publicationChecks()).toHaveLength(0);
    expect(calls.some((c) => contentOf(c).includes("משנת 1953"))).toBe(false);
  });
  it("retains a supplied paragraph pinpoint without comparing it as reporter page", async () => {
    const pin = kol.replace(" (1953)", ", פס׳ 3 לפסק דינו של השופט ברק (1953)");
    reset({ docket: KOL_HAAM, docketSearch:[govRow(kol)], formatter:pin });
    expect((await postResponse(raw+" פס׳ 3 לפסק דינו של השופט ברק", "typed-padi-00012")).body.content).toBe(pin);
  });
  it("uses the existing filtered second pass if initial evidence lacks the reporter", async () => {
    reset({ docket:{...KOL_HAAM,isPublished:false,padi_volume:'',padi_page:''},
      docketSearch:[govRow(kol.split(', פ״ד')[0])], verifySearch:[govRow(kol)], formatter:kol });
    const {body,prompt} = await postResponse(raw, "typed-padi-00002");
    expect(body.content).toBe(kol);
    expect(prompt).toContain("שנה: 1953");
    expect(mainDocket()).toHaveLength(1);
    expect(publicationChecks()).toHaveLength(1);
    expect(publicationChecks()[0].body.search_domain_filter).toEqual(padiEvidence.PADI_EVIDENCE_DOMAINS);
    expect(calls).toHaveLength(3);
  });
  it("does not invoke a newly eligible historical retry on a miss", async () => {
    reset({ docket:{found:false}, docketSearch:[], formatter:'לא נמצא מקור.' });
    await postResponse(raw, "typed-padi-00003");
    expect(mainDocket()).toHaveLength(1);
    expect(publicationChecks()).toHaveLength(0);
  });
  it("prevents a misformatted valid bundle, including a missing, changed or unproven reporter", async () => {
    for (const [n,draft] of [kol.replace("871","877"),kol.replace("(1953)","(1995)"),kol.replace(" 73/53 "," 73/1953 "),kol.split(', פ״ד')[0]].entries()) {
      reset({ docket:KOL_HAAM, docketSearch:[govRow(kol)], formatter:draft });
      const {body} = await postResponse(raw, `typed-padi-draft-000${n}`);
      expect(body.content).toBe(raw+'\n⚠️ פרטי הפרסום או שנת ההכרעה לא אומתו באזכור שהופק.');
    }
  });
  it("does not permit Adalah's cross-reference or a fabricated modern reporter through the formatter", async () => {
    const a = 'בג״ץ 1113/99', earlier = 'בג״ץ 240/98';
    const p1 = 'עדאלה - המרכז המשפטי לזכויות המיעוט הערבי בישראל', p2 = 'השר לענייני דתות';
    const bad = `${a} ${p1} נ׳ ${p2}, פ״ד נב(5) 167 (2000).`;
    reset({ docket:{...KOL_HAAM,caseNumber:'1113/99',party1:p1,party2:p2,year:'2000',date:'18.4.2000',padi_volume:'נב',padi_part:'5',padi_page:'167'},
      docketSearch:[{ title:a, url:'https://supreme.court.gov.il/1113-99',date:'2000-04-18',snippet:bad.replace(a,earlier)}],formatter:bad });
    const ad = await postResponse(a, "typed-padi-00004");
    expect(ad.prompt).not.toContain("167");
    expect(ad.body.content).not.toContain("167");
    const h='בג״ץ 5555/18', fake=`${h} חסון נ׳ כנסת ישראל, פ״ד נד(1) 1 (2021).`;
    reset({ docket:{...KOL_HAAM,caseNumber:'5555/18',party1:'חסון',party2:'כנסת ישראל',date:'8.7.2021',year:'2021',padi_volume:'נד',padi_part:'1',padi_page:'1'},
      docketSearch:[{title:h,url:'https://supreme.court.gov.il/5555-18',date:'2021-07-08',snippet:fake}],formatter:fake });
    const hz=await postResponse(h,"typed-padi-00005");
    expect(hz.body.content).not.toContain('נד(1) 1');
    reset({ docket:{...KOL_HAAM,isPublished:false,padi_volume:'',padi_page:'',caseNumber:'5555/18',party1:'חסון',party2:'כנסת ישראל',date:'8.7.2021',year:'2021'},
      docketSearch:[{title:h,url:'https://supreme.court.gov.il/5555-18',date:'2021-07-08',snippet:'חסון נ׳ כנסת ישראל'}],
      formatter:`${h} **חסון** נ׳ **כנסת ישראל** (אר״ש 8.7.2021).` });
    const db=await postResponse(h,"typed-padi-00006");
    expect(db.body.content).toContain('אר״ש 8.7.2021');
  });
  it("locks Panḥasi's reporter year before a different same-docket date, then withholds a result on two proof records", async () => {
    const p = 'בג״ץ 1843/93';
    const a = `${p} **פנחסי** נ׳ **כנסת ישראל**, פ״ד מח(4) 492 (1993).`;
    const b = `${p} **פנחסי** נ׳ **כנסת ישראל**, פ״ד מט(1) 661 (17.1.1995).`;
    const row = (snippet: string) => ({title:p,url:'https://supreme.court.gov.il/1843-93',date:'1995-01-17',snippet});
    const model = {...KOL_HAAM,caseNumber:'1843/93',party1:'פנחסי',party2:'כנסת ישראל',year:'1995',date:'17.1.1995'};
    reset({ docket:model,docketSearch:[row(a)],formatter:a });
    const single = await postResponse(p, "typed-padi-00007");
    expect(single.prompt).toContain("שנה: 1993");
    expect(single.prompt).not.toContain("17.1.1995");
    expect(single.body.content).toBe(a);
    reset({ docket:model,docketSearch:[row(a+" " + b)],formatter:a });
    const conflict = await postResponse(p, "typed-padi-00008");
    expect(conflict.prompt).toContain("פרטי הכרעה סותרים");
    expect(conflict.body.content).toBe(p+'\n⚠️ נמצאו פרטי הכרעה סותרים לאותו תיק; לא הופק אזכור מאומת.');
    expect(publicationChecks()).toHaveLength(0);
  });
  it("does not change explicitly lower-court or already supplied printed-reference paths", async () => {
    const lower = 'עש״א 1477-12-22';
    const original = `${lower} **הקיבוץ המאוחד** נ׳ **רשות הפטנטים** (אר״ש 9.4.2024).`;
    reset({ docket:{...KOL_HAAM,isPublished:false,padi_volume:'',padi_page:'',caseType:'עש״א',caseNumber:'1477-12-22',party1:'הקיבוץ המאוחד',party2:'רשות הפטנטים',date:'9.4.2024',year:'2024'},
      docketSearch:[{title:lower,url:'https://court.gov.il/1477-12-22',date:'2024-04-09',snippet:'הקיבוץ המאוחד נ׳ רשות הפטנטים'}],formatter:original });
    expect((await postResponse(lower, "typed-padi-00009")).body.content).toBe(original);
    expect(publicationChecks()).toHaveLength(0);
    reset({ docket:{found:false},formatter:kol });
    expect((await postResponse(kol.split("**").join(""), "typed-padi-00010")).body.content).toBe(kol);
  });
});
