import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { CommitTracker } from "../../supabase/functions/legal-research-v2/agent/commitPolicy";
import {
  AGENT_SYSTEM_PROMPT,
  buildAgentUserMessage,
} from "../../supabase/functions/legal-research-v2/agent/prompt";
import type { Intake } from "../../supabase/functions/legal-research-v2/types";

const FN = "supabase/functions/legal-research-v2";

const base = {
  readable_count: 3,
  obligations_total: 0,
  obligations_satisfied: 0,
  stale_streak: 0,
  research_steps_left: 20,
};

function intakeFor(question: string): Intake {
  return {
    question,
    normalized_question: question,
    docket_obligations: [],
    statute_obligations: [],
    attachment_text: null,
    budgets: { max_agent_steps: 30, max_search_calls: 8, max_fetch_calls: 12, max_lookup_calls: 6 },
  } as unknown as Intake;
}

describe("no deterministic deliverable classifier remains", () => {
  it("has no classifier module or symbols in the V2 production path", () => {
    const files = [
      `${FN}/index.ts`,
      `${FN}/types.ts`,
      `${FN}/agent/prompt.ts`,
      `${FN}/agent/commitPolicy.ts`,
      `${FN}/agent/researchAgent.ts`,
      `${FN}/agent/contextWindow.ts`,
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/classifyDeliverable|DEVELOPED_CUES|DeliverableKind/);
      expect(src).not.toMatch(/deliverable\s*===/);
    }
  });

  it("does not react to academic trigger words in the agent message", () => {
    const seminar = buildAgentUserMessage(
      intakeFor("אני כותב סמינריון ורק צריך לדעת מה קובע סעיף 12 לחוק החוזים (חלק כללי)."),
    );
    const review = buildAgentUserMessage(intakeFor("תעשה לי סקירת ספרות על עילת הסבירות"));
    const narrow = buildAgentUserMessage(intakeFor("מה קובע סעיף 12 לחוק החוזים (חלק כללי)?"));
    const strip = (s: string, q: string) => s.replace(q, "");
    expect(strip(seminar, "אני כותב סמינריון ורק צריך לדעת מה קובע סעיף 12 לחוק החוזים (חלק כללי).")).toBe(
      strip(narrow, "מה קובע סעיף 12 לחוק החוזים (חלק כללי)?"),
    );
    expect(strip(review, "תעשה לי סקירת ספרות על עילת הסבירות")).toBe(
      strip(narrow, "מה קובע סעיף 12 לחוק החוזים (חלק כללי)?"),
    );
    for (const m of [seminar, review, narrow]) {
      expect(m).not.toMatch(/תוצר מחקרי מפותח|תשובה ממוקדת לשאלה משפטית מוגדרת/);
    }
  });
});

describe("the research agent owns research scope", () => {
  it("states ownership, semantic depth, reassessment and ceiling-not-target", () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/הבעלים של היקף המחקר/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/לא ממילות מפתח/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/העריך מחדש את המספיקות/);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/תקרות בטיחות, לא יעדים/);
  });

  it("gives the same scope-assessment instruction to every request", () => {
    expect(buildAgentUserMessage(intakeFor("שאלה כלשהי"))).toMatch(/העריך בעצמך את היקף המחקר/);
  });
});

describe("commit policy is label-free", () => {
  it("issues one universal early reminder that count is not sufficiency", () => {
    const d = new CommitTracker().directive({ ...base });
    expect(d?.kind).toBe("early_commit");
    expect(d?.text).toMatch(/אינו מעיד על מספיקות/);
  });

  it("named-authority readiness asks to reassess the whole request", () => {
    const d = new CommitTracker().directive({
      ...base,
      readable_count: 1,
      obligations_total: 1,
      obligations_satisfied: 1,
    });
    expect(d?.kind).toBe("named_authority_ready");
    expect(d?.text).toMatch(/בחן מחדש את בקשת המשתמש במלואה/);
  });

  it("keeps the hard mandatory commit at the end of the research budget", () => {
    const d = new CommitTracker().directive({ ...base, research_steps_left: 0 });
    expect(d?.kind).toBe("mandatory_commit");
  });
});
