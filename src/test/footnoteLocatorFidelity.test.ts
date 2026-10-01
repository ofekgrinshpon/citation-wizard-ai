import { describe, expect, it } from "vitest";
import {
  buildCompoundFootnotes,
  buildOccurrenceFootnotes,
  simpleSection,
  type CitationOccurrence,
} from "../../supabase/functions/_shared/footnoteOccurrences";

// Synthetic placeholders — the behaviour under test is locator fidelity, not legal content.
const LAW = "חוק דוגמה, התש\"ן-1990";
const CASE = 'ע"א 1/00 פלוני נ\' אלמוני';
const occ = (id: string, full: string, locator?: string): CitationOccurrence => ({ source_id: id, full_citation: full, locator });

describe("footnote locator fidelity", () => {
  it("non-adjacent complex legislation uses the law name, never לעיל ה\"ש", () => {
    const f = buildOccurrenceFootnotes([
      occ("L", LAW, "סעיף 1"),
      occ("C", CASE),
      occ("L", LAW, "סעיף 56(א), סעיף 54"),
      occ("C", CASE),
      occ("L", LAW, "סעיפים 47–48"),
      occ("C", CASE),
      occ("L", LAW, "פרק ד׳, סעיפים 18–19"),
      occ("C", CASE),
      occ("L", LAW, "סעיף 54"),
    ]);
    expect(f[2].citation).toBe("סעיף 56(א), סעיף 54 לחוק דוגמה.");
    expect(f[4].citation).toBe("סעיפים 47–48 לחוק דוגמה.");
    expect(f[6].citation).toBe("פרק ד׳, סעיפים 18–19 לחוק דוגמה.");
    expect(f[8].citation).toBe("ס' 54 לחוק דוגמה.");
    for (const i of [2, 4, 6, 8]) expect(f[i].citation).not.toContain("לעיל");
  });

  it("keeps every provision of a multi-section locator", () => {
    const f = buildOccurrenceFootnotes([occ("L", LAW), occ("L", LAW, "סעיף 56(א), סעיף 54")]);
    expect(f[1].citation).toContain("56(א)");
    expect(f[1].citation).toContain("54");
  });

  it("keeps plural ranges instead of a first-source locator", () => {
    const f = buildOccurrenceFootnotes([occ("L", LAW, "סעיף 12"), occ("L", LAW, "סעיפים 47–48")]);
    expect(f[1].citation).toContain("47–48");
    expect(f[1].citation).not.toContain("12");
  });

  it("keeps chapter + range and paragraph + extra provision", () => {
    const f = buildOccurrenceFootnotes([
      occ("L", LAW, "סעיף 12"),
      occ("C", CASE),
      occ("L", LAW, "פרק ד׳, סעיפים 18–19"),
      occ("L", LAW, "סעיף 11(5) וסעיף 15"),
    ]);
    expect(f[2].citation).toContain("פרק ד׳, סעיפים 18–19");
    expect(f[2].citation).not.toMatch(/\b12\b/);
    expect(f[3].citation).toContain("11(5)");
    expect(f[3].citation).toContain("15");
  });

  it("compares שם against the immediately preceding occurrence (A54→A56→A54)", () => {
    const f = buildOccurrenceFootnotes([
      occ("L", LAW, "סעיף 54"),
      occ("L", LAW, "סעיף 56"),
      occ("L", LAW, "סעיף 54"),
      occ("L", LAW, "סעיף 54"),
    ]);
    expect(f[1].citation).toBe("שם, בס' 56.");
    expect(f[2].citation).toBe("שם, בס' 54.");
    expect(f[3].citation).toBe("שם.");
  });

  it("never invents a locator when the current one is missing", () => {
    const f = buildOccurrenceFootnotes([occ("L", LAW, "סעיף 54"), occ("C", CASE), occ("L", LAW)]);
    expect(f[2].citation).not.toContain("54");
  });

  it("same rule for case law; supra keeps current locator", () => {
    const f = buildOccurrenceFootnotes([
      occ("C", CASE, "פסקה 4"),
      occ("C", CASE, "פסקה 9"),
      occ("C", CASE, "פסקה 4"),
      occ("L", LAW),
      occ("C", CASE, "פסקה 4"),
    ]);
    expect(f[1].citation).toBe("שם, בפס' 9.");
    expect(f[2].citation).toBe("שם, בפס' 4.");
    expect(f[4].citation).toContain("בפס' 4");
  });

  it("same author, different works stay distinct sources", () => {
    const f = buildOccurrenceFootnotes([
      occ("B1", "ישראל ישראלי, ספר א"),
      occ("B2", "ישראל ישראלי, ספר ב"),
      occ("B1", "ישראל ישראלי, ספר א", "עמ' 5"),
    ]);
    expect(f[1].repeat_kind).toBe("full");
    expect(f[2].first_occurrence).toBe(1);
    expect(f[2].citation).toContain("בעמ' 5");
  });

  it("compound points keep per-source locators and numbering", () => {
    const f = buildCompoundFootnotes([
      [occ("L", LAW, "סעיף 1"), occ("C", CASE)],
      [occ("L", LAW, "סעיפים 2–3"), occ("C", CASE, "פסקה 7")],
    ]);
    expect(f.map((x) => x.index)).toEqual([1, 2]);
    expect(f[1].sources[0].citation).toContain("2–3");
    expect(f[1].sources[1].citation).toContain("בפס' 7");
  });

  it("simpleSection only accepts exactly one provision", () => {
    expect(simpleSection("סעיף 54")).toBe("54");
    expect(simpleSection("ס' 56(א)")).toBe("56(א)");
    expect(simpleSection("סעיפים 47–48")).toBe("");
    expect(simpleSection("סעיף 56(א), סעיף 54")).toBe("");
  });

  it("non-research callers without locators are unchanged", () => {
    const f = buildOccurrenceFootnotes([occ("C", CASE), occ("C", CASE), occ("L", LAW), occ("C", CASE)]);
    expect(f.map((x) => x.citation)).toEqual([CASE, "שם.", LAW, 'עניין אלמוני, לעיל ה"ש 1.']);
  });
});
