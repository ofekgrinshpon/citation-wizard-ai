import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  articleRecordFromHtml, articleRecordFromPage, articleRecordsFromSnippet,
} from "../../supabase/functions/_shared/foreignArticle";
import { runForeignLookup } from "../../supabase/functions/citation-chat/foreignLookup";
import capture from "./fixtures/foreignArticleSearchCapture.json";

const title = "The Right to Privacy";
const authors = "Samuel D. Warren; Louis D. Brandeis";
const heading = `${title} ${authors} ...`;
const publication = "Harvard Law Review, Vol. 4, No. 5. (Dec. 15, 1890), pp. 193-220.";
const snippet = `${authors}\n${publication}\n...\nhttps://example.edu/original`;
const anchors = { articleTitle: title, authors: "Warren & Brandeis" };
const fields = { articleTitle: title, authors: "Samuel D. Warren and Louis D. Brandeis", journal: "Harvard Law Review", year: "1890", volume: "4", firstPage: "193" };
const bibtex = `@article{Warren1890, title={${title}}, author={${fields.authors}}, journal={Harvard Law Review}, year={1890}, volume={4}, pages={193--220}}`;
const parse = (body: string, resultTitle = heading) => articleRecordsFromSnippet({ title: resultTitle, snippet: body }, anchors);

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden in normalization tests"); })));
afterEach(() => vi.unstubAllGlobals());

describe("bounded publisher presentation normalization", () => {
  it.each([
    ["flattened snippet", snippet.replace(/\s+/g, " "), heading],
    ["journal soft wrap", snippet.replace("Law Review", "Law\nReview"), heading],
    ["journal suffix wrap", snippet.replace("Harvard Law", "Harvard\nLaw"), heading],
    ["author separator wrap", snippet.replace("; ", ";\n"), heading],
    ["author name wrap", snippet.replace("Louis D.", "Louis\nD."), heading],
    ["curly title quotes", snippet, heading.replace(title, `“${title}”`)],
    ["straight title quotes", snippet, heading.replace(title, `"${title}"`)],
    ["title terminal period", snippet, heading.replace(title, `${title}.`)],
    ["quoted title and terminal period", snippet, heading.replace(title, `“${title}”.`)],
    ["Unicode NBSP", snippet.replace(/ /g, "\u00a0"), heading.replace(/ /g, "\u00a0")],
    ["narrow NBSP", snippet.replace(/ /g, "\u202f"), heading.replace(/ /g, "\u202f")],
  ])("recovers %s without changing work or coordinates", (_name, body, resultTitle) => {
    expect(parse(body, resultTitle)).toEqual([{ fields, structured: false }]);
  });

  it("normalizes another title, author list, journal and date without fixture-specific values", () => {
    const record = articleRecordsFromSnippet({
      title: "“Customs and Courts”. Jane A. Smith; Peter Jones ...",
      snippet: "Jane A.\nSmith; Peter Jones\nYale Law\nJournal, Vol. 110, Issue 2, (2001), pp. 601-649.",
    }, { articleTitle: "Customs and Courts", authors: "J. Smith & P. Jones" });
    expect(record[0]?.fields).toEqual({ articleTitle: "Customs and Courts", authors: "Jane A. Smith and Peter Jones", journal: "Yale Law Journal", volume: "110", year: "2001", firstPage: "601" });
  });

  it("can normalize journal metadata after an isolated body title and byline", () => {
    expect(parse(`${title}\n${authors}\n${publication.replace("Law Review", "Law\nReview")}`, "Unrelated result heading"))
      .toEqual([{ fields, structured: false }]);
  });

  it.each([
    ["unclosed title quote", snippet, heading.replace(title, `“${title}`)],
    ["mismatched title quote", snippet, heading.replace(title, `“${title}"`)],
    ["unmatched closing quote", snippet, heading.replace(title, `${title}”`)],
    ["truncated title", snippet, heading.replace(title, `${title}...`)],
    ["extended title", snippet, heading.replace(title, `${title}: A Retrospective`)],
    ["different heading byline", snippet.replace(/\s+/g, " "), heading.replace("Louis D. Brandeis", "Felix Frankfurter")],
    ["different body byline", snippet.replace("Louis D. Brandeis", "Felix Frankfurter").replace(/\s+/g, " "), heading],
    ["ellipsis before publication", `${authors}\n...\n${publication.replace("Law Review", "Law\nReview")}`, heading],
    ["different titled record", `${authors}\nAnother Article\n${publication}`, heading],
    ["another complete journal", `${authors}\nYale Law Journal\n${publication}`, heading],
    ["reference prose", `References discussing ${title}\n${authors}\n${publication}`, heading],
    ["no independent flattened byline", snippet.replace(/\s+/g, " "), title],
    ["blank paragraph inside author", snippet.replace("; ", ";\n\n"), heading],
    ["missing year", snippet.replace("(Dec. 15, 1890), ", "").replace(/\s+/g, " "), heading],
    ["missing pages", snippet.replace(", pp. 193-220", "").replace(/\s+/g, " "), heading],
    ["encoded HTML whitespace", snippet.replace("Harvard Law", "Harvard&nbsp;Law"), heading],
  ])("declines %s", (_name, body, resultTitle) => expect(parse(body, resultTitle)).toEqual([]));

  it("keeps the captured wrong Catholic donor rejected", () => {
    expect(articleRecordsFromSnippet(capture.searches[0].results[5], anchors)).toEqual([]);
  });

  it.each([
    ["bare carriage return", "\r"],
    ["Unicode line separator", "\u2028"],
    ["Unicode paragraph separator", "\u2029"],
    ["vertical tab", "\v"],
    ["form feed", "\f"],
  ])("preserves %s boundaries between journals, authors and heading metadata", (_name, separator) => {
    expect(parse(`${authors}\nYale Law Journal${separator}${publication}`)).toEqual([]);
    expect(parse(`Samuel D. Warren;${separator}Louis D. Brandeis ${publication}`)).toEqual([]);
    expect(parse(`Samuel D. Warren;${separator}${separator}Louis D. Brandeis ${publication}`)).toEqual([]);
    expect(parse(snippet.replace(/\s+/g, " "), `${title}${separator}${authors} ...`)).toEqual([]);
    expect(parse(snippet.replace(/\s+/g, " "), `${title}${separator}${separator}${authors} ...`)).toEqual([]);
    expect(parse(snippet, `“${title}”${separator}${authors} ...`)).toEqual([]);
  });

  it.each([["LF", "\n"], ["CRLF", "\r\n"]])("supports %s soft wraps but preserves blank paragraph boundaries", (_name, separator) => {
    const wrapped = `${authors.replace("; ", `;${separator}`)}${separator}${publication.replace("Law Review", `Law${separator}Review`)}`;
    expect(parse(wrapped)).toEqual([{ fields, structured: false }]);
    expect(parse(`Samuel D. Warren;${separator}${separator}Louis D. Brandeis ${publication}`)).toEqual([]);
    expect(parse(snippet.replace(/\s+/g, " "), `${title}${separator}${separator}${authors} ...`)).toEqual([]);
    expect(parse(snippet, `“${title}”${separator}${separator}${authors} ...`)).toEqual([]);
    expect(parse(`${authors}\nYale Law Journal${separator}${publication}`)).toEqual([]);
  });

  it.each(["\n\n", "\n \n", "\r\n\r\n", "\r\n \r\n"])("requires the new record to complete before paragraph boundary %j", (boundary) => {
    expect(parse(`${authors}${boundary}${publication.replace("Law Review", "Law\nReview")}`)).toEqual([]);
    for (const split of ["Harvard Law", "Review,", "Vol. 4,", "No. 5.", "1890),", "pp."]) {
      expect(parse(`${authors} ${publication.replace(`${split} `, `${split}${boundary}`)}`)).toEqual([]);
    }
  });

  it.each([
    `${authors}\n${publication}`.replace(/ /g, "\u00a0"),
    `${authors}\n${publication.replace("Law Review", "Law\nReview")}`,
    `${authors} ${publication}`,
  ])("retains a complete normalized prefix before an unrelated footer paragraph", (body) => {
    expect(parse(`${body}\n\nAnother Article\nCatholic U. L. Rev., Vol. 39, 1990, pp. 703-710.`))
      .toEqual([{ fields, structured: false }]);
  });

  it("preserves independent records for conflict detection", () => {
    const body = `${title}\n${authors}\n${publication.replace("Law Review", "Law\nReview")}`;
    expect(parse(`${body}\n${body.replace("1890", "1990")}`, "").map((record) => record.fields.year))
      .toEqual(["1890", "1990"]);
  });
});

describe("self-identifying fetched article representations", () => {
  it.each([bibtex, `\n \t${bibtex}\r\n`, bibtex.replace("@article{Warren1890,", "@ARTICLE(Warren1890,").replace(/}$/, ")")])("uses the complete record parser for a whole BibTeX response", (body) => {
    expect(articleRecordFromPage(body, anchors)).toEqual({ fields, structured: true });
    expect(articleRecordsFromSnippet({ snippet: body }, anchors)[0]?.fields).toEqual(fields);
  });

  it.each([
    bibtex.slice(0, -1),
    `${bibtex}\n${bibtex.replace("1890", "1990")}`,
    `References:\n${bibtex}`,
    `<html><body><pre>${bibtex}</pre></body></html>`,
    `${title}\n${bibtex}`,
    `${bibtex}\nUnrelated trailing text`,
    bibtex.replace("@article", "@book"),
    bibtex.replace("year={1890}", "indexed={1890}"),
    bibtex.replace("year={1890}", "year={1890}, YEAR={1990}"),
    bibtex.replace("year={1890}", 'year="1890'),
    bibtex.replace(title, `${title}: A Retrospective`),
    `{"title":"${title}","author":"${fields.authors}","journal":"Harvard Law Review","year":1890,"volume":4,"page":193}`,
    `{"title":"${title}","author":"${fields.authors}","journal":"Harvard Law Review","year":1890,"volume":4,"page":193,"resource":`,
    `${fields.authors}, ${title}, 4 Harvard Law Review 193 (1890).`,
    " ".repeat(16_384) + bibtex,
    bibtex.replace("pages={193--220}", `pages={193--220}, note={${"x".repeat(8_192)}}`),
  ])("declines non-isolated, malformed or unsupported full-page text", (body) => {
    expect(articleRecordFromPage(body, anchors)).toBeNull();
  });

  it("preserves existing citation_* HTML metadata exactly", () => {
    const html = `<html><head><meta name="citation_title" content="${title}"><meta name="citation_author" content="Samuel D. Warren"><meta name="citation_author" content="Louis D. Brandeis"><meta name="citation_journal_title" content="Harvard Law Review"><meta name="citation_volume" content="4"><meta name="citation_firstpage" content="193"><meta name="citation_date" content="1890-12-15"></head><body>References to other works</body></html>`;
    expect(articleRecordFromPage(html, anchors)).toEqual(articleRecordFromHtml(html, anchors));
  });

  it("resolves the existing selected page with unchanged Search payload and precise supplied pinpoint", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const result = await runForeignLookup({ kind: "journal_article", jurisdiction: "OTHER", rawInput: capture.input.rawInput, parsedFields: { ...capture.input.parsedFields, pinpoint: "213 – 214" } }, {
      apiKey: "offline-only",
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
        return String(url) === "https://api.perplexity.ai/search"
          ? new Response(JSON.stringify({ results: [{ title, url: "https://journal.example.edu/original", snippet: "" }] }), { status: 200 })
          : new Response(bibtex, { status: 200, headers: { "content-type": "application/x-bibtex" } });
      }) as typeof fetch,
    });
    expect(result.articleResolution).toBe("resolved");
    expect(result.identity.conflicts).toEqual([]);
    expect(result.fields).toEqual({ authors: fields.authors, journal: fields.journal, year: "1890", volume: "4", firstPage: "193" });
    expect(result.fields.pinpoint).toBeUndefined();
    expect(result.provenance.journal).toMatchObject({ sourceUrl: "https://journal.example.edu/original", basis: "structured_metadata" });
    expect(calls).toEqual([{ url: "https://api.perplexity.ai/search", body: capture.searches[0].body }, { url: "https://journal.example.edu/original" }]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
