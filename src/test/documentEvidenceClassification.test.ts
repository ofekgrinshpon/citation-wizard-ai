import { describe, it, expect } from "vitest";
import {
  detectJudgmentEvidence,
  detectScholarshipEvidence,
  normalizeHebrewFinals,
  RECLASSIFIABLE_CLASSES,
} from "../../supabase/functions/legal-research-v1/stages/documentEvidenceClassification";

describe("web_judgment_source_classification_and_role_admission_v1", () => {
  it("classifies a docket-bearing judgment from a NON-official host", () => {
    const r = detectJudgmentEvidence({
      url: "https://www.judgments.org.il/bavli-1000-92",
      title: 'בג"צ 1000/92 - חוה בבלי נ\' בית הדין הרבני הגדול',
      host_class: "unknown",
    });
    expect(r?.is_judgment).toBe(true);
    expect(r?.docket).toBe("1000/92");
    expect(r?.matched_in).toBe("title");
    expect(r?.signals).toContain("party_names");
  });

  it("classifies a judgment page hosted on an academic domain", () => {
    const r = detectJudgmentEvidence({
      url: "https://www.daat.ac.il/mishpat-ivri/psika/1000-92.htm",
      title: 'בג"צ 1000/92 בבלי נ\' בית הדין הרבני הגדול בירושלים',
      snippet: "פסק דין. לפני: כב' השופט ברק. בית המשפט העליון בשבתו כבית דין גבוה לצדק.",
      host_class: "academic",
    });
    expect(r?.is_judgment).toBe(true);
    expect(r?.signals).toContain("court_identity");
  });

  it("normalises non-final Hebrew letters", () => {
    expect(normalizeHebrewFinals('בג"ץ')).toBe(normalizeHebrewFinals('בג"צ'));
  });

  it("classifies scholarship from document evidence alone", () => {
    const r = detectScholarshipEvidence({
      url: "https://example.org/files/paper.pdf",
      title: "שחר ליפשיץ, שיתוף בנכסים בין בני זוג",
      snippet: 'עיוני משפט כרך כ"ח, עמ\' 331 (2004), הפקולטה למשפטים',
      host_class: "unknown",
    });
    expect(r?.is_scholarship).toBe(true);
    expect(r?.detected_journal_or_institution).toBeTruthy();
  });

  it("fails closed on an unrelated marketing page mentioning a docket", () => {
    expect(
      detectJudgmentEvidence({
        url: "https://lawoffice.example.com/blog/rechush",
        title: 'מאמר: מה קובע בג"צ 1000/92 על חלוקת רכוש?',
        host_class: "unknown",
      }),
    ).toBeNull();
  });

  it("fails closed when only a snippet name-drops a docket", () => {
    expect(
      detectJudgmentEvidence({
        url: "https://example.com/page",
        title: "הלכת השיתוף",
        snippet: 'ראו בג"צ 1000/92 בבלי',
        host_class: "unknown",
      }),
    ).toBeNull();
  });

  it("fails closed on a docket-only page with no second judgment signal", () => {
    expect(
      detectJudgmentEvidence({
        url: "https://example.com/x",
        title: 'ת"א 12/20',
        host_class: "unknown",
      }),
    ).toBeNull();
  });

  it("fails closed on a generic page with no academic signals", () => {
    expect(
      detectScholarshipEvidence({
        url: "https://example.com/info",
        title: "חלוקת רכוש - מידע כללי",
        host_class: "unknown",
      }),
    ).toBeNull();
  });

  it("never reclassifies a `bad` source", () => {
    expect(RECLASSIFIABLE_CLASSES.has("bad")).toBe(false);
  });
});
