import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as articles from "../../supabase/functions/_shared/hebrewArticleEvidence";
import * as dockets from "../../supabase/functions/_shared/caseTypePrefixes";
import * as hosts from "../../supabase/functions/_shared/trustedHosts";
import * as ranges from "../../supabase/functions/_shared/hebrewNumberRange";
import * as editors from "../../supabase/functions/_shared/articleCitationValidator";
import * as knesset from "../../supabase/functions/_shared/knessetTerms";
import * as usage from "../../supabase/functions/_shared/usageWeights";
import { articleLookupFallback } from "../../supabase/functions/citation-chat/foreignLookup";
import { buildEnginePromptHint } from "@/lib/citationValidation";
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
async function runHandler(options: { raw?: string; records?: unknown[]; candidate?: Record<string, unknown>; cached?: Array<Record<string, unknown>>; fail?: boolean; fallback?: boolean; label?: string; noPplx?: boolean; foreign?: Record<string, unknown>; foreignResult?: Record<string, unknown>; foreignThrows?: boolean; formatterReply?: string; compiledEntrypoint?: string } = {}) {
  const calls: Array<{ stage: string; body: Record<string, unknown> }> = [];
  const rpc = vi.fn(async (_name: string, _args: unknown) => ({ data: { ok: true }, error: null }));
  const zero = vi.fn();
  const client = {
    auth: { getClaims: async () => ({ data: { claims: { sub: "test-user" } }, error: null }) },
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ or: () => ({ limit: async () => ({ data: options.cached || [] }) }) }) }) }),
  };
  let handler: (req: Request) => Promise<Response>;
  const fetchProvider = async (_url: string, init: RequestInit, meta: { stage: string }) => {
    const body = JSON.parse(String(init.body));
    calls.push({ stage: meta.stage, body });
    if (meta.stage === "formatter") return new Response(JSON.stringify({ choices: [{ message: { content: options.formatterReply || wrong } }] }));
    if (options.fail) return new Response("offline test failure", { status: 503 });
    const isFallback = meta.stage === "biblio_fallback";
    const candidate = meta.stage === "author_check" ? { author: "דפנה ברק-ארז", confidence: "high" } : options.fallback && !isFallback ? { found: false } : isFallback ? { ...proposed, kind: "journal", title: proposed.articleTitle } : options.candidate || proposed;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(candidate) } }], citations: [result().url], search_results: options.fallback && !isFallback ? [] : options.records || [result()] }));
  };
  const modules: Record<string, unknown> = {
    "https://deno.land/std@0.168.0/http/server.ts": { serve: (f: typeof handler) => { handler = f; } },
    "https://esm.sh/@supabase/supabase-js@2": { createClient: () => client },
    "../_shared/costTelemetry.ts": { trackedFetch: fetchProvider, withCostTelemetry: (_name: string, fn: () => unknown) => fn(), setTelemetryFromBody: () => {}, recordZeroWork: zero },
    "../_shared/hebrewArticleEvidence.ts": articles,
    "../_shared/caseTypePrefixes.ts": dockets,
    "../_shared/trustedHosts.ts": hosts,
    "../_shared/hebrewNumberRange.ts": ranges,
    "../_shared/articleCitationValidator.ts": editors,
    "../_shared/knessetTerms.ts": knesset,
    "../_shared/usageWeights.ts": usage,
    "./foreignLookup.ts": { runForeignLookup: async () => { if (options.foreignThrows) throw new Error("Mock lookup boundary failed"); return options.foreignResult; }, articleLookupFallback },
  };
  runInContext(options.compiledEntrypoint || compiled, createContext({ exports: {}, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected real module boundary: ${name}`);
    return modules[name];
  }, console: { log: () => {}, error: () => {}, warn: () => {} }, URL, Request, Response, crypto,
  Deno: { env: { get: (name: string) => name === "CITATION_CHAT_OPENWEB_FALLBACK" ? "off" : name === "PERPLEXITY_API_KEY" && options.noPplx ? undefined : "mock-only" } },
  fetch: () => { throw new Error("Unmocked network is prohibited"); },
  }));
  const raw = options.raw || natural;
  const label = options.label || "מאמר";
  const message = `[סיווג אוטומטי: ${label}]\n${label === "מאמר" ? buildEnginePromptHint("article") : ""}${raw}`;
  const response = await handler!(new Request("https://local.test/citation-chat", { method: "POST", headers: { Authorization: "Bearer mock-token", "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: message }], rawInput: raw, ...(options.foreign ? { foreignLookup: options.foreign } : {}) }) }));
  return { body: await response.json(), status: response.status, calls, rpc, zero };
}

describe("article boundary through the real edge handler", () => {
  it("renders grounded facts with the supplied pinpoint and makes no formatter call", async () => {
    const r = await runHandler();
    expect(r.status).toBe(200);
    expect(r.body.content).toContain('"כתיבה שיפוטית" **משפטים** מו 269, 293–291 (התשע״ז).');
    expect(r.body.content).not.toContain("2018");
    expect(r.calls.map(c => c.stage)).toEqual(["article_retrieval_tier1", "author_check"]);
    expect(r.calls.every(c => c.body.model === "sonar-pro")).toBe(true);
    expect(r.rpc.mock.calls.filter(c => c[0] === "consume_credits")).toHaveLength(1);
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
    const baseline = compileEntrypoint(readFileSync(baselinePath!, "utf8"));
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
      const before = await runHandler({ ...input, compiledEntrypoint: baseline });
      const after = await runHandler(input);
      expect(after.status).toBe(before.status);
      expect(after.body).toEqual(before.body);
      expect(after.calls).toEqual(before.calls);
      expect(after.rpc.mock.calls.map(([name, args]) => [name, { ...(args as object), _request_id: "comparison" }]))
        .toEqual(before.rpc.mock.calls.map(([name, args]) => [name, { ...(args as object), _request_id: "comparison" }]));
      expect(after.zero.mock.calls).toEqual(before.zero.mock.calls);
    }
  });
});
