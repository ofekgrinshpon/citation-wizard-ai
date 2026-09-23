import { describe, it, expect } from "vitest";
import { applyRepeatCitationRules } from "@/lib/footnoteRepeatRules";

const FULL = "##Brown v. Board of Education##, 347 U.S. 483 (1954).";

describe("Rule 37 repeats for foreign sources (M1)", () => {
  it("repeated foreign citations keep the Israeli repeat form — never Id./supra/infra", () => {
    const out = applyRepeatCitationRules([
      { id: 1, input: "Brown v. Board of Education, 347 U.S. 483 (1954)", output: FULL },
      { id: 2, input: "Brown v. Board of Education, 347 U.S. 483 (1954)", output: FULL },
      { id: 3, input: "חוק העונשין", output: 'חוק העונשין, התשל"ז-1977.' },
      { id: 4, input: "Brown v. Board of Education, בעמ' 490", output: FULL },
    ]);
    const texts = out.map((c) => c.output ?? "").join("\n");
    expect(texts).not.toMatch(/\bId\./);
    expect(texts).not.toMatch(/\bsupra\b/i);
    expect(texts).not.toMatch(/\binfra\b/i);
    // The immediate repeat still uses the Israeli "שם" form.
    expect(out[1].output).toMatch(/שם/);
  });
});
