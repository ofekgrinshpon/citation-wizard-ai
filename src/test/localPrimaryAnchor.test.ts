import { describe, expect, it } from "vitest";
import {
  isLocalJudgmentTierAcceptable,
  locateStatuteSection,
  normalizeDocketForLocal,
  normalizeStatuteTitleForMatch,
  scoreLocalStatuteMatch,
  statuteMatchTokens,
  statuteTitleVariants,
} from "../../supabase/functions/legal-research-v1/stages/localPrimaryAnchor.ts";
import { cleanLawClue } from "../../supabase/functions/legal-research-v1/stages/localRetrieval.ts";

const BASIC_LAW_BODY =
  "אין פוגעים בזכויות שלפי חוק־יסוד זה אלא בחוק ההולם את ערכיה של מדינת ישראל, שנועד לתכלית ראויה, ובמידה שאינה עולה על הנדרש. ".repeat(
    12,
  );

describe("statute title normalization", () => {
  it("collapses Basic Law head spellings", () => {
    const forms = [
      "חוק-יסוד: כבוד האדם וחירותו",
      "חוק יסוד כבוד האדם וחירותו",
      "חוק־יסוד: כבוד האדם וחירותו",
      'סעיף 8 לחוק-יסוד: כבוד האדם וחירותו, התשנ"ב-1992',
    ];
    const normalized = forms.map(normalizeStatuteTitleForMatch);
    for (const n of normalized) expect(n).toContain("כבוד האדם וחירותו");
    expect(new Set(normalized).size).toBe(1);
  });

  it("produces variants and distinctive tokens", () => {
    expect(statuteTitleVariants("חוק-יסוד: כבוד האדם וחירותו").length).toBeGreaterThan(1);
    expect(statuteMatchTokens("חוק בתי המשפט")).toContain("בתי");
    expect(statuteMatchTokens("חוק החוזים (חלק כללי)")).toContain("החוזים");
  });

  it("scores exact and partial matches", () => {
    expect(scoreLocalStatuteMatch("חוק-יסוד: כבוד האדם וחירותו", "חוק יסוד כבוד האדם וחירותו")).toBe(1);
    expect(scoreLocalStatuteMatch("חוק העונשין", "חוק-יסוד: כבוד האדם וחירותו")).toBeLessThan(0.5);
  });
});

describe("law clue extraction", () => {
  it("no longer truncates bare law names to two characters", () => {
    expect(cleanLawClue("חוק-יסוד: כבוד האדם וחירותו")).toBe("חוק-יסוד: כבוד האדם וחירותו");
    expect(cleanLawClue("חוק בתי המשפט ל")).toBe("חוק בתי המשפט");
    expect(cleanLawClue("חוק החוזים (חלק כללי),")).toBe("חוק החוזים (חלק כללי)");
  });
});

describe("section location", () => {
  it("does not claim exact section support on a section-less body", () => {
    const loc = locateStatuteSection(BASIC_LAW_BODY, "8", { exact_title_match: true });
    expect(loc.section_located).toBe(false);
    expect(loc.allowed_claim_scope).toBe("general_statutory_framework");
    expect(loc.whole_statute_fallback_used).toBe(true);
    expect(loc.limitation_note).toBeTruthy();
  });

  it("locates a section when a qualified marker exists", () => {
    const loc = locateStatuteSection(`${BASIC_LAW_BODY}\nסעיף 8 לחוק קובע כי...`, "8", {
      exact_title_match: true,
    });
    expect(loc.section_located).toBe(true);
    expect(loc.allowed_claim_scope).toBe("exact_section");
  });

  it("rejects bodies below the substantive floor", () => {
    const loc = locateStatuteSection("קצר מדי", "8", { exact_title_match: true });
    expect(loc.allowed_claim_scope).toBe("none");
    expect(loc.text).toBe("");
  });
});

describe("judgment helpers", () => {
  it("normalizes dockets", () => {
    expect(normalizeDocketForLocal('בג"ץ 848/95')).toBe("848/95");
    expect(normalizeDocketForLocal("ללא מספר")).toBeNull();
  });

  it("gates non-primary tiers", () => {
    expect(isLocalJudgmentTierAcceptable("official_court")).toBe(true);
    expect(isLocalJudgmentTierAcceptable("blog")).toBe(false);
  });
});
