import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { articleRecordFromPage } from "../../supabase/functions/_shared/foreignArticle";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { buildForeignArticleRequest, renderForeignArticleLookup } from "@/lib/foreignArticleAdapter";

const title = "The Right to Privacy", doi = "10.2307/1321160";
const url = "https://law.harvard.edu/export/privacy.bib?work=1321160";
// Synthetic whole-export evidence exercises the combined parser seam only.
const bibtex = `@article{warren, title={${title}}, author={Samuel D. Warren and Louis D. Brandeis}, journal={Harvard Law Review}, year=1890, volume=4, pages={193--220}, doi={${doi}}}`;
const canonical = { articleTitle: title, authors: "Samuel D. Warren and Louis D. Brandeis", journal: "Harvard Law Review", year: "1890", volume: "4", firstPage: "193", doi };

function replay(rawInput: string, page: string, sourceUrl = `https://doi.org/${doi}`, sourceTitle = "Citation export") {
  const searches: Record<string, unknown>[] = [], pages: string[] = [];
  const fetchImpl = (async (address: string | URL | Request, init?: RequestInit) => {
    const addressText = String(address);
    if (addressText === "https://api.perplexity.ai/search") {
      searches.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ results: [{ title: sourceTitle, url: sourceUrl, snippet: "Export available" }] }), { status: 200 });
    }
    pages.push(addressText);
    return new Response(page, { status: 200, headers: { "content-type": "application/x-bibtex" } });
  }) as typeof fetch;
  const input: ForeignLookupInput = buildForeignArticleRequest(rawInput);
  return { searches, pages, input, result: runForeignLookup(input, { fetchImpl, apiKey: "offline-combined-only" }) };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden in combined seam tests"); })));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("combined normalization and identifier whole-page parsing", () => {
  it("reads a whole DOI-matched article export without requiring a supplied title", () => {
    expect(articleRecordFromPage(bibtex, { doi })).toEqual({ fields: canonical, structured: true });
  });
  it("resolves a DOI-only request through the existing selected one-page path", async () => {
    const test = replay(doi, bibtex), result = await test.result;
    expect(result.articleResolution).toBe("resolved");
    expect(result.identity).toMatchObject({ matched: true, conflicts: [] });
    expect(result.fields).toMatchObject(canonical);
    expect(result.provenance.doi).toMatchObject({ sourceUrl: `https://doi.org/${doi}`, basis: "structured_metadata" });
    expect(renderForeignArticleLookup(buildForeignArticleRequest(doi), result)?.status).toBe("valid");
    expect(test.searches).toHaveLength(1);
    expect(test.pages).toEqual([`https://doi.org/${doi}`]);
  });
  it("binds a matching supplied URL to its own complete article export without a title or an export URL field", async () => {
    const test = replay(url, bibtex, url), result = await test.result;
    expect(result.articleResolution).toBe("resolved");
    expect(result.fields).toMatchObject({ ...canonical, sourceUrl: url });
    expect(result.provenance.sourceUrl.sourceUrl).toBe(url);
    expect(test.searches).toHaveLength(1);
    expect(test.pages).toEqual([url]);
  });
  it("retains the page's actual title so a same-DOI wrong supplied title reaches conflict checking", async () => {
    const raw = `A Different Work, DOI ${doi}`;
    expect(articleRecordFromPage(bibtex, { articleTitle: "A Different Work", doi })?.fields.articleTitle).toBe(title);
    const test = replay(raw, bibtex), result = await test.result;
    expect(result.articleResolution).toBe("conflict");
    expect(result.identity.matched).toBe(false);
    expect(result.identity.conflicts).toContain(`articleTitle:A Different Work vs ${title}`);
    expect(result.fields).toEqual({});
    expect(test.searches).toHaveLength(2);
    expect(test.pages).toHaveLength(1);
  });
  it("retains same-identifier wrong-author conflicts and does not replace the user's title/byline", async () => {
    const raw = `John Warren and Louis Brandeis, ${title}, DOI ${doi}`;
    const test = replay(raw, bibtex), result = await test.result;
    expect(result.articleResolution).toBe("conflict");
    expect(result.fields).toEqual({});
    expect(result.identity.conflicts.some((conflict) => conflict.startsWith("authors:"))).toBe(true);
    const rendered = renderForeignArticleLookup(buildForeignArticleRequest(raw), result);
    expect(rendered?.citation).toContain("John Warren and Louis Brandeis");
    expect(rendered?.status).toBe("warning");
  });
  it("preserves the requested pinpoint independently of the export's first page", async () => {
    const raw = `Warren & Brandeis, ${title}, pp. 213–214. DOI ${doi}`;
    const result = await replay(raw, bibtex).result;
    expect(result.fields.firstPage).toBe("193");
    expect(result.fields.pinpoint).toBeUndefined();
    expect(renderForeignArticleLookup(buildForeignArticleRequest(raw), result)?.citation).toContain("193, 213–214 (1890)");
  });
  it.each([
    ["nonarticle", bibtex.replace("@article", "@book")],
    ["reference wrapper", `References:\n${bibtex}`],
    ["HTML body wrapper", `<html><body><pre>${bibtex}</pre></body></html>`],
    ["multiple entries", `${bibtex}\n${bibtex}`],
    ["multiple different works", `${bibtex}\n${bibtex.replace(title, "Another Work")}`],
    ["nested reference in a book", `@book{book, title={A Book}, note={${bibtex}}}`],
    ["nested reference in an incomplete article", `@article{other, title={Another Work}, note={${bibtex}}}`],
    ["incomplete article", bibtex.replace("year=1890, ", "")],
    ["truncated entry", bibtex.slice(0, -1)],
    ["trailing prose", `${bibtex}\nAnother work`],
    ["oversize record", " ".repeat(16_384) + bibtex],
  ])("rejects %s without scanning or merging page records", async (_label, page) => {
    expect(articleRecordFromPage(page, { doi })).toBeNull();
    const test = replay(doi, page), result = await test.result;
    expect(result.articleResolution).toBe("incomplete");
    expect(result.identity.matched).toBe(false);
    expect(result.fields).toEqual({});
    expect(test.searches).toHaveLength(2);
    expect(test.pages).toHaveLength(1);
  });
  it("does not fill DOI identity from an otherwise complete export missing its DOI", async () => {
    const result = await replay(doi, bibtex.replace(`, doi={${doi}}`, "")).result;
    expect(result.identity.matched).toBe(false);
    expect(result.articleResolution).toBe("incomplete");
    expect(result.fields).toEqual({});
  });
  it("does not fetch a page when Search does not select a matching strong source", async () => {
    const test = replay(doi, bibtex, "https://law.harvard.edu/unrelated"), result = await test.result;
    expect(result.identity.matched).toBe(false);
    expect(test.pages).toEqual([]);
    expect(test.searches).toHaveLength(2);
  });
});
