// academic_drafter_prompt_conflict_cleanup_v1 — prompt gating fixtures.
import { describe, expect, it } from "vitest";
import {
  ACADEMIC_BOTTOM_LINE_RULE_HE,
  applyAcademicPromptCleanup,
} from "../../supabase/functions/legal-research-v1/stages/academicPromptCleanup.ts";

const PROMPT = [
  "אתה משפטן/ית ישראלי/ת הכותב/ת מענה משפטי־מחקרי.",
  "אין לכלול בתשובה ביטויים שבורים או מומצאים כגון: בשן טוב, פוקודה.",
  "חיזוק איכות לשונית — עברית משפטית נקייה, שמות רשמיים:\n- אל תמציא מילים.",
  'חוזה ראיות וכיול ודאות (חובה):\n- "מן המקורות עולה בזהירות כי"\n- "אין במקורות שאותרו כדי לבסס מסקנה נחרצת"',
  'סגנון עברי משפטי נקי (חובה):\n- אל תכתוב "פוקודה".',
  "חדות משפטית (כללי ניסוח מחייבים):\n1. שורה תחתונה בפתיחה.\n3. השתמש ב\"נקבע כי\", \"הסעיף קובע כי\".",
  "זכור: אם תכניס סימן עילי כלשהו לתוך text, התשובה תיפסל.",
].join("\n\n");

describe("applyAcademicPromptCleanup", () => {
  it("matches every gate against the real prompt shape", () => {
    const r = applyAcademicPromptCleanup(PROMPT, "introduction");
    expect(r.report.unmatched_gates).toEqual([]);
  });

  it("removes the retrieval-process hedge mandate", () => {
    const { prompt, report } = applyAcademicPromptCleanup(PROMPT, "introduction");
    expect(prompt).not.toContain("מן המקורות עולה בזהירות כי");
    expect(prompt).not.toContain("אין במקורות שאותרו כדי לבסס מסקנה נחרצת");
    expect(prompt).toContain("ניתן לטעון");
    expect(report.academic_hedge_contract_disabled).toBe(true);
  });

  it("removes the broken-Hebrew blacklists and their examples", () => {
    const { prompt, report } = applyAcademicPromptCleanup(PROMPT, "theoretical_background");
    expect(prompt).not.toContain("בשן טוב");
    expect(prompt).not.toContain("פוקודה");
    expect(prompt).toContain("שמרנית ובהירה");
    expect(report.blacklist_blocks_disabled).toBe(3);
  });

  it("drops the bottom-line rule for prose genres", () => {
    for (const g of ["introduction", "theoretical_background", "topic_presentation", "generic_academic"] as const) {
      const { prompt, report } = applyAcademicPromptCleanup(PROMPT, g);
      expect(prompt).not.toContain(ACADEMIC_BOTTOM_LINE_RULE_HE);
      expect(prompt).not.toContain("שורה תחתונה בפתיחה");
      expect(report.bottom_line_rule_disabled).toBe(true);
    }
  });

  it("keeps the bottom-line rule for non-prose academic genres", () => {
    const { prompt, report } = applyAcademicPromptCleanup(PROMPT, "chapter_outline");
    expect(prompt).toContain(ACADEMIC_BOTTOM_LINE_RULE_HE);
    expect(report.bottom_line_rule_disabled).toBe(false);
  });

  it("removes the canned attribution formulas", () => {
    const { prompt } = applyAcademicPromptCleanup(PROMPT, "introduction");
    expect(prompt).not.toContain("הסעיף קובע כי");
    expect(prompt).toContain("אין תבנית ייחוס קבועה");
  });

  it("preserves unrelated prompt paragraphs", () => {
    const { prompt } = applyAcademicPromptCleanup(PROMPT, "introduction");
    expect(prompt).toContain("סימן עילי");
    expect(prompt).toContain("מענה משפטי־מחקרי");
  });

  it("reports unmatched gates when the prompt drifts", () => {
    const r = applyAcademicPromptCleanup("פסקה אחת בלבד.", "introduction");
    expect(r.report.unmatched_gates.length).toBe(5);
  });
});
