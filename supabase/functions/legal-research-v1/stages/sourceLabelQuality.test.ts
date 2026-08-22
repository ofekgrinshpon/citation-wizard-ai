// source_label_quality_v1 tests.
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeDisplayTitle } from "./displayTitleHygiene.ts";
import { classifySourceIntegrity } from "./sourceIntegrity.ts";
import { collapseNearDuplicateTitles, titleSimilarity } from "./sourceLabelQuality.ts";

Deno.test("raw filename title is rejected", () => {
  const r = computeDisplayTitle({
    title: "25_lst_2970619.docx",
    url: "https://fs.knesset.gov.il/globaldocs/MMM/25_lst_2970619.docx",
    source_type: "government_report",
  });
  assertEquals(r.title_status, "fallback_filename");
  assertEquals(r.display_title.includes(".docx"), false);
});

Deno.test("storage-like key is rejected", () => {
  const r = computeDisplayTitle({ title: "doc_1234567", url: "https://gov.il/a/b" });
  assertEquals(r.title_status, "fallback_filename");
});

Deno.test("bare institution title is rejected", () => {
  const r = computeDisplayTitle({
    title: "בית המשפט העליון",
    url: "https://supreme.court.gov.il/x?case=5658-23",
  });
  assertEquals(r.title_status, "fallback_bare_institution");
  assertNotEquals(r.display_title, "בית המשפט העליון");
});

Deno.test("institution + concrete docket survives via fallback docket recovery", () => {
  const r = computeDisplayTitle({
    title: "בית המשפט העליון",
    url: "https://supreme.court.gov.il/x",
    snippet: 'בג"ץ 5658/23 התנועה למען איכות השלטון נ\' הכנסת',
  });
  assertEquals(r.fallback_used, "docket");
  assertEquals(r.display_title.includes("5658/23"), true);
});

Deno.test("institution name combined with a document title is kept", () => {
  const r = computeDisplayTitle({
    title: "בית המשפט העליון — פסק הדין בעניין עילת הסבירות",
    url: "https://supreme.court.gov.il/x",
  });
  assertEquals(r.title_status, "ok");
});

Deno.test("gov.il research paper is not classified as statute", () => {
  const c = classifySourceIntegrity({
    url: "https://fs.knesset.gov.il/globaldocs/MMM/25_lst_2970619.docx",
    title: "עילת הסבירות בהיבט השוואתי — מסמך רקע",
    snippet: "מסמך שהוכן על ידי מרכז המחקר והמידע של הכנסת",
    source_type: "israeli_law",
  });
  assertNotEquals(c.citable_as, "statute");
  assertEquals(c.classification_reason, "statute_requires_title_shape_not_host");
});

Deno.test("real statute on official host stays statute", () => {
  const c = classifySourceIntegrity({
    url: "https://www.nevo.co.il/law_html/law01/999_001.htm",
    title: "חוק החברות, התשנ\"ט-1999",
    snippet: "סעיף 6 — הרמת מסך",
    source_type: "israeli_law",
  });
  assertEquals(c.citable_as, "statute");
});

Deno.test("commentary about a judgment is not classified as judgment", () => {
  const c = classifySourceIntegrity({
    url: "https://www.idi.org.il/articles/50123",
    title: "פסק דין הסבירות: עיונים ראשונים",
    snippet: "מאמר הדן בפסק הדין של בית המשפט העליון",
    source_type: "caselaw",
  });
  assertNotEquals(c.citable_as, "judgment");
});

Deno.test("judgment with docket is still a judgment", () => {
  const c = classifySourceIntegrity({
    url: "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts/23/580/056/x.pdf",
    title: 'בג"ץ 5658/23 התנועה למען איכות השלטון נ\' הכנסת',
    snippet: "פסק דין. העתירה נדחית. ניתן היום.",
    source_type: "caselaw",
  });
  assertEquals(c.citable_as, "judgment");
});

Deno.test("near-duplicate OCR titles collapse to the cleaner variant", () => {
  const sources = [
    { title: "עילת אי־הסבירות במשפט הממהלי*", title_hygiene_reasons: [] },
    { title: "עילת אי־הסבירות במשפט המינהלי", title_hygiene_reasons: [] },
  ];
  const rep = collapseNearDuplicateTitles(sources);
  assertEquals(rep.near_duplicate_titles_collapsed, 1);
  assertEquals(sources[0].title, "עילת אי־הסבירות במשפט המינהלי");
});

Deno.test("distinct titles are not collapsed", () => {
  assertEquals(titleSimilarity("חוק החברות", "פקודת הנזיקין") < 0.5, true);
});
