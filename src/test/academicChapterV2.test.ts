import { describe, expect, it } from "vitest";

import {
  CONTEXT_LIMITS,
  buildProjectContextBlock,
  parseProjectContext,
} from "../../supabase/functions/legal-research-v2/academic/projectContext";
import {
  buildChapterMemory,
  mergeSourceRegistry,
} from "../../supabase/functions/legal-research-v2/academic/chapterMemory";
import { ACADEMIC_BODY_CHAPTER_GUIDE } from "../../supabase/functions/legal-research-v2/academic/writingGuide";
import { renderAnswer } from "../../supabase/functions/legal-research-v2/drafting/render";
import { mergeRegistry } from "../lib/academic/chapterJob";
import type { VerifiedEvidencePack } from "../../supabase/functions/legal-research-v2/types";

const pack: VerifiedEvidencePack = {
  claims: [
    {
      claim_id: "C1",
      proposition: "טענה",
      importance: "core",
      support_status: "supported",
      sources: [
        {
          source_id: "S1",
          display_title: "חוק יחסי ממון",
          url: "https://example.gov.il/a",
          verified_span: "ציטוט מאומת",
          support: "supports",
        },
      ],
    },
  ],
  unsupported_claims: [],
};

describe("academic project context", () => {
  it("bounds outline, chapters and known sources", () => {
    const ctx = parseProjectContext({
      research_question: "ש".repeat(5_000),
      outline: Array.from({ length: 200 }, (_, i) => ({ index: i, title: `פרק ${i}` })),
      chapter: { index: 3, title: "פרק", role: "body" },
      completed_chapters: Array.from({ length: 50 }, () => ({ title: "פ", summary: "ס".repeat(5_000) })),
      known_sources: Array.from({ length: 200 }, () => ({ citation: "מקור" })),
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.outline.length).toBeLessThanOrEqual(CONTEXT_LIMITS.outline_entries);
    expect(ctx!.completed_chapters.length).toBeLessThanOrEqual(CONTEXT_LIMITS.completed_chapters);
    expect(ctx!.known_sources.length).toBeLessThanOrEqual(CONTEXT_LIMITS.known_sources);
  });

  it("rejects a payload with no chapter title", () => {
    expect(parseProjectContext({ research_question: "ש", chapter: { title: "" } })).toBeNull();
  });

  it("marks the block as framing that may not be cited", () => {
    const ctx = parseProjectContext({
      research_question: "שאלת מחקר",
      chapter: { index: 0, title: "פרק ראשון", role: "body" },
    })!;
    const block = buildProjectContextBlock(ctx);
    expect(block).toContain("פרק ראשון");
    expect(block.length).toBeGreaterThan(50);
  });
});

describe("academic body guide", () => {
  it("carries no numeric quotas or phrase banks", () => {
    expect(ACADEMIC_BODY_CHAPTER_GUIDE).not.toMatch(/\d+\s*(פסקאות|מקורות|הערות שוליים)/);
  });
});

describe("continuous footnote numbering", () => {
  it("starts numbering after the offset", () => {
    const out = renderAnswer(
      [{ type: "paragraph", text: "פסקה", source_ids: ["S1"] }],
      pack,
      { footnote_offset: 7 },
    );
    expect(out.footnotes[0].index).toBe(8);
    expect(out.answer_markdown).toContain("⁸");
    expect(out.invariant_errors).toEqual([]);
  });

  it("defaults to numbering from one", () => {
    const out = renderAnswer([{ type: "paragraph", text: "פסקה", source_ids: ["S1"] }], pack);
    expect(out.footnotes[0].index).toBe(1);
  });
});

describe("chapter memory and source registry", () => {
  it("derives deterministic memory from the verified pack", () => {
    const mem = buildChapterMemory({
      chapterTitle: "פרק א",
      pack,
      footnotes: [{ index: 1, citation: "חוק יחסי ממון", source_id: "S1" }],
      citedSourceIds: ["S1"],
    });
    expect(mem.title).toBe("פרק א");
    expect(mem.footnotes_count).toBe(1);
    expect(mem.cited_sources.length).toBe(1);
  });

  it("merges registry entries without duplicating the same source", () => {
    const first = mergeSourceRegistry([], "פרק א", [
      { index: 1, source_id: "S1", citation: "חוק יחסי ממון", url: "https://example.gov.il/a" },
    ]);
    const second = mergeSourceRegistry(first, "פרק ב", [
      { index: 2, source_id: "S1", citation: "חוק יחסי ממון", url: "https://example.gov.il/a/" },
    ]);
    expect(second).toHaveLength(1);
    expect(second[0].chapters_used_in).toEqual(["פרק א", "פרק ב"]);
  });

  it("client-side merge matches the same de-duplication rule", () => {
    const merged = mergeRegistry(
      [{ citation: "חוק יחסי ממון", url: "https://example.gov.il/a", chapters_used_in: ["פרק א"] }],
      "פרק ב",
      [{ title: "חוק יחסי ממון", url: "https://example.gov.il/a" }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].chapters_used_in).toEqual(["פרק א", "פרק ב"]);
  });
});
