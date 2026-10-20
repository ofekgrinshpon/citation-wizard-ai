/**
 * Stage B corrective — typography fixtures from the supplied Bluebook 21
 * evidence (mapping v3 rows 45–47 BB21-R2.1(a)-REQ01/02/03, row 51 R2.1(e);
 * scenario row 748 full_case_typeface was a reproduced mismatch).
 *  - R2.1(a): case names in full case citations are ROMAN, including "v.";
 *    only procedural phrases ("ex rel.", "In re") are italic.
 *  - Short-form case names are italic.
 *  - A case name inside an italic article title stays roman.
 *  - R2.1(e) concerns explanatory phrases; "quoting"/"citing" in
 *    related-authority parentheticals remain roman.
 * Plus literal marker-like characters in source text (C## / x^^2 / A**B).
 */
import { describe, expect, it } from "vitest";
import { renderForeignCitation } from "@/data/bluebook";
import { citationTextOnly, escapeCitationLiteral, parseCitationSegments } from "@/lib/citationSegments";
import { citationToHtml, citationToPlain } from "@/lib/citationRichText";
import { citationToOoxml } from "@/lib/wordInsertion";
import { applyRepeatCitationRules, extractCitationOnly, extractShortSourceLabel } from "@/lib/footnoteRepeatRules";

const italicText = (s: string) => parseCitationSegments(s).filter((x) => x.italic).map((x) => x.text);

describe("R2.1(a) — full case citation typeface", () => {
  it("US case name is roman, including v.", () => {
    const r = renderForeignCitation("Brown v. Board of Education, 347 U.S. 483 (1954)")!;
    expect(r.citation).toBe("Brown v. Board of Education, 347 U.S. 483 (1954).");
    expect(italicText(r.citation)).toEqual([]);
  });

  it("only the procedural phrase In re is italic", () => {
    const r = renderForeignCitation("In re Gault, 387 U.S. 1 (1967)")!;
    expect(italicText(r.citation)).toEqual(["In re"]);
    expect(citationTextOnly(r.citation)).toBe("In re Gault, 387 U.S. 1 (1967).");
  });

  it("only the procedural phrase ex rel. is italic", () => {
    const r = renderForeignCitation("United States ex rel. Smith v. Jones, 100 F.3d 1 (2d Cir. 1996)")!;
    expect(italicText(r.citation)).toEqual(["ex rel."]);
    expect(citationTextOnly(r.citation)).toBe("United States ex rel. Smith v. Jones, 100 F.3d 1 (2d Cir. 1996).");
  });

  it("UK full case name is roman", () => {
    const r = renderForeignCitation("R v Smith [2001] UKHL 1")!;
    expect(italicText(r.citation)).toEqual([]);
    expect(citationTextOnly(r.citation)).toBe("R v Smith [2001] UKHL 1.");
  });

  it("R2.1(e): quoting parenthetical stays roman and verbatim with its warning", () => {
    const r = renderForeignCitation("Example v. Sample, 100 F.3d 200 (2d Cir. 1996) (quoting Other v. Party, 1 U.S. 1 (1800))")!;
    expect(italicText(r.citation)).toEqual([]);
    expect(citationTextOnly(r.citation)).toContain("(quoting Other v. Party, 1 U.S. 1 (1800))");
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("case name inside an italic article title stays roman", () => {
  it("reverses italics for the embedded case name only", () => {
    const r = renderForeignCitation("Jane Doe, The Legacy of Brown v. Board of Education, 100 Harv. L. Rev. 1 (1990)")!;
    expect(italicText(r.citation)).toEqual(["The Legacy of "]);
    expect(citationTextOnly(r.citation)).toBe("Jane Doe, The Legacy of Brown v. Board of Education, 100 Harv. L. Rev. 1 (1990).");
  });

  it("an ambiguous embedded case name keeps the title italic and warns", () => {
    const r = renderForeignCitation("Jane Doe, Rethinking Brown v. Board of Education, 100 Harv. L. Rev. 1 (1990)")!;
    expect(italicText(r.citation)).toEqual(["Rethinking Brown v. Board of Education"]);
    expect(r.warnings.some((w) => w.includes("R2.1(a)"))).toBe(true);
  });
});

describe("Israeli repeats (37.9) with short-form foreign case names", () => {
  const FULL = "Brown v. Board of Education, 347 U.S. 483 (1954).";
  it("adjacent repeat is plain שם; non-adjacent לעיל ה\"ש keeps numbering with an italic short name", () => {
    const out = applyRepeatCitationRules([
      { id: 1, input: "Brown v. Board of Education, 347 U.S. 483 (1954)", output: FULL },
      { id: 2, input: "Brown v. Board of Education, 347 U.S. 483 (1954)", output: FULL },
      { id: 3, input: "חוק העונשין", output: 'חוק העונשין, התשל"ז-1977.' },
      { id: 4, input: "Brown v. Board of Education, 347 U.S. 483 (1954)", output: FULL },
    ]);
    expect(out[0].output).toBe(FULL);
    expect(out[1].output).toBe("שם.");
    expect(citationTextOnly(out[3].output!)).toBe('Brown v. Board of Education, לעיל ה"ש 1.');
    expect(italicText(out[3].output!)).toEqual(["Brown v. Board of Education"]);
  });

  it("Hebrew case labels and book labels are unchanged", () => {
    expect(extractShortSourceLabel('ע"א 1234/22 פלוני נ\' כהן, פ"ד נה(1) 1 (2001)')).toBe("עניין כהן");
    expect(extractShortSourceLabel("^^H.L.A. Hart, The Concept of Law^^ 100 (2d ed. 1994).")).toBe("H.L.A. Hart");
  });
});

describe("literal marker-like characters in source text", () => {
  const RAW = "Jane Doe, C## Guide: x^^2 & A**B, 12 Yale L.J. 1 (2000)";

  it("the renderer escapes literal characters; every channel shows them verbatim", () => {
    const r = renderForeignCitation(RAW)!;
    expect(citationTextOnly(r.citation)).toBe("Jane Doe, C## Guide: x^^2 & A**B, 12 Yale L.J. 1 (2000).");
    expect(italicText(r.citation)).toEqual(["C## Guide: x^^2 & A**B"]);
    expect(citationToPlain(r.citation)).toBe("Jane Doe, C## Guide: x^^2 & A**B, 12 Yale L.J. 1 (2000).");
    expect(citationToHtml(r.citation)).toContain("<em>C## Guide: x^^2 &amp; A**B</em>");
    expect(citationToHtml(r.citation)).toContain("font-variant:small-caps");
    const ooxml = citationToOoxml(r.citation);
    expect(ooxml).toContain("C## Guide: x^^2 &amp; A**B");
    expect(ooxml).toContain("<w:smallCaps/>");
    expect(extractCitationOnly(r.citation)).toBe("Jane Doe, C## Guide: x^^2 & A**B, 12 Yale L.J. 1 (2000).");
  });

  it("escape/parse round-trips and legacy stored markup still reads", () => {
    for (const s of ["C## Guide", "x^^2", "A**B", "a\\b", "\\##x##", "###"]) {
      expect(citationTextOnly(escapeCitationLiteral(s))).toBe(s);
    }
    expect(citationTextOnly("##Legacy v. Stored##, 1 ^^U.S.^^ 1 (1900).")).toBe("Legacy v. Stored, 1 U.S. 1 (1900).");
    expect(italicText("##Legacy v. Stored##, 1 U.S. 1")).toEqual(["Legacy v. Stored"]);
  });
});
