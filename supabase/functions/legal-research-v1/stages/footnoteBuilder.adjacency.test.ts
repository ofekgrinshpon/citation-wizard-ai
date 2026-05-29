// Regression tests for footnoteBuilder adjacency telemetry.
//
// Bug: the prior implementation counted any run of ≥2 superscript characters
// as an "adjacent marker" leak. That false-positives on multi-digit footnote
// numerals like ¹⁰, ¹¹, ¹², ¹³ — which are a single marker, not two.
// The fix counts only true adjacency: two distinct superscript runs
// separated by nothing but whitespace.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildFootnotedAnswer } from "./footnoteBuilder.ts";
import type { DrafterInputSource } from "./drafter.ts";
import type { StructuredDraft } from "./structuredValidation.ts";

function mkSrc(i: number): DrafterInputSource {
  return {
    ref: `S${i}`,
    candidate_id: `cand-${i}`,
    title: `Source ${i}`,
    url: `https://example.test/${i}`,
    source_type: "test",
    origin: "local_db",
    // unused by builder but typed loosely in DrafterInputSource
    snippet: "",
  } as unknown as DrafterInputSource;
}

Deno.test("builder: 15 cited paragraphs (footnotes 1..15) ⇒ 0 adjacency", () => {
  const sources = Array.from({ length: 15 }, (_, i) => mkSrc(i + 1));
  const draft: StructuredDraft = {
    blocks: sources.map((s, i) => ({
      kind: "paragraph",
      text: `פסקה משפטית מספר ${i + 1} עם ציטוט בסוף`,
      source_refs: [s.ref],
    })),
  } as unknown as StructuredDraft;

  const out = buildFootnotedAnswer(draft, sources);
  // The rendered text WILL contain multi-digit superscripts like ¹⁰ — but
  // those are one marker, not two adjacent ones.
  assertEquals(out.builder_report.adjacent_marker_count, 0);
  assertEquals(out.builder_report.marker_count, 15);
});

Deno.test("builder: footnotes 9 and 10 on consecutive paragraphs ⇒ 0 adjacency", () => {
  const sources = Array.from({ length: 10 }, (_, i) => mkSrc(i + 1));
  const draft: StructuredDraft = {
    blocks: sources.map((s, i) => ({
      kind: "paragraph",
      text: `פסקה ${i + 1}`,
      source_refs: [s.ref],
    })),
  } as unknown as StructuredDraft;
  const out = buildFootnotedAnswer(draft, sources);
  assertEquals(out.builder_report.adjacent_marker_count, 0);
  // Sanity: rendered markdown contains ¹⁰ as a single multi-char run.
  if (!out.answer_markdown.includes("¹⁰")) {
    throw new Error("expected multi-digit marker ¹⁰ in output");
  }
});

Deno.test("builder: single-paragraph segments are separated by blank line, never adjacent", () => {
  const sources = [mkSrc(1), mkSrc(2)];
  const draft: StructuredDraft = {
    blocks: [
      { kind: "paragraph", text: "ראשון", source_refs: ["S1"] },
      { kind: "paragraph", text: "שני", source_refs: ["S2"] },
    ],
  } as unknown as StructuredDraft;
  const out = buildFootnotedAnswer(draft, sources);
  assertEquals(out.builder_report.adjacent_marker_count, 0);
});
