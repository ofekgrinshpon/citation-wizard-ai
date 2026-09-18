import { describe, expect, it } from "vitest";
import {
  assessTextQuality,
  canonicalizeDocumentText,
  classifyExtraction,
} from "../../supabase/functions/legal-research-v2/shared/academicText.ts";
import { normalizeMalformedUrl } from "../../supabase/functions/legal-research-v2/shared/urlNormalize.ts";
import {
  bibliographicFromSearch,
  formatAcademicCitation,
  mergeBibliographic,
  parseHtmlBibliographic,
  pdfUrlFromHtmlMeta,
} from "../../supabase/functions/legal-research-v2/shared/bibliographic.ts";
import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore.ts";
import { buildAcademicYield } from "../../supabase/functions/legal-research-v2/evidence/academicYield.ts";
import { formatCitation } from "../../supabase/functions/legal-research-v2/drafting/render.ts";

const HTML = `<html><head>
<meta name="citation_title" content="זכות העמידה בבג&quot;ץ">
<meta name="citation_author" content="כהן, יואב">
<meta name="citation_author" content="לוי, רות">
<meta name="citation_journal_title" content="משפטים">
<meta name="citation_volume" content="מה">
<meta name="citation_publication_date" content="2015/03/01">
<meta name="citation_firstpage" content="101">
<meta name="citation_pdf_url" content="https://lawrev.ac.il/cgi/viewcontent.cgi?article=1&amp;context=faculty">
</head><body><p>abstract</p></body></html>`;

describe("canonical document text", () => {
  it("removes invisible controls and normalizes whitespace without losing prose", () => {
    const raw = "פסק\u200f  הדין\u00a0קובע\u00ad כי   הזכות\n\n\n\nמוגנת.  ";
    const out = canonicalizeDocumentText(raw);
    expect(out).toContain("פסק הדין קובע");
    expect(out).not.toMatch(/[\u200f\u00ad\u00a0]/);
    expect(out.endsWith("מוגנת.")).toBe(true);
  });

  it("classifies empty and usable extractions differently", () => {
    expect(classifyExtraction("", assessTextQuality(""))).toBe("empty");
    const good = "זוהי פסקה משפטית ארוכה דיה כדי להיחשב טקסט קריא ושמיש לצורכי ציטוט. ".repeat(20);
    expect(classifyExtraction(good, assessTextQuality(good))).toBe("usable");
  });
});

describe("malformed URL repair", () => {
  it("repairs backslashes, duplicate slashes and wrapping punctuation", () => {
    expect(normalizeMalformedUrl("https://fs.knesset.gov.il/\\7\\law\\a.pdf"))
      .toBe("https://fs.knesset.gov.il/7/law/a.pdf");
    expect(normalizeMalformedUrl("(https://example.org/doc.pdf)")).toBe("https://example.org/doc.pdf");
    expect(normalizeMalformedUrl("https:/example.org/x")).toBe("https://example.org/x");
  });

  it("leaves a clean URL untouched and keeps the query string", () => {
    const u = "https://example.org/a?b=1&c=2";
    expect(normalizeMalformedUrl(u)).toBe(u);
  });
});

describe("bibliographic identity", () => {
  it("parses citation meta tags and the declared PDF link", () => {
    const meta = parseHtmlBibliographic(HTML)!;
    expect(meta.title).toContain("זכות העמידה");
    expect(meta.authors).toEqual(["כהן, יואב", "לוי, רות"]);
    expect(meta.journal).toBe("משפטים");
    expect(meta.year).toBe("2015");
    expect(meta.metadata_basis).toContain("repository_page");
    expect(pdfUrlFromHtmlMeta(HTML, "https://lawrev.ac.il/x"))
      .toBe("https://lawrev.ac.il/cgi/viewcontent.cgi?article=1&context=faculty");
  });

  it("lets stronger metadata win and weaker metadata only fill gaps", () => {
    const strong = parseHtmlBibliographic(HTML)!;
    const weak = bibliographicFromSearch({ title: "something else" });
    const merged = mergeBibliographic(strong, weak)!;
    expect(merged.title).toBe(strong.title);
  });

  it("renders an academic citation instead of a bare title and URL", () => {
    const cite = formatCitation({
      display_title: "viewcontent.cgi",
      url: "https://lawrev.ac.il/x.pdf",
      locator: "עמ' 118",
      bibliographic: parseHtmlBibliographic(HTML)!,
    });
    expect(cite).toContain("כהן");
    expect(cite).toContain("משפטים");
    expect(cite).toContain("2015");
    expect(cite).not.toContain("viewcontent.cgi");
  });

  it("falls back to the existing citation shape when there is no metadata", () => {
    expect(formatAcademicCitation(undefined, "כותרת")).toBeNull();
    const cite = formatCitation({ display_title: "בג\"ץ 1234/20 פלוני נ' אלמוני", url: "https://n.co/x" });
    expect(cite).toContain("בג\"ץ 1234/20");
    expect(cite).toContain("https://n.co/x");
  });
});

describe("evidence store — canonical bodies and bounded continuation", () => {
  it("stores canonical text and serves quotes that match it verbatim", async () => {
    const store = new EvidenceStore();
    const src = await store.append({
      url: "https://lawrev.ac.il/a.pdf",
      title: "מאמר",
      origin: "web",
      fetch_status: "ok",
      extracted_text: "רקע. ".repeat(50) + "הביקורת השיפוטית\u00a0הורחבה בפסיקה מאוחרת. " + "סיפא. ".repeat(50),
      is_actual_document: true,
      bibliographic: parseHtmlBibliographic(HTML)!,
    });
    expect(src.bibliographic?.journal).toBe("משפטים");
    expect(src.extraction_status).toBe("usable");
    const ex = store.excerpt(src.source_id, { find: ["הביקורת השיפוטית הורחבה"] })!;
    expect(ex.from).toBe("locator");
    expect(store.get(src.source_id)!.extracted_text).toContain(
      "הביקורת השיפוטית הורחבה בפסיקה מאוחרת.",
    );
  });

  it("extends a body append-only so earlier spans still match", async () => {
    const store = new EvidenceStore();
    const src = await store.append({
      url: "https://lawrev.ac.il/a.pdf",
      title: "מאמר",
      origin: "web",
      fetch_status: "ok",
      extracted_text: "פתיחה ארוכה מאוד של המאמר. ".repeat(30),
      is_actual_document: true,
      pdf_extraction: { total_pages: 40, last_page: 24, continued_through_page: 24 },
    });
    const before = store.get(src.source_id)!.extracted_text;
    const res = await store.extendBody(src.source_id, "הטיעון המרכזי מופיע בעמודים המאוחרים.", {
      last_page: 40,
      continued_through_page: 40,
    });
    const after = store.get(src.source_id)!;
    expect(res!.added).toBeGreaterThan(0);
    expect(after.extracted_text.startsWith(before)).toBe(true);
    expect(after.pdf_extraction?.continued_through_page).toBe(40);
    const again = await store.extendBody(src.source_id, "הטיעון המרכזי מופיע בעמודים המאוחרים.");
    expect(again!.added).toBe(0);
  });
});

describe("academic yield accounting", () => {
  it("names the exact stage where a read academic source stopped contributing", async () => {
    const store = new EvidenceStore();
    const read = await store.append({
      url: "https://lawrev.ac.il/read.pdf",
      title: "מאמר שנקרא",
      origin: "web",
      fetch_status: "ok",
      extracted_text: "טקסט אקדמי ארוך ושמיש לצורכי ציטוט משפטי. ".repeat(40),
      is_actual_document: true,
      acquisition_status: "acquired",
    });
    const failed = await store.append({
      url: "https://lawrev.ac.il/dead.pdf",
      title: "מאמר שלא הושג",
      origin: "web",
      fetch_status: "error",
      fetch_error: "http_403",
      extracted_text: "",
      is_actual_document: false,
      acquisition_status: "http_failed",
    });
    store.serveQuotes(read.source_id, [store.get(read.source_id)!.extracted_text.slice(0, 300)]);

    const report = buildAcademicYield({
      sources: store.all(),
      quotes: store.servedQuotes(),
      memo: null,
      verification: null,
      pack: null,
      cited_source_ids: [],
    });
    const byId = Object.fromEntries(report.rows.map((r) => [r.source_id, r]));
    expect(byId[read.source_id].outcome).toBe("WINDOW_SERVED_NOT_MEMOED");
    expect(byId[read.source_id].terminal_loss_stage).toBe("memo_selection");
    expect(byId[failed.source_id].outcome).toBe("NOT_ACQUIRED");
    expect(byId[failed.source_id].terminal_loss_stage).toBe("acquisition");
    expect(report.counters.academic_discovered).toBe(2);
    expect(report.counters.academic_acquired).toBe(1);
  });
});
