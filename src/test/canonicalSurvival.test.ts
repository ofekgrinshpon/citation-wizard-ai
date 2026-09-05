import { describe, expect, it } from "vitest";
import { identityTokens } from "../../supabase/functions/legal-research-v1/stages/claimSourceMatch.ts";

describe("canonical_body_acquisition_and_csm_survival_v1 — identity tokens", () => {
  it("extracts the docket and distinctive Hebrew party tokens", () => {
    const t = identityTokens({ title: 'בג"ץ 389/80 דפי זהב בע"מ נ\' רשות השידור' });
    expect(t).toContain("389/80");
    expect(t.some((x) => x.includes("השידור"))).toBe(true);
  });

  it("returns tokens for a scholarly work without a docket", () => {
    const t = identityTokens({ title: "אהרן ברק, שיקול דעת שיפוטי (הפרקליט)" });
    expect(t.length).toBeGreaterThan(0);
    expect(t.every((x) => x.length >= 5)).toBe(true);
  });

  it("returns nothing for an empty title", () => {
    expect(identityTokens({})).toEqual([]);
  });
});
