import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { articleFieldMatches, articleRecordsFromSnippet, parseForeignArticleInput } from "../../supabase/functions/_shared/foreignArticle";
import { extractWorkIdentifiers, normalizeDoi, normalizeWorkUrl } from "../../supabase/functions/_shared/workIdentifiers";
import { runForeignLookup, articleLookupFallback, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { buildForeignArticleRequest, mergeForeignArticleCache, renderForeignArticleLookup } from "@/lib/foreignArticleAdapter";
import capture from "./fixtures/foreignArticleSearchCapture.json";

const original = "Warren & Brandeis, The Right to Privacy, pp. 213–214.";
const title = "The Right to Privacy", doi = "10.2307/1321160";
const watsonDoi = "10.1038/171737a0";
const url = "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=123";
// Synthetic complete metadata tests parser contracts; it is not a live retrieval.
const bibtex = `@article{warren, title={${title}}, author={Samuel D. Warren and Louis D. Brandeis}, journal={Harvard Law Review}, year={1890}, volume={4}, pages={193--220}, doi={${doi}}}`;
const watson = `@article{watson, title={Molecular Structure of Nucleic Acids: A Structure for Deoxyribose Nucleic Acid}, author={J. D. Watson and F. H. C. Crick}, journal={Nature}, year={1953}, volume={171}, pages={737--738}, doi={${watsonDoi}}}`;
const html = `<meta name="citation_title" content="${title}"><meta name="citation_author" content="Samuel D. Warren"><meta name="citation_author" content="Louis D. Brandeis"><meta name="citation_journal_title" content="Harvard Law Review"><meta name="citation_volume" content="4"><meta name="citation_firstpage" content="193"><meta name="citation_publication_date" content="1890/12/15"><meta name="citation_doi" content="${doi}">`;
type Item = { title: string; url: string; snippet: string };
const donor = (snippet = bibtex): Item => ({ title, url: `https://doi.org/${doi}`, snippet });

function replay(rawInput: string, tiers: Item[][], page = "", parsedFields?: Record<string, string>) {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  let index = 0;
  const fetchImpl = (async (address: string | URL | Request, init?: RequestInit) => {
    const url = String(address);
    if (url === "https://api.perplexity.ai/search") {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ results: tiers[index++] ?? [] }), { status: 200 });
    }
    calls.push({ url });
    return new Response(page, { status: page ? 200 : 404 });
  }) as typeof fetch;
  const input: ForeignLookupInput = { kind: "journal_article", jurisdiction: "OTHER", rawInput, parsedFields };
  return { input, calls, result: runForeignLookup(input, { apiKey: "offline-identifiers-only", fetchImpl }) };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden in identifier tests"); })));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("separate explicit work identifiers from citation text", () => {
  it("keeps the exact original anchors unchanged", () => {
    expect(parseForeignArticleInput(original)).toEqual(capture.input.parsedFields);
  });
  it.each([doi, `${doi}.`, `DOI: ${doi}`, `https://doi.org/${doi}`, `https://dx.doi.org/${doi}`])("does not invent a title for %s", (raw) => {
    expect(parseForeignArticleInput(raw)).toEqual({ doi });
  });
  it("does not treat an alphanumeric DOI as a literal title", () => {
    expect(parseForeignArticleInput(`${watsonDoi}.`)).toEqual({ doi: watsonDoi });
  });
  it.each([` DOI ${doi}.`, ` https://doi.org/${doi}`, ` (DOI: ${doi}).`, ` DOI: https://doi.org/${doi}`])("retains authors, title and pinpoint with %s", (suffix) => {
    expect(parseForeignArticleInput(original + suffix)).toEqual({ ...capture.input.parsedFields, doi });
  });
  it("separates a publisher URL and preserves its work-identifying query", () => {
    expect(parseForeignArticleInput(`${original} ${url}`)).toEqual({ ...capture.input.parsedFields, sourceUrl: url });
    expect(normalizeWorkUrl(url)).not.toBe(normalizeWorkUrl(url.replace("123", "456")));
    expect(normalizeWorkUrl(`${url}#page=2`)).toBe(url);
    expect(normalizeWorkUrl(`${url}.`)).not.toBe(normalizeWorkUrl(url));
    expect(parseForeignArticleInput(`${title} (${url}).`)).toEqual({ articleTitle: title, sourceUrl: url });
  });
  it("preserves balanced DOI suffix punctuation and removes an outer citation wrapper", () => {
    const id = "10.1002/(SICI)1099-0844(199912)17:4;2-P(foo)";
    expect(parseForeignArticleInput(`(${id}).`)).toEqual({ doi: id.toLowerCase() });
    expect(normalizeDoi(`https://doi.org/10.1002%2FABC(foo)`)).toBe("10.1002/abc(foo)");
  });
  it("does not collapse genuine URL-path or authoritative DOI suffix punctuation", () => {
    for (const punctuation of [".", ",", ";", ")"]) {
      const path = "https://law.harvard.edu/work";
      expect(normalizeWorkUrl(path + punctuation)).not.toBe(normalizeWorkUrl(path));
      expect(articleFieldMatches("sourceUrl", path, path + punctuation)).toBe(false);
      expect(articleFieldMatches("doi", doi, doi + punctuation)).toBe(false);
    }
    expect(parseForeignArticleInput(`${title} https://law.harvard.edu/work.`).sourceUrl).toBe("https://law.harvard.edu/work.");
  });
  it("does not complete a naked DOI from a different authoritative suffix that differs only by punctuation", async () => {
    const result = await replay(doi, [[donor(bibtex.replace(`doi={${doi}}`, `doi={${doi}.}`))]]).result;
    expect(result.identity.matched).toBe(false);
    expect(result.fields).toEqual({});
  });
  it.each(["https://doi.org.evil.example/10.2307/1321160", "https://doi.org@evil.example/10.2307/1321160", "https://user@doi.org/10.2307/1321160"]) ("does not recognize a resolver identity from %s", (raw) => {
    expect(extractWorkIdentifiers(raw).doi).toBeUndefined();
    expect(normalizeDoi(raw)).toBeUndefined();
  });
  it("retains both contradictory DOI anchors as a conflict", async () => {
    const test = replay(`${original} DOI ${doi}; DOI ${watsonDoi}`, [[donor()]]);
    expect((await test.result).identity.conflicts).toContain("multiple_doi_anchors");
    expect(test.calls).toEqual([]);
  });
  it("rejects a userinfo URL instead of emitting it as a literal article title", async () => {
    const raw = "https://doi.org@evil.example/10.2307/1321160";
    expect(parseForeignArticleInput(raw).articleTitle).toBeUndefined();
    const test = replay(raw, [[donor()]], "", { articleTitle: raw });
    const result = await test.result;
    expect(result.articleResolution).toBe("conflict");
    expect(result.identity.conflicts).toContain("unsupported_url_anchor");
    expect(result.fields).toEqual({});
    expect(test.calls).toEqual([]);
  });
  it("builds a clean complete request without letting a trailing URL overwrite identity", () => {
    const fields = buildForeignArticleRequest(`Warren & Brandeis, ${title}, 4 Harv. L. Rev. 193, 213–214 (1890). https://doi.org/${doi}`).parsedFields;
    expect(fields).toMatchObject({ authors: "Warren & Brandeis", articleTitle: title, firstPage: "193", pinpoint: "213–214", doi });
  });
});

describe("bounded same-work identifier evidence", () => {
  it.each([doi, `https://doi.org/${doi}`, `${original} DOI ${doi}`])("resolves %s only from its complete explicitly identified article", async (raw) => {
    const test = replay(raw, [[donor()]]), result = await test.result;
    expect(result.articleResolution).toBe("resolved");
    expect(result.identity.matched).toBe(true);
    expect(result.provenance.doi).toMatchObject({ value: doi, sourceUrl: donor().url });
    expect(result.fields).toMatchObject({ journal: "Harvard Law Review", firstPage: "193", year: "1890" });
    const rendered = renderForeignArticleLookup(buildForeignArticleRequest(raw), result);
    expect(rendered?.status).toBe("valid");
    expect(rendered?.citation).toContain(title);
    expect(test.calls).toHaveLength(1);
  });
  it("resolves the independently specified Watson alphanumeric DOI from synthetic complete evidence", async () => {
    const test = replay(`${watsonDoi}.`, [[{ title: "Search result", url: `https://doi.org/${watsonDoi}`, snippet: watson }]]);
    const result = await test.result;
    expect(result.articleResolution).toBe("resolved");
    expect(result.fields).toMatchObject({ authors: "J. D. Watson and F. H. C. Crick", journal: "Nature", firstPage: "737", year: "1953" });
  });
  it("does not invent a title from a legacy parsedFields identifier echo", async () => {
    const test = replay(watsonDoi, [[{ ...donor(watson), url: `https://doi.org/${watsonDoi}` }]], "", { articleTitle: watsonDoi });
    expect((await test.result).articleResolution).toBe("resolved");
  });
  it.each([`Warren and Brandeis, ${title}, DOI ${watsonDoi}.`, `A Different Title, DOI ${doi}.`, `John Warren and Louis Brandeis, ${title}, DOI ${doi}.`])("surfaces distinct anchor conflicts for %s", async (raw) => {
    const test = replay(raw, [[donor(raw.includes(watsonDoi) ? watson : bibtex)]]);
    const result = await test.result;
    expect(result.articleResolution).toBe("conflict");
    expect(result.identity.matched).toBe(false);
    expect(result.identity.conflicts.length).toBeGreaterThan(0);
    expect(result.fields).toEqual({});
    const rendered = renderForeignArticleLookup(buildForeignArticleRequest(raw), result);
    expect(rendered?.status).toBe("warning");
    expect(rendered?.warningMsg).toContain("סותרים");
    expect(rendered?.citation).not.toContain("737");
  });
  it("never completes title-only evidence when its DOI is missing", async () => {
    const test = replay(`${original} DOI ${doi}`, [[donor(bibtex.replace(`, doi={${doi}}`, ""))]]);
    expect((await test.result).articleResolution).toBe("incomplete");
    expect((await test.result).fields).toEqual({});
    expect(test.calls.filter((call) => call.body)).toHaveLength(2);
    expect(test.calls.filter((call) => !call.body)).toHaveLength(1);
  });
  it("keeps the saved October 8 evidence as an honest negative for DOI-only lookup", async () => {
    const test = replay(doi, capture.searches.map((search) => search.results));
    const result = await test.result;
    expect(result.articleResolution).toBe("incomplete");
    expect(result.identity.matched).toBe(false);
    expect(result.fields).toEqual({});
    expect(test.calls.filter((call) => call.body)).toHaveLength(2);
    expect(test.calls.filter((call) => !call.body)).toHaveLength(1);
  });
  it("uses only the existing selected strong-source page inspection for citation metadata", async () => {
    const test = replay(doi, [[{ ...donor("No complete snippet"), title: "DOI record" }]], html);
    const result = await test.result;
    expect(result.articleResolution).toBe("resolved");
    expect(result.provenance.doi.basis).toBe("structured_metadata");
    expect(test.calls.map((call) => call.url)).toEqual(["https://api.perplexity.ai/search", donor().url]);
  });
  it("never fetches a supplied URL directly when Search did not select a strong matching source", async () => {
    const test = replay(`${original} ${url}`, [[], []], html);
    expect((await test.result).articleResolution).toBe("incomplete");
    expect(test.calls.every((call) => !!call.body)).toBe(true);
  });
  it("can bind a supplied URL to a primary result heading and complete article record", async () => {
    const test = replay(`${original} ${url}`, [[{ title, url, snippet: bibtex.replace(`doi={${doi}}`, `url={${url}}`) }]]);
    expect((await test.result).articleResolution).toBe("resolved");
    expect((await test.result).provenance.sourceUrl.sourceUrl).toBe(url);
  });
  it("rejects a different work selected through the same URL path with a different query", async () => {
    const otherUrl = url.replace("123", "456");
    const test = replay(`${original} ${url}`, [[{ title, url: otherUrl, snippet: bibtex.replace(`doi={${doi}}`, `url={${otherUrl}}`) }]]);
    expect((await test.result).articleResolution).toBe("incomplete");
    expect((await test.result).fields).toEqual({});
  });
  it("does not let another same-title DOI poison an independently matched DOI record", async () => {
    const other = bibtex.replace(doi, "10.2307/9999999").replace("year={1890}", "year={1990}");
    const test = replay(`${original} DOI ${doi}`, [[donor(other), donor(bibtex)]]);
    const result = await test.result;
    expect(result.articleResolution).toBe("resolved");
    expect(result.identity.conflicts).toEqual([]);
    expect(result.fields.year).toBe("1890");
  });
  it("does not vote away contradictory records for the same DOI", async () => {
    const test = replay(doi, [[donor(`${bibtex}\n${bibtex.replace("year={1890}", "year={1990}")}`)]]);
    const result = await test.result;
    expect(result.articleResolution).toBe("conflict");
    expect(result.identity.conflicts).toContain("conflicting_article_year");
    expect(result.fields).toEqual({});
  });
  it("reports primary metadata that contradicts the inspected DOI resolver URL", async () => {
    const test = replay(doi, [[donor("")]], html.replace(doi, watsonDoi));
    const result = await test.result;
    expect(result.articleResolution).toBe("conflict");
    expect(result.identity.conflicts.some((value) => value.startsWith("doi:"))).toBe(true);
  });
  it("leaves a supplied URL unverified when a DOI-matched record names an alternate landing URL", async () => {
    const otherUrl = url.replace("123", "456");
    const snippet = bibtex.replace(`doi={${doi}}`, `doi={${doi}}, url={${otherUrl}}`);
    const result = await replay(`${original} DOI ${doi} ${url}`, [[{ title, url: otherUrl, snippet }]]).result;
    expect(result.articleResolution).toBe("incomplete");
    expect(result.identity.conflicts).toEqual([]);
    expect(result.fields).toEqual({});
  });
  it("does not treat unrequested alternate URLs for the same DOI as conflicting work metadata", async () => {
    const resolver = bibtex.replace(`doi={${doi}}`, `doi={${doi}}, url={https://doi.org/${doi}}`);
    const publisher = bibtex.replace(`doi={${doi}}`, `doi={${doi}}, url={${url}}`);
    const result = await replay(doi, [[donor(`${resolver}\n${publisher}`)]]).result;
    expect(result.articleResolution).toBe("resolved");
    expect(result.identity.conflicts).toEqual([]);
    expect(result.fields.sourceUrl).toBeUndefined();
  });
  it("reports an exact supplied URL whose primary metadata declares a different DOI", async () => {
    const result = await replay(`${original} DOI ${doi} ${url}`, [[{ title, url, snippet: "" }]], html.replace(doi, watsonDoi)).result;
    expect(result.articleResolution).toBe("conflict");
    expect(result.identity.conflicts.some((value) => value.startsWith("doi:"))).toBe(true);
  });
  it("does not bind a citing page's URL to a referenced work inside its snippet", async () => {
    const test = replay(`${original} ${url}`, [[{ title: "Privacy After a Century", url, snippet: bibtex }]]);
    expect((await test.result).articleResolution).toBe("incomplete");
  });
  it.each([
    bibtex.replace("@article", "@book"),
    `@book{book, title={A Book}, doi={${doi}}, note={${bibtex}}}`,
    `@article{other, title={Another Work}, note={${bibtex}}}`,
    JSON.stringify({ title, author: "Warren and Brandeis", DOI: doi, type: "journal-article", volume: 4, page: 193, year: 1890 }),
  ])("does not salvage nested/reference/nonarticle/JSON evidence", async (snippet) => {
    const test = replay(doi, [[donor(snippet)]]);
    expect((await test.result).identity.matched).toBe(false);
    expect((await test.result).fields).toEqual({});
  });
  it("rejects a DOI found only in body references under another citation_title", async () => {
    const page = html.replace(title, "Another Work").replace(`<meta name="citation_doi" content="${doi}">`, "") + `<p>References: ${doi}</p>`;
    expect((await replay(doi, [[donor("")]], page).result).fields).toEqual({});
  });
  it("declines nonarticle citation metadata even when its DOI matches", async () => {
    const page = html.replace('citation_journal_title', 'citation_book_title');
    expect((await replay(doi, [[donor("")]], page).result).identity.matched).toBe(false);
  });
  it.each([doi, `https://doi.org/${doi}`])("does not bootstrap an article title from an identifier in metadata: %s", async (identifierTitle) => {
    const fromSnippet = await replay(doi, [[donor(bibtex.replace(`title={${title}}`, `title={${identifierTitle}}`))]]).result;
    const fromPage = await replay(doi, [[donor("")]], html.replace(`content="${title}"`, `content="${identifierTitle}"`)).result;
    expect(fromSnippet.identity.matched).toBe(false);
    expect(fromPage.identity.matched).toBe(false);
    expect(fromSnippet.fields).toEqual({});
    expect(fromPage.fields).toEqual({});
  });
  it("does not pool fields or DOI between mixed incomplete records", () => {
    const incomplete = bibtex.replace("volume={4}, ", "");
    const noDoi = bibtex.replace(`, doi={${doi}}`, "");
    const records = articleRecordsFromSnippet(donor(`${incomplete}\n${noDoi}\n${watson}`), { doi });
    expect(records).toEqual([]);
  });
  it("retains only compatible independently identified records in a mixed evidence wrapper", async () => {
    const test = replay(doi, [[donor(`${watson}\n${bibtex}`)]]);
    expect((await test.result).articleResolution).toBe("resolved");
    expect((await test.result).fields.firstPage).toBe("193");
  });
  it("returns a terminal warned incomplete DOI-only response at the credential boundary", () => {
    const request = buildForeignArticleRequest(doi);
    const fallback = articleLookupFallback(request, "missing_perplexity_credentials");
    expect(fallback.articleResolution).toBe("incomplete");
    expect(fallback.identity.anchors).toContain(`doi:${doi}`);
    expect(renderForeignArticleLookup(request, fallback)?.status).toBe("warning");
  });
  it("does not let a complete but unverified identifier bypass warnings or a title-only cache", async () => {
    const complete = `Warren & Brandeis, ${title}, 4 Harv. L. Rev. 193 (1890)`;
    const request = buildForeignArticleRequest(`${complete} DOI ${doi}`);
    const result = await replay(request.rawInput, [[], []]).result;
    expect(renderForeignArticleLookup(request, result)?.status).toBe("warning");
    expect(mergeForeignArticleCache(request.rawInput, complete)).toBeNull();
  });
});
