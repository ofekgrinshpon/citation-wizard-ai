import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decideRepairAcceptance } from "../../supabase/functions/legal-research-v2/verification/repairPolicy.ts";
import { buildVerificationForensics } from "../../supabase/functions/legal-research-v2/verification/forensics.ts";
import type {
  ResearchMemo,
  VerificationOutcome,
} from "../../supabase/functions/legal-research-v2/types.ts";

const QUESTION = "האם ניתן לקיים צוואה שנפל בה פגם בחתימת עד";

function claim(id: string, proposition: string, importance: "core" | "supporting" = "core") {
  return { claim_id: id, proposition, importance } as never;
}

function outcome(input: {
  claims?: ReturnType<typeof claim>[];
  unsupported?: ReturnType<typeof claim>[];
  rejected?: { claim_id: string; source_id?: string; reason: string; detail?: string }[];
}): VerificationOutcome {
  return {
    pack: {
      claims: input.claims ?? [],
      unsupported_claims: input.unsupported ?? [],
    },
    rejected: (input.rejected ?? []) as never,
  } as unknown as VerificationOutcome;
}

describe("zero-claim repair acceptance", () => {
  const before = outcome({
    claims: [],
    unsupported: [claim("c1", "פגם בחתימת עד ניתן לריפוי לפי סעיף 25")],
    rejected: [{ claim_id: "c1", reason: "support_does_not_support" }],
  });

  it("rejects a no_verified_claims repair that still verifies nothing", () => {
    const d = decideRepairAcceptance({
      triggerReason: "no_verified_claims",
      before,
      after: outcome({ claims: [] }),
      question: QUESTION,
    });
    expect(d).toMatchObject({ accept: false, reason: "still_zero_verified_claims" });
  });

  it("accepts a no_verified_claims repair that produced one verified claim", () => {
    const d = decideRepairAcceptance({
      triggerReason: "no_verified_claims",
      before,
      after: outcome({ claims: [claim("r1", "בית המשפט רשאי לקיים צוואה פגומה")] }),
      question: QUESTION,
    });
    expect(d).toMatchObject({ accept: true, reason: "verified_claims_produced" });
  });

  it("introduces no minimum above a single verified claim", () => {
    for (const n of [1, 2, 3]) {
      const claims = Array.from({ length: n }, (_, i) => claim(`r${i}`, `טענה ${i}`));
      expect(
        decideRepairAcceptance({ triggerReason: "no_verified_claims", before, after: outcome({ claims }) }).accept,
      ).toBe(true);
    }
  });

  it("keeps ordinary count semantics for other trigger reasons", () => {
    const b = outcome({ claims: [claim("a", "א"), claim("b", "ב")] });
    expect(
      decideRepairAcceptance({
        triggerReason: "unreadable_or_missing_body",
        before: b,
        after: outcome({ claims: [claim("a", "א")] }),
      }),
    ).toMatchObject({ accept: false, reason: "verified_claims_reduced" });
    expect(
      decideRepairAcceptance({
        triggerReason: "unreadable_or_missing_body",
        before: b,
        after: b,
      }),
    ).toMatchObject({ accept: true, reason: "verified_claims_not_reduced" });
  });

  it("keeps central-insufficiency repair semantics unchanged", () => {
    const d = decideRepairAcceptance({
      triggerReason: "central_issue_not_covered_after_narrowing",
      before,
      after: outcome({ claims: [claim("r1", "קיום צוואה פגומה בחתימת עד לפי סעיף 25")] }),
      question: "האם ניתן לקיים צוואה פגומה בחתימת עד",
    });
    expect(d.reason).toBe("coverage_restored");
    expect(d.accept).toBe(true);
  });
});

describe("central coverage telemetry for an empty verified pack", () => {
  const src = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");

  it("reports zero coverage in answer mode when nothing verified", () => {
    expect(src).toContain("central_issue_covered: pack.claims.length === 0");
    expect(src).toContain("central_coverage_ratio: pack.claims.length === 0 ? 0 :");
  });

  it("preserves existing coverage semantics for a non-empty pack", () => {
    expect(src).toContain("(coverage ? coverage.central_issue_covered : true)");
  });

  it("does not touch the source-mode telemetry block", () => {
    const sources = src.slice(src.indexOf('output_mode: "sources"'));
    expect(sources.slice(0, 1200)).not.toContain("central_issue_covered");
  });
});

describe("verification forensics (evaluation only)", () => {
  const memo = {
    issue_summary: "צוואה פגומה",
    claims: [
      {
        claim_id: "c1",
        proposition: "ניתן לקיים צוואה פגומה",
        importance: "core",
        evidence: [{ source_id: "s1", quoted_span: "בית המשפט רשאי לקיים", locator: "סעיף 25", reason: "" }],
      },
      {
        claim_id: "c2",
        proposition: "נטל ההוכחה על המבקש",
        importance: "core",
        evidence: [{ source_id: "s2", quoted_span: "הנטל מוטל", reason: "" }],
      },
    ],
    unresolved_questions: [],
    research_complete: true,
  } as unknown as ResearchMemo;

  const v = {
    pack: {
      claims: [
        {
          claim_id: "c1",
          proposition: "ניתן לקיים צוואה פגומה",
          importance: "core",
          support_status: "supported",
          sources: [{ source_id: "s1", display_title: "חוק הירושה", verified_span: "בית המשפט רשאי לקיים" }],
        },
      ],
      unsupported_claims: [],
    },
    rejected: [
      { claim_id: "c2", source_id: "s2", reason: "support_does_not_support", detail: "הציטוט אינו מבסס" },
    ],
  } as unknown as VerificationOutcome;

  it("reconstructs the chain for verified and rejected claims", () => {
    const rows = buildVerificationForensics(memo, v);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      claim_id: "c1",
      span: "ok",
      support_verdict: "supports",
      claim_outcome: "verified",
    });
    expect(rows[1]).toMatchObject({
      claim_id: "c2",
      span: "ok",
      support_verdict: "does_not_support",
      claim_outcome: "rejected",
      rejection_reason: "support_does_not_support",
    });
    expect(rows[1].support_reason).toBe("הציטוט אינו מבסס");
  });

  it("returns nothing without a memo or verification", () => {
    expect(buildVerificationForensics(null, v)).toEqual([]);
    expect(buildVerificationForensics(memo, null)).toEqual([]);
  });
});
