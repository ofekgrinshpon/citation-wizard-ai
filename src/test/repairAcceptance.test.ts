import { describe, expect, it } from "vitest";
import {
  decideRepairAcceptance,
} from "../../supabase/functions/legal-research-v2/verification/repairPolicy.ts";
import type {
  VerificationOutcome,
} from "../../supabase/functions/legal-research-v2/types.ts";

const QUESTION = "מהו הכלל בדבר חובת הגילוי של בן זוג בוגד בחלוקת רכוש";

function claim(id: string, proposition: string, importance: "core" | "supporting" = "core") {
  return { claim_id: id, proposition, importance } as never;
}

function outcome(input: {
  claims: ReturnType<typeof claim>[];
  unsupported?: ReturnType<typeof claim>[];
  rejected?: { claim_id: string; reason: string }[];
}): VerificationOutcome {
  return {
    pack: {
      claims: input.claims,
      unsupported_claims: input.unsupported ?? [],
    },
    rejected: (input.rejected ?? []) as never,
  } as unknown as VerificationOutcome;
}

describe("repair acceptance", () => {
  const before = outcome({
    claims: [
      claim("c1", "ההליך הוגש לבית המשפט לענייני משפחה במחוז תל אביב"),
      claim("c2", "הדיון התקיים בשלושה מועדים והוגשו תצהירים"),
    ],
    unsupported: [claim("c3", "חובת הגילוי של בן זוג בוגד משפיעה על חלוקת רכוש")],
    rejected: [{ claim_id: "c3", reason: "span_not_found" }],
  });

  it("accepts a central-insufficiency repair that covers the issue with fewer claims", () => {
    const after = outcome({
      claims: [claim("r1", "חובת הגילוי של בן זוג בוגד נבחנת בחלוקת רכוש לפי הכלל שנקבע")],
    });
    const d = decideRepairAcceptance({
      triggerReason: "central_issue_not_covered_after_narrowing",
      before,
      after,
      question: QUESTION,
    });
    expect(after.pack.claims.length).toBeLessThan(before.pack.claims.length);
    expect(d.accept).toBe(true);
    expect(d.reason).toBe("coverage_restored");
  });

  it("rejects a repair with fewer claims that still misses the central issue", () => {
    const after = outcome({
      claims: [claim("r1", "הדיון נקבע למועד נוסף בחודש שלאחר מכן")],
      unsupported: [claim("c3", "חובת הגילוי של בן זוג בוגד משפיעה על חלוקת רכוש")],
      rejected: [{ claim_id: "c3", reason: "span_not_found" }],
    });
    const d = decideRepairAcceptance({
      triggerReason: "central_issue_not_covered_after_narrowing",
      before,
      after,
      question: QUESTION,
    });
    expect(d.accept).toBe(false);
    expect(d.reason).toBe("coverage_still_missing");
  });

  it("keeps count-based acceptance for non-central repairs", () => {
    const fewer = outcome({ claims: [claim("r1", "טענה אחת בלבד")] });
    const same = outcome({
      claims: [claim("r1", "א"), claim("r2", "ב")],
    });
    expect(
      decideRepairAcceptance({
        triggerReason: "unreadable_or_missing_body",
        before,
        after: fewer,
        question: QUESTION,
      }),
    ).toMatchObject({ accept: false, reason: "verified_claims_reduced" });
    expect(
      decideRepairAcceptance({
        triggerReason: "unreadable_or_missing_body",
        before,
        after: same,
      }),
    ).toMatchObject({ accept: true, reason: "verified_claims_not_reduced" });
  });

  it("rejects a repair whose memo moved the goalposts to a peripheral issue", () => {
    // Original frame (issue A): חובת הגילוי של בן זוג בוגד בחלוקת רכוש.
    // Repaired memo redefines its own issue_summary toward peripheral issue B
    // (procedural scheduling) and its verified claims cover B, not A.
    // Acceptance judged against the ORIGINAL frame must reject.
    const after = outcome({
      claims: [claim("r1", "הדיון נדחה למועד נוסף והוגשו תצהירים משלימים")],
      unsupported: [claim("c3", "חובת הגילוי של בן זוג בוגד משפיעה על חלוקת רכוש")],
      rejected: [{ claim_id: "c3", reason: "span_not_found" }],
    });
    const d = decideRepairAcceptance({
      triggerReason: "central_issue_not_covered_after_narrowing",
      before,
      after,
      question: QUESTION,
      issue_summary: "חובת הגילוי של בן זוג בוגד בחלוקת רכוש", // original frame
    });
    expect(d.accept).toBe(false);
    expect(d.reason).toBe("coverage_still_missing");
  });

  it("accepts a repair covering the original issue even if the memo's own summary changed", () => {
    const after = outcome({
      claims: [claim("r1", "חובת הגילוי של בן זוג בוגד נבחנת בחלוקת רכוש לפי הכלל שנקבע")],
    });
    const d = decideRepairAcceptance({
      triggerReason: "central_issue_not_covered_after_narrowing",
      before,
      after,
      question: QUESTION,
      // The call site passes the PRE-REPAIR issue_summary regardless of what
      // the repaired memo says about itself.
      issue_summary: "חובת הגילוי של בן זוג בוגד בחלוקת רכוש",
    });
    expect(d.accept).toBe(true);
    expect(d.reason).toBe("coverage_restored");
  });

  it("does not require any minimum number of claims, sources or citations", () => {
    const after = outcome({
      claims: [claim("r1", "חובת הגילוי של בן זוג בוגד בחלוקת רכוש")],
    });
    const d = decideRepairAcceptance({
      triggerReason: "central_issue_not_covered_after_narrowing",
      before,
      after,
      question: QUESTION,
    });
    expect(d.accept).toBe(true);
    expect(d.coverage_after?.assessed).toBe(true);
  });
});
