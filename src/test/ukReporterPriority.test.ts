import { describe, expect, it } from "vitest";
import {
  decisionLabel, decisionLocationFields, isRetroactiveUkNeutral, orderDecisionsForChoice, readLocationChoice,
  selectableLocations, type CaseDecisionRecord, type CaseLocationRecord,
} from "../../supabase/functions/_shared/citationPure/caseLocations.ts";
import { renderUkCase } from "../../supabase/functions/_shared/citationPure/render.ts";
import { citationTextOnly } from "@/lib/citationSegments";
import { lineDirection } from "@/lib/textDirection";

const URL = "https://example.org/case";
const loc = (reporter: string, volumeYear: string, firstPage: string, yearStyle: "square" | "none" = "square"): CaseLocationRecord => ({
  id: `UK|${reporter}|${volumeYear}|${firstPage}`, jurisdiction: "UK", reporter, volumeYear, firstPage, yearStyle,
  sourceUrl: URL, basis: "repository_metadata", support: 1,
});
const decision = (over: Partial<CaseDecisionRecord>): CaseDecisionRecord => ({
  id: `dec:${over.neutral ?? ""}|${over.decisionYear ?? ""}`, jurisdiction: "UK", locations: [], sourceUrls: [URL], locationConflicts: [],
  neutralSourceUrl: URL, neutralBasis: "repository_metadata", ...over,
});

describe("pre-2001 UK neutral citations are treated as database identifiers", () => {
  it("a neutral citation before 2001 is retroactive; from 2001 it is not", () => {
    expect(isRetroactiveUkNeutral("1932", "UKHL 100")).toBe(true);
    expect(isRetroactiveUkNeutral("2000", "UKHL 1")).toBe(true);
    expect(isRetroactiveUkNeutral("2001", "UKHL 1")).toBe(false);
  });

  it("with a printed report chosen, a pre-2001 decision uses the report alone", () => {
    const ac = loc("AC", "1932", "562");
    const d = decision({ neutral: "UKHL 100", decisionYear: "1932", locations: [ac] });
    const { fields } = decisionLocationFields(d, ac);
    expect(fields.neutral).toBeUndefined();
    const out = renderUkCase({ caseName: "Donoghue v Stevenson", ...fields });
    expect(citationTextOnly(out.citation)).toBe("Donoghue v Stevenson [1932] AC 562.");
  });

  it("a decision from 2001 on keeps its neutral citation with the report", () => {
    const ac = loc("AC", "2010", "1");
    const d = decision({ neutral: "UKSC 1", decisionYear: "2009", locations: [ac] });
    expect(decisionLocationFields(d, ac).fields.neutral).toBe("UKSC 1");
  });

  it("a typed pre-2001 neutral citation is dropped when a report is given, with a note", () => {
    const out = renderUkCase({ caseName: "Donoghue v Stevenson", neutral: "UKHL 100", year: "1932", reporter: "AC", firstPage: "562" });
    expect(citationTextOnly(out.citation)).toBe("Donoghue v Stevenson [1932] AC 562.");
    expect(out.warnings.join(" ")).toContain("2001");
  });

  it("a pre-2001 neutral citation with no report is kept but flagged", () => {
    const out = renderUkCase({ caseName: "Donoghue v Stevenson", neutral: "UKHL 3", year: "1931" });
    expect(citationTextOnly(out.citation)).toContain("[1931] UKHL 3");
    expect(out.warnings.join(" ")).toContain("Law Reports");
  });
});

describe("official Law Reports are listed first; the user still chooses", () => {
  it("parallel reports: AC comes before Scottish and commercial reports", () => {
    const d = decision({ neutral: "UKHL 100", decisionYear: "1932", locations: [
      loc("SC (HL)", "1932", "31", "none"), loc("All ER Rep", "1932", "1"), loc("AC", "1932", "562"),
    ] });
    expect(selectableLocations(d).map((l) => l.reporter)).toEqual(["AC", "SC (HL)", "All ER Rep"]);
    const choice = readLocationChoice({ locationChoiceRequired: true, caseDecisions: [d] }, "UK");
    expect(choice?.map((o) => o.label)).toEqual(["[1932] AC 562", "1932 SC (HL) 31", "[1932] All ER Rep 1"]);
  });

  it("several rulings: the one reported in the Law Reports is listed before a database-only one", () => {
    const petition = decision({ neutral: "UKHL 3", decisionYear: "1931" });
    const merits = decision({ neutral: "UKHL 100", decisionYear: "1932", locations: [loc("SC (HL)", "1932", "31", "none"), loc("AC", "1932", "562")] });
    const ordered = orderDecisionsForChoice([petition, merits]);
    expect(ordered.map((d) => d.neutral)).toEqual(["UKHL 100", "UKHL 3"]);
    expect(decisionLabel(merits)).toBe("[1932] AC 562, 1932 SC (HL) 31, [1932] UKHL 100");
  });
});

describe("text direction of chat lines", () => {
  it("an English citation line is left-to-right; Hebrew lines stay right-to-left", () => {
    expect(lineDirection("##Donoghue v Stevenson## [1932] AC 562.")).toBe("ltr");
    expect(lineDirection("⚠️ נדרשת בחירה בין מראי מקום")).toBe("rtl");
    expect(lineDirection("ע\"א 1234/20 Smith v Jones")).toBe("rtl");
  });
});
