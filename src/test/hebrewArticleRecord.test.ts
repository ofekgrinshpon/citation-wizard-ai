import { describe, it, expect, vi } from "vitest";
import { createHebrewArticleRequest, resolveHebrewArticle, renderHebrewArticle, collectHebrewArticleEvidence } from "../../supabase/functions/_shared/hebrewArticleEvidence";
import { readHebrewArticleRecord, fetchHebrewArticleRecords, isHebrewArticleRecordUrl } from "../../supabase/functions/_shared/hebrewArticleRecord";

// Explicit offline records exercise the grammar; these are not captured Sonar
// payloads and do not establish live-provider coverage.
const fixtures = [
  { author: "ז'וזה ברונר", title: "בין קפקא לקנט: קריאה ראשונית בפסקי הדין הפליליים של דפנה ברק ארז", journal: "עיוני משפט", volume: "לט", page: "59", year: "2016" },
  { author: "עומר פלד", title: "חישוב הנזק בתנאי אי-ודאות: התאמת הנתון הסטטיסטי למטרותיהם של דיני הפיצויים", journal: "עיוני משפט", volume: "לט", page: "147", year: "2016" },
  { author: "דניאל פרידמן", title: "עוד לפרשנות החקיקה הישראלית החדשה", journal: "עיוני משפט", volume: "ה", page: "463", year: "1977" },
];
const html = (f = fixtures[0]) => `<h1>${f.title}</h1><table><tr><th>מחבר</th><td>${f.author}</td></tr><tr><th>כתב עת</th><td>${f.journal}</td></tr><tr><th>כרך</th><td>${f.volume}</td></tr><tr><th>עמודים</th><td>${f.page}–200</td></tr><tr><th>שנה</th><td>${f.year}</td></tr></table>`;
const url = "https://law.tau.ac.il/article/example";
const resolved = (raw: string, page = html()) => {
  const req = createHebrewArticleRequest(raw);
  return resolveHebrewArticle(req, readHebrewArticleRecord(req, page, url));
};

describe("source-bound Hebrew journal completion", () => {
  it.each(fixtures)("reads separate fields for $author without generated publication JSON", f => {
    const r = resolved(`${f.author} "${f.title}"`, html(f));
    expect(r.fields).toMatchObject({ journalName: f.journal, volume: f.volume, firstPage: f.page, year: f.year });
    expect(r.matched).toBe(true);
  });
  it("keeps a standalone supplied journal and fills only missing values", () => {
    const f = fixtures[0];
    const raw = `${f.author} "${f.title}" עיוני משפט`;
    expect(createHebrewArticleRequest(raw).supplied.journalName).toBe("עיוני משפט");
    const r = resolved(raw);
    expect(r.provenance.journalName?.status).toBe("supplied");
    expect(renderHebrewArticle(r)).toBe(`${f.author} "${f.title}" **עיוני משפט** לט 59 (2016).`);
  });
  it.each(["author-first", "author-last"])("binds unquoted %s to a record, not word count", order => {
    const f = fixtures[1];
    const raw = order === "author-first" ? `${f.author} ${f.title}` : `${f.title}, ${f.author}`;
    expect(createHebrewArticleRequest(raw).supplied.author).toBeUndefined();
    const r = resolved(raw, html(f));
    expect(r.fields.author).toBe(f.author);
    expect(r.fields.articleTitle).toBe(f.title);
    expect(r.fields.firstPage).toBe("147");
  });
  it("does not silently correct a title typo", () => {
    const f = fixtures[0];
    const raw = `${f.author} "${f.title.replace("קפקא", "קפפא")}"`;
    const r = resolved(raw);
    expect(r.matched).toBe(false);
    expect(r.fields.firstPage).toBeUndefined();
    expect(r.fields.articleTitle).toContain("קפפא");
  });
  it("does not borrow publication details from a conflicting journal", () => {
    const f = fixtures[0];
    const r = resolved(`${f.author} "${f.title}" משפטים`);
    expect(r.fields.journalName).toBe("משפטים");
    expect(r.fields.firstPage).toBeUndefined();
    expect(r.fields.year).toBeUndefined();
    expect(r.matched).toBe(false);
  });
  it("preserves another journal's existing citation", () => {
    const raw = 'דפנה ברק-ארז "כתיבה שיפוטית" **משפטים** מו 269 (תשע״ז).';
    expect(renderHebrewArticle(resolveHebrewArticle(createHebrewArticleRequest(raw), []))).toBe(raw);
  });
  it("reads explicit Highwire metadata and ignores update timestamps", () => {
    const f = fixtures[2];
    const meta = `<meta name="citation_title" content="${f.title}"><meta content="${f.author}" name="citation_author"><meta name="citation_journal_title" content="עיוני משפט"><meta name="citation_volume" content="ה"><meta name="citation_firstpage" content="463"><meta name="citation_publication_date" content="1977/06"><meta property="article:modified_time" content="2026-11-26">`;
    const r = resolved(`${f.author} "${f.title}"`, meta);
    expect(r.fields.year).toBe("1977");
    expect(r.fields.firstPage).toBe("463");
  });
  it("rejects multiple records and does not borrow a citing table", () => {
    const req = createHebrewArticleRequest(`${fixtures[0].author} "${fixtures[0].title}"`);
    expect(readHebrewArticleRecord(req, html() + html(fixtures[1]), url)).toEqual([]);
    expect(readHebrewArticleRecord(req, html().replace(fixtures[0].title, "מאמר אחר"), url)).toEqual([]);
  });
  it("reads a labelled publication list bound by source title and author", () => {
    const f = fixtures[0];
    const page = `<h1>${f.title}</h1><dl><dt>Authors</dt><dd>${f.author}</dd><dt>Journal</dt><dd>עיוני משפט</dd><dt>Volume</dt><dd>לט</dd><dt>Pages (from-to)</dt><dd>59–96</dd><dt>Publication status</dt><dd>Published - 2016</dd></dl>`;
    expect(resolved(`${f.author} "${f.title}"`, page).fields).toMatchObject({ volume: "לט", firstPage: "59", year: "2016", journalName: "עיוני משפט" });
  });
  it("never accepts generated fields without source evidence", () => {
    const req = createHebrewArticleRequest(`${fixtures[0].author} "${fixtures[0].title}"`);
    const proposed = { author: fixtures[0].author, articleTitle: fixtures[0].title, journalName: "משפטים", volume: "מח", firstPage: "291", year: "2018" };
    expect(collectHebrewArticleEvidence(req, proposed, [{ url, title: fixtures[0].title, snippet: "אין פרטי פרסום" }])).toEqual([]);
  });
  it("keeps issue metadata but omits a discovered issue for continuous vol. 39", () => {
    const f = fixtures[1], req = createHebrewArticleRequest(`${f.author} "${f.title}"`);
    const evidence = readHebrewArticleRecord(req, html(f), url);
    const r = resolveHebrewArticle(req, evidence.map(e => ({ ...e, fields: { ...e.fields, notebook: "1" } })));
    expect(r.fields.notebook).toBe("1");
    expect(r.renderNotebook).toBe(false);
    expect(renderHebrewArticle(r)).toContain("**עיוני משפט** לט 147 (2016).");
  });
  it("prints an issue only with restarted-pagination evidence; a low page alone is not proof", () => {
    const raw = 'יעל כהן "שוויון"', req = createHebrewArticleRequest(raw);
    const record = { fields: { author: "יעל כהן", articleTitle: "שוויון", journalName: "פלילים", volume: "ה", notebook: "2", firstPage: "27", year: "1996" }, sourceUrl: url, quote: "fixture" };
    expect(renderHebrewArticle(resolveHebrewArticle(req, [record]))).toContain("**פלילים** ה 27");
    expect(renderHebrewArticle(resolveHebrewArticle(req, [{ ...record, pagination: "restarted" }]))).toContain("**פלילים** ה(2) 27");
  });
  it("preserves supplied issue notation", () => {
    const f = fixtures[1], raw = `${f.author} "${f.title}" **עיוני משפט** לט(1) 147 (2016).`;
    expect(renderHebrewArticle(resolveHebrewArticle(createHebrewArticleRequest(raw), []))).toBe(raw);
  });
  it("leaves book/chapter parsing and rendering unchanged", () => {
    const raw = 'אייל גרוס "בריאות בישראל: בין זכות למצרך" **זכויות כלכליות, חברתיות ותרבותיות בישראל** 437, 440 (יורם רבין ויובל שני עורכים 2004).';
    const req = createHebrewArticleRequest(raw, true);
    expect(readHebrewArticleRecord(req, html(), url)).toEqual([]);
    expect(renderHebrewArticle(resolveHebrewArticle(req, []))).toBe(raw);
  });
  it("restricts page reads to public academic origins without redirects", async () => {
    expect(isHebrewArticleRecordUrl("https://127.0.0.1/x")).toBe(false);
    expect(isHebrewArticleRecordUrl("https://tau.ac.il.evil.test/x")).toBe(false);
    expect(isHebrewArticleRecordUrl("https://user:pass@tau.ac.il/x")).toBe(false);
    const fetcher = vi.fn(async () => new Response(html(), { headers: { "Content-Type": "text/html" } }));
    const req = createHebrewArticleRequest(`${fixtures[0].author} "${fixtures[0].title}"`);
    const evidence = await fetchHebrewArticleRecords(req, [{ url }, { url }, { url: "http://localhost/x" }], fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([url, expect.objectContaining({ redirect: "manual" })]);
    expect(evidence[0]?.fields.firstPage).toBe("59");
  });
});