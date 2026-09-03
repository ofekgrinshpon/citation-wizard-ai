import { describe, expect, it } from "vitest";
import {
  calibrateNonAcademicCategory,
  consolidateLimitationNotes,
  detectStatutoryTarget,
  evaluateAreaEquivalence,
  unrelatedCompoundCompanions,
} from "../../supabase/functions/legal-research-v1/stages/nonAcademicBinding.ts";

describe("evaluateAreaEquivalence", () => {
  it("allows public-law adjacency when doctrine terms overlap", () => {
    const r = evaluateAreaEquivalence({
      claim_id: "C1",
      block_area: "constitutional",
      source_area: "public_law_hcj",
      block_text: "מבחן המידתיות והביקורת השיפוטית על החלטה מינהלית",
      source_text: "בג\"ץ — ביקורת שיפוטית ומידתיות בהחלטת רשות מינהלית",
    });
    expect(r.equivalence_applied).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.doctrine_terms_overlap.length).toBeGreaterThan(0);
  });

  it("blocks adjacency without doctrine overlap", () => {
    const r = evaluateAreaEquivalence({
      claim_id: "C1",
      block_area: "constitutional",
      source_area: "public_law_hcj",
      block_text: "רקע כללי",
      source_text: "החלטה בעניין אגרות",
    });
    expect(r.equivalence_applied).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it("never crosses unrelated families", () => {
    const r = evaluateAreaEquivalence({
      claim_id: "C1",
      block_area: "contracts",
      source_area: "public_law_hcj",
      block_text: "מידתיות וביקורת שיפוטית",
      source_text: "מידתיות וביקורת שיפוטית",
    });
    expect(r.equivalence_applied).toBe(false);
    expect(r.reason).toBe("areas_not_adjacent");
  });
});

describe("calibrateNonAcademicCategory", () => {
  it("downgrades a generic doctrine paragraph away from court_holding", () => {
    const r = calibrateNonAcademicCategory({
      block_id: "b1",
      category: "court_holding",
      basis: "proposition_type_application",
      text: "ככלל, בית המשפט נוטה לריסון בשיקול דעת מקצועי של הרשות.",
    });
    expect(r.category).toBe("doctrinal_synthesis");
    expect(r.row?.reason).toContain("generic_doctrine_paragraph");
  });

  it("keeps court_holding when a docket is named", () => {
    const r = calibrateNonAcademicCategory({
      block_id: "b1",
      category: "court_holding",
      basis: "proposition_type_application",
      text: "בבג\"ץ 1234/20 נקבע כי הרשות חרגה מסמכותה.",
    });
    expect(r.category).toBe("court_holding");
    expect(r.row).toBeNull();
  });

  it("never touches escalated categories", () => {
    const r = calibrateNonAcademicCategory({
      block_id: "b1",
      category: "statutory",
      basis: "x+binding_language_escalation",
      text: "החוק קובע",
    });
    expect(r.row).toBeNull();
  });
});

describe("detectStatutoryTarget", () => {
  it("detects a Basic Law target", () => {
    const r = detectStatutoryTarget("מה אומר חוק-יסוד: כבוד האדם וחירותו לגבי פגיעה בזכויות?");
    expect(r.detected).toBe(true);
    expect(r.statute_title).toContain("כבוד האדם");
  });

  it("detects a named statute with section", () => {
    const r = detectStatutoryTarget("מה קובע סעיף 14 לחוק החוזים על טעות?");
    expect(r.detected).toBe(true);
    expect(r.statute_section).toBe("14");
  });

  it("returns nothing for a doctrinal question", () => {
    expect(detectStatutoryTarget("מה ההלכה לגבי מבחן המידתיות?").detected).toBe(false);
  });
});

describe("unrelatedCompoundCompanions", () => {
  it("prunes a companion with no shared subject tokens", () => {
    const out = unrelatedCompoundCompanions([
      { title: "מידתיות חוקתית, סבירות מנהלית" },
      { title: "חופש הביטוי בתקשורת המקוונת" },
    ]);
    expect(out.length).toBe(1);
  });

  it("keeps a related companion", () => {
    const out = unrelatedCompoundCompanions([
      { title: "מבחן המידתיות בפסיקה" },
      { title: "המידתיות כעיקרון חוקתי" },
    ]);
    expect(out.length).toBe(0);
  });
});

describe("consolidateLimitationNotes", () => {
  it("merges stacked notices into one", () => {
    const r = consolidateLimitationNotes({
      question_id: "answer",
      parts: [
        "\n\n**היקף התשובה:** התשובה מבוססת על ספרות.",
        "\n\n**מגבלת ביסוס:** חלק מהקביעות נותרו ללא מקור.\n\nהערה על היקף המקורות: לא אותר פסק דין.",
      ],
      primary_cited: false,
      no_direct_caselaw: true,
    });
    expect(r.report.notes_after).toBe(1);
    expect(r.report.reduced).toBe(true);
    expect((r.text.match(/מגבלת ביסוס/g) ?? []).length).toBe(1);
    expect(r.text).not.toContain("הערה על היקף המקורות");
  });

  it("emits nothing when there is no limitation", () => {
    const r = consolidateLimitationNotes({
      question_id: "answer",
      parts: ["", ""],
      primary_cited: true,
      no_direct_caselaw: false,
    });
    expect(r.text).toBe("");
    expect(r.report.limitation_type).toBe("none");
  });
});
