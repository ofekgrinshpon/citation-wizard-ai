// research_pack_hierarchy_v1 — deterministic hierarchy / footnote assembly tests.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildFootnotedAnswer } from "./footnoteBuilder.ts";
import type { DrafterInputSource } from "./drafter.ts";
import type { StructuredDraft } from "./structuredValidation.ts";

function src(p: Partial<DrafterInputSource> & { ref: string; candidate_id: string }): DrafterInputSource {
  return {
    title: p.candidate_id,
    raw_title: p.candidate_id,
    title_status: "ok",
    title_hygiene_reasons: [],
    url: `https://x/${p.candidate_id}`,
    source_type: "web",
    role: "binding_case_law",
    origin: "web",
    best_support: "direct",
    supported_points: [],
    claim_ids: ["c1"],
    snippet: "…",
    ...p,
  } as DrafterInputSource;
}

const judgment = src({
  ref: "s1",
  candidate_id: "J1",
  citable_as: "judgment",
  text_usability: "substantive_excerpt",
  authority_tier: "official_primary",
  is_judgment_document: true,
  has_holding_text: true,
  best_support: "partial",
  synthesis_role: "leading_candidate",
});
const scholarship = src({
  ref: "s2",
  candidate_id: "A1",
  citable_as: "scholarship",
  authority_tier: "secondary_commentary",
  text_usability: "full_text",
  synthesis_role: "secondary_commentary",
});
const commentary = src({
  ref: "s3",
  candidate_id: "C1",
  citable_as: "commentary",
  authority_tier: "secondary_commentary",
  synthesis_role: "secondary_commentary",
});
const statuteOfficial = src({
  ref: "s4",
  candidate_id: "L1",
  title: 'חוק החברות, התשנ"ט-1999, סעיף 6',
  citable_as: "statute",
  authority_tier: "official_primary",
  text_usability: "full_text",
});
const statuteMirror = src({
  ref: "s5",
  candidate_id: "L2",
  title: 'חוק החברות התשנ"ט 1999 סעיף 6 (ויקיטקסט)',
  citable_as: "statute",
  authority_tier: "statute_mirror",
  text_usability: "full_text",
});

function draft(blocks: Array<{ text: string; refs: string[] }>): StructuredDraft {
  return {
    blocks: blocks.map((b) => ({
      kind: "paragraph" as const,
      text: b.text,
      source_refs: b.refs,
    })),
  } as StructuredDraft;
}

Deno.test("hierarchy: primary judgment precedes scholarship in used_sources", () => {
  const res = buildFootnotedAnswer(
    draft([
      { text: "פסקה על ספרות", refs: ["s2"] },
      { text: "פסקה על הלכה", refs: ["s1"] },
    ]),
    [judgment, scholarship],
  );
  assertEquals(res.used_sources[0].candidate_id, "J1");
  assertEquals(res.footnotes[0].title, judgment.title);
  assertEquals(res.hierarchy_report.first_primary_position, 1);
  assertEquals(res.hierarchy_report.primary_before_secondary_passed, true);
});

Deno.test("hierarchy: mixed compound footnote is split (secondary dropped)", () => {
  const res = buildFootnotedAnswer(
    draft([{ text: "טענה", refs: ["s1", "s2", "s3"] }]),
    [judgment, scholarship, commentary],
  );
  assertEquals(res.footnotes.length, 1);
  assertEquals(res.footnotes[0].sources.length, 1);
  assertEquals(res.used_sources.map((u) => u.candidate_id), ["J1"]);
  assertEquals(res.hierarchy_report.mixed_hierarchy_footnotes_count, 1);
});

Deno.test("hierarchy: statute mirrors collapse by legal identity", () => {
  const res = buildFootnotedAnswer(
    draft([
      { text: "סעיף 6", refs: ["s4"] },
      { text: "אותו סעיף ממראה מקום אחר", refs: ["s5"] },
    ]),
    [statuteOfficial, statuteMirror],
  );
  assertEquals(res.used_sources.map((u) => u.candidate_id), ["L1"]);
  assertEquals(res.hierarchy_report.statute_identity_dedup_count, 1);
});

Deno.test("hierarchy: no adjacency regressions and stable numbering", () => {
  const res = buildFootnotedAnswer(
    draft([
      { text: "א", refs: ["s2"] },
      { text: "ב", refs: ["s1"] },
      { text: "ג", refs: ["s4"] },
    ]),
    [judgment, scholarship, statuteOfficial],
  );
  assertEquals(res.builder_report.adjacent_marker_count, 0);
  assertEquals(res.footnotes.map((f) => f.number), [1, 2, 3]);
  assertEquals(res.used_sources.map((u) => u.candidate_id), ["J1", "L1", "A1"]);
  assertEquals(res.hierarchy_report.hierarchy_order_applied, true);
});
