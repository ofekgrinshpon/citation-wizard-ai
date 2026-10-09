import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCitation } from "@/lib/runCitation";
import { buildForeignArticleRequest, renderForeignArticleLookup } from "@/lib/foreignArticleAdapter";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { articleRecordsFromSnippet } from "../../supabase/functions/_shared/foreignArticle";
import capture from "./fixtures/foreignArticleSearchCapture.json";

const boundaries = vi.hoisted(() => ({ invoke: vi.fn(), classify: vi.fn(), verified: vi.fn(), zero: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: boundaries.invoke }));
vi.mock("@/lib/sourceTypeClassifier", () => ({ resolveSourceType: boundaries.classify }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: boundaries.verified, classifyVerifiedSource: vi.fn(), getVerifiedCategoryLabel: vi.fn() }));
vi.mock("@/lib/refundResponse", () => ({ handleRefundResponse: vi.fn() }));
vi.mock("@/lib/costTelemetry", async (original) => ({ ...await original<typeof import("@/lib/costTelemetry")>(), reportZeroWork: boundaries.zero }));

type Item = (typeof capture.searches)[number]["results"][number];
const rawInput = capture.input.rawInput;

function replay(tiers = capture.searches.map((search) => search.results)) {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  let tier = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    if (address === "https://api.perplexity.ai/search") {
      calls.push({ url: address, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ results: tiers[tier++] ?? [] }), { status: 200 });
    }
    calls.push({ url: address });
    // The captured page returned HTTP 202 and immediate EOF. Never fetch it.
    return new Response("", { status: 202 });
  }) as typeof fetch;
  return { calls, lookup: (input: ForeignLookupInput = capture.input as ForeignLookupInput) => runForeignLookup(input, { fetchImpl, apiKey: "offline-fixture-only" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  boundaries.classify.mockResolvedValue({ sourceType: "foreign_journal_article" });
  boundaries.verified.mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden in capture replay"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("captured English search to complete citation", () => {
  it("resolves the unchanged ordered capture without changing Search bodies or inspecting a page", async () => {
    const test = replay();
    const result = await test.lookup();
    expect(result.articleResolution).toBe("resolved");
    expect(result.identity).toMatchObject({ matched: true, conflicts: [] });
    expect(result.fields).toMatchObject({ authors: "Samuel D. Warren and Louis D. Brandeis", journal: "Harvard Law Review", volume: "4", firstPage: "193", year: "1890" });
    expect(test.calls.map((call) => call.body)).toEqual(capture.searches.map((search) => search.body));
    expect(result.provenance.journal.sourceUrl).toBe(capture.searches[1].results[4].url);
    expect(result.provenance.journal.basis).toBe("search_result_explicit");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("completes normal client orchestration, lookup, merge, renderer and validation using the public captured data", async () => {
    const test = replay();
    boundaries.invoke.mockImplementation(async (_name, body) => ({ data: { content: "", foreignLookup: await test.lookup(body.foreignLookup) }, errorInfo: null }));
    const result = await runCitation({ rawInput, useVerifiedStore: false });
    expect(result.citation).toContain("Samuel D. Warren and Louis D. Brandeis");
    expect(result.citation).toContain("The Right to Privacy");
    expect(result.citation).toBe("Samuel D. Warren and Louis D. Brandeis, ##The Right to Privacy##, 4 ^^Harv. L. Rev.^^ 193, 213–214 (1890).");
    expect(result.citation).not.toMatch(/Catholic|1990|\[חסר/);
    expect(result.status).toBe("valid");
    expect(result.fromVerifiedStore).toBe(false);
    expect(boundaries.classify).toHaveBeenCalledTimes(1);
    expect(boundaries.invoke).toHaveBeenCalledTimes(1);
    expect(boundaries.invoke.mock.calls[0][0]).toBe("citation-chat");
    expect(boundaries.invoke.mock.calls[0][1].foreignLookup.parsedFields).toEqual(capture.input.parsedFields);
    expect(test.calls.map((call) => call.body)).toEqual(capture.searches.map((search) => search.body));
  });

  it.each([4, 7])("independently resolves captured tier-two record %i without borrowing fields from another result", async (index) => {
    const test = replay([[capture.searches[1].results[index]]]);
    const found = await test.lookup();
    expect(found.articleResolution).toBe("resolved");
    expect(found.fields).toMatchObject({ journal: "Harvard Law Review", volume: "4", firstPage: "193", year: "1890" });
    const rendered = renderForeignArticleLookup(buildForeignArticleRequest(rawInput), found);
    expect(rendered?.citation).toBe("Samuel D. Warren and Louis D. Brandeis, ##The Right to Privacy##, 4 ^^Harv. L. Rev.^^ 193, 213–214 (1890).");
    expect(rendered?.status).toBe("valid");
    expect(test.calls).toHaveLength(1);
  });

  it("still rejects the captured Catholic donor and preserves a warned partial", async () => {
    const wrong = capture.searches[0].results[5];
    const test = replay([[wrong], [wrong]]);
    const found = await test.lookup();
    expect(found.fields).toEqual({});
    expect(found.identity.matched).toBe(false);
    const rendered = renderForeignArticleLookup(buildForeignArticleRequest(rawInput), found);
    expect(rendered?.citation).toContain("The Right to Privacy");
    expect(rendered?.citation).toContain("213–214");
    expect(rendered?.citation).not.toMatch(/Catholic|703|1990/);
    expect(rendered?.status).toBe("warning");
  });

  it.each([" and ", " & ", "; "])("preserves complete supplied author separators %s when normalizing publisher metadata", async (separator) => {
    const authors = `Samuel D. Warren${separator}Louis D. Brandeis`;
    const parsedFields = { ...capture.input.parsedFields, authors };
    const found = await replay([[capture.searches[1].results[7]]]).lookup({ ...capture.input, kind: "journal_article", jurisdiction: "OTHER", parsedFields });
    const rendered = renderForeignArticleLookup({ parsedFields }, found);
    expect(rendered?.status).toBe("valid");
    expect(rendered?.citation).toBe(`${authors}, ##The Right to Privacy##, 4 ^^Harv. L. Rev.^^ 193, 213–214 (1890).`);
  });

  it("does not salvage the captured truncated Crossref JSON or confuse its indexed date with publication", async () => {
    const crossref = capture.searches[0].results[0];
    expect(articleRecordsFromSnippet(crossref, capture.input.parsedFields)).toEqual([]);
    const found = await replay([[crossref], [crossref]]).lookup();
    expect(found.fields).toEqual({});
    expect(found.articleResolution).toBe("incomplete");
  });

  it.each(["year", "volume", "firstPage", "journal"])("keeps supplied conflicting %s and reports rejection", async (field) => {
    const values: Record<string, string> = { year: "1990", volume: "39", firstPage: "703", journal: "Catholic University Law Review" };
    const parsedFields = { ...capture.input.parsedFields, [field]: values[field] };
    const test = replay();
    const found = await test.lookup({ ...capture.input, kind: "journal_article", jurisdiction: "OTHER", parsedFields });
    expect(found.fields).toEqual({});
    expect(found.identity.conflicts.some((conflict) => conflict.startsWith(`${field}:`))).toBe(true);
    const rendered = renderForeignArticleLookup({ parsedFields }, found);
    expect(rendered?.status).toBe("warning");
    expect(rendered?.citation).toContain(values[field]);
  });

  it("rejects conflicting complete records rather than selecting the first returned source", async () => {
    const good = capture.searches[1].results[4];
    const conflict: Item = { ...good, url: "https://law.example.edu/conflicting-record", snippet: good.snippet.replace("year={1890}", "year={1990}") };
    const found = await replay([[good, conflict]]).lookup();
    expect(found.fields).toEqual({});
    expect(found.articleResolution).toBe("conflict");
    expect(found.identity.conflicts).toContain("conflicting_article_year");
  });
});
