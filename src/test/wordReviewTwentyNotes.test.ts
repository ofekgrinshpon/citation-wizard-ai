/**
 * Five problems seen in a 20-footnote Word review. Real planner, real lookup
 * and real renderer; search responses are fixtures. No live provider.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { createCitationBudget, prepareFreeformHandoff } from "../../supabase/functions/_shared/citationPure/freeformInterpret";
import { citationTextOnly } from "@/lib/citationSegments";
import { runCitation } from "@/lib/runCitation";
import { hasMultipleSourceSignals } from "@/lib/wordFootnotePlan";
import { validateAIResponse } from "@/lib/citationValidation";
import { lineDirection } from "@/lib/textDirection";

const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: m.invoke, retryCitationFunction: vi.fn(), citationRetryDisclosure: vi.fn() }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: vi.fn().mockResolvedValue(null), findSimilarVerifiedSource: vi.fn().mockResolvedValue(null) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: async () => { throw new Error("classifier offline"); } }, from: () => { throw new Error("no database"); } } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
});

async function cite(rawInput: string, results: Array<{ title: string; url: string; snippet: string }>) {
  const budget = createCitationBudget();
  let request: ForeignLookupInput | undefined;
  m.invoke.mockImplementation(async (_name: string, body: { foreignLookup?: ForeignLookupInput }) => {
    if (!body.foreignLookup) return { data: { content: "" }, errorInfo: null };
    request = body.foreignLookup;
    const response = await runForeignLookup(body.foreignLookup, {
      apiKey: "offline-only", budget,
      fetchImpl: (async () => new Response(JSON.stringify({ results }), { status: 200 })) as unknown as typeof fetch,
    });
    return { data: { foreignLookup: response, content: "" }, errorInfo: null };
  });
  const result = await runCitation({ rawInput, useVerifiedStore: false });
  return { result, request, budget };
}

describe("Brown v. Board of Education (1954): the year in parentheses is the decision year", () => {
  it("is not part of the case name and is not reported as missing", async () => {
    const { result, request, budget } = await cite("Brown v. Board of Education (1954).", [
      { title: "Brown v. Board of Education, 347 U.S. 483 (1954)", url: "https://supreme.justia.com/cases/federal/us/347/483/", snippet: "Brown v. Board of Education, 347 U.S. 483 (1954)." },
    ]);
    expect(request?.parsedFields?.caseName).toBe("Brown v. Board of Education");
    expect(request?.parsedFields?.year).toBe("1954");
    const text = citationTextOnly(result.citation);
    expect(text).toContain("Brown v. Board of Education, 347 U.S. 483 (1954)");
    expect(text).not.toContain("(1954),");
    expect(text).not.toContain("[חסר: שנה]");
    expect(result.reply).not.toContain("חסרה שנת ההחלטה");
    expect(budget.searches).toBeLessThanOrEqual(2);
  });
});

describe("Word: one consolidated Israeli case is one source", () => {
  it("does not read docket 1908/94 as a year or several dockets of one caption as several cases", () => {
    expect(hasMultipleSourceSignals('ע"א 6821/93, רע"א 1908/94, ע"א 3363/95 בנק המזרחי המאוחד בע"מ נ\' מגדל כפר שיתופי, פ"ד מט(4) 221 (1995).')).toBe(false);
  });
  it("still stops two separate cases", () => {
    expect(hasMultipleSourceSignals('ע"א 1/90 כהן נ\' לוי, ע"א 2/91 דוד נ\' משה')).toBe(true);
    expect(hasMultipleSourceSignals("case 123/20 and case 567/21")).toBe(true);
    expect(hasMultipleSourceSignals("A (2020), B (2021)")).toBe(true);
  });
});

describe("Hebrew book year check (rule 23.9)", () => {
  it("finds the year when the citation ends with a period", () => {
    const v = validateAIResponse("אהרן ברק **פרשנות במשפט** כרך ראשון: תורת הפרשנות הכללית (1992).", "book");
    expect(v.missingFields.join(" ")).not.toMatch(/שנ/);
  });
  it("still reports a book with no year", () => {
    const v = validateAIResponse("אהרן ברק **פרשנות במשפט** כרך ראשון.", "book");
    expect(v.missingFields.length).toBeGreaterThan(0);
  });
});

describe("Free-form book: a trailing edition is not part of the author", () => {
  it("reads 'second edition' as the edition and searches for author H. L. A. Hart", () => {
    const handoff = prepareFreeformHandoff("The Concept of Law by H. L. A. Hart, second edition.");
    expect(handoff?.mode).toBe("search");
    if (handoff?.mode !== "search") throw new Error("no search");
    expect(handoff.request.parsedFields).toEqual({ bookTitle: "The Concept of Law", authors: "H. L. A. Hart", edition: "second edition" });
  });
  it("confirms the book by Hart and keeps the stated edition", async () => {
    const { result } = await cite("The Concept of Law by H. L. A. Hart, second edition.", [
      { title: "The Concept of Law — H.L.A. Hart", url: "https://global.oup.com/academic/product/the-concept-of-law", snippet: "H.L.A. Hart, The Concept of Law (2d ed. 1994)." },
    ]);
    const text = citationTextOnly(result.citation);
    console.log("HART", text, "|", result.reply);
    expect(text).toContain("Hart");
    expect(text).not.toContain("second edition.,");
    expect(result.reply).not.toContain("לא אומתה התאמת המקור");
  });
  it("reads '2nd ed.' the same way", () => {
    const handoff = prepareFreeformHandoff("The Concept of Law by H. L. A. Hart, 2nd ed.");
    if (handoff?.mode !== "search") throw new Error("no search");
    expect(handoff.request.parsedFields.authors).toBe("H. L. A. Hart");
    expect(handoff.request.parsedFields.edition).toBe("2nd ed.");
  });
});

describe("English citation lines with Hebrew missing-detail tags stay left-to-right", () => {
  it("ignores [חסר: …] tags when choosing the direction", () => {
    expect(lineDirection("Oliver Wendell Holmes, The Path of the Law, [חסר: כרך] Harv. L. Rev. [חסר: עמוד] ([חסר: שנה]).")).toBe("ltr");
    expect(lineDirection("אהרן ברק [חסר: שנה]")).toBe("rtl");
    expect(lineDirection("[חסר: שנה]")).toBe("rtl");
  });
});
