import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import * as adapter from "@/lib/foreignArticleAdapter";
import * as abbreviations from "@/data/abbreviations";
import * as validation from "@/lib/citationValidation";
import * as telemetry from "@/lib/costTelemetry";
import * as citationUtils from "@/lib/citationUtils";
import { validateCitationInput } from "@/lib/citationInputValidation";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";

// Execute the actual nested Index handlers in the real Vitest/jsdom setup.
// Only their UI/service boundaries are injected; request and response logic,
// article parsing/lookup/rendering and telemetry payload construction are real.
const source = readFileSync(resolve(__dirname, "../pages/Index.tsx"), "utf8");
const tree = ts.createSourceFile("Index.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name: string, context: Record<string, unknown>): (...args: unknown[]) => Promise<unknown> {
  let expression = "";
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) expression = node.initializer.getText(tree);
    ts.forEachChild(node, walk);
  };
  walk(tree);
  if (!expression) throw new Error(`Missing actual Index handler: ${name}`);
  const code = ts.transpileModule(`const testedHandler = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
  return new Function(...Object.keys(context), `${code}\nreturn testedHandler;`)(...Object.values(context));
}

const raw = "Warren & Brandeis, The Right to Privacy, pp. 213–214.";
const complete = "Warren & Brandeis, The Right to Privacy, 4 Harv. L. Rev. 193, 213–214 (1890)";
const original = { title: "The Right to Privacy — Warren and Brandeis", url: "https://law.harvard.edu/privacy", snippet: "Samuel D. Warren and Louis D. Brandeis, The Right to Privacy, 4 Harvard Law Review 193 (1890)." };
const history = [{ role: "user", content: "Earlier source" }, { role: "assistant", content: "Earlier citation" }];
const tel = { feature: "uniform_citation", telemetryBatchId: "batch-attribution", telemetryRequestId: "source-attribution" } as const;
const cached = { source_name: "Warren & Brandeis, The Right to Privacy", full_citation: "Samuel D. Warren & Louis D. Brandeis, The Right to Privacy, 4 Harv. L. Rev. 193, 201–203 (1890)", source_type: "article" };
const last = <T,>(items: T[]): T => items[items.length - 1];

function harness(options: { rawInput?: string; sourceType?: abbreviations.SourceType; cache?: typeof cached; errorInfo?: Record<string, unknown>; lookup?: "ok" | "empty" | "timeout" | "unavailable" | "conflict" | "missing_contract" } = {}) {
  const provider = vi.fn(async (url: string) => {
    if (url !== "https://api.perplexity.ai/search") return new Response("", { status: 404 });
    if (options.lookup === "timeout") throw new DOMException("Timed out", "AbortError");
    const results = options.lookup === "empty" ? [] : options.lookup === "conflict"
      ? [original, { ...original, url: "https://lawreview.example.edu/other", snippet: original.snippet.replace("4 Harvard Law Review 193 (1890)", "39 Catholic U. L. Rev. 703 (1990)") }]
      : [original];
    return new Response(JSON.stringify({ results }), { status: 200 });
  });
  const invokeFunction = vi.fn(async (_name, body: Record<string, unknown>) => {
    if (options.errorInfo) return { data: null, errorInfo: options.errorInfo };
    if (options.lookup === "missing_contract") return { data: { content: "Unbound legacy output" }, errorInfo: null };
    if (!body.foreignLookup) return { data: { content: "##Capitol Records, LLC v. ReDigi Inc.##, 910 F.3d 649 (2d Cir. 2018)." }, errorInfo: null };
    const foreignLookup = await runForeignLookup(body.foreignLookup as ForeignLookupInput, { fetchImpl: provider as unknown as typeof fetch, apiKey: options.lookup === "unavailable" ? null : "fixture" });
    return { data: { content: "", foreignLookup }, errorInfo: null };
  });
  const toast = { error: vi.fn(), info: vi.fn() };
  const handleRefundResponse = vi.fn();
  const callAPI = handler("callAPI", { ...adapter, ...telemetry, invokeFunction, toast, handleRefundResponse, projectId: "project-preserved", crypto: { randomUUID: () => "request-preserved" } });
  const insert = vi.fn(async (_rows: Array<Record<string, unknown>>) => ({}));
  const state = { setMessages: vi.fn(), setPendingSuggestion: vi.fn() };
  const resolveSourceType = vi.fn(async () => ({ sourceType: options.sourceType ?? "foreign_journal_article", source: "regex" }));
  const findVerifiedSourceMatch = vi.fn(async () => options.cache ?? null);
  const findSimilarVerifiedSource = vi.fn(async () => options.cache ?? null);
  const subscription = { loading: false, isLimitReached: false, incrementCount: vi.fn(async () => {}) };
  const context = {
    ...adapter, ...abbreviations, ...validation, ...citationUtils, ...telemetry, ...state,
    input: options.rawInput ?? raw, loading: false, validateCitationInput, toast, subscription,
    setInput: vi.fn(), setLoading: vi.fn(), setLoadingMessage: vi.fn(), messages: history,
    resolveSourceType, findVerifiedSourceMatch, findSimilarVerifiedSource, callAPI,
    buildFullRawInput: (value: string) => value,
    setPendingBillType: vi.fn(), setPendingTreatyType: vi.fn(), setMessageSourceTypes: vi.fn(), setMessageRawInputs: vi.fn(),
    classifyVerifiedSource: vi.fn(), getVerifiedCategoryLabel: () => "מאמר", reportZeroWork: vi.fn(),
    user: { id: "fixture-user" }, currentProject: { id: "project-preserved" },
    supabase: { from: () => ({ insert }) }, setCitationRefreshKey: vi.fn(), logActivity: vi.fn(),
    saveVerifiedSource: vi.fn(async () => {}), setPendingVerification: vi.fn(),
  };
  const handleSend = handler("handleSend", context);
  return { callAPI, handleSend, context, state, insert, invokeFunction, provider, toast, handleRefundResponse, resolveSourceType, findVerifiedSourceMatch, findSimilarVerifiedSource, subscription };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unmocked network forbidden"); })));
afterEach(() => vi.unstubAllGlobals());

describe("legacy standalone article adapter", () => {
  it.each([raw, complete])("keeps one classified, server-billed operation for %s", async (rawInput) => {
    const h = harness({ rawInput });
    await h.handleSend();
    expect(h.resolveSourceType).toHaveBeenCalledTimes(1);
    expect(h.findVerifiedSourceMatch).toHaveBeenCalledTimes(1);
    expect(h.invokeFunction).toHaveBeenCalledTimes(1);
    expect(h.provider).toHaveBeenCalledTimes(1);
    expect(h.subscription.incrementCount).not.toHaveBeenCalled();
    const body = h.invokeFunction.mock.calls[0][1];
    expect(body.messages).toEqual([...history, { role: "user", content: expect.stringContaining(rawInput) }]);
    expect(body.foreignLookup).toMatchObject({ enabled: true, articleResponseVersion: 1, kind: "journal_article", rawInput, parsedFields: { authors: "Warren & Brandeis", articleTitle: "The Right to Privacy", pinpoint: "213–214" } });
    const messages = last(h.state.setMessages.mock.calls)[0] as typeof history;
    expect(last(messages).content).toContain("193, 213–214 (1890)");
    expect(last(messages).content).toContain("Samuel D. Warren and Louis D. Brandeis");
    expect(last(messages).content).not.toContain("⚠️");
    expect(h.insert.mock.calls[0][0][0].formatted_output).toContain("213–214");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(["empty", "timeout", "unavailable"] as const)("preserves supplied fields and warning on %s lookup", async (lookup) => {
    const h = harness({ lookup });
    const reply = await h.callAPI("existing prompt", history, tel, { sourceType: "foreign_journal_article", rawInput: raw });
    expect(reply).toContain("Warren & Brandeis");
    expect(reply).toContain("The Right to Privacy");
    expect(reply).toContain("[חסר: עמוד], 213–214");
    expect(reply).toContain("⚠️");
    expect(h.invokeFunction).toHaveBeenCalledTimes(1);
    expect(h.provider).toHaveBeenCalledTimes(lookup === "unavailable" ? 0 : 2);
    expect(h.handleRefundResponse).toHaveBeenCalledTimes(1);
  });

  it("preserves API error/toast behavior without rendering or retrying", async () => {
    const h = harness({ errorInfo: { code: "INSUFFICIENT_CREDITS", message: "No credits", isInvalidInput: false } });
    await expect(h.callAPI("existing prompt", history, tel, { sourceType: "foreign_journal_article", rawInput: raw })).rejects.toMatchObject({ message: "INSUFFICIENT_CREDITS", handled: true, userMessage: "No credits" });
    expect(h.toast.error).toHaveBeenCalledWith("No credits", { description: undefined });
    expect(h.provider).not.toHaveBeenCalled();
    expect(h.handleRefundResponse).not.toHaveBeenCalled();
    expect(h.invokeFunction).toHaveBeenCalledTimes(1);
  });

  it("shows the structured conflict warning without substituting either publication", async () => {
    const h = harness({ lookup: "conflict" });
    const reply = await h.callAPI("existing prompt", history, tel, { sourceType: "foreign_journal_article", rawInput: raw });
    expect(reply).toContain("סותרים");
    expect(reply).toContain("[חסר: עמוד], 213–214");
    expect(reply).not.toContain("703");
    expect(h.invokeFunction).toHaveBeenCalledTimes(1);
  });

  it("preserves the request with a warning if the expected response contract is unavailable", async () => {
    const h = harness({ lookup: "missing_contract" });
    const reply = await h.callAPI("existing prompt", history, tel, { sourceType: "foreign_journal_article", rawInput: raw });
    expect(reply).toContain("The Right to Privacy");
    expect(reply).toContain("213–214");
    expect(reply).toContain("⚠️");
    expect(reply).not.toContain("Unbound legacy output");
  });

  it("keeps compatible cached articles free and replaces stale requested pages", async () => {
    const h = harness({ cache: cached });
    await h.handleSend();
    expect(h.resolveSourceType).toHaveBeenCalledTimes(1);
    expect(h.findVerifiedSourceMatch).toHaveBeenCalledTimes(1);
    expect(h.findSimilarVerifiedSource).not.toHaveBeenCalled();
    expect(h.invokeFunction).not.toHaveBeenCalled();
    expect(h.provider).not.toHaveBeenCalled();
    expect(h.subscription.incrementCount).toHaveBeenCalledTimes(1);
    const messages = last(h.state.setMessages.mock.calls)[0] as typeof history;
    expect(last(messages).content).toContain("193, 213–214 (1890)");
    expect(last(messages).content).toContain("Samuel D. Warren & Louis D. Brandeis");
    expect(last(messages).content).not.toContain("201–203");
  });

  it("rejects a wrong-work direct/fuzzy cache candidate and uses one lookup", async () => {
    const h = harness({ cache: { ...cached, full_citation: "Another Author, Another Work, 39 Cath. U. L. Rev. 703 (1990)" } });
    await h.handleSend();
    expect(h.state.setPendingSuggestion).not.toHaveBeenCalled();
    expect(h.invokeFunction).toHaveBeenCalledTimes(1);
    expect(h.provider).toHaveBeenCalledTimes(1);
    expect(h.subscription.incrementCount).not.toHaveBeenCalled();
    const messages = last(h.state.setMessages.mock.calls)[0] as typeof history;
    expect(last(messages).content).toContain("193, 213–214 (1890)");
  });

  it("does not inherit cached pinpoints when none were requested", () => {
    expect(adapter.mergeForeignArticleCache("Warren & Brandeis, The Right to Privacy", cached.full_citation)).not.toContain("201–203");
  });

  it.each(["foreign_case_us", "foreign_book", "foreign_book_chapter", "article_in_book"] as const)("keeps the %s request payload, history, telemetry and return behavior unchanged", async (sourceType) => {
    const h = harness();
    const reply = await h.callAPI("unchanged case prompt", history, tel, { sourceType, rawInput: "Capitol Records v ReDigi" });
    expect(h.invokeFunction).toHaveBeenCalledWith("citation-chat", {
      messages: [...history, { role: "user", content: "unchanged case prompt" }], requestId: "request-preserved",
      telemetryFeature: "uniform_citation", telemetryBatchId: "batch-attribution", telemetryRequestId: "source-attribution",
    }, { projectId: "project-preserved" });
    expect(reply).toContain("910 F.3d 649");
    expect(h.provider).not.toHaveBeenCalled();
    expect(adapter.compatibleArticleCache("foreign_book", "Any book", cached)).toBe(cached);
  });

  it("adds only rawInput for Hebrew articles and keeps their content response contract", async () => {
    const h = harness();
    await h.callAPI("existing Hebrew prompt", history, tel, { sourceType: "article", rawInput: 'מחבר "מאמר"' });
    expect(h.invokeFunction.mock.calls[0][1]).toMatchObject({ rawInput: 'מחבר "מאמר"' });
    expect(h.invokeFunction.mock.calls[0][1]).not.toHaveProperty("foreignLookup");
    expect(adapter.compatibleArticleCache("article", 'מחבר "מאמר"', cached)).toBeNull();
    expect(adapter.articleRequestFields("article_in_book", 'מחבר "פרק"')).toEqual({});
    expect(adapter.compatibleArticleCache("article_in_book", 'מחבר "פרק"', cached)).toBe(cached);
  });
});
