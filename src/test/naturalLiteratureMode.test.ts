// natural_literature_mode_and_topic_guard_v1 — deterministic fixtures.
import { describe, expect, it } from "vitest";
import {
  assessCenterOfGravity,
  buildCenterOfGravityDirectives,
  buildUnusedLiteraturePackTelemetry,
  detectNaturalLiteratureMode,
} from "../../supabase/functions/legal-research-v1/stages/naturalLiteratureMode.ts";
import { guardFacetAgainstQuestion } from "../../supabase/functions/legal-research-v1/stages/claimFacetExpansion.ts";

const activate = (q: string, intent: string | null = null) =>
  detectNaturalLiteratureMode({
    run_id: "r",
    question: q,
    user_task_intent: intent,
    answer_strategy: null,
    mode_before: false,
  });

describe("natural literature-mode activation", () => {
  it("activates on natural literature-review prompts", () => {
    for (
      const q of [
        "תעשה לי סקירת ספרות על עילת הסבירות",
        "תעשה לי סקירת ספרות על היחס בין מידתיות לסבירות במשפט הישראלי",
        "תכתוב לי רקע תיאורטי לסמינריון על עילת הסבירות והביקורת עליה",
        "תעזור לי לבנות פרק סקירת ספרות על הסתמכות מול רשות מנהלית",
        "תכתוב לי סקירת ספרות לסמינריון על הבטחה מנהלית וציפייה לגיטימית",
      ]
    ) {
      const r = activate(q);
      expect(r.academic_literature_mode_after, q).toBe(true);
      expect(r.activation_signals.length).toBeGreaterThan(0);
    }
  });

  it("activates from planner intent / strategy alone", () => {
    expect(activate("מהי עילת הסבירות?", "literature_map").academic_literature_mode_after).toBe(
      true,
    );
    expect(
      detectNaturalLiteratureMode({
        run_id: "r",
        question: "מהי עילת הסבירות?",
        answer_strategy: "map_literature",
        mode_before: false,
      }).academic_literature_mode_after,
    ).toBe(true);
  });

  it("does not activate on ordinary legal questions", () => {
    const r = activate("מה הדין לגבי פיטורי עובדת בהיריון?");
    expect(r.academic_literature_mode_after).toBe(false);
  });

  it("keeps case law and statutes allowed unless the user excludes them", () => {
    const open = activate("תעשה לי סקירת ספרות על עילת הסבירות");
    expect(open.case_law_allowed_as_context).toBe(true);
    expect(open.statutes_allowed_as_context).toBe(true);
    const closed = activate("תעשה לי סקירת ספרות על עילת הסבירות, ספרות בלבד בלי פסיקה");
    expect(closed.explicit_exclusion_of_case_law_or_statutes).toBe(true);
    expect(closed.case_law_allowed_as_context).toBe(false);
  });
});

describe("facet contamination guard", () => {
  const q = "תעשה לי סקירת ספרות על היחס בין מידתיות לסבירות במשפט הישראלי";

  it("rejects rabbinical-court facets on a proportionality question", () => {
    for (
      const [label, query] of [
        ["עילת ההתערבות של בג\"ץ בבית דין דתי", "ביקורת שיפוטית של בג\"ץ על בתי דין דתיים"],
        ["תחולת הדין האזרחי על בית הדין הרבני", "החלת הדין האזרחי בבית הדין הרבני"],
        ["איזון משאבים וחלוקת רכוש", "חוק יחסי ממון בין בני זוג איזון משאבים"],
      ]
    ) {
      const g = guardFacetAgainstQuestion({ question: q, facet_label: label, facet_query: query });
      expect(g.accepted, label).toBe(false);
      expect(g.rejection_reason, label).toBeTruthy();
    }
  });

  it("accepts on-topic facets", () => {
    const g = guardFacetAgainstQuestion({
      question: q,
      facet_label: "היחס בין סבירות למידתיות בביקורת מנהלית",
      facet_query: "מבחני המידתיות מול מבחן הסבירות במשפט המינהלי",
    });
    expect(g.accepted).toBe(true);
    expect(g.shared_key_terms.length).toBeGreaterThan(0);
  });

  it("keeps rabbinical facets when the prompt is actually about them", () => {
    const g = guardFacetAgainstQuestion({
      question: "מהי אמת המידה להתערבות בג\"ץ בהחלטת בית הדין הרבני בחלוקת רכוש?",
      facet_label: "עילת ההתערבות של בג\"ץ בבית דין דתי",
      facet_query: "התערבות בג\"ץ בפסיקת בית הדין הרבני חריגה מסמכות",
    });
    expect(g.accepted).toBe(true);
  });
});

describe("centre of gravity + unused pack telemetry", () => {
  it("flags primary law crowding out scholarship", () => {
    const r = assessCenterOfGravity("r", [
      { ref: "S1", title: "מאמר", kind: "direct_scholarship", cited: false },
      { ref: "S2", title: "פסק דין", kind: "case_law", cited: true },
    ]);
    expect(r.primary_law_crowded_out_scholarship).toBe(true);
    expect(r.final_cited_scholarship_sources).toBe(0);
  });

  it("flags adjacent scholarship used as direct", () => {
    const r = assessCenterOfGravity("r", [
      { ref: "S1", title: "ישיר", kind: "direct_scholarship", cited: false },
      { ref: "S2", title: "סמוך", kind: "adjacent_scholarship", cited: true },
    ]);
    expect(r.adjacent_source_used_as_direct).toBe(true);
  });

  it("declares an adjacent-only source base", () => {
    const lines = buildCenterOfGravityDirectives({
      direct_scholarship_in_pack: 0,
      adjacent_scholarship_in_pack: 2,
      primary_in_pack: 1,
    });
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("סמוכים");
  });

  it("reports uncited direct pack sources without changing behaviour", () => {
    const rows = buildUnusedLiteraturePackTelemetry("r", [{
      source_id: "c1",
      title: "מאמר ישיר",
      topicality: 0.4,
      body_available: true,
      verifier_usable: true,
      model_emitted: false,
      cited: false,
    }]);
    expect(rows[0].in_pack).toBe(true);
    expect(rows[0].omission_reason_if_available).toBe("silently_omitted_by_drafter");
  });
});
