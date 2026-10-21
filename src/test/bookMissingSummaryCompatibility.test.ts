import { describe, expect, it } from "vitest";
import { CITATION_RULES, validateCitation } from "@/data/citationEngine";
import { getMissingFieldsSummary, validateAIResponse } from "@/lib/citationValidation";
import { bookMissingSummary } from "../../supabase/functions/_shared/citationPure/bookFinal";

const titleLabel = "שם המאמר – באותיות מוטות (כלל 36.7) (כלל 36.8)";

describe("book/chapter missing-label compatibility", () => {
  it("restores the exact legacy articleTitle summary in client and shared server code", () => {
    const expected = `חסרים 1 רכיבי חובה: ${titleLabel}`;
    expect(getMissingFieldsSummary("foreign_book_chapter", ["articleTitle"])).toBe(expected);
    expect(bookMissingSummary("foreign_book_chapter", ["articleTitle"])).toBe(expected);
  });

  for (const type of ["foreign_book", "foreign_book_chapter"] as const) {
    it.each(CITATION_RULES[type].components)(`${type} retains the existing $field label`, component => {
      const expected = `חסרים 1 רכיבי חובה: ${component.description} (כלל ${component.rule})`;
      expect(getMissingFieldsSummary(type, [component.field])).toBe(expected);
      expect(bookMissingSummary(type, [component.field])).toBe(expected);
    });
  }

  it("the real chapter engine reports a missing title without inventing or accepting it", () => {
    const fields = { authors: "Jane Doe", bookTitle: "Synthetic Collection", firstPage: "12", year: "2020" };
    const missing = validateCitation("foreign_book_chapter", fields);
    expect(missing).toEqual(["articleTitle"]);
    expect(getMissingFieldsSummary("foreign_book_chapter", missing)).toBe(`חסרים 1 רכיבי חובה: ${titleLabel}`);
    expect(validateCitation("foreign_book_chapter", { ...fields, chapterTitle: "Quiet Rules" })).toEqual(["articleTitle"]);
    expect(validateCitation("foreign_book_chapter", { ...fields, articleTitle: "Quiet Rules" })).toEqual([]);
  });

  it("actual response validation carries the required chapter-title warning", () => {
    const result = validateAIResponse("Jane Doe, in Synthetic Collection 12 (2020).", "foreign_book_chapter");
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toContain("articleTitle");
    expect(getMissingFieldsSummary(result.effectiveSourceType ?? "foreign_book_chapter", result.missingFields)).toContain(titleLabel);
  });

  it("preserves ordered partial summaries and existing chapterTitle/unknown-key behavior", () => {
    const fields = ["articleTitle", "chapterTitle", "firstPage", "unknownField", "year"];
    const expected = `חסרים 3 רכיבי חובה: ${titleLabel}، עמוד תחילת המאמר בספר (כלל 36.8)، שנת פרסום הספר (כלל 36.8)`;
    expect(getMissingFieldsSummary("foreign_book_chapter", fields)).toBe(expected);
    expect(bookMissingSummary("foreign_book_chapter", fields)).toBe(expected);
    expect(bookMissingSummary("foreign_book_chapter", ["chapterTitle", "unknownField"])).toBe("");
    expect(getMissingFieldsSummary("foreign_book_chapter", [])).toBe("");
  });
});