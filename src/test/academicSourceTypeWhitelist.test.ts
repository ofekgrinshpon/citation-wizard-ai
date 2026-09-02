import { describe, expect, it } from "vitest";
import {
  assessDoctrinalEligibility,
  isDoctrinalType,
} from "../../supabase/functions/legal-research-v1/stages/doctrinalSourceTyping.ts";
import {
  categoryAccepts,
  profileSource,
} from "../../supabase/functions/legal-research-v1/stages/claimSupportCategory.ts";

const BIG_BODY = "א".repeat(16_000);

/** s3-shaped source: university-domain article, typed `academic`, body acquired. */
const academicSrc = (over: Record<string, unknown> = {}) =>
  ({
    ref: "s3",
    title: "אחרי עשרים שנה: הרהורים על מוסכמות מקובלות בשיח המידתיות",
    source_type: "academic",
    url: "https://law.haifa.ac.il/images/documents/cohn.pdf",
    origin: "web",
    body_acquired: true,
    topical_text: BIG_BODY,
    available_text_length: 16_000,
    verifier_verdict: "direct",
    text_usability: "full_text",
    authority_tier: "secondary_authority",
    citable_as: "secondary",
    ...over,
  }) as never;

describe("academic_source_type_whitelist_consistency_v1 — typing", () => {
  it("`academic` (and working-paper aliases) are doctrinal types", () => {
    expect(isDoctrinalType("academic")).toBe(true);
    expect(isDoctrinalType("working_paper")).toBe(true);
    expect(isDoctrinalType("faculty_pdf")).toBe(true);
  });

  it("academic + 16k body + direct verdict => doctrinally eligible", () => {
    const r = assessDoctrinalEligibility(academicSrc());
    expect(r.eligible).toBe(true);
    expect(r.reason).toBe("eligible_doctrinal_secondary");
  });

  it("academic + body under citability floor => not eligible", () => {
    const r = assessDoctrinalEligibility(academicSrc({
      body_acquired: false,
      topical_text: "",
      available_text_length: 120,
      snippet: "תקציר קצר",
    }));
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("no_acquired_body_text");
  });

  it("academic + metadata-only usability => not eligible", () => {
    const r = assessDoctrinalEligibility(academicSrc({ text_usability: "metadata_only" }));
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("integrity_failed_or_metadata_only");
  });

  it("academic + verifier tangential => not eligible", () => {
    const r = assessDoctrinalEligibility(academicSrc({ verifier_verdict: "tangential" }));
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("verifier_not_direct_or_partial");
  });
});

describe("academic_source_type_whitelist_consistency_v1 — primary-law guards", () => {
  const prof = profileSource(academicSrc());

  it("academic source gains doctrinal authority only", () => {
    expect(prof.doctrinal_authority).toBe(true);
    expect(prof.judgment_authority).toBe(false);
    expect(prof.statutory_authority).toBe(false);
  });

  it("cannot support court_holding / statutory claims", () => {
    expect(categoryAccepts("court_holding", prof)).toBe(false);
    expect(categoryAccepts("statutory", prof)).toBe(false);
  });

  it("supports academic/theoretical/literature/critique categories", () => {
    for (const c of [
      "theoretical_explanation",
      "literature_synthesis",
      "critique_or_counterposition",
      "academic_framing",
      "doctrinal_background",
      "scholarly_commentary",
    ] as const) {
      expect(categoryAccepts(c, prof)).toBe(true);
    }
  });

  it("an academic source never acquires judgment authority even with judgment-ish flags", () => {
    const p2 = profileSource(academicSrc({
      citable_as: "judgment",
      is_judgment_document: false,
    }));
    expect(p2.judgment_authority).toBe(false);
  });
});
