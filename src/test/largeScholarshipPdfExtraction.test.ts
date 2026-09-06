import { describe, expect, it } from "vitest";
import {
  assessLargePdfEligibility,
  classifyLargePdfBody,
  confirmLargePdfIdentity,
  isInlineSizeCapFailure,
  LARGE_PDF_LIMITS,
  runLargeScholarshipPdfExtraction,
  selectLargePdfCandidates,
  type LargePdfCandidateView,
} from "../../supabase/functions/legal-research-v1/stages/largeScholarshipPdfExtraction.ts";
import { joinPageItems } from "../../supabase/functions/legal-research-v1/lib/largePdfChunkedExtract.ts";

const DAGAN_TITLE = "מידתיות חוקתית, סבירות מנהלית וביקורת שיפוטית";
const DAGAN_AUTHOR = "נדב דגן";

function scholarshipView(over: Partial<LargePdfCandidateView> = {}): LargePdfCandidateView {
  return {
    run_id: "r1",
    source_id: "c1",
    title: DAGAN_TITLE,
    author: DAGAN_AUTHOR,
    url: "https://law.tau.ac.il/sites/default/files/dagan-article.pdf",
    source_type: "journal_article",
    role: "scholarship",
    topicality_before: "direct",
    previous_failure_reason: "secondary_binary_too_large_for_inline_extraction",
    binary_size_bytes: 2_340_000,
    body_chars: 420,
    strong_scholarship: true,
    ...over,
  };
}

function articleText(paragraphs = 8): string {
  const p = [
    `${DAGAN_TITLE} מאת ${DAGAN_AUTHOR}, עיוני משפט כרך מה`,
    "מאמר זה בוחן את היחס בין מידתיות חוקתית לבין סבירות מנהלית בביקורת שיפוטית על החלטות הרשות המנהלית. לטענת המחברים, שני המבחנים משקפים דוקטרינות שונות של ריסון נורמטיבי.",
    "לעומת זאת, גישה אחרת בפסיקה גורסת כי עילת הסבירות בולעת את מבחני המידתיות, ומכאן שהניתוח הדוקטרינרי מחייב הבחנה ברורה בין שיקול דעת מנהלי ובין איזון חוקתי.",
    "מנגד, יש לטעון כי הפרשנות התכליתית של עקרון הסבירות מאפשרת ביקורת שיפוטית מדודה, בלי לרוקן מתוכן את שיקול הדעת של הרשות המנהלית בהחלטותיה.",
    "לפיכך, הניתוח שלהלן מציע מסגרת נורמטיבית המבחינה בין ביקורת על תוצאה ובין ביקורת על ההליך, תוך התייחסות להלכה הפסוקה ולחקיקה הרלוונטית בישראל.",
  ];
  const out: string[] = [];
  for (let i = 0; i < paragraphs; i++) out.push(p[i % p.length]);
  return out.join("\n\n");
}

describe("inline size-cap detection", () => {
  it("recognises the blocking reason from previous telemetry", () => {
    expect(isInlineSizeCapFailure("secondary_binary_too_large_for_inline_extraction")).toBe(true);
    expect(isInlineSizeCapFailure("reextraction_fetch_timeout")).toBe(false);
    expect(isInlineSizeCapFailure(null)).toBe(false);
  });
});

describe("eligibility gate", () => {
  it("admits an already-found, size-capped scholarship PDF", () => {
    const r = assessLargePdfEligibility(scholarshipView());
    expect(r.eligible).toBe(true);
    expect(r.ineligible_reason).toBeNull();
    expect(r.binary_size_bytes).toBe(2_340_000);
  });

  it("refuses court hosts", () => {
    const r = assessLargePdfEligibility(
      scholarshipView({ url: "https://supremedecisions.court.gov.il/x/file.pdf" }),
    );
    expect(r.eligible).toBe(false);
    expect(r.ineligible_reason).toBe("court_host_out_of_scope");
  });

  it("refuses primary law", () => {
    const r = assessLargePdfEligibility(scholarshipView({ source_type: "statute", role: "statute" }));
    expect(r.ineligible_reason).toBe("primary_law_not_extracted");
  });

  it("refuses news", () => {
    const r = assessLargePdfEligibility(
      scholarshipView({ source_type: "news", role: "news", strong_scholarship: false }),
    );
    expect(r.ineligible_reason).toBe("news_or_blog_not_extracted");
  });

  it("refuses paywalled or access-controlled URLs", () => {
    const r = assessLargePdfEligibility(
      scholarshipView({ url: "https://www.nevo.co.il/private/article.pdf" }),
    );
    expect(r.eligible).toBe(false);
    expect(["access_controlled_or_paywalled", "not_a_pdf_target"]).toContain(r.ineligible_reason);
  });

  it("refuses non-PDF targets", () => {
    const r = assessLargePdfEligibility(
      scholarshipView({ url: "https://law.tau.ac.il/article-page" }),
    );
    expect(r.ineligible_reason).toBe("not_a_pdf_target");
  });

  it("refuses sources without an article identity signal", () => {
    const r = assessLargePdfEligibility(
      scholarshipView({ title: "PDF", author: null, url: "https://example.org/a.pdf" }),
    );
    expect(r.ineligible_reason).toBe("no_article_identity_signal");
  });

  it("refuses sources not blocked by the inline size cap", () => {
    const r = assessLargePdfEligibility(scholarshipView({ previous_failure_reason: "http_404" }));
    expect(r.ineligible_reason).toBe("not_blocked_by_inline_size_cap");
  });

  it("refuses off-topic and hard-integrity-failed sources", () => {
    expect(assessLargePdfEligibility(scholarshipView({ topicality_before: "off_topic" }))
      .ineligible_reason).toBe("off_topic_before_extraction");
    expect(assessLargePdfEligibility(scholarshipView({ hard_integrity_failure: true }))
      .ineligible_reason).toBe("hard_integrity_failure");
  });

  it("refuses sources whose body is already sufficient", () => {
    const r = assessLargePdfEligibility(scholarshipView({ body_chars: 40_000 }));
    expect(r.ineligible_reason).toBe("body_already_sufficient");
  });

  it("caps the per-run selection at two PDFs", () => {
    const views = [1, 2, 3, 4].map((i) =>
      scholarshipView({
        source_id: `c${i}`,
        url: `https://law.tau.ac.il/files/a${i}.pdf`,
      })
    );
    const rows = views.map((v) => assessLargePdfEligibility(v));
    const sel = selectLargePdfCandidates(rows, new Map(views.map((v) => [v.source_id, v])));
    expect(sel).toHaveLength(LARGE_PDF_LIMITS.MAX_PDFS_PER_RUN);
    expect(rows.filter((r) => r.ineligible_reason === "over_per_run_large_pdf_cap")).toHaveLength(2);
  });
});

describe("article identity confirmation", () => {
  it("confirms the expected article", () => {
    const r = confirmLargePdfIdentity({
      source_id: "c1",
      expected_title: DAGAN_TITLE,
      expected_author: DAGAN_AUTHOR,
      text: articleText(),
    });
    expect(r.identity_confirmed).toBe(true);
    expect(r.title_match).toBe(true);
    expect(r.legal_argumentation_signals).toBeGreaterThanOrEqual(2);
  });

  it("rejects a different article from the same bundle", () => {
    const r = confirmLargePdfIdentity({
      source_id: "c1",
      expected_title: DAGAN_TITLE,
      expected_author: DAGAN_AUTHOR,
      text: "דיני חוזים אחידים בישראל: תניות פטור והגנת הצרכן. מאמר זה עוסק אך ורק בחוזה האחיד.",
    });
    expect(r.identity_confirmed).toBe(false);
    expect(r.rejection_reason).toBe("title_and_author_not_found");
  });

  it("rejects PDF object noise", () => {
    const r = confirmLargePdfIdentity({
      source_id: "c1",
      expected_title: DAGAN_TITLE,
      expected_author: DAGAN_AUTHOR,
      text: "%PDF-1.7 12 obj << /Length 4096 >> endstream",
    });
    expect(r.mojibake_or_binary_noise).toBe(true);
    expect(r.rejection_reason).toBe("mojibake_or_binary_noise");
  });
});

describe("body quality classification", () => {
  it("marks a substantive extraction usable", () => {
    const q = classifyLargePdfBody({
      source_id: "c1",
      title: DAGAN_TITLE,
      text: articleText(30),
      topicTerms: ["סבירות", "מידתיות"],
      identity_confirmed: true,
    });
    expect(q.body_quality).toBe("complete_enough_for_use");
    expect(q.usable).toBe(true);
    expect(q.topic_terms_found).toBeGreaterThan(0);
  });

  it("marks an abstract-only extraction unusable", () => {
    const q = classifyLargePdfBody({
      source_id: "c1",
      title: DAGAN_TITLE,
      text: "תקציר\n" + "מאמר זה בוחן את עילת הסבירות בביקורת שיפוטית על הרשות המנהלית בישראל. ".repeat(8),
      identity_confirmed: true,
    });
    expect(q.abstract_only_signal || q.body_quality !== "complete_enough_for_use").toBe(true);
    expect(q.usable).toBe(false);
  });

  it("marks a table-of-contents extraction metadata_only", () => {
    const q = classifyLargePdfBody({
      source_id: "c1",
      title: DAGAN_TITLE,
      text: "תוכן העניינים\nפרק א .... 3\nפרק ב .... 17\nפרק ג .... 44\n" + "x".repeat(900),
      identity_confirmed: true,
    });
    expect(q.usable).toBe(false);
    expect(["metadata_only", "too_noisy"]).toContain(q.body_quality);
  });

  it("marks a failed identity as wrong_document", () => {
    const q = classifyLargePdfBody({
      source_id: "c1",
      title: DAGAN_TITLE,
      text: articleText(30),
      identity_confirmed: false,
    });
    expect(q.body_quality).toBe("wrong_document");
    expect(q.usable).toBe(false);
  });
});

describe("page item joining", () => {
  it("preserves line breaks and drops empty items", () => {
    const s = joinPageItems([
      { str: "מידתיות", hasEOL: false },
      { str: "חוקתית", hasEOL: true },
      { str: "", hasEOL: true },
      { str: "סבירות", hasEOL: false },
    ]);
    expect(s).toBe("מידתיות חוקתית\nסבירות");
  });
});

describe("bounded orchestration", () => {
  const bytes = new Uint8Array([1, 2, 3]);

  function deps(text: string, over: Record<string, unknown> = {}) {
    const applied: Array<{ id: string; chars: number }> = [];
    return {
      applied,
      input: {
        run_id: "r1",
        enabled: true,
        views: [scholarshipView()],
        topicTerms: ["סבירות", "מידתיות"],
        downloadPdf: () =>
          Promise.resolve({
            bytes,
            content_type: "application/pdf",
            final_url: "https://law.tau.ac.il/sites/default/files/dagan-article.pdf",
            status: 200,
          }),
        extractPages: () =>
          Promise.resolve({
            text,
            total_pages: 40,
            pages_attempted: 20,
            pages_extracted: 20,
            first_page_extracted: 1,
            last_page_extracted: 20,
            chars_extracted: text.length,
            stopped_reason: "enough_text" as const,
            latency_ms: 900,
          }),
        applyBody: (id: string, t: string) => {
          applied.push({ id, chars: t.length });
          return t.length;
        },
        topicality: () => "direct" as const,
        ...over,
      },
    };
  }

  it("extracts, accepts and stores a usable body", async () => {
    const d = deps(articleText(40));
    // deno-lint-ignore no-explicit-any
    const r = await runLargeScholarshipPdfExtraction(d.input as any);
    expect(r.attempts[0].status).toBe("success");
    expect(r.improved_source_ids).toEqual(["c1"]);
    expect(d.applied[0].chars).toBeGreaterThanOrEqual(LARGE_PDF_LIMITS.MIN_USEFUL_CHARS);
    expect(r.downstream[0].extraction_succeeded).toBe(true);
    expect(r.downstream[0].body_chars_after).toBeGreaterThan(r.downstream[0].body_chars_before);
  });

  it("rejects a wrong-document extraction and leaves the candidate untouched", async () => {
    const d = deps("מאמר על דיני חוזים אחידים והגנת הצרכן בישראל. ".repeat(200));
    // deno-lint-ignore no-explicit-any
    const r = await runLargeScholarshipPdfExtraction(d.input as any);
    expect(r.improved_source_ids).toHaveLength(0);
    expect(d.applied).toHaveLength(0);
    expect(r.attempts[0].failure_reason).toContain("identity_");
  });

  it("rejects an off-topic extraction", async () => {
    const d = deps(articleText(40), { topicality: () => "off_topic" as const });
    // deno-lint-ignore no-explicit-any
    const r = await runLargeScholarshipPdfExtraction(d.input as any);
    expect(r.improved_source_ids).toHaveLength(0);
    expect(r.attempts[0].failure_reason).toBe("off_topic_after_extraction");
  });

  it("records a download failure without touching the candidate", async () => {
    const d = deps(articleText(40), {
      downloadPdf: () => Promise.reject(new Error("http_403")),
    });
    // deno-lint-ignore no-explicit-any
    const r = await runLargeScholarshipPdfExtraction(d.input as any);
    expect(r.attempts[0].status).toBe("failed");
    expect(r.attempts[0].failure_reason).toBe("http_403");
    expect(d.applied).toHaveLength(0);
    expect(r.downstream[0].final_loss_stage).toBe("large_pdf_extraction");
  });

  it("does nothing when no candidate is eligible", async () => {
    const d = deps(articleText(40));
    const r = await runLargeScholarshipPdfExtraction({
      // deno-lint-ignore no-explicit-any
      ...(d.input as any),
      views: [scholarshipView({ previous_failure_reason: "http_404" })],
    });
    expect(r.stop_reason).toBe("no_eligible_large_pdf");
    expect(r.attempts).toHaveLength(0);
  });

  it("is inert when disabled", async () => {
    const d = deps(articleText(40));
    // deno-lint-ignore no-explicit-any
    const r = await runLargeScholarshipPdfExtraction({ ...(d.input as any), enabled: false });
    expect(r.stop_reason).toBe("stage_disabled");
    expect(r.eligibility).toHaveLength(0);
  });

  it("serves a cached body without re-downloading", async () => {
    let downloads = 0;
    const d = deps(articleText(40), {
      cacheLookup: () => Promise.resolve(articleText(40)),
      downloadPdf: () => {
        downloads += 1;
        return Promise.reject(new Error("should_not_download"));
      },
    });
    // deno-lint-ignore no-explicit-any
    const r = await runLargeScholarshipPdfExtraction(d.input as any);
    expect(downloads).toBe(0);
    expect(r.attempts[0].stopped_reason).toBe("cache_hit");
    expect(r.improved_source_ids).toEqual(["c1"]);
  });
});
