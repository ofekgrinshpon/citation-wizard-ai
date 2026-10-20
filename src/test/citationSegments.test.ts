import { describe, it, expect } from "vitest";
import { parseCitationSegments, citationTextOnly } from "@/lib/citationSegments";

describe("citationSegments — shared structural representation (Stage B)", () => {
  it("parses plain text as a single unstyled segment", () => {
    expect(parseCitationSegments('ע"א 6821/93 בנק המזרחי נ\' מגדל')).toEqual([
      { text: 'ע"א 6821/93 בנק המזרחי נ\' מגדל', bold: false, italic: false, smallCaps: false },
    ]);
  });

  it("parses italic and small caps roles", () => {
    const segs = parseCitationSegments("##Brown v. Board##, 347 ^^U.S.^^ 483 (1954).");
    expect(segs).toEqual([
      { text: "Brown v. Board", bold: false, italic: true, smallCaps: false },
      { text: ", 347 ", bold: false, italic: false, smallCaps: false },
      { text: "U.S.", bold: false, italic: false, smallCaps: true },
      { text: " 483 (1954).", bold: false, italic: false, smallCaps: false },
    ]);
  });

  it("supports nested styles (bold containing italic)", () => {
    const segs = parseCitationSegments("**a ##b## c** d");
    expect(segs).toEqual([
      { text: "a ", bold: true, italic: false, smallCaps: false },
      { text: "b", bold: true, italic: true, smallCaps: false },
      { text: " c", bold: true, italic: false, smallCaps: false },
      { text: " d", bold: false, italic: false, smallCaps: false },
    ]);
  });

  it("supports adjacent style boundaries", () => {
    const segs = parseCitationSegments("##a##^^b^^**c**");
    expect(segs).toEqual([
      { text: "a", bold: false, italic: true, smallCaps: false },
      { text: "b", bold: false, italic: false, smallCaps: true },
      { text: "c", bold: true, italic: false, smallCaps: false },
    ]);
  });

  it("never leaks an unterminated marker token but keeps its text", () => {
    expect(citationTextOnly("Foo ^^bar")).toBe("Foo bar");
    expect(citationTextOnly("a ** b")).toBe("a  b");
    expect(citationTextOnly("x ##y")).toBe("x y");
  });

  it("keeps literal source punctuation that is not markup", () => {
    // A single * or ^ or # is ordinary text, never markup.
    expect(citationTextOnly("2^3 and a*b and c#d")).toBe("2^3 and a*b and c#d");
    expect(citationTextOnly("F. App'x")).toBe("F. App'x");
  });

  it("treats malicious HTML-looking source text as plain text", () => {
    const segs = parseCitationSegments('<img src=x onerror="alert(1)"> ##safe##');
    expect(segs[0].text).toBe('<img src=x onerror="alert(1)"> ');
    expect(segs[0].italic).toBe(false);
    expect(citationTextOnly('<script>alert(1)</script>')).toBe("<script>alert(1)</script>");
  });

  it("preserves RTL Hebrew and LTR runs in original order", () => {
    const text = 'ראו ##Brown v. Board##, 347 ^^U.S.^^ 483 (1954), בעמ\' 490.';
    expect(citationTextOnly(text)).toBe("ראו Brown v. Board, 347 U.S. 483 (1954), בעמ' 490.");
  });

  it("preserves missing-field placeholders and unsupported suffixes verbatim", () => {
    const text = "##Example v. Sample##, [חסר: כרך/מאגר] [חסר: מקור פרסום] [חסר: עמוד] (2d Cir. 1996) (Taylor, J., dissenting).";
    expect(citationTextOnly(text)).toBe(
      "Example v. Sample, [חסר: כרך/מאגר] [חסר: מקור פרסום] [חסר: עמוד] (2d Cir. 1996) (Taylor, J., dissenting).",
    );
  });
});
