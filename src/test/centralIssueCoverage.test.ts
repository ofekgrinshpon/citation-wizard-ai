/**
 * v2_central_issue_coverage_v1
 *
 * After verification narrows a memo, does the surviving verified pack still
 * answer the central question? Repair is a conservative exception, never a
 * consequence of a "core" label alone, and never of counts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { decideResearchRepair } from "../../supabase/functions/legal-research-v2/verification/repairPolicy";
import { assessCentralIssueCoverage } from "../../supabase/functions/legal-research-v2/verification/centralIssueCoverage";
import { buildCoverageRepairMessage } from "../../supabase/functions/legal-research-v2/agent/prompt";
import { StopPolicy } from "../../supabase/functions/legal-research-v2/agent/stopPolicy";
import type {
  RejectionReason,
  VerificationOutcome,
} from "../../supabase/functions/legal-research-v2/types";

type C = { id: string; text: string; core?: boolean };

function outcome(input: {
  verified: C[];
  unsupported: C[];
  reason?: RejectionReason;
}): VerificationOutcome {
  return {
    pack: {
      claims: input.verified.map((c) => ({
        claim_id: c.id,
        proposition: c.text,
        importance: (c.core === false ? "supporting" : "core") as "core" | "supporting",
        support_status: "supported" as const,
        sources: [],
      })),
      unsupported_claims: input.unsupported.map((c) => ({
        claim_id: c.id,
        proposition: c.text,
        importance: (c.core === false ? "supporting" : "core") as "core" | "supporting",
        reasons: [],
      })),
    },
    rejected: input.unsupported.map((c) => ({
      claim_id: c.id,
      source_id: "S1",
      reason: input.reason ?? "span_not_found",
      detail: "",
    })),
    counters: {
      total_evidence_pairs: 0,
      identity_verified_pairs: 0,
      span_verified_pairs: 0,
      support_verdicts: { supports: 0, supports_partially: 0, does_not_support: 0 },
    },
  };
}

const DOCTRINE_Q = "תסביר לי מהי הלכת הבוגדת ומהו הכלל המחייב שנקבע בה";

describe("A — peripheral unsupported claim", () => {
  it("does not repair when the verified pack still answers the question", () => {
    const d = decideResearchRepair(
      outcome({
        verified: [{
          id: "C1",
          text: "הלכת הבוגדת קובעת כלל מחייב שלפיו בת זוג המפרה אמון אינה מאבדת את זכויותיה הרכושיות",
        }],
        unsupported: [{ id: "C2", text: "ההליך נדון בהרכב מורחב בשנת אלפיים ותשע עשרה", core: false }],
      }),
      { question: DOCTRINE_Q },
    );
    expect(d.repair).toBe(false);
    expect(d.reason).toBe("no_unsupported_core_claims");
  });
});

describe("B — core claim rejected but redundant coverage exists", () => {
  it("does not repair when another verified claim covers the same central issue", () => {
    const d = decideResearchRepair(
      outcome({
        verified: [{
          id: "C1",
          text: "הכלל המחייב בהלכת הבוגדת הוא שבגידה אינה שוללת זכויות רכושיות של בן הזוג",
        }],
        unsupported: [{
          id: "C2",
          text: "הכלל המחייב בהלכת הבוגדת נוסח גם כך שבגידה אינה שוללת זכויות רכושיות",
        }],
      }),
      { question: DOCTRINE_Q },
    );
    expect(d.repair).toBe(false);
    expect(d.reason).toBe("narrowable_to_verified_propositions");
    expect(d.coverage?.central_issue_covered).toBe(true);
  });
});

describe("C — central rule missing, research-fixable", () => {
  it("requests one bounded repair", () => {
    const d = decideResearchRepair(
      outcome({
        verified: [
          { id: "C1", text: "העתירה הוגשה לבית המשפט העליון והדיון התקיים בפני שלושה שופטים" },
          { id: "C2", text: "ההליך נפתח בעקבות ערעור על החלטת ערכאה קודמת" },
        ],
        unsupported: [{
          id: "C3",
          text: "הכלל המחייב שנקבע בהלכת הבוגדת הוא שאין לשלול זכויות רכושיות בשל בגידה",
        }],
        reason: "span_not_found",
      }),
      { question: DOCTRINE_Q },
    );
    expect(d.repair).toBe(true);
    expect(d.reason).toBe("central_issue_not_covered_after_narrowing");
    expect(d.coverage?.lost_central_terms.length).toBeGreaterThan(0);
  });
});

describe("D — central issue missing but not research-fixable", () => {
  it("does not reopen research and records the limitation reason", () => {
    const d = decideResearchRepair(
      outcome({
        verified: [
          { id: "C1", text: "העתירה הוגשה לבית המשפט העליון והדיון התקיים בפני שלושה שופטים" },
          { id: "C2", text: "ההליך נפתח בעקבות ערעור על החלטת ערכאה קודמת" },
        ],
        unsupported: [{
          id: "C3",
          text: "הכלל המחייב שנקבע בהלכת הבוגדת הוא שאין לשלול זכויות רכושיות בשל בגידה",
        }],
        reason: "support_does_not_support",
      }),
      { question: DOCTRINE_Q },
    );
    expect(d.repair).toBe(false);
    expect(d.reason).toBe("central_gap_not_research_fixable");
    expect(d.coverage?.research_fixable).toBe(false);
  });
});

describe("E — multiple unresolved issues, only one central", () => {
  it("ignores peripheral gaps and judges central coverage only", () => {
    const a = assessCentralIssueCoverage({
      question: DOCTRINE_Q,
      issue_summary: "מהו הכלל המחייב בהלכת הבוגדת",
      pack: outcome({
        verified: [{
          id: "C1",
          text: "הכלל המחייב בהלכת הבוגדת הוא שבגידה אינה שוללת זכויות רכושיות של בן הזוג",
        }],
        unsupported: [
          { id: "C2", text: "שיעור המזונות נקבע בהתאם לתקנות משרד הרווחה" },
          { id: "C3", text: "ההליך נמשך ארבע שנים בערכאות" },
        ],
      }).pack,
      rejected: [],
    });
    expect(a.central_issue_covered).toBe(true);
    expect(a.unsupported_core_claim_ids).toEqual(["C2", "C3"]);
  });
});

describe("F/G — boundedness and budgets", () => {
  const src = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");

  it("F. a sufficiency repair cannot trigger a second verification repair cycle", () => {
    expect(src.split("runResearchAgent({")).toHaveLength(5); // initial + 3 bounded repairs
    expect(src).toMatch(/repair_cycles = 1;/);
    expect(/while\s*\(.*repair/i.test(src)).toBe(false);
    expect(/for\s*\(.*repair/i.test(src)).toBe(false);
    expect(src.match(/decideResearchRepair\(/g)).toHaveLength(1);
  });

  it("G. exhausted research capacity is never revived by insufficiency", () => {
    expect(src).toMatch(/needsRepair = repairDecision\.repair && !agent\.policy\.allExhausted\(\)/);
    const p = new StopPolicy({
      max_agent_steps: 10,
      max_search_calls: 1,
      max_fetch_calls: 1,
      max_lookup_calls: 1,
    } as never);
    p.note("search");
    p.note("fetch");
    p.note("lookup_authority");
    expect(p.allExhausted()).toBe(true);
  });
});

describe("H — autonomy of the repair message", () => {
  const msg = buildCoverageRepairMessage({
    question: DOCTRINE_Q,
    issue_summary: "מהו הכלל המחייב בהלכת הבוגדת",
    verified: [{ claim_id: "C1", proposition: "העתירה נדונה בבית המשפט העליון" }],
    unsupported: [{ claim_id: "C3", proposition: "הכלל המחייב הוא שאין לשלול זכויות רכושיות" }],
  });

  it("names the gap and the usable propositions", () => {
    expect(msg).toContain("C1");
    expect(msg).toContain("C3");
    expect(msg).toContain(DOCTRINE_Q);
  });

  it("does not prescribe an authority, a URL, or a source/citation count", () => {
    expect(msg).not.toMatch(/https?:\/\//);
    expect(msg).not.toMatch(/בג"?ץ\s*\d/);
    expect(msg).not.toMatch(/לפחות\s*\d/);
    expect(msg).toMatch(/unresolved_questions/);
  });
});

describe("I — synthetic bad-run shape", () => {
  it("recognises that the surviving pack lost the proposition the user asked for", () => {
    const a = assessCentralIssueCoverage({
      question: 'תסביר לי על "הלכת הבוגדת"',
      issue_summary: "מהי הלכת הבוגדת ומהו הכלל שנקבע בדיון הנוסף",
      pack: outcome({
        verified: [
          { id: "C1", text: "ההליך התנהל כדיון נוסף לאחר פסק דין קודם" },
          { id: "C2", text: "המדינה הגישה בקשה והתקיים דיון בהרכב מורחב" },
        ],
        unsupported: [{
          id: "C3",
          text: "הכלל שנקבע בהלכת הבוגדת הוא שאין לשלול זכויות מכוח בגידה",
        }],
      }).pack,
      rejected: [],
    });
    expect(a.central_issue_covered).toBe(false);
    expect(a.research_fixable).toBe(true);
    expect(a.coverage_ratio).toBeLessThan(1);
  });

  it("is substantive coverage, not verbosity: length alone never changes the verdict", () => {
    const long = "פירוט ארוך מאוד על סדרי הדין והמועדים וההרכב ".repeat(20);
    const a = assessCentralIssueCoverage({
      question: DOCTRINE_Q,
      pack: outcome({
        verified: [{ id: "C1", text: long }],
        unsupported: [{
          id: "C2",
          text: "הכלל המחייב בהלכת הבוגדת הוא שאין לשלול זכויות רכושיות בשל בגידה",
        }],
      }).pack,
      rejected: [],
    });
    expect(a.central_issue_covered).toBe(false);
  });
});
