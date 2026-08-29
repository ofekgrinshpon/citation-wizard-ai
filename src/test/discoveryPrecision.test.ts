import { describe, expect, it } from "vitest";
import {
  backfillOriginCap,
  classifyDiscoveryPrecision,
} from "../../supabase/functions/legal-research-v1/stages/discoveryPrecision.ts";

const cand = (over: Record<string, unknown> = {}) =>
  ({
    candidate_id: "c1",
    claim_id: "cl1",
    role: "scholarship",
    origin: "perplexity",
    retrieval_method: "perplexity",
    title: "מאמר על מבחני המידתיות",
    source_type: "legal_article",
    source_url: "https://law.tau.ac.il/sites/default/files/article.pdf",
    snippet: "ניתוח דוקטרינרי מפורט של מבחני המידתיות".repeat(20),
    query_he: "q",
    score: 1,
    ...over,
  }) as never;

const run = (over: Record<string, unknown> = {}, task_intent = "doctrinal_explanation") =>
  classifyDiscoveryPrecision({ candidate: cand(over), task_intent } as never);

describe("discovery_precision_and_listing_suppression_v1", () => {
  it("suppresses search result pages with an explicit reason", () => {
    const r = run({ source_url: "https://www.nevo.co.il/search?q=מידתיות", title: "תוצאות חיפוש" });
    expect(r.discovery_class).toBe("search_result_page");
    expect(r.suppress).toBe(true);
    expect(r.suppress_reason).toBeTruthy();
  });

  it("suppresses category/tag pages", () => {
    const r = run({ source_url: "https://example.co.il/category/constitutional", title: "קטגוריה: משפט חוקתי" });
    expect(r.discovery_class).toBe("category_page");
    expect(r.suppress).toBe(true);
  });

  it("suppresses index/listing pages", () => {
    const r = run({ source_url: "https://example.co.il/archive/page/3", title: "ארכיון פסיקה" });
    expect(r.discovery_class).toBe("index_or_listing");
    expect(r.suppress).toBe(true);
  });

  it("never suppresses without an explainable reason string", () => {
    const r = run();
    expect(r.suppress).toBe(false);
    expect(r.suppress_reason).toBeUndefined();
  });

  it("preserves an article/report landing page with a PDF/body path", () => {
    const r = run({
      source_url: "https://law.huji.ac.il/files/report-2023.pdf",
      title: "דוח מחקר על מבחני המידתיות",
      snippet: "תקציר",
    });
    expect(r.suppress).toBe(false);
    expect(r.protected).toBe(true);
    expect(r.protection_reason).toBe("article_or_report_with_body_path");
  });

  it("preserves official statute pages even with listing-ish URLs", () => {
    const r = run({
      role: "primary_statute",
      source_type: "israeli_law",
      title: "חוק יסוד: כבוד האדם וחירותו",
      source_url: "https://main.knesset.gov.il/activity/legislation/laws/index/basic3",
      snippet: "טקסט החוק",
    });
    expect(r.suppress).toBe(false);
    expect(r.protected).toBe(true);
  });

  it("preserves exact-docket judgment candidates", () => {
    const r = run({
      role: "binding_case_law",
      source_type: "caselaw",
      title: 'בג"ץ 6821/93 בנק המזרחי נ\' מגדל',
      source_url: "https://supreme.court.gov.il/search?q=6821",
      snippet: "",
    });
    expect(r.suppress).toBe(false);
    expect(r.protection_reason).toBe("exact_docket_identity");
  });

  it("never suppresses exact_authority candidates", () => {
    const r = run({
      retrieval_method: "exact_authority",
      source_url: "https://example.co.il/search?q=x",
      title: "תוצאות חיפוש",
    });
    expect(r.suppress).toBe(false);
    expect(r.protection_reason).toBe("exact_authority_candidate");
  });

  it("demotes but does not suppress metadata-only pages", () => {
    const r = run({
      source_url: "https://example.co.il/item/123",
      title: "פריט במאגר",
      snippet: "אין תקציר",
    });
    expect(r.discovery_class).toBe("metadata_only");
    expect(r.suppress).toBe(false);
    expect(r.rank_delta).toBeLessThan(0);
  });

  it("suppresses metadata-only pages that also match clear listing signals", () => {
    const r = run({
      source_url: "https://example.co.il/tag/mishpat",
      title: "תגית: מידתיות",
      snippet: "",
    });
    expect(r.suppress).toBe(true);
  });

  it("demotes low-instance unrelated case law in doctrinal mode", () => {
    const r = run({
      role: "persuasive_case_law",
      source_type: "caselaw",
      title: "פסק דין בעניין חוזה שכירות",
      source_url: "https://example.co.il/case/999",
      snippet: "דיון בשכירות",
    });
    expect(r.rank_signals).toContain("unrelated_case_law_in_doctrinal_mode");
    expect(r.suppress).toBe(false);
  });

  it("keeps the ranking delta bounded", () => {
    const r = run();
    expect(Math.abs(r.rank_delta)).toBeLessThanOrEqual(0.3);
  });

  it("caps backfill per origin at 60% of freed slots", () => {
    expect(backfillOriginCap(10)).toBe(6);
    expect(backfillOriginCap(0)).toBe(1);
  });
});
