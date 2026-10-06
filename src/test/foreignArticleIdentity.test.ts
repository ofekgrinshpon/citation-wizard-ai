import { describe, expect, it } from "vitest";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { parseForeignArticleInput } from "../../supabase/functions/_shared/foreignArticle";

type Item = { title: string; url: string; snippet: string };
const original: Item = {
  title: "The Right to Privacy — Samuel D. Warren and Louis D. Brandeis",
  url: "https://law.harvard.edu/privacy",
  snippet: "Samuel D. Warren and Louis D. Brandeis, The Right to Privacy, 4 Harvard Law Review 193 (1890).",
};
const citing: Item = {
  title: "Privacy After a Century",
  url: "https://lawreview.example.edu/century",
  snippet: "Privacy After a Century, 39 Catholic U. L. Rev. 703 (1990). Discusses Warren and Brandeis and The Right to Privacy.",
};
const input: ForeignLookupInput = {
  kind: "journal_article", jurisdiction: "OTHER",
  rawInput: "Warren & Brandeis, The Right to Privacy, pp. 213–214.",
};

function lookup(request: ForeignLookupInput, tiers: Item[][], html = "") {
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  let index = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    if (address === "https://api.perplexity.ai/search") {
      calls.push({ url: address, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ results: tiers[index++] ?? [] }), { status: 200 });
    }
    calls.push({ url: address });
    return new Response(html, { status: html ? 200 : 404 });
  }) as typeof fetch;
  return { result: runForeignLookup(request, { fetchImpl, apiKey: "offline-test" }), calls };
}

describe("foreign article record identity", () => {
  it.each(["Warren & Brandeis", "Warren and Brandeis", "Samuel D. Warren and Louis D. Brandeis"])("preserves %s, a title and explicit pinpoint independently", (authors) => {
    expect(parseForeignArticleInput(`${authors}, The Right to Privacy, pp. 213–214.`)).toEqual({ authors, articleTitle: "The Right to Privacy", pinpoint: "213–214" });
  });

  it.each([
    ["The Right to Privacy", { articleTitle: "The Right to Privacy" }],
    ['“The Right to Privacy” by Warren and Brandeis', { articleTitle: "The Right to Privacy", authors: "Warren and Brandeis" }],
    ['The Right to Privacy by Warren & Brandeis, pp. 213-214', { articleTitle: "The Right to Privacy", authors: "Warren & Brandeis", pinpoint: "213–214" }],
    ['Warren & Brandeis, The Right to Privacy (1890), pp. 213–214.', { articleTitle: "The Right to Privacy", authors: "Warren & Brandeis", year: "1890", pinpoint: "213–214" }],
    ['Samuel D. Warren, Louis D. Brandeis, The Right to Privacy, pp. 213–214.', { articleTitle: "The Right to Privacy", authors: "Samuel D. Warren, Louis D. Brandeis", pinpoint: "213–214" }],
    ['Warren & Brandeis, The Right to Privacy, 4 Harv. L. Rev. (1890), pp. 213–214.', { articleTitle: "The Right to Privacy", authors: "Warren & Brandeis", journal: "Harv. L. Rev.", volume: "4", year: "1890", pinpoint: "213–214" }],
    ['Warren & Brandeis, The Right to Privacy, Harvard Law Review, 1890', { articleTitle: "The Right to Privacy", authors: "Warren & Brandeis", journal: "Harvard Law Review", year: "1890" }],
    ['Warren & Brandeis, The Right to Privacy, 4 Harvard Law Review 193–220 (1890), pp. 213–214.', { articleTitle: "The Right to Privacy", authors: "Warren & Brandeis", journal: "Harvard Law Review", volume: "4", firstPage: "193", year: "1890", pinpoint: "213–214" }],
    ['Warren & Brandeis, The Right to Privacy, Harvard Law Review, vol. 4, 1890, pp. 213–214.', { articleTitle: "The Right to Privacy", authors: "Warren & Brandeis", journal: "Harvard Law Review", volume: "4", year: "1890", pinpoint: "213–214" }],
  ])("accepts ordinary partial form %s", (raw, fields) => expect(parseForeignArticleInput(raw)).toEqual(fields));
  it("completes an ordinary incomplete author/title request from the original work", async () => {
    const { result } = lookup(input, [[original]]);
    expect((await result).fields).toMatchObject({ volume: "4", journal: "Harvard Law Review", firstPage: "193", year: "1890" });
  });

  it("rejects a citing work that merely mentions the target title and authors", async () => {
    const { result } = lookup(input, [[citing], []]);
    const found = await result;
    expect(found.fields).toEqual({});
    expect(found.identity.matched).toBe(false);
  });

  it("uses the existing Tier 2 when a strong Tier 1 result is irrelevant", async () => {
    const { result, calls } = lookup(input, [[citing], [original]]);
    expect((await result).fields.firstPage).toBe("193");
    expect(calls.filter((call) => call.body)).toHaveLength(2);
  });

  it("uses richer Tier 2 evidence at the same URL without duplicating the source or inspection", async () => {
    const { result, calls } = lookup(input, [[{ ...original, snippet: "Samuel D. Warren and Louis D. Brandeis" }], [original]]);
    const found = await result;
    expect(found.fields.firstPage).toBe("193");
    expect(found.sources).toHaveLength(1);
    expect(calls.filter((call) => call.body)).toHaveLength(2);
    expect(calls.filter((call) => !call.body)).toHaveLength(1);
  });

  it("binds a tuple to its citation rather than the first tuple on the page", async () => {
    const { result } = lookup(input, [[{ ...citing, snippet: `${citing.snippet} Samuel D. Warren and Louis D. Brandeis, The Right to Privacy, 4 Harvard Law Review 193 (1890).` }]]);
    expect((await result).fields).toMatchObject({ volume: "4", firstPage: "193", year: "1890" });
  });

  it("rejects all metadata from a record conflicting with the supplied year", async () => {
    const { result } = lookup({ ...input, parsedFields: { authors: "Warren & Brandeis", articleTitle: "The Right to Privacy", year: "1890" } }, [[{ ...original, snippet: original.snippet.replace("(1890)", "(1990)") }], []]);
    const found = await result;
    expect(found.fields).toEqual({});
    expect(found.identity.conflicts.join(" ")).toContain("year:");
  });

  it("reads matching article citation metadata during the bounded page inspection", async () => {
    const html = '<meta name="citation_title" content="The Right to Privacy"><meta name="citation_author" content="Samuel D. Warren"><meta name="citation_author" content="Louis D. Brandeis"><meta name="citation_journal_title" content="Harvard Law Review"><meta name="citation_volume" content="4"><meta name="citation_firstpage" content="193"><meta name="citation_publication_date" content="1890/12/15">';
    const { result, calls } = lookup(input, [[{ ...original, snippet: "Samuel D. Warren and Louis D. Brandeis" }], []], html);
    const found = await result;
    expect(found.fields).toMatchObject({ volume: "4", journal: "Harvard Law Review", firstPage: "193", year: "1890" });
    expect(found.provenance.volume.basis).toBe("structured_metadata");
    expect(calls.filter((call) => !call.body)).toHaveLength(1);
  });

  it("recovers authors for title-only discovery from an explicit same-work citation", async () => {
    const { result } = lookup({ ...input, rawInput: "The Right to Privacy" }, [[original]]);
    const found = await result;
    expect(found.fields).toMatchObject({ authors: "Samuel D. Warren and Louis D. Brandeis", firstPage: "193", year: "1890" });
    expect(found.articleResolution).toBe("resolved");
  });

  it("does not count duplicate or more numerous wrong records to defeat a conflicting citation", async () => {
    const wrong = { ...original, snippet: original.snippet.replace("4 Harvard Law Review 193 (1890)", "39 Catholic U. L. Rev. 703 (1990)") };
    const { result } = lookup(input, [[original, { ...wrong, url: "https://lawreview.example.edu/a" }, { ...wrong, url: "https://lawreview.example.edu/b" }]]);
    const found = await result;
    expect(found.fields).toEqual({});
    expect(found.articleResolution).toBe("conflict");
    expect(found.identity.conflicts).toContain("conflicting_article_journal");
  });

  it("accepts a correct record despite more donors conflicting with the user's year", async () => {
    const wrong = { ...original, snippet: original.snippet.replace("4 Harvard Law Review 193 (1890)", "39 Catholic U. L. Rev. 703 (1990)") };
    const { result } = lookup({ ...input, rawInput: `${input.rawInput} (1890)` }, [[original, { ...wrong, url: "https://lawreview.example.edu/a" }, { ...wrong, url: "https://lawreview.example.edu/b" }]]);
    const found = await result;
    expect(found.fields).toMatchObject({ volume: "4", firstPage: "193", journal: "Harvard Law Review" });
    expect(found.fields.year).toBeUndefined();
    expect(found.identity.conflicts).toContain("year:1890 vs 1990");
  });

  it("does not conflate equal volume/page coordinates in different journals", async () => {
    const { result } = lookup(input, [[original, { ...original, url: "https://lawreview.example.edu/other", snippet: original.snippet.replace("Harvard Law Review", "Yale Law Journal") }]]);
    const found = await result;
    expect(found.articleResolution).toBe("conflict");
    expect(found.fields).toEqual({});
  });

  it("keeps compatible abbreviated publication anchors supplied by the user", async () => {
    const { result } = lookup({ ...input, parsedFields: { journal: "Harv. L. Rev.", volume: "4", firstPage: "193" } }, [[original]]);
    expect((await result).fields.year).toBe("1890");
  });

  it("does not match title-word substrings or a title extended into a different work", async () => {
    for (const title of ["The Brightest Privacy Debate", "The Right to Privacy: An Updated Theory"]) {
      const { result } = lookup(input, [[{ ...original, title, snippet: "Warren and Brandeis discuss the right to privacy. 39 Catholic U. L. Rev. 703 (1990)." }], []]);
      expect((await result).fields).toEqual({});
    }
  });

  it("does not bind a title-only prose mention to a later sentence's citation", async () => {
    const { result } = lookup({ ...input, rawInput: "The Right to Privacy" }, [[{ ...citing, snippet: "This paper discusses The Right to Privacy. 39 Catholic U. L. Rev. 703 (1990)." }], []]);
    expect((await result).fields).toEqual({});
  });

  it("requires all supplied author surnames in the bound record", async () => {
    const { result } = lookup(input, [[{ ...original, title: "The Right to Privacy", snippet: "Robert Brandeis, The Right to Privacy, 39 Catholic U. L. Rev. 703 (1990)." }], []]);
    expect((await result).fields).toEqual({});
  });

  it("distinguishes fully named authors sharing a surname", async () => {
    const { result } = lookup({ ...input, rawInput: "Samuel Warren, The Right to Privacy" }, [[{ ...original, title: "The Right to Privacy — John Warren", snippet: "John Warren, The Right to Privacy, 39 Catholic U. L. Rev. 703 (1990)." }], []]);
    const found = await result;
    expect(found.fields).toEqual({});
    expect(found.identity.conflicts.join(" ")).toContain("authors:");
  });

  it("does not erase the byline when accepting a heading plus leading tuple", async () => {
    const { result } = lookup({ ...input, rawInput: "Samuel Warren, The Right to Privacy" }, [[{ ...original, title: "The Right to Privacy — John Warren", snippet: "4 Harvard Law Review 193 (1890)." }], []]);
    expect((await result).fields).toEqual({});
  });

  it("accepts a compatible heading byline and leading publication tuple", async () => {
    const { result } = lookup(input, [[{ ...original, snippet: "4 Harvard Law Review 193 (1890)." }]]);
    expect((await result).fields.firstPage).toBe("193");
  });

  it("returns a terminal incomplete article without calling a provider when credentials are absent", async () => {
    const found = await runForeignLookup(input, { apiKey: null, fetchImpl: (() => { throw new Error("forbidden"); }) as typeof fetch });
    expect(found.articleResolution).toBe("incomplete");
    expect(found.error).toBe("missing_perplexity_credentials");
    expect(found.fields).toEqual({});
  });

  it("recovers a citation with comma-separated coauthors", async () => {
    const { result } = lookup(input, [[{ ...original, snippet: original.snippet.replace("Warren and Louis", "Warren, Louis") }]]);
    expect((await result).fields.firstPage).toBe("193");
  });

  it("prefers an explicitly bound reference over a leading unbound tuple", async () => {
    const { result } = lookup(input, [[{ ...original, snippet: `39 Catholic U. L. Rev. 703 (1990). ${original.snippet}` }]]);
    expect((await result).fields.firstPage).toBe("193");
  });

  it("rejects unrelated page self-metadata and body-reference tuples", async () => {
    const html = '<meta name="citation_title" content="Privacy After a Century"><meta name="citation_author" content="Warren and Brandeis"><meta name="citation_volume" content="39"><meta name="citation_journal_title" content="Catholic U. L. Rev."><meta name="citation_firstpage" content="703"><meta name="citation_date" content="1990"><p>Warren and Brandeis, The Right to Privacy, 4 Harvard Law Review 193 (1890).</p>';
    const { result } = lookup(input, [[{ ...original, snippet: "Warren and Brandeis" }], []], html);
    expect((await result).fields).toEqual({});
  });

  it("keeps an explicitly grounded partial metadata record useful", async () => {
    const html = '<meta name="citation_title" content="The Right to Privacy"><meta name="citation_author" content="Warren"><meta name="citation_author" content="Brandeis"><meta name="citation_journal_title" content="Harvard Law Review"><meta name="citation_date" content="1890">';
    const { result } = lookup(input, [[{ ...original, snippet: "Warren and Brandeis" }], []], html);
    const found = await result;
    expect(found.fields).toEqual({ journal: "Harvard Law Review", year: "1890" });
    expect(found.articleResolution).toBe("incomplete");
    expect(found.provenance.year).toEqual({ value: "1890", sourceUrl: original.url, sourceTitle: original.title, basis: "structured_metadata" });
  });

  it("does not ground metadata from a weak host", async () => {
    const { result, calls } = lookup(input, [[{ ...original, url: "https://random.example/post" }], []]);
    expect((await result).fields).toEqual({});
    expect(calls.filter((call) => call.body)).toHaveLength(2);
    expect(calls.filter((call) => !call.body)).toHaveLength(0);
  });
});
