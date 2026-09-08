import { describe, expect, it } from "vitest";

import { classifyDeliverable } from "../../supabase/functions/legal-research-v2/agent/deliverable";
import { CommitTracker } from "../../supabase/functions/legal-research-v2/agent/commitPolicy";
import { buildAgentUserMessage } from "../../supabase/functions/legal-research-v2/agent/prompt";
import type { Intake } from "../../supabase/functions/legal-research-v2/types";

const base = {
  readable_count: 3,
  obligations_total: 0,
  obligations_satisfied: 0,
  stale_streak: 0,
  research_steps_left: 20,
};

describe("deliverable classification", () => {
  it("marks academic / synthesis products as developed", () => {
    expect(
      classifyDeliverable(
        'כתוב פרק מבוא לסמינריון שלי ששאלת המחקר שלו כיצד זהות לאומית יכולה להיות אובייקט לקודיפיקציה? מבט השוואתי',
      ),
    ).toBe("developed");
    expect(classifyDeliverable("תעשה לי סקירת ספרות על עילת הסבירות")).toBe("developed");
  });

  it("keeps narrow authority questions focused", () => {
    expect(
      classifyDeliverable('מה נקבע בבג״ץ 1000/92 בבלי נ׳ בית הדין הרבני הגדול בסוגיית הדין החל על חלוקת רכוש בין בני זוג?'),
    ).toBe("focused");
    expect(classifyDeliverable("מהו העונש על סחיטה באיומים?")).toBe("focused");
  });
});

describe("early commit is deliverable-aware", () => {
  it("keeps the fast commit wording for focused questions", () => {
    const d = new CommitTracker().directive({ ...base, deliverable: "focused" });
    expect(d?.kind).toBe("early_commit");
    expect(d?.text).toMatch(/עשוי להספיק/);
  });

  it("asks a developed deliverable to judge depth instead of committing", () => {
    const d = new CommitTracker().directive({ ...base, deliverable: "developed" });
    expect(d?.kind).toBe("early_commit");
    expect(d?.text).toMatch(/אינו מעיד על מספיקות/);
    expect(d?.text).not.toMatch(/עשוי להספיק/);
  });
});

describe("agent user message states the requested deliverable", () => {
  const intake = {
    question: "תעשה לי סקירת ספרות על עילת הסבירות",
    docket_obligations: [],
    statute_obligations: [],
    attachment_text: null,
    deliverable: "developed",
    budgets: { max_agent_steps: 30, max_search_calls: 8, max_fetch_calls: 12, max_lookup_calls: 6 },
  } as unknown as Intake;

  it("describes a developed product", () => {
    expect(buildAgentUserMessage(intake)).toMatch(/תוצר מחקרי מפותח/);
  });

  it("describes a focused product", () => {
    expect(buildAgentUserMessage({ ...intake, deliverable: "focused" })).toMatch(/תשובה ממוקדת/);
  });
});
