import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSourceType } from "@/lib/sourceTypeClassifier";
import { runCitation } from "@/lib/runCitation";
import { articleRequestFields } from "@/lib/foreignArticleAdapter";
import { applyRepeatCitationRules } from "@/lib/footnoteRepeatRules";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";

const boundaries = vi.hoisted(() => ({ classifier: vi.fn(), invoke: vi.fn(), verified: vi.fn(), zero: vi.fn() }));
// Only transport/storage boundaries are replaced. Classifier selection,
// request construction, lookup and rendering execute production code.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: boundaries.classifier } } }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: boundaries.invoke }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: boundaries.verified, classifyVerifiedSource: vi.fn(), getVerifiedCategoryLabel: vi.fn() }));
vi.mock("@/lib/refundResponse", () => ({ handleRefundResponse: vi.fn() }));
vi.mock("@/lib/costTelemetry", async (original) => ({ ...await original<typeof import("@/lib/costTelemetry")>(), reportZeroWork: boundaries.zero }));

const doi = "10.2307/1321160", title = "The Right to Privacy";
const partial = `Warren & Brandeis, ${title}, pp. 213–214.`;
const complete = `Warren & Brandeis, ${title}, 4 Harv. L. Rev. 193, 213–214 (1890)`;
// Explicitly synthetic positive evidence; no metadata or query is live.
const donor = { title, url: `https://doi.org/${doi}`, snippet: `@article{warren, title={${title}}, author={Samuel D. Warren and Louis D. Brandeis}, journal={Harvard Law Review}, volume=4, pages={193--220}, year=1890, doi={${doi}}}` };
let searchCalls: Record<string, unknown>[], pageCalls: string[];

beforeEach(() => {
  vi.clearAllMocks();
  searchCalls = []; pageCalls = [];
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unmocked network forbidden in identifier routing"); }));
  boundaries.verified.mockResolvedValue(null);
  boundaries.classifier.mockResolvedValue({ data: { sourceType: "foreign_journal_article", confidence: 0.8, reason: "Synthetic classifier reply" }, error: null });
  boundaries.invoke.mockImplementation(async (_name, body) => {
    if (!body.foreignLookup) return { data: { content: "Generic fallback remains available." }, errorInfo: null };
    const fetchImpl = (async (address: string | URL | Request, init?: RequestInit) => {
      const url = String(address);
      if (url === "https://api.perplexity.ai/search") {
        searchCalls.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ results: [donor] }), { status: 200 });
      }
      pageCalls.push(url);
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const foreignLookup = await runForeignLookup(body.foreignLookup as ForeignLookupInput, { apiKey: "offline-only", fetchImpl });
    return { data: { content: "", foreignLookup }, errorInfo: null };
  });
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("actual identifier classification and client routes", () => {
  it.each([doi, `${doi}.`, `https://doi.org/${doi}`, `${partial} https://doi.org/${doi}`, `${partial} DOI ${doi}`])("routes %s using the classifier's article verdict and retains the identifier", async (rawInput) => {
    const result = await runCitation({ rawInput, useVerifiedStore: false });
    expect(result.sourceType).toBe("foreign_journal_article");
    expect(result.status).toBe("valid");
    expect(result.citation).toContain(title);
    expect(boundaries.classifier).toHaveBeenCalledTimes(1);
    expect(boundaries.classifier).toHaveBeenCalledWith("classify-source", expect.objectContaining({ body: expect.objectContaining({ rawText: rawInput }) }));
    expect(boundaries.invoke).toHaveBeenCalledTimes(1);
    const request = boundaries.invoke.mock.calls[0][1].foreignLookup;
    expect(request.parsedFields.doi).toBe(doi);
    expect(request.parsedFields.articleTitle).toBe(rawInput.includes(title) ? title : undefined);
    expect(searchCalls).toHaveLength(1);
    expect(pageCalls).toEqual([]);
  });
  it("preserves the exact original input route and its pinpoint", async () => {
    const result = await runCitation({ rawInput: partial, useVerifiedStore: false });
    expect(result.citation).toContain("193, 213–214 (1890)");
    expect(boundaries.classifier).toHaveBeenCalledTimes(1);
    expect(searchCalls).toHaveLength(1);
  });
  it("lets citation text with an appended publisher URL reach classification and the same adapter used by Index", async () => {
    const raw = `${partial} https://law.harvard.edu/privacy`;
    const selected = await resolveSourceType(raw);
    expect(selected.sourceType).toBe("foreign_journal_article");
    const request = articleRequestFields(selected.sourceType, raw).foreignLookup;
    expect(request?.parsedFields).toMatchObject({ articleTitle: title, authors: "Warren & Brandeis", pinpoint: "213–214", sourceUrl: "https://law.harvard.edu/privacy" });
    expect(boundaries.classifier).toHaveBeenCalledTimes(1);
  });
  it("keeps ordinary URL-only routing unchanged", async () => {
    const selected = await resolveSourceType("https://law.harvard.edu/privacy");
    expect(selected).toEqual({ sourceType: "internet", source: "regex" });
    expect(boundaries.classifier).not.toHaveBeenCalled();
    expect(articleRequestFields(selected.sourceType, "https://law.harvard.edu/privacy")).toEqual({});
  });
  it("does not force a DOI URL to be an article when the classifier identifies a book", async () => {
    boundaries.classifier.mockResolvedValue({ data: { sourceType: "foreign_book", confidence: 0.9 }, error: null });
    const raw = "https://doi.org/10.1017/CBO9780511625138";
    const selected = await resolveSourceType(raw);
    expect(selected.sourceType).toBe("foreign_book");
    expect(articleRequestFields(selected.sourceType, raw)).toEqual({});
  });
  it.each([
    { data: null, error: new Error("Synthetic unavailable classifier") },
    { data: { sourceType: "unknown", confidence: 1 }, error: null },
    { data: { sourceType: "foreign_journal_article", confidence: 0.59 }, error: null },
  ])("does not create article identity when the classifier is unavailable, unknown or below threshold", async (reply) => {
    boundaries.classifier.mockResolvedValue(reply);
    const result = await runCitation({ rawInput: `https://doi.org/${doi}`, useVerifiedStore: false });
    expect(result.sourceType).toBe("unknown");
    expect(result.fromVerifiedStore).toBe(false);
    expect(boundaries.invoke.mock.calls[0][1].foreignLookup).toBeUndefined();
    expect(searchCalls).toEqual([]);
    expect(pageCalls).toEqual([]);
  });
  it("retains the complete-input local fast path when no identifier needs checking", async () => {
    const result = await runCitation({ rawInput: complete, useVerifiedStore: false });
    expect(result.status).toBe("valid");
    expect(boundaries.invoke).not.toHaveBeenCalled();
    expect(searchCalls).toEqual([]);
    expect(boundaries.zero).toHaveBeenCalledWith(undefined, "local_foreign_formatter", "deterministic");
  });
  it("formats a complete article plus DOI locally with an explicit unverified warning", async () => {
    const result = await runCitation({ rawInput: `${complete}. DOI ${doi}`, useVerifiedStore: false });
    expect(result.status).toBe("warning");
    expect(result.fromVerifiedStore).toBe(false);
    expect(result.reply).toContain("לא אומתה התאמת");
    expect(result.citation).toContain("193, 213–214 (1890)");
    expect(boundaries.invoke).not.toHaveBeenCalled();
    expect(searchCalls).toEqual([]);
    expect(boundaries.zero).toHaveBeenCalledWith(undefined, "local_foreign_formatter", "deterministic");
  });
  it("does not falsely verify an explicit DOI through a matching title-only cache", async () => {
    boundaries.verified.mockResolvedValue({ source_name: `Warren & Brandeis, ${title}`, full_citation: complete, source_type: "article" });
    const result = await runCitation({ rawInput: `${complete}. DOI ${doi}` });
    expect(result.fromVerifiedStore).toBe(false);
    expect(result.status).toBe("warning");
    expect(result.warningMsg).toContain("לא אומתה");
    expect(boundaries.invoke).not.toHaveBeenCalled();
    expect(searchCalls).toEqual([]);
  });
  it("preserves the bounded lookup for an incomplete citation despite a complete title-only cache", async () => {
    boundaries.verified.mockResolvedValue({ source_name: `Warren & Brandeis, ${title}`, full_citation: complete, source_type: "article" });
    const result = await runCitation({ rawInput: `${partial} DOI ${doi}` });
    expect(result.fromVerifiedStore).toBe(false);
    expect(boundaries.invoke).toHaveBeenCalledTimes(1);
    expect(searchCalls).toHaveLength(1);
  });
  it("does not silently accept multiple identifiers on a complete locally formatted citation", async () => {
    const result = await runCitation({ rawInput: `${complete}. DOI ${doi}; DOI 10.1038/171737a0`, useVerifiedStore: false });
    expect(result.status).toBe("warning");
    expect(result.warningMsg).toContain("מזהים סותרים");
    expect(result.fromVerifiedStore).toBe(false);
    expect(boundaries.invoke).not.toHaveBeenCalled();
  });
  it("preserves the unverified-identifier warning in actual repeated footnote output", async () => {
    const input = `${complete}. DOI ${doi}`;
    const result = await runCitation({ rawInput: input, useVerifiedStore: false });
    const cells = applyRepeatCitationRules([
      { id: 1, input, output: result.reply },
      { id: 2, input, output: result.reply },
    ]);
    expect(cells[1].output).toMatch(/^שם\./);
    for (const cell of cells) {
      // Batch finalization derives warning/verification from the output text.
      expect(cell.output).toContain("\n⚠️ לא אומתה התאמת");
      expect(/\[חסר:|⚠️/.test(cell.output ?? "")).toBe(true);
    }
    expect(boundaries.invoke).not.toHaveBeenCalled();
  });
  it("keeps the Index request adapter's existing server route for complete input plus identifier", async () => {
    const raw = `${complete}. https://doi.org/${doi}`;
    const selected = await resolveSourceType(raw);
    const fields = articleRequestFields(selected.sourceType, raw);
    expect(fields.foreignLookup?.parsedFields).toMatchObject({ articleTitle: title, doi, firstPage: "193", year: "1890", pinpoint: "213–214" });
    // Index calls citation-chat using this exact adapter and does not call
    // runCitation's local fast path. Its existing server call is unchanged.
    await boundaries.invoke("citation-chat", fields);
    expect(boundaries.invoke).toHaveBeenCalledTimes(1);
    expect(searchCalls).toHaveLength(1);
  });
});
