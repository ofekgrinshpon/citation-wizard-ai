// footnote_rendering_invariant_v1 — marker ↔ footnote-row 1:1 correspondence.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildFootnotedAnswer } from "./footnoteBuilder.ts";
import type { DrafterInputSource } from "./drafter.ts";
import type { StructuredDraft } from "./structuredValidation.ts";

const src = (o: Partial<DrafterInputSource>): DrafterInputSource =>
  ({
    ref: "s1",
    candidate_id: "C1",
    title: "מקור",
    url: "https://example.org/1",
    source_type: "case_law",
    origin: "local",
    authority_tier: "supreme_court",
    citable_as: "judgment",
    text_usability: "full_text",
    supported_points: [],
    claim_ids: [],
    integrity_flags: [],
    is_judgment_document: true,
    has_holding_text: true,
    can_satisfy_authority_role: true,
    synthesis_role: "authority",
    ...o,
  }) as DrafterInputSource;

const draft = (blocks: Array<{ text: string; refs: string[] }>): StructuredDraft =>
  ({
    blocks: blocks.map((b) => ({
      kind: "paragraph" as const,
      text: b.text,
      source_refs: b.refs,
    })),
  }) as StructuredDraft;

const a = src({ ref: "s1", candidate_id: "C1", title: "פסק דין א" });
const b = src({ ref: "s2", candidate_id: "C2", title: "פסק דין ב" });
const c = src({ ref: "s3", candidate_id: "C3", title: "פסק דין ג" });

Deno.test("invariant: max marker equals footnotes.length (simple)", () => {
  const res = buildFootnotedAnswer(
    draft([
      { text: "טענה א", refs: ["s1"] },
      { text: "טענה ב", refs: ["s2"] },
    ]),
    [a, b],
  );
  const r = res.footnote_render_report;
  assertEquals(r.invariant_passed, true);
  assertEquals(r.dangling_marker_count, 0);
  assertEquals(r.orphan_source_row_count, 0);
  assertEquals(r.footnotes_length, 2);
  assertEquals(r.inline_marker_count, 2);
});

Deno.test("invariant: compound footnote is one numbered row with nested sources", () => {
  const res = buildFootnotedAnswer(
    draft([
      { text: "טענה משותפת", refs: ["s1", "s2"] },
      { text: "טענה נפרדת", refs: ["s1"] },
    ]),
    [a, b],
  );
  // 2 footnote entries: {C1,C2} compound + {C1} single.
  assertEquals(res.footnotes.length, 2);
  const compound = res.footnotes.find((f) => (f.sources ?? []).length > 1)!;
  assertEquals(compound.sources!.length, 2);
  assertEquals(res.footnote_render_report.invariant_passed, true);
  // every footnote number has a marker in the answer
  for (const f of res.footnotes) {
    const sup = String(f.number).split("").map((d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)]).join("");
    assertEquals(res.answer_markdown.includes(sup), true);
  }
});

Deno.test("invariant: numbering stays gap-free with 3 distinct footnotes", () => {
  const res = buildFootnotedAnswer(
    draft([
      { text: "א", refs: ["s1"] },
      { text: "ב", refs: ["s2"] },
      { text: "ג", refs: ["s3"] },
      { text: "ד", refs: ["s2"] },
    ]),
    [a, b, c],
  );
  assertEquals(res.footnotes.map((f) => f.number), [1, 2, 3]);
  assertEquals(res.footnote_render_report.invariant_passed, true);
  assertEquals(res.footnote_render_report.used_sources_length, 3);
});
