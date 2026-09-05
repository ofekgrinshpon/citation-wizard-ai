import { describe, expect, it } from "vitest";
import { mapDoctrine } from "../../supabase/functions/legal-research-v1/stages/coreAuthorityRegistry.ts";

// deno-lint-ignore no-explicit-any
const analyzer = (claims: string[] = []): any => ({
  legal_area: "public_law_hcj",
  claims: claims.map((text_he, i) => ({ claim_id: `c${i}`, text_he })),
});

describe("academic_richness_last_mile_and_doctrine_mapping_v1 — doctrine mapping", () => {
  it("maps a reasonableness chapter to reasonableness even when מידתיות is mentioned", () => {
    const q =
      "כתוב פרק רקע תיאורטי בנושא עילת הסבירות והביקורת השיפוטית על שיקול דעת מנהלי בישראל, " +
      "ומה היחס בין סבירות, מידתיות ושיקול דעת מקצועי";
    const r = mapDoctrine(q, analyzer(), []);
    expect(r.decision.primary_doctrine).toBe("reasonableness");
    expect(r.decision.secondary_doctrines).toContain("proportionality");
  });

  it("maps administrative promise / legitimate expectation to its own family", () => {
    const q =
      "כתוב פרק בנושא ההבטחה המנהלית והציפייה הלגיטימית במשפט המנהלי הישראלי, " +
      "ומה ההבחנה בין הבטחה מנהלית, הסתמכות וציפייה לגיטימית";
    const r = mapDoctrine(q, analyzer(), []);
    expect(r.decision.primary_doctrine).toBe("administrative_promise");
    expect(r.decision.rejected_doctrines).not.toContain("administrative_promise");
    expect(r.primary?.canonical_authorities.map((a) => a.docket)).toContain("135/75");
  });

  it("keeps a proportionality question on proportionality", () => {
    const q =
      "מהם מבחני המידתיות בפסקת ההגבלה ומהו מבחן האמצעי שפגיעתו פחותה לפי חוק-יסוד: כבוד האדם וחירותו?";
    const r = mapDoctrine(q, analyzer(), []);
    expect(r.decision.primary_doctrine).toBe("proportionality");
  });

  it("does not route to a doctrine raised only by facet expansion", () => {
    const q = "מהי חלוקת רכוש בין בני זוג לאחר גירושין?";
    const facets = [
      { doctrinal_label: "מידתיות", query_terms: ["מידתיות"] },
      // deno-lint-ignore no-explicit-any
    ] as any;
    const r = mapDoctrine(q, analyzer(), facets);
    expect(r.decision.primary_doctrine).not.toBe("proportionality");
  });
});
