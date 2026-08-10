// Rule-15 Knesset term regression coverage.
//
// Failure mode: "החלטת הררי" (13.6.1950) was rendered as a decision of
// "הכנסת ה-12". 13.6.1950 falls in the First Knesset; the ordinal was
// invented by the drafting model with no grounded source.

import { describe, expect, it } from "vitest";
import {
  KNESSET_TERMS,
  isProvisionalCouncilDate,
  knessetLabel,
  knessetTermForDate,
  normalizeKnessetTerm,
  parseDecisionDate,
} from "../../supabase/functions/_shared/knessetTerms.ts";

describe("knessetTermForDate", () => {
  it("maps the Harari decision date to the First Knesset", () => {
    expect(knessetTermForDate("13.6.1950")).toBe(1);
  });

  it("resolves every term boundary to the correct ordinal", () => {
    for (const t of KNESSET_TERMS) {
      // Swearing-in day belongs to the new Knesset.
      const [y, m, d] = t.start.split("-");
      expect(knessetTermForDate(`${Number(d)}.${Number(m)}.${y}`)).toBe(t.ordinal);
      if (t.end) {
        // Day before the next term still belongs to this one.
        const prev = new Date(`${t.end}T00:00:00Z`);
        prev.setUTCDate(prev.getUTCDate() - 1);
        const label = `${prev.getUTCDate()}.${prev.getUTCMonth() + 1}.${prev.getUTCFullYear()}`;
        expect(knessetTermForDate(label)).toBe(t.ordinal);
      }
    }
  });

  it("returns null before the First Knesset and for unparsable input", () => {
    expect(knessetTermForDate("1.1.1948")).toBeNull();
    expect(knessetTermForDate("")).toBeNull();
    expect(knessetTermForDate("ללא תאריך")).toBeNull();
    expect(knessetTermForDate("13.6.50")).toBeNull();
  });

  it("identifies the Provisional State Council period", () => {
    expect(isProvisionalCouncilDate("1.1.1949")).toBe(true);
    expect(isProvisionalCouncilDate("13.6.1950")).toBe(false);
  });

  it("parses slash and dash separated dates", () => {
    expect(parseDecisionDate("13/6/1950")).toBe("1950-06-13");
    expect(parseDecisionDate("13-6-1950")).toBe("1950-06-13");
  });
});

describe("normalizeKnessetTerm", () => {
  it("corrects the fabricated Harari term", () => {
    const line = '"החלטת הררי" (החלטה של הכנסת ה-12, 13.6.1950).';
    const r = normalizeKnessetTerm(line);
    expect(r.action).toBe("corrected");
    expect(r.claimed).toBe(12);
    expect(r.resolved).toBe(1);
    expect(r.text).toContain("הכנסת ה-1");
    expect(r.text).not.toContain("ה-12");
  });

  it("leaves a correct term untouched", () => {
    const line = "החלטה של הכנסת ה-13 בעניין כלשהו (1.1.1994).";
    const r = normalizeKnessetTerm(line);
    expect(r.action).toBe("none");
    expect(r.text).toBe(line);
  });

  it("strips an ordinal that no date anchors", () => {
    const line = "החלטה של הכנסת ה-12 בעניין כלשהו.";
    const r = normalizeKnessetTerm(line);
    expect(r.action).toBe("stripped");
    expect(r.text).not.toMatch(/ה[־-]?\s*12/);
    expect(r.text).toContain("הכנסת");
  });

  it("handles Hebrew-word ordinals and the maqaf variant", () => {
    const numeric = normalizeKnessetTerm("החלטה של הכנסת ה־12 (13.6.1950).");
    expect(numeric.action).toBe("corrected");
    expect(numeric.resolved).toBe(1);

    const hebrew = normalizeKnessetTerm("החלטה של הכנסת השלישית (13.6.1950).");
    expect(hebrew.action).toBe("corrected");
    expect(hebrew.text).toContain("הכנסת הראשונה");
  });

  it("ignores lines with no Knesset term", () => {
    const line = 'ע"א 6821/93 בנק המזרחי נ\' מגדל.';
    expect(normalizeKnessetTerm(line).action).toBe("none");
  });

  it("renders labels in both styles", () => {
    expect(knessetLabel(1)).toBe("הכנסת ה-1");
    expect(knessetLabel(1, "hebrew")).toBe("הכנסת הראשונה");
    expect(knessetLabel(25, "hebrew")).toBe("הכנסת ה-25");
  });
});
