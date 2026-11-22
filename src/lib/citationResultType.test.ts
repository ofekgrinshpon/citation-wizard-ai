import { describe, expect, it } from "vitest";
import { SOURCE_TYPE_LABELS } from "@/data/abbreviations";
import { getCitationResultType, getGroundedJournalType } from "./citationResultType";

describe("quick citation result classification", () => {
  it.each([
    'ע"פ 5121/98 יששכרוב נ׳ התובע הצבאי, פ"ד סא(1) 461 (2006).',
    'ע״א 80/50 פלוני נ׳ פלונית, פ״ד ז 871 (1953).',
  ])("shares the published label with history for %s", (citation) => {
    expect(getCitationResultType("case_law_database", citation)).toEqual({
      type: "case_law_published", label: SOURCE_TYPE_LABELS.case_law_published,
    });
  });

  it.each([
    'ע״א 140/00 עזבון אטינגר נ׳ החברה לשיקום (אר״ש 15.3.2004).',
    'ע״א 140/00 עזבון אטינגר, פ״ד נח.',
    'לא נמצאה ראיה לאזכור כגון פ״ד נח(4) 486.',
  ])("keeps an online or incomplete citation in its original category: %s", (citation) => {
    expect(getCitationResultType("case_law_database", citation)).toEqual({
      type: "case_law_database", label: SOURCE_TYPE_LABELS.case_law_database,
    });
  });

  it("does not infer a case category for a different route", () => {
    expect(getCitationResultType("unknown", 'ע״א 140/00 אטינגר, פ״ד נח(4) 486 (2004).'))
      .toEqual({ type: "unknown", label: null });
  });
});


describe("verified journal result after an initial book guess", () => {
  const raw = "המהפכה החוקתית: זכויות יסוד מוגנות";
  const content = `אהרן ברק "${raw}" **משפט וממשל** א 9 (1992).`;
  const groundedJournalResultType = { version: 1, type: "article", rawInput: raw, content };
  const displayAndHistory = (data: { content: string; groundedJournalResultType?: unknown }) =>
    getCitationResultType(getGroundedJournalType("book", raw, data) ?? "book", data.content);

  it("uses the accepted article type for both the badge and history label", () => {
    expect(displayAndHistory({ content, groundedJournalResultType })).toEqual({ type: "article", label: SOURCE_TYPE_LABELS.article });
  });

  it("ignores even a correct-looking citation without the server's binding", () => {
    expect(displayAndHistory({ content })).toEqual({ type: "book", label: SOURCE_TYPE_LABELS.book });
    expect(displayAndHistory({ content, groundedJournalResultType: { ...groundedJournalResultType, rawInput: raw + "." } }).type).toBe("book");
    expect(displayAndHistory({ content: content.replace("1992", "1993"), groundedJournalResultType }).type).toBe("book");
    expect(getGroundedJournalType("unknown", raw, { content, groundedJournalResultType })).toBeUndefined();
  });
});
