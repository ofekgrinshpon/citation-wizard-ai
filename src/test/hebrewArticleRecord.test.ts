import { describe, it, expect, vi } from "vitest";
import { createHebrewArticleRequest, resolveHebrewArticle, renderHebrewArticle, collectHebrewArticleEvidence } from "../../supabase/functions/_shared/hebrewArticleEvidence";
import { readHebrewArticleRecord, fetchHebrewArticleRecords, isHebrewArticleRecordUrl, isNliArticleRecordUrl } from "../../supabase/functions/_shared/hebrewArticleRecord";

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
  // Synthetic dedicated-record fixtures, not a captured NLI page or proof
  // that the live catalogue currently serves this metadata representation.
  const nli = "https://www.nli.org.il/he/articles/RAMBI990000000000000001/NLI";
  const f = fixtures[2];
  const req = () => createHebrewArticleRequest(`${f.author} ${f.title}`);
  const reference = (tail = "עיוני משפט ה 463 (1977)", author = f.author) => ({
    title: "פסק דין", url: "https://supremedecisions.court.gov.il/example", snippet: `${author} "${f.title}" ${tail}`,
  });
  const primary = () => readHebrewArticleRecord(req(), html(f), nli);
  it("admits only dedicated NLI article paths, not its entire domain", () => {
    expect(isNliArticleRecordUrl(nli)).toBe(true);
    expect(isHebrewArticleRecordUrl(nli)).toBe(true);
    for (const path of ["/he/search", "/he/books/NNL_ALEPH990000000000000001/NLI", "/he/authorities/1", "/he/articles/collection/NLI"]) {
      expect(isHebrewArticleRecordUrl(`https://www.nli.org.il${path}`)).toBe(false);
    }
    expect(isNliArticleRecordUrl(nli.replace("www.nli.org.il", "www.nli.org.il.evil.test"))).toBe(false);
    expect(isNliArticleRecordUrl(nli + "?redirect=evil")).toBe(false);
  });
  it("reads a standalone ScholarlyArticle, not webpage or book metadata", () => {
    const record = { "@type": "ScholarlyArticle", headline: f.title, author: { "@type": "Person", name: f.author },
      isPartOf: { "@type": "PublicationIssue", issueNumber: "3", isPartOf: { "@type": "PublicationVolume", volumeNumber: "ה", isPartOf: { "@type": "Periodical", name: f.journal } } },
      pageStart: "463", datePublished: "1977" };
    const page = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
    expect(readHebrewArticleRecord(req(), page(record), nli)[0]?.fields).toMatchObject({ firstPage: "463", year: "1977", volume: "ה", notebook: "3", journalName: "עיוני משפט" });
    expect(readHebrewArticleRecord(req(), page({ ...record, "@type": "Book" }), nli)).toEqual([]);
    expect(readHebrewArticleRecord(req(), page({ ...record, author: { "@type": "Person", name: "דוד פרידמן" } }), nli)).toEqual([]);
    expect(readHebrewArticleRecord(req(), page({ ...record, pageStart: "בעמ׳ 489–488", datePublished: undefined, dateModified: "2026" }), nli)[0]?.fields.firstPage).toBeUndefined();
  });
  it("accepts a complete judicial citation as backup with the full supplied identity", () => {
    const e = collectHebrewArticleEvidence(req(), {}, [reference()]);
    expect(resolveHebrewArticle(req(), e).fields).toMatchObject({ firstPage: "463", year: "1977", volume: "ה", journalName: "עיוני משפט" });
  });
  it.each(["עיוני משפט ה בעמ׳ 489–488 (1977)", "עיוני משפט ה בעמ' 489–488 (1977)", "עיוני משפט בעמ׳ 489–488 (1977)"])("never promotes a pinpoint into opening page: %s", tail => {
    const r = resolveHebrewArticle(req(), collectHebrewArticleEvidence(req(), {}, [reference(tail)]));
    expect(r.fields.firstPage).toBeUndefined();
    expect(r.matched).toBe(false);
  });
  it("keeps the opening page when a separate pinpoint follows it", () => {
    expect(resolveHebrewArticle(req(), collectHebrewArticleEvidence(req(), {}, [reference("עיוני משפט ה 463, בעמ׳ 489–488 (1977)")])).fields.firstPage).toBe("463");
  });
  it.each(["עיוני משפט ה 463", "עיוני משפט 463 (1977)", "עיוני משפט ה (1977)"])("rejects an incomplete secondary tuple: %s", tail => {
    expect(collectHebrewArticleEvidence(req(), {}, [reference(tail)])).toEqual([]);
  });
  it("does not globally equate initials with full names", () => {
    expect(collectHebrewArticleEvidence(req(), {}, [reference(undefined, "ד׳ פרידמן")])).toEqual([]);
    expect(collectHebrewArticleEvidence(createHebrewArticleRequest(f.title), {}, [reference(undefined, "ד׳ פרידמן")])).toEqual([]);
  });
  it("cannot use judicial page headings or separate labels to bypass the full-reference gate", () => {
    expect(collectHebrewArticleEvidence(req(), { author: f.author, articleTitle: f.title }, [{
      ...reference(), title: f.title,
      snippet: `שם המאמר: ${f.title}; מחבר: ${f.author}; כתב עת: עיוני משפט; עמוד ראשון: 489; שנה: 1977`,
    }])).toEqual([]);
  });
  it("binds initials only through a direct same-title full-name record", () => {
    const direct = primary();
    expect(collectHebrewArticleEvidence(req(), {}, [reference(undefined, "ד׳ פרידמן")], direct)).toHaveLength(1);
    expect(collectHebrewArticleEvidence(req(), {}, [reference(undefined, "י׳ פרידמן")], direct)).toEqual([]);
    const otherTitle = direct.map(e => ({ ...e, fields: { ...e.fields, articleTitle: "מאמר אחר" } }));
    expect(collectHebrewArticleEvidence(req(), {}, [reference(undefined, "ד׳ פרידמן")], otherTitle)).toEqual([]);
  });
  it.each([false, true])("direct publication prevails over conflicting judicial pages, regardless of order: %s", reverse => {
    const secondary = collectHebrewArticleEvidence(req(), {}, [reference("עיוני משפט ה 489 (1977)")]);
    const evidence = [...primary(), ...secondary];
    const r = resolveHebrewArticle(req(), reverse ? evidence.reverse() : evidence);
    expect(r.fields.firstPage).toBe("463");
    expect(r.conflicts).not.toContain("firstPage");
    expect(r.provenance.firstPage?.sources).toEqual([nli]);
  });
  it("preserves supplied fields even against a direct record", () => {
    const supplied = createHebrewArticleRequest(`${f.author} "${f.title}" עיוני משפט ה 489 (1977)`);
    const r = resolveHebrewArticle(supplied, primary());
    expect(r.fields.firstPage).toBe("489");
    expect(r.conflicts).toContain("firstPage");
  });
  it("prioritizes NLI reads without adding to the two-page budget", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(html(f), { headers: { "Content-Type": "text/html" } }));
    await fetchHebrewArticleRecords(req(), [{ url }, { url: "https://law.huji.ac.il/article/example" }, { url: nli }], fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe(nli);
  });
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