import { describe, expect, it } from "vitest";
import { articleRecordsFromSnippet, type ArticleFields } from "../../supabase/functions/_shared/foreignArticle";
import { runForeignLookup } from "../../supabase/functions/citation-chat/foreignLookup";

const title = "The Right to Privacy";
const authors = "Samuel D. Warren and Louis D. Brandeis";
const anchors = { articleTitle: title, authors: "Warren & Brandeis" };
const canonical = { articleTitle: title, authors, journal: "Harvard Law Review", year: "1890", volume: "4", firstPage: "193" };
const bibtex = `@article{Warren1890, title={${title}}, author={${authors}}, journal={Harvard Law Review}, year={1890}, volume={4}, pages={193--220}, url={https://example.edu/original} }`;
const publication = "Harvard Law Review, Vol. 4, No. 5. (Dec. 15, 1890), pp. 193-220.";
const record = (snippet: string, heading = "", supplied: ArticleFields = anchors) => articleRecordsFromSnippet({ title: heading, snippet }, supplied);

async function lookup(snippets: string[], parsedFields: ArticleFields = {}, rawInput = "Warren & Brandeis, The Right to Privacy, pp. 213–214.") {
  return runForeignLookup({ kind: "journal_article", jurisdiction: "OTHER", rawInput, parsedFields }, {
    apiKey: "offline-only",
    fetchImpl: (async (url: string | URL | Request) => String(url) === "https://api.perplexity.ai/search"
      ? new Response(JSON.stringify({ results: snippets.map((snippet, i) => ({ title: `Record ${i}`, url: `https://law.harvard.edu/record-${i}`, snippet })) }), { status: 200 })
      : new Response("", { status: 404 })) as typeof fetch,
  });
}

describe("bounded complete BibTeX article records", () => {
  it("reads a complete record independently of its heading", () => {
    expect(record(bibtex, "Search result")).toEqual([{ fields: canonical, structured: false }]);
  });

  it("supports case-insensitive keys, quotes, bare numbers and parenthesized entries", () => {
    const text = `@ARTICLE(key, TITLE="${title}", AUTHOR="${authors}", JOURNAL="Harvard Law Review", YEAR=1890, VOLUME=4, PAGES="193–220")`;
    expect(record(text)[0]?.fields).toEqual(canonical);
  });

  it("normalizes bounded nested braces, whitespace and standard inverted personal names", () => {
    const text = bibtex.replace(`{${title}}`, "{The {Right} to\n{Privacy}}")
      .replace(`{${authors}}`, "{Warren, Samuel D. and Brandeis, Louis D.}")
      .replace("{Harvard Law Review}", "{Harvard {Law} Review}");
    expect(record(text)[0]?.fields).toEqual(canonical);
  });

  it("handles escaped literal punctuation without implementing TeX macros", () => {
    const text = bibtex.replace(`{${title}}`, String.raw`{Privacy \& Publicity \{Revisited\}}`);
    expect(record(text, "", { articleTitle: "Privacy & Publicity {Revisited}" })[0]?.fields.articleTitle)
      .toBe("Privacy & Publicity {Revisited}");
  });

  it("parses other complete articles without fixture-specific words or coordinates", () => {
    const text = "@article{different, author={Jane A. Smith and Peter Jones}, title={Customs and Courts}, journal={Yale Law Journal}, year=2001, volume=110, pages={601-649}}";
    expect(record(text, "", { articleTitle: "Customs and Courts" })[0]?.fields).toEqual({ articleTitle: "Customs and Courts", authors: "Jane A. Smith and Peter Jones", journal: "Yale Law Journal", year: "2001", volume: "110", firstPage: "601" });
  });

  it.each(["title", "author", "journal", "year", "volume", "pages"])("requires an explicit %s rather than pooling an incomplete record", (field) => {
    const incomplete = bibtex.replace(new RegExp(`${field}=\\{[^}]*\\},?\\s*`), "");
    expect(record(incomplete, `${title} — ${authors}`)).toEqual([]);
  });

  it.each([
    ["missing entry close", bibtex.slice(0, -1)],
    ["missing value close", bibtex.replace("pages={193--220}", "pages={193--220")],
    ["missing field separator", bibtex.replace("}, author", "} author")],
    ["unclosed quoted value", bibtex.replace("year={1890}", 'year="1890')],
    ["bare macro", bibtex.replace("year={1890}", "year=publicationYear")],
    ["concatenated value", bibtex.replace("year={1890}", 'year={18} # "90"')],
    ["unknown TeX command", bibtex.replace("The Right", String.raw`The \textbf{Right}`)],
    ["duplicate field", bibtex.replace("year={1890}", "year={1890}, YEAR={1890}")],
    ["conflicting duplicate field", bibtex.replace("year={1890}", "year={1890}, year={1990}")],
    ["truncated title", bibtex.replace("The Right to Privacy", "The Right to Privacy...")],
    ["truncated byline", bibtex.replace("Louis D. Brandeis", "et al.")],
    ["reversed page range", bibtex.replace("193--220", "220--193")],
    ["non-article entry", bibtex.replace("@article", "@book")],
  ])("declines %s without repairing syntax", (_label, text) => expect(record(text)).toEqual([]));

  it("does not borrow publication dates from unrelated metadata", () => {
    expect(record(bibtex.replace("year={1890}", "deposited={1890}, indexed={2026}"))).toEqual([]);
  });

  it("keeps multiple records separate and accepts only the exact target title", () => {
    const wrong = bibtex.replace(title, "Privacy After a Century").replace("1890", "1990");
    expect(record(`${wrong}\n${bibtex}`)).toEqual([{ fields: canonical, structured: false }]);
    expect(record(`${bibtex.replace("pages={193--220},", "")}\n${wrong}`)).toEqual([]);
  });

  it("does not suppress conflicting complete records", async () => {
    const result = await lookup([`${bibtex}\n${bibtex.replace("year={1890}", "year={1990}")}`]);
    expect(result.fields).toEqual({});
    expect(result.articleResolution).toBe("conflict");
    expect(result.identity.conflicts).toContain("conflicting_article_year");
  });

  it("does not recover a nested article or prose reference from another entry", () => {
    const mention = `${authors}, ${title}, 39 Catholic U. L. Rev. 703 (1990).`;
    expect(record(`@article{donor, title={Another Article}, note={${bibtex} ${mention}}}`)).toEqual([]);
    expect(record(`@book{donor, title={Another Work}, note={${mention}}}`)).toEqual([]);
  });

  it("does not join citation fragments across a removed BibTeX entry", () => {
    expect(record(`${authors}, ${title}, @book{other, title={Another Work}} 39 Catholic U. L. Rev. 703 (1990).`)).toEqual([]);
  });

  it("declines an unterminated entry rather than treating its nested text as a later record", () => {
    expect(record(`@article{donor, title={Another Article}, note={\n${bibtex}`)).toEqual([]);
  });

  it("resumes after a closed but malformed record", () => {
    expect(record(`@article{bad, year=notLiteral}\n${bibtex}`)).toEqual([{ fields: canonical, structured: false }]);
  });

  it("enforces entry, depth, field-count and snippet bounds", () => {
    expect(record(bibtex.replace("{The Right to Privacy}", `{${"{".repeat(20)}${title}${"}".repeat(20)}}`))).toEqual([]);
    expect(record(bibtex.replace("url={https://example.edu/original}", `note={${"x".repeat(9000)}}`))).toEqual([]);
    expect(record(bibtex.replace("url={https://example.edu/original}", Array.from({ length: 33 }, (_, i) => `field${i}={x}`).join(",")))).toEqual([]);
    expect(record(" ".repeat(16_384) + bibtex)).toEqual([]);
  });

  it.each([
    ["authors", "John Warren and Louis Brandeis"],
    ["authors", "Louis Brandeis and Samuel Warren"],
    ["authors", "Samuel Warren"],
    ["year", "1990"],
    ["volume", "39"],
    ["journal", "Catholic U. L. Rev."],
    ["firstPage", "703"],
  ])("preserves lookup conflict checks for supplied %s=%s", async (field, value) => {
    const result = await lookup([bibtex], { [field]: value });
    expect(result.fields).toEqual({});
    expect(result.identity.conflicts.some((conflict) => conflict.startsWith(`${field}:`))).toBe(true);
  });

  it("resolves a title-only request with evidenced authors and publication fields", async () => {
    const result = await lookup([bibtex], {}, title);
    expect(result.fields).toMatchObject({ authors, journal: "Harvard Law Review", volume: "4", firstPage: "193", year: "1890" });
    expect(result.articleResolution).toBe("resolved");
    expect(result.provenance.firstPage.basis).toBe("search_result_explicit");
    expect(result.fields.pinpoint).toBeUndefined();
  });
});

describe("adjacent publisher article records", () => {
  const semicolonAuthors = "Samuel D. Warren; Louis D. Brandeis";

  it("binds a standalone snippet title, byline and publication line", () => {
    expect(record(`${title}\n${semicolonAuthors}\n${publication}`, "Unrelated search heading")[0]?.fields)
      .toEqual({ ...canonical, authors: semicolonAuthors });
  });

  it("binds a decorated heading only when the same complete byline leads the snippet", () => {
    expect(record(`${semicolonAuthors}\n${publication}`, `${title} ${semicolonAuthors} ...`)[0]?.fields)
      .toEqual({ ...canonical, authors: semicolonAuthors });
  });

  it("retains title-only discovery from an echoed complete multi-author heading", () => {
    expect(record(`${semicolonAuthors}\n${publication}`, `${title} ${semicolonAuthors} ...`, { articleTitle: title })[0]?.fields)
      .toEqual({ ...canonical, authors: semicolonAuthors });
  });

  it.each([" and ", " & ", "; "])("accepts an adjacent %s byline", (separator) => {
    const byline = `Samuel D. Warren${separator}Louis D. Brandeis`;
    expect(record(`${title}\nBy ${byline}\n${publication}`)[0]?.fields.authors).toBe(byline);
  });

  it.each([
    "Harvard Law Review, Volume 4, Issue 5, December 1890, pp. 193–220.",
    "Harvard Law Review, Vol. IV, No. 5. (Dec. 15, 1890), pp. 193-220.",
    "Harvard Law Review, Vol. 4, No. 5 (15 December 1890), pp. 193-220.",
    "Harvard Law Review, Vol. 4, 1890, Pages 193-220.",
    "Harvard Law Review, Vol. 4, (1890-12-15), p. 193.",
    "Harvard Law Review, Vol. 4, Issue 5, 1890/12/15, pp. 193.",
    "Harvard Law Review, Vol. 4 Spring 1890 pp. 193.",
    "Harvard Law Review, Volume 4, Issue 5, Autumn 1890, pp. 193–220.",
  ])("reads publication issue/date variant %s", (line) => {
    expect(record(`${title}\n${authors}\n${line}`)[0]?.fields).toEqual(canonical);
  });

  it.each([
    publication.replace("(Dec. 15, 1890)", "(Dec. 15, 1890–1991)"),
    publication.replace("(Dec. 15, 1890)", "(Dec. 15, 1890"),
    publication.replace("(Dec. 15, 1890)", "Deposited 1890"),
    publication.replace("(Dec. 15, 1890)", "(Dec. 99, 1890)"),
    publication.replace("pp. 193-220", "pages unknown"),
    publication.replace("pp. 193-220", "pp. 220-193"),
  ])("declines incomplete or ambiguous publication line %s", (line) => {
    expect(record(`${title}\n${authors}\n${line}`)).toEqual([]);
  });

  it("does not join a target mention to a later work's publication", () => {
    expect(record(`${title}\n${authors}\nDiscussed in:\n39 Catholic U. L. Rev. 703 (1990).`)).toEqual([]);
    expect(record(`Discusses ${title}\n${authors}\n${publication}`)).toEqual([]);
    expect(record(`${authors}\n${publication}`, `The Birth of Privacy Law: A Century Since Warren and Brandeis, 39 Catholic U. L. Rev. 703 (1990)`)).toEqual([]);
  });

  it("rejects decorated headings with a different byline or extended title", () => {
    for (const heading of [`${title} John Warren; Louis Brandeis ...`, `${title}: A Modern Theory ${semicolonAuthors} ...`, `${title} ${semicolonAuthors} cited by Other Author ...`]) {
      expect(record(`${semicolonAuthors}\n${publication}`, heading)).toEqual([]);
    }
  });

  it("does not interpret an echoed subtitle as a title-only author's name", () => {
    for (const heading of [`${title}: A Modern Theory`, `${title} A Modern Theory`]) {
      expect(record(`A Modern Theory\n${publication}`, heading, { articleTitle: title })).toEqual([]);
    }
    expect(record(`A Modern Theory\n${publication}`, `${title} A Modern Theory`)).toEqual([]);
  });

  it("declines truncation markers in the actual title, byline or journal", () => {
    for (const snippet of [
      `${title}...\n${authors}\n${publication}`,
      `${title}…\n${authors}\n${publication}`,
      `${title}\nSamuel D. Warren; Louis...\n${publication}`,
      `${title}\n${authors}\n${publication.replace("Harvard Law Review", "Harvard Law Review...")}`,
    ]) expect(record(snippet, "", { articleTitle: title })).toEqual([]);
  });

  it("does not reaccept truncated metadata through the older heading fallback", () => {
    expect(record(`${authors}\n${publication}`, `${title}...`, { articleTitle: title })).toEqual([]);
    expect(record(`Samuel D. Warren and Louis...\n${publication}`, title, { articleTitle: title })).toEqual([]);
    expect(record(bibtex, `${title}...`)).toEqual([{ fields: canonical, structured: false }]);
  });

  it("retains every independently complete repeated block for conflict detection", async () => {
    const first = `${title}\n${authors}\n${publication}`;
    const second = `${title}\n${authors}\n${publication.replace("1890", "1990")}`;
    expect(record(`${first}\n${second}`)).toHaveLength(2);
    const result = await lookup([`${first}\n${second}`]);
    expect(result.fields).toEqual({});
    expect(result.articleResolution).toBe("conflict");
    expect(result.identity.conflicts).toContain("conflicting_article_year");
  });

  it("does not borrow an unbound heading's title when publication comes before the snippet byline", () => {
    expect(record(`${publication}\n${semicolonAuthors}`, `${title} ${semicolonAuthors} ...`)).toEqual([]);
  });

  it("preserves same-surname, author-order and supplied-year conflict checks", async () => {
    const snippet = `${title}\n${authors}\n${publication}`;
    for (const supplied of [{ authors: "John Warren & Louis Brandeis" }, { authors: "Louis Brandeis & Samuel Warren" }, { year: "1990" }]) {
      const result = await lookup([snippet], supplied);
      expect(result.fields).toEqual({});
      expect(result.identity.conflicts).not.toEqual([]);
    }
  });

  it("does not salvage malformed or truncated JSON", () => {
    expect(record(`{"title":"${title}","author":"${authors}","journal":"Harvard Law Review","year":1890,"volume":4,"page":193,"resource":`)).toEqual([]);
  });
});
