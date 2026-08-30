// academic_writing_intent_and_drafting_v1 — Stage 1 deterministic fixtures.
import { describe, expect, it } from "vitest";
import {
  detectAcademicWritingRequest,
  isAcademicWritingTask,
  planRequestsAcademicWriting,
  planSourceUseIntent,
} from "../../supabase/functions/legal-research-v1/stages/sourceUseIntent.ts";

const plan = (q: string) => planSourceUseIntent(q, null);

describe("detectAcademicWritingRequest", () => {
  it("detects an introduction-chapter request", () => {
    const d = detectAcademicWritingRequest(
      "כתוב פרק מבוא לסמינריון שלי ששאלת המחקר שלו היא: האם הסעד החוקתי של קריאה לתוך החוק חורג מסמכות הרשות השופטת ומפר את עקרון הפרדת הרשויות?",
    );
    expect(d).not.toBeNull();
    expect(d?.genre).toBe("introduction");
  });

  it("detects a theoretical-background chapter request", () => {
    const d = detectAcademicWritingRequest("כתוב פרק רקע תיאורטי לעבודה שלי על מבחני המידתיות");
    expect(d?.genre).toBe("theoretical_background");
  });

  it("detects an argument-paragraph request", () => {
    expect(detectAcademicWritingRequest("כתוב פסקת טיעון בעד יישום המידתיות")?.genre).toBe(
      "argument_paragraph",
    );
  });

  it("detects a chapter-outline request", () => {
    expect(
      detectAcademicWritingRequest("כתוב מתווה פרקים לסמינריון על הסעד החוקתי")?.genre,
    ).toBe("chapter_outline");
  });

  it("suppresses explicitly source-seeking requests", () => {
    expect(detectAcademicWritingRequest("תן לי מקורות לסמינריון על עילת הסבירות")).toBeNull();
    expect(detectAcademicWritingRequest("מצא פסיקה על ההבטחה המנהלית")).toBeNull();
  });

  it("ignores ordinary legal questions", () => {
    expect(detectAcademicWritingRequest("מה הדין לגבי פיטורי עובדת בהיריון?")).toBeNull();
    expect(detectAcademicWritingRequest("מהי דוקטרינת ההבטחה המנהלית?")).toBeNull();
  });
});

describe("planSourceUseIntent — academic writing override", () => {
  it("forces academic_writing / draft_academic_text for an intro request", () => {
    const p = plan(
      "כתוב פרק מבוא לסמינריון שלי ששאלת המחקר שלו היא: האם הסעד החוקתי של קריאה לתוך החוק חורג מסמכות הרשות השופטת?",
    ).plan;
    expect(p.user_task_intent).toBe("academic_writing");
    expect(p.answer_strategy).toBe("draft_academic_text");
    expect(p.academic_genre).toBe("introduction");
    expect(p.authority_requirements.secondary_sources_can_support).toBe(true);
    expect(p.authority_requirements.found_only_can_support_claims).toBe(false);
    expect(p.authority_requirements.found_only_allowed_as_reading_list).toBe(false);
  });

  it("records the override in telemetry", () => {
    const r = plan("כתוב פרק רקע תיאורטי לעבודה שלי על מבחני המידתיות");
    expect(r.overrides).toContain("academic_writing_intent_detected");
    expect(isAcademicWritingTask(r.plan.user_task_intent)).toBe(true);
    expect(planRequestsAcademicWriting(r.plan)).toBe(true);
  });

  it("does not override source-seeking requests", () => {
    const p = plan("תן לי מקורות לסמינריון על עילת הסבירות").plan;
    expect(p.user_task_intent).not.toBe("academic_writing");
  });

  it("does not override ordinary doctrinal questions", () => {
    const p = plan("מה הדין לגבי פיטורי עובדת בהיריון, ומהו היקף ההגנה?").plan;
    expect(p.user_task_intent).toBe("doctrinal_explanation");
  });

  it("keeps case-safety priority when a docket is present", () => {
    const r = plan("סכם את בג״ץ 6821/93 בנק המזרחי המאוחד נ׳ מגדל כפר שיתופי");
    expect(r.explicit_docket_detected).toBe(true);
    expect(r.plan.user_task_intent).not.toBe("academic_writing");
    expect(r.plan.authority_requirements.requires_judgment_body).toBe(true);
  });

  it("routes academic writing to the secondary intent when a docket is present", () => {
    const p = plan(
      "כתוב פרק מבוא לסמינריון שלי על בג״ץ 6821/93 בנק המזרחי המאוחד נ׳ מגדל כפר שיתופי",
    ).plan;
    expect(p.user_task_intent).not.toBe("academic_writing");
    expect(p.authority_requirements.requires_judgment_body).toBe(true);
    expect(p.mixed_plan).toBe(true);
    expect(p.secondary_task_intent).toBe("academic_writing");
    expect(planRequestsAcademicWriting(p)).toBe(true);
  });
});
