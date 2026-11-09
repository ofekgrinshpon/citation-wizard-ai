import { describe, expect, it } from "vitest";
import { citationPartRulesFor, tooltipScopeFor } from "@/data/ruleTooltips";

const keys = (scope: Parameters<typeof citationPartRulesFor>[0]) => citationPartRulesFor(scope).map((r) => r.ruleKey);

describe("rule hints follow the source type", () => {
  it("an English statute gets no Israeli case-law year hint (18.7)", () => {
    expect(tooltipScopeFor("foreign_statute_uk", "Data Protection Act 2018.")).toBe("foreign");
    expect(keys("foreign")).not.toContain("18.7");
  });

  it("foreign sources keep only the foreign-source hint (36)", () => {
    expect(new Set(keys("foreign"))).toEqual(new Set(["36"]));
  });

  it("Israeli legislation gets no case-law year hint (18.7)", () => {
    expect(tooltipScopeFor("primary_legislation", "חוק הגנת הפרטיות, התשמ\"א–1981, ס\"ח 128.")).toBe("israeli_other");
    expect(keys("israeli_other")).not.toContain("18.7");
    expect(keys("israeli_other")).toContain("2.1");
  });

  it("Israeli case law keeps the year hint (18.7)", () => {
    expect(tooltipScopeFor("case_law_published", "ע\"א 248/86 כהן נ' לוי, פ\"ד מב(1) 200 (1988).")).toBe("israeli_case_law");
    expect(keys("israeli_case_law")).toContain("18.7");
  });

  it("without a source type, an English line is foreign and a Hebrew ruling is case law", () => {
    expect(tooltipScopeFor(undefined, "Data Protection Act 2018.")).toBe("foreign");
    expect(tooltipScopeFor(undefined, "בג\"ץ 73/53 קול העם נ' שר הפנים, פ\"ד ז 871 (1953).")).toBe("israeli_case_law");
    expect(tooltipScopeFor(undefined, "חוק הגנת הפרטיות, התשמ\"א–1981, ס\"ח 128.")).toBe("israeli_other");
  });
});
