import { describe, it, expect } from "vitest";
import { detectSourceType } from "@/data/abbreviations";
import { detectForeignSource } from "@/data/bluebook/extract";

describe("Bluebook 22 — foreign classification (M1)", () => {
  it("F1: US Supreme Court case → foreign_case_us, not generic foreign", () => {
    const t = detectSourceType("Brown v. Board of Education, 347 U.S. 483 (1954)");
    expect(t).toBe("foreign_case_us");
  });

  it("F2: U.S.C. → US statute", () => {
    expect(detectSourceType("15 U.S.C. § 1")).toBe("foreign_statute_us");
    expect(detectSourceType("42 U.S.C. § 1983 (2018)")).toBe("foreign_statute_us");
  });

  it("F3: U.S. Constitution", () => {
    expect(detectSourceType("U.S. CONST. amend. XIV, § 1")).toBe("foreign_constitution");
  });

  it("F4: UK neutral citation → foreign case (UK)", () => {
    const d = detectForeignSource("R (Miller) v Prime Minister [2019] UKSC 41");
    expect(d?.kind).toBe("case");
    expect(d?.jurisdiction).toBe("UK");
  });

  it("F5: law-review article", () => {
    const d = detectForeignSource(
      "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)",
    );
    expect(d?.kind).toBe("journal_article");
  });

  it("F6: firstPage and pinpoint are never conflated", () => {
    const d = detectForeignSource("Brown v. Board of Education, 347 U.S. 483, 490 (1954)");
    const f = d!.fields as { firstPage?: string; pinpoint?: string };
    expect(f.firstPage).toBe("483");
    expect(f.pinpoint).toBe("490");
  });

  it("F7: generic foreign stays a fallback only", () => {
    const d = detectForeignSource("Brown v. Board of Education, 347 U.S. 483 (1954)");
    expect(d?.sourceType).not.toBe("foreign");
  });

  it("F8: a traditional source that happens to be online is not an internet source", () => {
    const d = detectForeignSource(
      "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960), https://example.org/coase.pdf",
    );
    expect(d?.kind).toBe("journal_article");
  });

  it("Hebrew citations are untouched by the foreign fast paths", () => {
    expect(detectForeignSource('ע"א 4628/93 מדינת ישראל נ\' אפרופים')).toBeNull();
    expect(detectSourceType('ע"א 4628/93 מדינת ישראל נ\' אפרופים שיכון')).toBe("case_law_database");
  });
});
