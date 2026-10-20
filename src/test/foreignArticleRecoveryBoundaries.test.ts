import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCitation } from "@/lib/runCitation";
import { buildForeignArticleRequest, renderForeignArticleLookup } from "@/lib/foreignArticleAdapter";
import { articleRecordsFromSnippet } from "../../supabase/functions/_shared/foreignArticle";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import capture from "./fixtures/foreignArticleSearchCapture.json";

const boundaries = vi.hoisted(() => ({ invoke: vi.fn(), classify: vi.fn(), verified: vi.fn(), zero: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: boundaries.invoke }));
vi.mock("@/lib/sourceTypeClassifier", () => ({ resolveSourceType: boundaries.classify }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: boundaries.verified, classifyVerifiedSource: vi.fn(), getVerifiedCategoryLabel: vi.fn() }));
vi.mock("@/lib/refundResponse", () => ({ handleRefundResponse: vi.fn() }));
vi.mock("@/lib/costTelemetry", async (original) => ({ ...await original<typeof import("@/lib/costTelemetry")>(), reportZeroWork: boundaries.zero }));

// These are synthetic formatting mutations of the old, public fixture. They do
// not claim to reproduce the unknown live Search payload that returned no records.
const input = capture.input as ForeignLookupInput;
const title = "The Right to Privacy";
const authors = "Samuel D. Warren and Louis D. Brandeis";
const publication = "Harvard Law Review, Vol. 4, No. 5. (Dec. 15, 1890), pp. 193-220.";
const canonical = { articleTitle: title, authors, journal: "Harvard Law Review", volume: "4", firstPage: "193", year: "1890" };
const expectedCitation = "Samuel D. Warren and Louis D. Brandeis, ##The Right to Privacy##, 4 ^^Harv. L. Rev.^^ 193, 213–214 (1890).";
const cornell = capture.searches[1].results[7];
const semantic = capture.searches[1].results[4];
const bibtex = semantic.snippet.slice(semantic.snippet.indexOf("@article"));
const anchors = capture.input.parsedFields;
type Source = { title?: string; url?: string; snippet?: string };
const pageSource = { title, url: "https://law.harvard.edu/export/privacy.bib", snippet: "Article record; citation export available." };

function replay(tiers: Source[][], pages: Record<string, string> = {}) {
  const searches: { method?: string; body: Record<string, unknown>; headers?: HeadersInit }[] = [];
  const pageCalls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    if (address === "https://api.perplexity.ai/search") {
      const tier = searches.length;
      searches.push({ method: init?.method, body: JSON.parse(String(init?.body)), headers: init?.headers });
      return new Response(JSON.stringify({ results: tiers[tier] ?? [] }), { status: 200 });
    }
    pageCalls.push(address);
    return new Response(pages[address] ?? "", { status: 200 });
  }) as typeof fetch;
  return { searches, pageCalls, lookup: (request = input) => runForeignLookup(request, { fetchImpl, apiKey: "offline-only" }) };
}

function citationMetadata(overrides: Record<string, string> = {}) {
  const fields = { citation_title: title, citation_journal_title: "Harvard Law Review", citation_volume: "4", citation_firstpage: "193", citation_publication_date: "1890/12/15", ...overrides };
  return `<html><head>${Object.entries(fields).map(([name, value]) => `<meta name="${name}" content="${value}">`).join("")}<meta name="citation_author" content="Samuel D. Warren"><meta name="citation_author" content="Louis D. Brandeis"></head><body>Article</body></html>`;
}

beforeEach(() => {
  vi.clearAllMocks();
  boundaries.classify.mockResolvedValue({ sourceType: "foreign_journal_article" });
  boundaries.verified.mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden in recovery boundary tests"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("synthetic isolated publisher formatting through the actual lookup and renderer", () => {
  const variants: Array<[string, Source]> = [
    ["NBSP within the journal", { ...cornell, snippet: `Samuel D. Warren; Louis D. Brandeis\n${publication.replace(/ /g, "\u00a0")}` }],
    ["soft-wrapped byline and journal", { ...cornell, snippet: `Samuel D. Warren;\nLouis D. Brandeis\nHarvard Law\nReview, Vol. 4, No. 5. (Dec. 15, 1890), pp. 193-220.` }],
    ["flattened byline and publication bound to the captured heading", { ...cornell, snippet: `Samuel D. Warren; Louis D. Brandeis ${publication}` }],
    ["quoted standalone title with terminal period", { ...cornell, title: "Publisher record", snippet: `“${title}.”\n${authors}\n${publication}` }],
    ["narrow nonbreaking spaces", { ...cornell, snippet: `Samuel D. Warren; Louis D. Brandeis\n${publication.replace(/ /g, "\u202f")}` }],
  ];

  it.each(variants)("recovers exact fixture metadata from %s", async (_name, source) => {
    const test = replay([[source]]);
    const result = await test.lookup();
    expect(result.articleResolution).toBe("resolved");
    expect(result.identity).toMatchObject({ matched: true, conflicts: [] });
    expect(result.fields).toEqual({ authors, journal: "Harvard Law Review", volume: "4", firstPage: "193", year: "1890" });
    expect(result.grounded).toEqual({ authors: true, journal: true, volume: true, firstPage: true, year: true });
    expect(result.provenance.firstPage).toMatchObject({ value: "193", sourceUrl: source.url, basis: "search_result_explicit" });
    expect(renderForeignArticleLookup(buildForeignArticleRequest(input.rawInput), result)).toMatchObject({ citation: expectedCitation, status: "valid" });
    expect(test.searches.map((call) => call.body)).toEqual([capture.searches[0].body]);
    expect(test.pageCalls).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([semantic, cornell])("keeps the individual old donor $url unchanged", async (source) => {
    const test = replay([[source]]);
    const result = await test.lookup();
    expect(renderForeignArticleLookup({ parsedFields: anchors }, result)).toMatchObject({ citation: expectedCitation, status: "valid" });
    expect(test.searches).toHaveLength(1);
    expect(test.pageCalls).toHaveLength(0);
  });

  it("keeps the whole ordered old capture and both Search payloads unchanged", async () => {
    const test = replay(capture.searches.map((tier) => tier.results));
    const result = await test.lookup();
    expect(renderForeignArticleLookup({ parsedFields: anchors }, result)?.citation).toBe(expectedCitation);
    expect(test.searches.map((call) => call.body)).toEqual(capture.searches.map((tier) => tier.body));
    expect(test.searches.every((call) => call.method === "POST")).toBe(true);
    expect(test.pageCalls).toHaveLength(0);
  });

  it("carries normalized evidence through client orchestration without overwriting the pinpoint", async () => {
    const test = replay([[variants[2][1]]]);
    boundaries.invoke.mockImplementation(async (_name, body) => ({ data: { content: "", foreignLookup: await test.lookup(body.foreignLookup) }, errorInfo: null }));
    const result = await runCitation({ rawInput: input.rawInput, useVerifiedStore: false });
    // C1 confirmation never silently replaces a supplied abbreviated byline.
    expect(result).toMatchObject({ citation: expectedCitation.replace(authors, anchors.authors), status: "valid", fromVerifiedStore: false });
    expect(boundaries.invoke).toHaveBeenCalledTimes(1);
    expect(boundaries.invoke.mock.calls[0][0]).toBe("citation-chat");
    expect(boundaries.invoke.mock.calls[0][1].foreignLookup.parsedFields).toEqual(anchors);
    expect(test.searches).toHaveLength(1);
    expect(test.pageCalls).toHaveLength(0);
  });

  it.each([
    ["extended title", `${title}: A Modern Theory\n${authors}\n${publication}`],
    ["nearby separate publication", `“${title}.”\n${authors}\nDiscussed in:\nAnother Publication\n${publication}`],
    ["truncated title", `“${title}…”\n${authors}\n${publication}`],
    ["truncated author", `“${title}.”\nSamuel D. Warren; Louis…\n${publication}`],
    ["truncated journal", `“${title}.”\n${authors}\n${publication.replace("Harvard Law Review", "Harvard Law…")}`],
    ["missing first page", `“${title}.”\n${authors}\nHarvard Law Review, Vol. 4, 1890.`],
    ["separate incomplete records", `“${title}.”\n${authors}\nHarvard Law Review\nAnother Publication\nVol. 4, 1890, pp. 193-220.`],
  ])("does not turn %s into a whole target record", async (_label, snippet) => {
    const source = { title: "Other publication", url: "https://law.harvard.edu/other", snippet };
    const result = await replay([[source], [source]]).lookup();
    expect(result.fields).toEqual({});
    expect(result.identity.matched).toBe(false);
    const rendered = renderForeignArticleLookup({ parsedFields: anchors }, result);
    expect(rendered?.status).toBe("warning");
    expect(rendered?.citation).toContain("213–214");
  });

  it("does not use the captured same-topic Catholic donor", async () => {
    const wrong = capture.searches[0].results[5];
    const test = replay([[wrong], [wrong]]);
    const result = await test.lookup();
    expect(result.fields).toEqual({});
    expect(result.identity.matched).toBe(false);
    expect(renderForeignArticleLookup({ parsedFields: anchors }, result)?.citation).not.toMatch(/Catholic|703|1990/);
    expect(test.pageCalls).toHaveLength(0);
  });

  it("retains complete repeated normalized records so a duplicate cannot hide a conflicting year", async () => {
    const good = `“${title}.”\n${authors}\n${publication}`;
    const snippet = `${good}\n${good}\n${good.replace("1890", "1990")}`;
    const result = await replay([[{ title: "Publisher records", url: "https://law.harvard.edu/records", snippet }]]).lookup();
    expect(result.fields).toEqual({});
    expect(result.articleResolution).toBe("conflict");
    expect(result.identity.conflicts).toContain("conflicting_article_year");
  });
});

describe("single fetched record recovery without full-page reference scanning", () => {
  it("recovers a complete raw BibTeX response through lookup and renderer", async () => {
    const test = replay([[pageSource]], { [pageSource.url]: bibtex });
    const result = await test.lookup();
    expect(result.articleResolution).toBe("resolved");
    expect(result.fields).toEqual({ authors, journal: "Harvard Law Review", volume: "4", firstPage: "193", year: "1890" });
    expect(renderForeignArticleLookup({ parsedFields: anchors }, result)).toMatchObject({ citation: expectedCitation, status: "valid" });
    expect(test.pageCalls).toEqual([pageSource.url]);
    expect(test.searches.map((call) => call.body)).toEqual([capture.searches[0].body]);
    expect(result.provenance.firstPage.sourceUrl).toBe(pageSource.url);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("accepts surrounding whitespace on the one raw export, preserving all publication fields", async () => {
    const test = replay([[pageSource]], { [pageSource.url]: `\n\t ${bibtex}\r\n` });
    const result = await test.lookup();
    expect({ ...result.fields, ...anchors, authors: result.fields.authors }).toEqual({ ...canonical, pinpoint: "213–214" });
    expect(test.searches).toHaveLength(1);
    expect(test.pageCalls).toHaveLength(1);
  });

  it.each([
    ["BibTeX inside unrelated HTML", `<html><h1>Another publication</h1><pre>${bibtex}</pre></html>`],
    ["target mentioned only in page references", `<html><h1>Another publication</h1><h2>References</h2><p>${authors}, ${title}, 4 Harvard Law Review 193 (1890).</p></html>`],
    ["mixed raw reference records", `@article{other, title={Another Work}, author={Jane Smith}, journal={Yale Law Journal}, year={2001}, volume={110}, pages={601}}\n${bibtex}`],
    ["duplicate complete raw records", `${bibtex}\n${bibtex}`],
    ["conflicting raw records", `${bibtex}\n${bibtex.replace("year={1890}", "year={1990}")}`],
    ["plain publisher prose", `${title}\n${authors}\n${publication}`],
    ["plain bibliography preface", `References\n${bibtex}`],
    ["PDF-looking response", `%PDF-1.7\n${bibtex}`],
    ["malformed captured Crossref JSON", capture.searches[0].results[0].snippet],
    ["missing entry closure", bibtex.slice(0, -1)],
    ["duplicate year field", bibtex.replace("year={1890}", "year={1890}, year={1890}")],
    ["missing explicit first page", bibtex.replace("pages={193},", "")],
    ["unknown BibTeX macro", bibtex.replace("year={1890}", "year=publicationYear")],
    ["entry exceeding its existing bound", bibtex.replace("url={https://api.semanticscholar.org/CorpusID:148685002}", `note={${"x".repeat(9000)}}`)],
  ])("declines %s without rescuing references or issuing more page fetches", async (_label, page) => {
    const test = replay([[pageSource], [pageSource]], { [pageSource.url]: page });
    const result = await test.lookup();
    expect(result.fields).toEqual({});
    expect(result.articleResolution).toBe("incomplete");
    expect(result.identity.matched).toBe(false);
    expect(renderForeignArticleLookup({ parsedFields: anchors }, result)).toMatchObject({ status: "warning" });
    expect(test.pageCalls).toEqual([pageSource.url]);
    expect(test.searches.map((call) => call.body)).toEqual(capture.searches.map((tier) => tier.body));
  });

  it.each([
    ["authors", "Samuel D. Warren and William Brandeis", bibtex.replace("Louis D. Brandeis", "William Brandeis")],
    ["year", "1990", bibtex.replace("year={1890}", "year={1990}")],
    ["journal", "Catholic University Law Review", bibtex.replace("Harvard Law Review", "Catholic University Law Review")],
  ])("rejects a fetched conflicting %s while preserving supplied complete fields", async (field, _wrong, page) => {
    const parsedFields = { ...canonical, pinpoint: "213–214" };
    const test = replay([[pageSource], [pageSource]], { [pageSource.url]: page });
    const result = await test.lookup({ ...input, parsedFields });
    expect(result.fields).toEqual({});
    expect(result.identity.matched).toBe(false);
    expect(result.identity.conflicts.some((conflict) => conflict.startsWith(`${field}:`))).toBe(true);
    expect(renderForeignArticleLookup({ parsedFields }, result)).toMatchObject({ citation: expectedCitation, status: "warning" });
  });

  it("declines a fetched same-author extended title", async () => {
    const result = await replay([[pageSource]], { [pageSource.url]: bibtex.replace(`title={${title}}`, `title={${title}: A Modern Theory}`) }).lookup();
    expect(result.fields).toEqual({});
    expect(result.identity.matched).toBe(false);
  });

  it("does not inspect an unrelated result even when its page contains a complete target export", async () => {
    const unrelated = { ...pageSource, title: "Privacy After a Century", snippet: "Discusses Warren and Brandeis, The Right to Privacy." };
    const test = replay([[unrelated], [unrelated]], { [pageSource.url]: bibtex });
    expect((await test.lookup()).fields).toEqual({});
    expect(test.pageCalls).toEqual([]);
  });

  it("does not visit export links or a second page when its one eligible inspection fails", async () => {
    const second = { ...pageSource, url: "https://law.harvard.edu/export/second.bib" };
    const test = replay([[pageSource], [second]], { [pageSource.url]: `<a href="${second.url}">Download citation</a>`, [second.url]: bibtex });
    expect((await test.lookup()).articleResolution).toBe("incomplete");
    expect(test.searches).toHaveLength(2);
    expect(test.pageCalls).toEqual([pageSource.url]);
  });

  it("preserves original complete citation metadata behavior", async () => {
    const test = replay([[pageSource]], { [pageSource.url]: citationMetadata() });
    const result = await test.lookup();
    expect(result.articleResolution).toBe("resolved");
    expect(result.fields).toEqual({ authors: "Samuel D. Warren & Louis D. Brandeis", journal: "Harvard Law Review", volume: "4", firstPage: "193", year: "1890" });
    expect(result.provenance.firstPage).toMatchObject({ value: "193", basis: "structured_metadata", sourceUrl: pageSource.url });
    expect(renderForeignArticleLookup({ parsedFields: anchors }, result)?.citation).toBe(expectedCitation.replace("Warren and Louis", "Warren & Louis"));
    expect(test.searches).toHaveLength(1);
    expect(test.pageCalls).toEqual([pageSource.url]);
  });

  it("preserves partial citation metadata without filling its missing page from an embedded reference", async () => {
    const page = citationMetadata().replace('<meta name="citation_firstpage" content="193">', "").replace("Article</body>", `${bibtex}</body>`);
    const test = replay([[pageSource]], { [pageSource.url]: page });
    const result = await test.lookup();
    expect(result.articleResolution).toBe("incomplete");
    expect(result.fields.firstPage).toBeUndefined();
    expect(result.fields).toMatchObject({ journal: "Harvard Law Review", volume: "4", year: "1890" });
    const rendered = renderForeignArticleLookup({ parsedFields: anchors }, result);
    expect(rendered?.status).toBe("warning");
    expect(rendered?.citation).toContain("[חסר: עמוד], 213–214");
    expect(test.pageCalls).toHaveLength(1);
  });

  it("does not override conflicting structured metadata using embedded correct BibTeX", async () => {
    const page = citationMetadata({ citation_publication_date: "1990" }).replace("Article</body>", `${bibtex}</body>`);
    const result = await replay([[pageSource], [pageSource]], { [pageSource.url]: page }).lookup({ ...input, parsedFields: { ...anchors, year: "1890" } });
    expect(result.fields).toEqual({});
    expect(result.identity.conflicts).toContain("year:1890 vs 1990");
  });
});

describe("existing unrelated routes and bounded evidence", () => {
  it("retains the exact record-text limit before attempting formatting repair", () => {
    expect(articleRecordsFromSnippet({ title: "Publisher record", snippet: "x".repeat(16_384) + `\n“${title}.”\n${authors}\n${publication}` }, anchors)).toEqual([]);
  });

  it("retains other ordinary article support without fixture-specific metadata", () => {
    const snippet = "Customs and Courts\nJane A. Smith and Peter Jones\nYale Law Journal, Vol. 110, 2001, pp. 601-649.";
    expect(articleRecordsFromSnippet({ snippet }, { articleTitle: "Customs and Courts" })).toEqual([{ fields: { articleTitle: "Customs and Courts", authors: "Jane A. Smith and Peter Jones", journal: "Yale Law Journal", volume: "110", firstPage: "601", year: "2001" }, structured: false }]);
  });

  it("keeps supplied complete article input on the deterministic client path", async () => {
    const result = await runCitation({ rawInput: "Warren & Brandeis, The Right to Privacy, 4 Harv. L. Rev. 193, 213–214 (1890)", overrideType: "foreign_journal_article", useVerifiedStore: false });
    expect(result.status).toBe("valid");
    expect(result.citation).toContain("193, 213–214 (1890)");
    expect(boundaries.invoke).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["foreign_case_us", "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)", "910 F.3d 649"],
    ["foreign_book", "H.L.A. Hart, The Concept of Law (2d ed. 1994)", "1994"],
  ] as const)("preserves the complete %s client path", async (overrideType, rawInput, expected) => {
    const result = await runCitation({ rawInput, overrideType, useVerifiedStore: false });
    expect(result.status).toBe("valid");
    expect(result.citation).toContain(expected);
    expect(boundaries.invoke).not.toHaveBeenCalled();
  });

  it("keeps missing-credential article fallback free of provider or page calls", async () => {
    const fetchImpl = vi.fn(() => { throw new Error("No fetch authorized by this fixture"); });
    const result = await runForeignLookup(input, { apiKey: null, fetchImpl });
    expect(result).toMatchObject({ fields: {}, error: "missing_perplexity_credentials", articleResolution: "incomplete" });
    expect(renderForeignArticleLookup({ parsedFields: anchors }, result)?.citation).toContain("213–214");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
