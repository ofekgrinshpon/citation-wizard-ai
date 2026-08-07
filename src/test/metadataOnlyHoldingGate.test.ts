import { describe, expect, it } from "vitest";
import {
  applyMetadataOnlyHoldingGate,
  bodyAcquired,
  isMetadataOnlyJudgment,
  referenceOnlySection,
} from "../../supabase/functions/legal-research-v1/stages/metadataOnlyHoldingGate.ts";

const src = (over: Record<string, unknown>) => ({
  ref: "s1",
  candidate_id: "c1",
  title: "פס\"ד",
  url: "https://x",
  ...over,
}) as never;

describe("metadata_only_holding_gate_v1", () => {
  it("classifies metadata-only judgments", () => {
    expect(isMetadataOnlyJudgment(src({ citable_as: "judgment", text_usability: "metadata_only" }))).toBe(true);
    expect(isMetadataOnlyJudgment(src({ is_judgment_document: true, text_usability: "listing_page" }))).toBe(true);
    expect(isMetadataOnlyJudgment(src({ citable_as: "judgment", text_usability: "full_text" }))).toBe(false);
    expect(isMetadataOnlyJudgment(src({ citable_as: "judgment", has_holding_text: true }))).toBe(false);
    // Non-judgment sources are untouched by the gate.
    expect(isMetadataOnlyJudgment(src({ citable_as: "statute", text_usability: "metadata_only" }))).toBe(false);
  });

  it("marks body-acquired usability values", () => {
    expect(bodyAcquired(src({ text_usability: "substantive_excerpt" }))).toBe(true);
    expect(bodyAcquired(src({ text_usability: "metadata_only" }))).toBe(false);
  });

  it("strips metadata-only refs from cited segments", () => {
    const sources = [
      src({ ref: "s1", candidate_id: "c1", citable_as: "judgment", text_usability: "metadata_only" }),
      src({ ref: "s2", candidate_id: "c2", citable_as: "judgment", text_usability: "full_text" }),
      src({ ref: "s3", candidate_id: "c3", citable_as: "statute", text_usability: "metadata_only" }),
    ];
    const draft = {
      blocks: [
        { kind: "heading", level: 2, text: "כותרת" },
        { kind: "paragraph", text: "נקבע כי...", source_refs: ["s1", "s2"] },
        { kind: "paragraph", text: "הלכה נוספת", source_refs: ["s1"] },
        { kind: "paragraph", text: "רקע חקיקתי", source_refs: ["s3"] },
      ],
    } as never;

    const { draft: out, report } = applyMetadataOnlyHoldingGate(draft, sources);
    const blocks = (out as { blocks: Array<{ source_refs?: string[] }> }).blocks;
    expect(blocks[1].source_refs).toEqual(["s2"]);
    expect(blocks[2].source_refs).toEqual([]);
    expect(blocks[3].source_refs).toEqual(["s3"]); // statute untouched
    expect(report.metadata_only_holdings_remaining).toBe(0);
    expect(report.blocks_stripped).toBe(2);
    expect(report.blocks_left_unsupported).toBe(1);
    expect(report.source_split_counts).toEqual({ read_in_full: 1, reference_only: 1 });
    expect(report.reference_only_sources).toHaveLength(1);
  });

  it("is a no-op when no metadata-only judgment exists", () => {
    const sources = [src({ ref: "s1", citable_as: "judgment", text_usability: "full_text" })];
    const draft = { blocks: [{ kind: "paragraph", text: "x", source_refs: ["s1"] }] } as never;
    const { draft: out, report } = applyMetadataOnlyHoldingGate(draft, sources);
    expect(out).toBe(draft);
    expect(report.stripped_ref_occurrences).toBe(0);
  });

  it("renders a reference-only section", () => {
    expect(referenceOnlySection([])).toBe("");
    const s = referenceOnlySection([{ title: "עע\"ם 1/20", url: "https://y" }]);
    expect(s).toContain("לעיון בלבד");
    expect(s).toContain("עע\"ם 1/20");
  });
});
