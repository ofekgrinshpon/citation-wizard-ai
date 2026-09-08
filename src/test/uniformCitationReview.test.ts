import { describe, it, expect } from "vitest";
import { buildCitationInput } from "@/components/legal-research/UniformCitationPanel";
import { applyRepeatCitationRules, extractCitationOnly, stripPresentationWarnings } from "@/lib/footnoteRepeatRules";

describe("buildCitationInput", () => {
  it("uses title and url", () => {
    expect(buildCitationInput({ number: 1, title: "בג\"ץ 1000/92 בבלי", url: "https://x/1" })).toBe(
      'בג"ץ 1000/92 בבלי — https://x/1',
    );
  });

  it("joins compound sources", () => {
    const input = buildCitationInput({
      number: 2,
      title: "ignored",
      sources: [{ title: "מקור א" }, { title: "מקור ב", url: "https://y" }],
    });
    expect(input).toBe("מקור א ; מקור ב — https://y");
  });
});

describe("applyRepeatCitationRules (shared)", () => {
  it("turns an adjacent repeat into שם", () => {
    const cells = [
      { id: 1, input: "עניין בבלי", output: "בג\"ץ 1000/92 בבלי נ' בית הדין הרבני." },
      { id: 2, input: "עניין בבלי", output: "בג\"ץ 1000/92 בבלי נ' בית הדין הרבני." },
    ];
    const out = applyRepeatCitationRules(cells);
    expect(extractCitationOnly(out[1].output!)).toMatch(/^שם/);
    expect(out[0].output).toBe(cells[0].output);
  });
});

describe("stripPresentationWarnings (copy/export hygiene)", () => {
  const withWarning = [
    'אזכור שנערך ידנית בבדיקה — הערה 1.',
    "",
    "[חסר: מחבר] \"Constitutional or ethnocultural?\" ipex.eu ([חסר: תאריך]) https://ipex.eu/x.pdf.",
    "⚠️ חסרים פרטים לפי כלל 34.2. אנא השלם אותם.",
  ].join("\n");

  it("excludes ⚠️ warning lines from copied text", () => {
    const out = stripPresentationWarnings(extractCitationOnly(withWarning));
    expect(out).not.toContain("⚠️");
    expect(out).not.toContain("חסרים פרטים");
  });

  it("keeps actual citation content and [חסר:...] citation fields", () => {
    const out = stripPresentationWarnings(extractCitationOnly(withWarning));
    expect(out).toContain("אזכור שנערך ידנית בבדיקה");
    expect(out).toContain("[חסר: מחבר]");
    expect(out).toContain("[חסר: תאריך]");
    expect(out).toContain("https://ipex.eu/x.pdf");
  });

  it("strips warnings even when a [חסר:] field appears on the warning line", () => {
    const text = "ע\"א 123/45 כהן נ' לוי, פ\"ד נב(1) 1.\n⚠️ חסרים פרטים: [חסר: שנה]";
    const out = stripPresentationWarnings(text);
    expect(out).toBe('ע"א 123/45 כהן נ\' לוי, פ"ד נב(1) 1.');
  });

  it("returns plain citation unchanged when no warnings exist", () => {
    const text = 'ע"א 123/45 כהן נ\' לוי, פ"ד נב(1) 1 (2020).';
    expect(stripPresentationWarnings(text)).toBe(text);
  });
});
