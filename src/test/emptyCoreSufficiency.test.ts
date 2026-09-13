import { describe, expect, it } from "vitest";

import { assessCentralIssueCoverage } from "../../supabase/functions/legal-research-v2/verification/centralIssueCoverage.ts";
import {
  decideRepairAcceptance,
  decideResearchRepair,
} from "../../supabase/functions/legal-research-v2/verification/repairPolicy.ts";
import type { VerificationOutcome } from "../../supabase/functions/legal-research-v2/types.ts";

const QUESTION =
  "כיצד התפתחה בפסיקה הישראלית ההכרה בחובת תום הלב במשא ומתן לקראת כריתת חוזה, ומהן התרופות בגין הפרתה";
const ISSUE = "חובת תום הלב במשא ומתן ותרופות בגין הפרתה";

function claim(id: string, proposition: string, importance: "core" | "supporting") {
  return { claim_id: id, proposition, importance } as never;
}

function outcome(input: {
  claims?: ReturnType<typeof claim>[];
  unsupported?: ReturnType<typeof claim>[];
  rejected?: { claim_id: string; reason: string }[];
}): VerificationOutcome {
  return {
    pack: {
      claims: input.claims ?? [],
      unsupported_claims: input.unsupported ?? [],
    },
    rejected: (input.rejected ?? []) as never,
  } as unknown as VerificationOutcome;
}

const answerCtx = {
  question: QUESTION,
  issue_summary: ISSUE,
  assess_empty_core_sufficiency: true,
};

describe("empty-core sufficiency (answer mode)", () => {
  it("detects insufficiency for an empty memo and allows one bounded repair", () => {
    const v = outcome({});
    const d = decideResearchRepair(v, answerCtx);
    expect(d.coverage?.assessed).toBe(true);
    expect(d.coverage?.surviving_core_claim_ids).toEqual([]);
    expect(d.coverage?.unsupported_core_claim_ids).toEqual([]);
    expect(d.coverage?.central_issue_covered).toBe(false);
    expect(d.coverage?.coverage_ratio).toBe(0);
    expect(d.repair).toBe(true);
    expect(d.reason).toBe("central_issue_not_covered_after_narrowing");
  });

  it("allows repair when only peripheral verified claims survive", () => {
    const v = outcome({
      claims: [claim("s1", "הדיון התקיים בשלושה מועדים והוגשו תצהירים", "supporting")],
    });
    const d = decideResearchRepair(v, answerCtx);
    expect(d.coverage?.central_issue_covered).toBe(false);
    expect(d.repair).toBe(true);
  });

  it("does not repair when a supporting claim genuinely covers the central terms", () => {
    const v = outcome({
      claims: [
        claim(
          "s1",
          "ההכרה בחובת תום הלב במשא ומתן לקראת כריתת חוזה התפתחה בפסיקה הישראלית, והתרופות בגין הפרתה כוללות פיצויים",
          "supporting",
        ),
      ],
    });
    const d = decideResearchRepair(v, answerCtx);
    expect(d.coverage?.central_issue_covered).toBe(true);
    expect(d.repair).toBe(false);
    expect(d.reason).toBe("no_unsupported_core_claims");
  });

  it("one on-point verified proposition is sufficient — no count minimum", () => {
    const v = outcome({
      claims: [
        claim(
          "c1",
          "חובת תום הלב במשא ומתן לקראת כריתת חוזה הוכרה בפסיקה הישראלית והתרופות בגין הפרתה נקבעו בה",
          "core",
        ),
      ],
    });
    expect(decideResearchRepair(v, answerCtx)).toMatchObject({ repair: false });
  });

  it("preserves no-repair for a verified core claim with low lexical overlap", () => {
    const v = outcome({ claims: [claim("c1", "הכלל שנקבע חל גם במקרה זה", "core")] });
    const d = decideResearchRepair(v, answerCtx);
    expect(d.repair).toBe(false);
    expect(d.reason).toBe("no_unsupported_core_claims");
    expect(d.coverage).toBeUndefined();
  });

  it("leaves the unsupported-core research-fixable path unchanged", () => {
    const v = outcome({
      claims: [claim("c1", "טענה שאומתה", "core")],
      unsupported: [claim("c2", "חובת תום הלב במשא ומתן", "core")],
      rejected: [{ claim_id: "c2", reason: "fetch_failed" }],
    });
    expect(decideResearchRepair(v, answerCtx)).toMatchObject({
      repair: true,
      reason: "unreadable_or_missing_body",
    });
  });

  it("leaves the unsupported-core non-research-fixable path unchanged", () => {
    const v = outcome({
      claims: [claim("c1", "טענה שאומתה על עניין צדדי", "core")],
      unsupported: [claim("c2", "חובת תום הלב במשא ומתן ותרופות בגין הפרתה", "core")],
      rejected: [{ claim_id: "c2", reason: "support_does_not_support" }],
    });
    expect(decideResearchRepair(v, answerCtx)).toMatchObject({
      repair: false,
      reason: "central_gap_not_research_fixable",
    });
  });

  it("empty core with only non-research-fixable rejections does not loop research", () => {
    const v = outcome({
      rejected: [{ claim_id: "x1", reason: "span_too_short" }],
    });
    const d = decideResearchRepair(v, answerCtx);
    expect(d.repair).toBe(false);
    expect(d.reason).toBe("central_gap_not_research_fixable");
  });

  it("does not fire the new rule in source mode", () => {
    const v = outcome({});
    const d = decideResearchRepair(v, { question: QUESTION, issue_summary: ISSUE });
    expect(d.repair).toBe(false);
    expect(d.reason).toBe("no_unsupported_core_claims");
    expect(d.coverage).toBeUndefined();
  });

  it("source mode keeps existing unsupported-core repair behavior", () => {
    const v = outcome({
      claims: [claim("c1", "טענה", "core")],
      unsupported: [claim("c2", "טענה מרכזית", "core")],
      rejected: [{ claim_id: "c2", reason: "empty_body" }],
    });
    expect(decideResearchRepair(v, { question: QUESTION })).toMatchObject({
      repair: true,
      reason: "unreadable_or_missing_body",
    });
  });

  it("judges the repaired empty-core pack against the ORIGINAL issue_summary", () => {
    const before = outcome({});
    // Still no core proposition, and the surviving peripheral claim does not
    // touch the original frame: the repair must not be adopted.
    const offTopic = outcome({
      claims: [claim("r1", "הדיון נדחה למועד נוסף והוגשו תצהירים", "supporting")],
    });
    const onTopic = outcome({
      claims: [
        claim(
          "r1",
          "חובת תום הלב במשא ומתן לקראת כריתת חוזה הוכרה בפסיקה הישראלית והתרופות בגין הפרתה כוללות פיצויים",
          "core",
        ),
      ],
    });
    expect(
      decideRepairAcceptance({
        triggerReason: "central_issue_not_covered_after_narrowing",
        before,
        after: offTopic,
        question: QUESTION,
        issue_summary: ISSUE,
      }),
    ).toMatchObject({ accept: false, reason: "coverage_still_missing" });
    expect(
      decideRepairAcceptance({
        triggerReason: "central_issue_not_covered_after_narrowing",
        before,
        after: onTopic,
        question: QUESTION,
        issue_summary: ISSUE,
      }),
    ).toMatchObject({ accept: true, reason: "coverage_restored" });
  });

  it("assessor keeps default covered behavior when a verified core survives", () => {
    const a = assessCentralIssueCoverage({
      question: QUESTION,
      issue_summary: ISSUE,
      pack: {
        claims: [claim("c1", "הכלל חל", "core")],
        unsupported_claims: [],
      } as never,
      rejected: [],
      assess_empty_core_sufficiency: true,
    });
    expect(a.central_issue_covered).toBe(true);
    expect(a.coverage_ratio).toBe(1);
  });
});
