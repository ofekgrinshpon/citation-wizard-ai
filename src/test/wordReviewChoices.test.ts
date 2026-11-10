import { describe, expect, it } from "vitest";
import { cleanCitationLine, countryRetryChoice, parseResultOptions } from "@/lib/resultOptions";
import { extractCitationFromResponse } from "@/lib/citationUtils";
import { getMissingFieldsSummary, validateAIResponse } from "@/lib/citationValidation";

const blob = (o: object) => `<!--DATA:${encodeURIComponent(JSON.stringify(o))}-->`;
const list = [
  "נמצאו מספר פסקי דין בין הצדדים. לאיזה פסק דין התכוונת?",
  `1. ע"פ 7939/10 זדורוב נ' מדינת ישראל (2015) — העליון${blob({ caseNumber: "7939/10" })}`,
  `2. דנ"פ 1012/16 זדורוב נ' מדינת ישראל (2016) — העליון${blob({ caseNumber: "1012/16" })}`,
].join("\n");

describe("Word review: result lists become choices", () => {
  it("reads every numbered ruling as an option and keeps its hidden data for the next check", () => {
    const options = parseResultOptions(list)!;
    expect(options).toHaveLength(2);
    expect(options[1].label).toBe(`דנ"פ 1012/16 זדורוב נ' מדינת ישראל (2016) — העליון`);
    expect(options[1].selection).toContain("<!--DATA:");
    expect(options[1].label).not.toContain("<!--DATA:");
  });

  it("a single result is not a list", () => {
    expect(parseResultOptions(`ע"פ 7939/10 זדורוב נ' מדינת ישראל (2015)`)).toBeNull();
  });

  it("never proposes a list number as part of the citation", () => {
    expect(extractCitationFromResponse(`2. ע"א 1/20 כהן נ' לוי (2020)`)).toBe(`ע"א 1/20 כהן נ' לוי (2020)`);
    expect(cleanCitationLine(`1. ע"א 1/20 כהן נ' לוי${blob({ a: 1 })}`, `1. ע"א 1/20 כהן נ' לוי`)).toBe(`ע"א 1/20 כהן נ' לוי`);
  });

  it("several numbered lines are left visible instead of silently keeping the last one", () => {
    expect(extractCitationFromResponse(list)).toMatch(/^2\. /);
  });

  it("offers a country choice only when rulings come from more than one country", () => {
    const us = { jurisdiction: "US" as const, label: "Donoghue v. Stevenson - US casebook", url: "https://example.edu/a" };
    const uk = { jurisdiction: "UK" as const, label: "Donoghue v Stevenson [1932] UKHL 100", url: "https://www.bailii.org/uk/cases/UKHL/1932/100.html" };
    expect(countryRetryChoice([uk, us])).toEqual({ kind: "country", countries: [
      { country: "uk", options: [{ label: uk.label, url: uk.url }] },
      { country: "us", options: [{ label: us.label, url: us.url }] },
    ] });
    expect(countryRetryChoice([uk, { ...uk, url: "https://example.org/b" }])).toBeNull();
  });
});

describe("Hebrew book year and missing-detail wording", () => {
  it("a year that ends the citation line is found even when notes follow it", () => {
    const reply = "רות גביזון **זכויות אדם בישראל** (2019).\n⚠️ כלל 23.9: יש לבדוק את שנת המהדורה.";
    expect(validateAIResponse(reply, "book").missingFields).not.toContain("year");
  });

  it("a book with no year is still reported, in short words", () => {
    expect(validateAIResponse("רות גביזון **זכויות אדם בישראל**", "book").missingFields).toContain("year");
    expect(getMissingFieldsSummary("book", ["year"])).toBe("חסרים 1 רכיבי חובה: שנת פרסום (כלל 23.9)");
  });
});
