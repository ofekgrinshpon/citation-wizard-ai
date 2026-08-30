// academic_style_model_v1 — deterministic style-block fixtures.
import { describe, expect, it } from "vitest";
import {
  ACADEMIC_STYLE_MODEL_VERSION,
  buildAcademicStyleGuideBlock,
} from "../../supabase/functions/legal-research-v1/stages/academicStyleGuide.ts";

const build = (genre: string, limitedDraft = false, hasFootnotes = true) =>
  // deno-lint-ignore no-explicit-any
  buildAcademicStyleGuideBlock(genre as any, { limitedDraft, hasFootnotes });

describe("buildAcademicStyleGuideBlock", () => {
  it("is disabled by flag", () => {
    const r = buildAcademicStyleGuideBlock("introduction", {
      limitedDraft: false,
      hasFootnotes: true,
      enabled: false,
    });
    expect(r.block).toBe("");
    expect(r.report.enabled).toBe(false);
  });

  it("fences the block as non-citable", () => {
    const { block } = build("introduction");
    expect(block).toContain("לא מקור לציטוט");
    expect(block).toContain(ACADEMIC_STYLE_MODEL_VERSION);
  });

  it("stays within the prompt budget", () => {
    for (const g of ["introduction", "argument_paragraph", "research_question", "generic_academic"]) {
      expect(build(g).report.block_chars).toBeLessThan(4000);
    }
  });

  it("slices per genre", () => {
    expect(build("argument_paragraph").report.sections_used).toContain("argument_structure");
    expect(build("introduction").report.sections_used).toContain("paragraph_rhythm");
    expect(build("research_question").report.sections_used).toContain("brevity");
  });

  it("never pushes citation density on short genres", () => {
    for (const g of ["research_question", "chapter_outline", "topic_presentation"]) {
      expect(build(g).report.sections_used).not.toContain("citation_density");
    }
  });

  it("swaps density for restraint on thin packs", () => {
    const thin = build("introduction", true, false).report.sections_used;
    expect(thin).toContain("citation_restraint");
    expect(thin).not.toContain("citation_density");
  });

  it("demands varied phrasing rather than a house template", () => {
    expect(build("introduction").block).toContain("גוון");
  });
});
