import { describe, it, expect } from "vitest";
import { buildCitationInput } from "@/components/legal-research/UniformCitationPanel";
import { applyRepeatCitationRules, extractCitationOnly } from "@/lib/footnoteRepeatRules";

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
