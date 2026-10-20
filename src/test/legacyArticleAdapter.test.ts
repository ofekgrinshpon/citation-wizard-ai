import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import * as adapter from "@/lib/foreignArticleAdapter";
import * as statuteAdapter from "@/lib/foreignStatuteAdapter";
import { renderUsUnreportedLocal } from "@/lib/usUnreportedLocal";
import { renderUnpublishedLocal } from "@/lib/unpublishedWorkLocal";
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
  const citationRetryRef = { current: null as { descriptor: unknown; run: () => Promise<string>; isCurrent: () => boolean } | null };
  const retryCitationFunction = vi.fn(async () => ({ data: { content: "Recovered exact citation from the failed request" }, errorInfo: null }));
  const setCitationRetry = vi.fn();
  const setCitationStatus = vi.fn();
  const citationRevision = { current: 0 };
  const citationScope = { current: { accountId: "fixture-user", projectId: "project-preserved", mode: "freetext" } };
  const callAPI = handler("callAPI", { ...adapter, ...statuteAdapter, ...telemetry, renderUsUnreportedLocal, renderUnpublishedLocal, invokeFunction, retryCitationFunction, toast, handleRefundResponse, projectId: "project-preserved", crypto: { randomUUID: () => "request-preserved" },
    clearCitationRetry: () => { citationRevision.current += 1; citationRetryRef.current = null; }, citationRevision, citationScope, citationRetryRef, setCitationRetry, setCitationStatus, user: { id: "fixture-user" }, mode: "freetext",
  });
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
    saveCitationHistoryRecord: async (entry: Record<string, unknown>) => {
      await insert([entry]);
      return { historyId: "synthetic-history", alreadySaved: false };
    },
    saveVerifiedSource: vi.fn(async () => {}), setPendingVerification: vi.fn(),
  };
  const handleSend = handler("handleSend", context);
  return { callAPI, handleSend, context, state, insert, invokeFunction, retryCitationFunction, citationRetryRef, citationScope, citationRevision, setCitationRetry, setCitationStatus, provider, toast, handleRefundResponse, resolveSourceType, findVerifiedSourceMatch, findSimilarVerifiedSource, subscription };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unmocked network forbidden"); })));
afterEach(() => vi.unstubAllGlobals());

describe("legacy standalone article adapter", () => {
  it("explicit retry reuses the saved success continuation once, preserving history/verification without classifying again", async () => {
    const descriptor = { failedRequestId: "failed-request-parent", handle: "fixture-handle", refundConfirmed: false, refundStatus: "deferred",
      refundReceipt: { status: "deferred", refunded: false, units_refunded: 0, request_id: "failed-request-parent" } };
    const h = harness({ sourceType: "foreign_case_us", errorInfo: { code: "AI_REFUSED", status: 422, message: "Failed", citationRetry: descriptor } });
    await h.handleSend();
    expect(h.insert).not.toHaveBeenCalled();
    const offer = h.citationRetryRef.current!;
    expect(offer.descriptor).toBe(descriptor);
    await offer.run();
    await offer.run();
    expect(h.resolveSourceType).toHaveBeenCalledTimes(1);
    expect(h.findVerifiedSourceMatch).toHaveBeenCalledTimes(1);
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.context.saveVerifiedSource).toHaveBeenCalledTimes(1);
    expect(last(h.state.setMessages.mock.calls)[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", content: expect.stringContaining("Recovered exact citation") }),
    ]));
  });

  it.each(["account", "project", "revision"])("does not restore old messages/input/loading after a stale %s response", async (changed) => {
    const h = harness();
    let resolve!: (value: { data: null; errorInfo: Record<string, unknown> }) => void;
    h.invokeFunction.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = h.handleSend();
    await vi.waitFor(() => expect(h.invokeFunction).toHaveBeenCalledTimes(1));
    const messagesBefore = h.state.setMessages.mock.calls.length;
    const inputsBefore = h.context.setInput.mock.calls.length;
    const loadingBefore = h.context.setLoading.mock.calls.length;
    if (changed === "revision") h.citationRevision.current += 1;
    else h.citationScope.current = { ...h.citationScope.current, [changed === "account" ? "accountId" : "projectId"]: "new-scope" };
    resolve({ data: null, errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN", message: "Unknown" } });
    await pending;
    expect(h.state.setMessages).toHaveBeenCalledTimes(messagesBefore);
    expect(h.context.setInput).toHaveBeenCalledTimes(inputsBefore);
    expect(h.context.setLoading).toHaveBeenCalledTimes(loadingBefore);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("rechecks retry scope after the saved continuation awaits verification metadata", async () => {
    const descriptor = { failedRequestId: "failed-request-parent", handle: "fixture-handle", refundConfirmed: false, refundStatus: "deferred",
      refundReceipt: { status: "deferred", refunded: false, units_refunded: 0, request_id: "failed-request-parent" } };
    const h = harness({ sourceType: "primary_legislation", rawInput: 'חוק העונשין, התשל"ז-1977',
      errorInfo: { code: "AI_REFUSED", status: 422, message: "Failed", citationRetry: descriptor } });
    await h.handleSend();
    const offer = h.citationRetryRef.current!;
    let resolve!: (value: { data: unknown[] }) => void;
    const lookup = vi.fn(() => new Promise((done) => { resolve = done; }));
    Object.assign(h.context.supabase, { from: (table: string) => table === "citation_history" ? { insert: h.insert }
      : { select: () => ({ or: () => ({ limit: lookup }) }) } });
    const retry = offer.run();
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    h.citationScope.current = { ...h.citationScope.current, projectId: "new-project" };
    resolve({ data: [] });
    await expect(retry).rejects.toMatchObject({ message: "CITATION_RETRY_STALE" });
    expect(h.context.setPendingVerification).not.toHaveBeenCalled();
    expect(h.context.saveVerifiedSource).not.toHaveBeenCalled();
    expect(h.insert).toHaveBeenCalledTimes(1);
  });

  it("restores input and exact model history after an unknown outcome so a manual retry keeps its payload", async () => {
    const h = harness({ errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN", message: "Outcome unknown", status: 503 } });
    await h.handleSend();
    const restoredHistory = last(h.state.setMessages.mock.calls)[0];
    const restoredInput = last(h.context.setInput.mock.calls)[0];
    expect(restoredHistory).toEqual(history);
    expect(restoredInput).toBe(raw);
    await handler("handleSend", { ...h.context, messages: restoredHistory, input: restoredInput })();
    expect(h.invokeFunction).toHaveBeenCalledTimes(2);
    const [first, second] = h.invokeFunction.mock.calls.map(([, body]) => body);
    expect(second.messages).toEqual(first.messages);
    expect(second.foreignLookup).toEqual(first.foreignLookup);
    expect(second.rawInput).toEqual(first.rawInput);
  });

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
    }, expect.objectContaining({ projectId: "project-preserved" }));
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


describe("standalone citation request status context", () => {
  it("offers the exact failed request without generating a new identity", async () => {
    const h = harness({ errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN", message: "Unknown", requestId: "known-request-id", status: 503 } });
    await expect(h.callAPI("input", [])).rejects.toMatchObject({ handled: true });
    expect(h.setCitationStatus).toHaveBeenCalledWith({ requestId: "known-request-id", isCurrent: expect.any(Function) });
    const context = h.setCitationStatus.mock.calls[0][0];
    expect(context.isCurrent()).toBe(true);
    h.citationScope.current.accountId = "another-user";
    expect(context.isCurrent()).toBe(false);
    expect(h.invokeFunction).toHaveBeenCalledTimes(1);
    expect(h.retryCitationFunction).not.toHaveBeenCalled();
  });
  it("does not offer a recovery link for rejected input", async () => {
    const h = harness({ errorInfo: { code: "INVALID_INPUT", message: "Invalid", requestId: "known-request-id", isInvalidInput: true } });
    await expect(h.callAPI("input", [])).rejects.toMatchObject({ handled: true });
    expect(h.setCitationStatus).not.toHaveBeenCalled();
  });
});
