import { describe, expect, it } from "vitest";
import {
  assessDoctrinalReconsideration,
  assessListingSuppression,
  buildDoctrinalPoolSnapshot,
  decideDoctrinalRecovery,
  isAcquiredEligibleDoctrinal,
  recoveryBudgetFor,
} from "../../supabase/functions/legal-research-v1/stages/doctrinalCandidateStabilization.ts";

const cand = (over: Record<string, unknown> = {}) =>
  ({
    candidate_id: "c1",
    claim_id: "cl1",
    role: "scholarship",
    origin: "web",
    retrieval_method: "perplexity",
    title: "מאמר על חלוקת רכוש",
    source_type: "legal_article",
    source_url: "https://law.tau.ac.il/article/123",
    snippet: "ניתוח דוקטרינרי",
    query_he: "q",
    score: 1,
    ...over,
  }) as never;

const verdict = (candidate_id: string, support: string) =>
  ({ candidate_id, claim_id: "cl1", support, supported_points: [] }) as never;

const plan = (over: Record<string, unknown> = {}) =>
  ({ user_task_intent: "doctrinal_explanation", mixed_plan: false, ...over }) as never;

describe("listing suppression (conservative)", () => {
  it("suppresses clear listing/index pages", () => {
    expect(assessListingSuppression(cand({
      title: "תוצאות חיפוש",
      source_url: "https://x.co.il/search?q=רכוש",
      source_type: "web",
    })).suppress).toBe(true);
    expect(assessListingSuppression(cand({
      title: "רשימת פרסומים",
      source_type: "web",
      source_url: "https://x.co.il/publications",
      metadata: { source_integrity: { authority_tier: "index_or_listing" } },
    })).suppress).toBe(true);
  });

  it("never suppresses strong article identity with a body path", () => {
    const r = assessListingSuppression(cand({
      title: "מאמר: עיוני משפט",
      source_url: "https://law.huji.ac.il/category/files/paper.pdf",
      metadata: { source_integrity: { authority_tier: "index_or_listing" } },
    }));
    expect(r.suppress).toBe(false);
    expect(r.reason).toBe("strong_identity_with_body_path");
  });

  it("never suppresses a candidate whose body was already acquired", () => {
    expect(assessListingSuppression(cand({
      source_url: "https://x.co.il/search?q=a",
      metadata: { body_acquired: true },
    })).suppress).toBe(false);
  });
});

describe("doctrinal reconsideration (attempt only)", () => {
  it("admits direct/partial candidates with doctrinal signals", () => {
    const r = assessDoctrinalReconsideration(cand({ source_type: "web" }), "direct");
    expect(r.reconsider).toBe(true);
    expect(r.evidence.length).toBeGreaterThan(0);
  });

  it("rejects tangential/unrelated candidates", () => {
    expect(assessDoctrinalReconsideration(cand({ source_type: "web" }), "tangential").reconsider)
      .toBe(false);
    expect(assessDoctrinalReconsideration(cand({ source_type: "web" }), null).reconsider)
      .toBe(false);
  });

  it("rejects news/PR, case law and suppressed listings", () => {
    expect(
      assessDoctrinalReconsideration(
        cand({ source_type: "web", source_url: "https://www.ynet.co.il/a/1", title: "כתבה" }),
        "direct",
      ).reconsider,
    ).toBe(false);
    expect(assessDoctrinalReconsideration(cand({ source_type: "case" }), "direct").reconsider)
      .toBe(false);
    expect(
      assessDoctrinalReconsideration(
        cand({ source_type: "web", title: "רשימה", source_url: "https://x.co.il/search?q=a" }),
        "direct",
      ).reconsider,
    ).toBe(false);
  });

  it("does not confer eligibility without an acquired body", () => {
    expect(isAcquiredEligibleDoctrinal(cand({ source_type: "legal_article" }))).toBe(false);
    expect(
      isAcquiredEligibleDoctrinal(cand({ metadata: { body_acquired: true } })),
    ).toBe(true);
    expect(
      isAcquiredEligibleDoctrinal(cand({
        metadata: { body_acquired: true, source_integrity: { text_usability: "metadata_only" } },
      })),
    ).toBe(false);
  });
});

describe("pool snapshot + recovery decision", () => {
  const candidates = [
    cand({ candidate_id: "a", source_type: "web" }),
    cand({ candidate_id: "b", source_type: "web", source_url: "https://ssrn.com/p/2" }),
  ];
  const verdicts = [verdict("a", "direct"), verdict("b", "partial")];

  it("counts blocked and reconsiderable candidates", () => {
    const snap = buildDoctrinalPoolSnapshot({ candidates, verdicts });
    expect(snap.verifier_direct).toBe(1);
    expect(snap.blocked_not_doctrinal_type).toBe(2);
    expect(snap.doctrinal_eligible).toBe(0);
    expect(snap.reconsiderable_candidate_ids).toEqual(["a", "b"]);
  });

  it("fires recovery for doctrinal tasks under the eligibility floor", () => {
    const snap = buildDoctrinalPoolSnapshot({ candidates, verdicts });
    const d = decideDoctrinalRecovery({
      snapshot: snap,
      plan: plan(),
      depth_mode: "broad_research",
      candidates,
      verdicts,
      budget_allows: true,
    });
    expect(d.should_run).toBe(true);
    expect(d.candidate_ids.length).toBeLessThanOrEqual(3);
    expect(d.candidate_ids[0]).toBe("a");
  });

  it("does not fire when the floor is met, budget is gone, or the task is not doctrinal", () => {
    const eligible = [
      cand({ candidate_id: "x", metadata: { body_acquired: true } }),
      cand({ candidate_id: "y", metadata: { body_acquired: true } }),
    ];
    const snapOk = buildDoctrinalPoolSnapshot({ candidates: eligible, verdicts: [] });
    expect(
      decideDoctrinalRecovery({
        snapshot: snapOk,
        plan: plan(),
        depth_mode: "broad_research",
        candidates: eligible,
        verdicts: [],
        budget_allows: true,
      }).should_run,
    ).toBe(false);

    const snap = buildDoctrinalPoolSnapshot({ candidates, verdicts });
    expect(
      decideDoctrinalRecovery({
        snapshot: snap,
        plan: plan(),
        depth_mode: "broad_research",
        candidates,
        verdicts,
        budget_allows: false,
      }).reason,
    ).toBe("runtime_budget_exhausted");
    expect(
      decideDoctrinalRecovery({
        snapshot: snap,
        plan: plan({ user_task_intent: "case_holding" }),
        depth_mode: "broad_research",
        candidates,
        verdicts,
        budget_allows: true,
      }).should_run,
    ).toBe(false);
    expect(
      decideDoctrinalRecovery({
        snapshot: snap,
        plan: plan(),
        depth_mode: "specific_case_or_statute",
        candidates,
        verdicts,
        budget_allows: true,
      }).should_run,
    ).toBe(false);
  });

  it("keeps recovery budgets tight", () => {
    expect(recoveryBudgetFor("narrow_doctrine").total_ms).toBe(10_000);
    expect(recoveryBudgetFor("academic_research").total_ms).toBe(15_000);
    expect(recoveryBudgetFor("academic_research").max_candidates).toBe(3);
  });
});
