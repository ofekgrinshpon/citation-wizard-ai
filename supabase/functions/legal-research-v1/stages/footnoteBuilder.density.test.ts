// footnote_density_v1_part_a_per_occurrence_emission
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildFootnotedAnswer } from "./footnoteBuilder.ts";
import { compoundLabel, planBlockOccurrences, splitSentences } from "./perOccurrenceFootnotes.ts";
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

const a = src({ ref: "s1", candidate_id: "C1", title: "בג\"ץ א" });
const b = src({ ref: "s2", candidate_id: "C2", title: "בג\"ץ ב" });

const draft = (blocks: Array<{ text: string; refs: string[] }>): StructuredDraft =>
  ({
    blocks: blocks.map((x) => ({ kind: "paragraph" as const, text: x.text, source_refs: x.refs })),
  }) as StructuredDraft;

Deno.test("split: two refs over two sentences ⇒ two separate markers", () => {
  const res = buildFootnotedAnswer(
    draft([{ text: "המשפט הראשון קובע כלל. המשפט השני מוסיף חריג.", refs: ["s1", "s2"] }]),
    [a, b],
  );
  assertEquals(res.footnotes.length, 2);
  assertEquals(res.builder_report.compound_footnote_count, 0);
  assertEquals(res.footnote_render_report.invariant_passed, true);
  const t = res.answer_markdown;
  assertEquals(t.indexOf("¹") < t.indexOf("²") || t.indexOf("²") < t.indexOf("¹"), true);
  const em = res.footnote_density_emission[0];
  assertEquals(em.split_count, 1);
  assertEquals(em.per_occurrence_markers, 2);
  assertEquals(em.compound_after, 0);
});

Deno.test("same-claim single sentence keeps one compound footnote with clean label", () => {
  const res = buildFootnotedAnswer(
    draft([{ text: "כלל אחד בלבד נקבע בפסיקה", refs: ["s1", "s2"] }]),
    [a, b],
  );
  assertEquals(res.footnotes.length, 1);
  assertEquals(res.footnotes[0].sources!.length, 2);
  assertEquals(res.footnotes[0].title.includes("כן ראו:"), true);
});

Deno.test("no ref is revived: only approved refs render", () => {
  const res = buildFootnotedAnswer(
    draft([{ text: "משפט אחד. משפט שני.", refs: ["s1"] }]),
    [a, b],
  );
  assertEquals(res.used_sources.map((u) => u.candidate_id), ["C1"]);
});

Deno.test("planner respects per-sentence and per-block caps", () => {
  assertEquals(planBlockOccurrences(["a."], 3).length, 1);
  assertEquals(splitSentences("א. ב. ג.").length, 3);
  assertEquals(compoundLabel(["X", "Y"]), "X; כן ראו: Y");
});
