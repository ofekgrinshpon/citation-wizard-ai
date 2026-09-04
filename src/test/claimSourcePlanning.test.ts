import { describe, expect, it } from "vitest";
import {
  assessDrafterBlockCompliance,
  buildClaimSourcePlan,
  buildPostDraftAlignmentFilter,
  deriveClaimTypeFromText,
  renderClaimSourcePlanBlock,
} from "../../supabase/functions/legal-research-v1/stages/claimSourcePlanning.ts";
import { emptyTopicAwareAlignmentReport } from "../../supabase/functions/legal-research-v1/stages/topicAwareAlignment.ts";

// deno-lint-ignore no-explicit-any
const src = (o: Record<string, unknown>): any => ({
  ref: "s1",
  candidate_id: "c1",
  title: "",
  raw_title: "",
  title_status: "ok",
  title_hygiene_reasons: [],
  url: null,
  source_type: "other",
  role: "unknown",
  origin: "local_db",
  best_support: "direct",
  supported_points: [],
  claim_ids: [],
  snippet: null,
  ...o,
});

describe("claim type derivation", () => {
  it("detects statutory framework", () => {
    expect(deriveClaimTypeFromText("סעיף 8 לחוק-יסוד קובע את פסקת ההגבלה", false))
      .toBe("statutory_framework");
  });
  it("detects a holding claim", () => {
    expect(deriveClaimTypeFromText("בית המשפט קבע כי ההחלטה בטלה", false)).toBe("case_holding");
  });
  it("defaults academic claims to theoretical background", () => {
    expect(deriveClaimTypeFromText("הרקע המושגי של הדוקטרינה", true)).toBe(
      "theoretical_background",
    );
  });
});

describe("claim source plan", () => {
  const sources = [
    src({
      ref: "s1",
      citable_as: "statute",
      source_type: "israeli_law",
      title: "חוק-יסוד: כבוד האדם וחירותו",
      snippet: "פסקת ההגבלה ומידתיות",
      body_acquired: true,
    }),
    src({
      ref: "s2",
      citable_as: "scholarship",
      source_type: "journal_article",
      title: "מידתיות בביקורת חוקתית",
      snippet: "מבחני המידתיות ופסקת ההגבלה",
      body_acquired: true,
    }),
    src({
      ref: "s3",
      citable_as: "judgment",
      source_type: "caselaw",
      title: 'בג"ץ תנאי מאסר',
      snippet: "תנאי מאסר וכליאה בבית סוהר",
    }),
  ];

  it("allows only statutes for a statutory framework claim", () => {
    const plan = buildClaimSourcePlan(
      "מידתיות בביקורת חוקתית",
      [{ claim_id: "c1", text_he: "סעיף 8 לחוק-יסוד קובע את תנאי פסקת ההגבלה" }],
      sources,
      { academicMode: true },
    );
    const row = plan.rows[0];
    expect(row.claim_type).toBe("statutory_framework");
    expect(row.preferred_source_ids).toContain("s1");
    expect(row.disallowed_source_ids).toEqual(expect.arrayContaining(["s2", "s3"]));
  });

  it("blocks an off-doctrine judgment for a theoretical claim", () => {
    const plan = buildClaimSourcePlan(
      "מידתיות בביקורת חוקתית",
      [{ claim_id: "c1", text_he: "רקע תיאורטי על מבחני המידתיות" }],
      sources,
      { academicMode: true },
    );
    expect(plan.rows[0].disallowed_source_ids).toContain("s3");
    expect(plan.rows[0].preferred_source_ids).toContain("s2");
  });

  it("renders a prompt block naming allowed and disallowed refs", () => {
    const plan = buildClaimSourcePlan(
      "מידתיות",
      [{ claim_id: "c1", text_he: "רקע תיאורטי על מבחני המידתיות" }],
      sources,
      { academicMode: true },
    );
    const block = renderClaimSourcePlanBlock(plan);
    expect(block).toContain("תכנון מקורות לפי טענה");
    expect(block).toContain("c1");
  });

  it("returns an empty prompt block for no claims", () => {
    expect(renderClaimSourcePlanBlock(buildClaimSourcePlan("q", [], sources, {
      academicMode: false,
    }))).toBe("");
  });
});

describe("drafter compliance", () => {
  const plan = {
    version: "v1.0",
    academic_mode: true,
    rows: [{
      claim_id: "c1",
      block_topic: "t",
      claim_type: "theoretical_background" as const,
      allowed_roles: [],
      preferred_source_ids: ["s2"],
      disallowed_source_ids: ["s3"],
      unsupported_or_cautious: false,
      reason: "ok",
    }],
  };

  it("flags a block citing a disallowed source", () => {
    const rep = assessDrafterBlockCompliance(
      // deno-lint-ignore no-explicit-any
      { blocks: [{ kind: "paragraph", text: "x", claim_id: "c1", source_refs: ["s2", "s3"] }] } as any,
      plan,
    );
    expect(rep.violations).toBe(1);
    expect(rep.rows[0].disallowed_emitted_refs).toEqual(["s3"]);
  });

  it("passes a compliant block", () => {
    const rep = assessDrafterBlockCompliance(
      // deno-lint-ignore no-explicit-any
      { blocks: [{ kind: "paragraph", text: "x", claim_id: "c1", source_refs: ["s2"] }] } as any,
      plan,
    );
    expect(rep.violations).toBe(0);
    expect(rep.rows[0].compliant).toBe(true);
  });
});

describe("post-draft alignment filter", () => {
  it("reports kept and dropped citations with reasons", () => {
    const report = emptyTopicAwareAlignmentReport();
    report.block_source_plan.push({
      block_id: "b1",
      block_topic: "proportionality",
      claim_type: "theoretical_background",
      acceptable_roles: [],
      selected_sources: ["s2"],
      rejected_sources: ["s3"],
      rejection_reasons: ["s3:adjacent_legal_area_only"],
      unsupported_or_cautious: false,
    });
    const out = buildPostDraftAlignmentFilter(report);
    expect(out.kept).toBe(1);
    expect(out.dropped).toBe(1);
    expect(out.rows.find((r) => r.source_id === "s3")?.reason).toBe("adjacent_legal_area_only");
  });
});
