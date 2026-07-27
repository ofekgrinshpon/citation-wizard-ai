// Deno tests for perplexityHygiene. Run: `deno test perplexityHygiene.test.ts`.

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  evaluatePerplexityHygiene,
  normalizePerplexitySourceType,
} from "./perplexityHygiene.ts";

Deno.test("hhttps:// URL is fixed and kept when body+title valid", () => {
  const h = evaluatePerplexityHygiene({
    url: "hhttps://www.example.gov.il/laws/2000943",
    title: "פקודת מס הכנסה, 1947 - חוק מדינת ישראל במאגר החקיקה הלאומי",
    snippet: "פקודת מס הכנסה היא חקיקה ראשית במדינת ישראל, שמסדירה את גביית מס ההכנסה.",
  });
  assertEquals(h.url_status, "fixed");
  assertEquals(h.body_status, "has_body");
  assertEquals(h.title_status, "valid");
  assertEquals(h.hygiene_action, "keep");
});

Deno.test("broken URL → excluded", () => {
  const h = evaluatePerplexityHygiene({ url: "not a url", title: "something", snippet: "x".repeat(100) });
  assertEquals(h.url_status, "broken");
  assertEquals(h.hygiene_action, "exclude");
});

Deno.test("empty body + generic-index URL alone → downgrade, not exclude", () => {
  const h = evaluatePerplexityHygiene({
    url: "https://www.gov.il/he/departments/miniyou_misim/daily_reports/state_audit_reports",
    title: "דוחות מבקר המדינה על יישום הוראות מס ישנות ובעיות פרקטיות לנישומים",
    snippet: "",
  });
  assertEquals(h.body_status, "empty_body");
  assertEquals(h.landing_page_status, "generic_index");
  assertEquals(h.title_status, "valid");
  assertEquals(h.hygiene_action, "downgrade");
});

Deno.test("empty body + generic-index URL + url-slug title → exclude (multi-signal)", () => {
  const h = evaluatePerplexityHygiene({
    url: "https://www.gov.il/he/departments/miniyou_misim/daily_reports/state_audit_reports_2023",
    title: "state_audit_report_2023",
    snippet: "",
  });
  assertEquals(h.title_status, "suspicious");
  // Title=suspicious, body=empty_body, landing=generic_index → multi-signal exclude.
  assertEquals(h.hygiene_action, "exclude");
});

Deno.test("two-char title 'עע' + empty body → excluded", () => {
  const h = evaluatePerplexityHygiene({
    url: "https://www.takdin.co.il/article/Article/4983547",
    title: "עע",
    snippet: "",
  });
  assertEquals(h.title_status, "too_short");
  assertEquals(h.hygiene_action, "exclude");
});

Deno.test("specific-document URL is detected", () => {
  const h = evaluatePerplexityHygiene({
    url: "https://main.knesset.gov.il/apps/legislation/main/laws/2000943",
    title: "פקודת מס הכנסה במאגר החקיקה הלאומי",
    snippet: "טקסט החקיקה המלא של פקודת מס הכנסה כפי שהיא היום, כולל סעיפים ותיקונים.",
  });
  assertEquals(h.landing_page_status, "specific_document");
  assertEquals(h.hygiene_action, "keep");
});

Deno.test("PDF path is specific_document even with thin body", () => {
  const h = evaluatePerplexityHygiene({
    url: "https://law.haifa.ac.il/wp-content/uploads/2021/11/16-bracha.pdf",
    title: "פרשנות במשפט, כרך שלישי: פרשנות חוקתית",
    snippet: "",
  });
  assertEquals(h.landing_page_status, "specific_document");
  // body empty but URL is specific + title valid → keep (no downgrade triggers).
  assertEquals(h.hygiene_action, "keep");
});

Deno.test("repeated-phrase title is generic", () => {
  const h = evaluatePerplexityHygiene({
    url: "https://www.gov.il/BlobFolder/unit/tax-reforma-committee/he/Vaadot_ahchud_TaxReformaCommittee_Report_Full.PDF",
    title: "רפורמה במס הכנסה - רפורמה במס הכנסה",
    snippet: "דוח רשמי של ועדת רפורמה במס הכנסה הכולל המלצות מפורטות לשינויי חקיקה.",
  });
  assertEquals(h.title_status, "generic");
  // has_body keeps it from being downgraded (title=generic + body=has_body → keep).
  assertEquals(h.hygiene_action, "keep");
});

Deno.test("path with one short segment ending in 's' alone is NOT excluded", () => {
  // User explicitly required: do not exclude solely on path shape.
  const h = evaluatePerplexityHygiene({
    url: "https://www.gov.il/he/departments/miniyou_misim/daily_reports/state_audit_reports",
    title: "דוחות מבקר המדינה",
    snippet: "טקסט מהותי שמתאר את תכולת הדוחות. ".repeat(5),
  });
  // body has content + valid title → keep, despite generic-index path.
  assertEquals(h.hygiene_action, "keep");
});

Deno.test("normalizePerplexitySourceType: PDF/document → other (not invented type)", () => {
  const n = normalizePerplexitySourceType("PDF", "legislation");
  assertEquals(n.normalized, "other");
  assertEquals(n.raw, "PDF");
  assertEquals(n.was_normalized, true);
});

Deno.test("normalizePerplexitySourceType: empty raw falls back to class", () => {
  const n = normalizePerplexitySourceType("", "legislation");
  assertEquals(n.normalized, "legislation");
});

Deno.test("normalizePerplexitySourceType: state_audit_report_2023 → government_report", () => {
  const n = normalizePerplexitySourceType("state_audit_report_2023", "government_report");
  assertEquals(n.normalized, "government_report");
});

Deno.test("normalizePerplexitySourceType: known canonical preserved", () => {
  const n = normalizePerplexitySourceType("caselaw", "court_case");
  assertEquals(n.normalized, "caselaw");
  assertEquals(n.was_normalized, false);
});

Deno.test("normalizePerplexitySourceType: legal_db court_case class maps to caselaw", () => {
  const n = normalizePerplexitySourceType("legal_db", "court_case");
  assertEquals(n.normalized, "caselaw");
  assertEquals(n.was_normalized, true);
});
