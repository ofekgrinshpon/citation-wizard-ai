import { describe, it, expect } from "vitest";
import { applyRepeatCitationRules } from "@/lib/footnoteRepeatRules";

describe("Rule 37 repeats for foreign sources (M1)", () => {
  it("a repeated foreign citation uses the Israeli repeat form, never Id./supra", () => {
    const first = "##Brown v. Board of Education##, 347 U.S. 483 (1954).";
    const out = applyRepeatCitationRules([
      { id: 1, citation: first },
      { id: 2, citation: first },
    ] as never);
    const texts = (out as { citation: string }[]).map((c) => c.citation).join("\n");
    expect(texts).not.toMatch(/\bId\./);
    expect(texts).not.toMatch(/\bsupra\b/i);
    expect(texts).not.toMatch(/\binfra\b/i);
  });
});
