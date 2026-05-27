// Unit tests for applyCitationCleanup — Phase 1 chronological renumbering,
// Phase 2 punctuation normalization, and cluster telemetry.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { applyCitationCleanup, validatePlacement } from "./drafter.ts";

const u = (n: number) => ({ ref: `s${n}`, number: n, candidate_id: `c${n}` });

Deno.test("phase1: renumbers out-of-order markers by first appearance", () => {
  const answer = "טקסט אחד² ועוד טקסט¹ ושלישי³.";
  const used = [u(1), u(2), u(3)];
  const r = applyCitationCleanup(answer, used);
  assert(r.report.phase1.applied);
  assert(r.report.phase1.changed);
  assertEquals(r.report.phase1.after_order, [1, 2, 3]);
  // First marker in text should now be ¹
  assert(/אחד¹/.test(r.answer));
  assert(/אחד¹.*טקסט²/.test(r.answer));
  // used_sources renumbered too
  const numbers = r.used.map((x) => x.number).sort();
  assertEquals(numbers, [1, 2, 3]);
});

Deno.test("phase1: pass-through when already sorted", () => {
  const answer = "אחד¹ שני² שלישי³.";
  const r = applyCitationCleanup(answer, [u(1), u(2), u(3)]);
  assert(r.report.phase1.applied);
  assertEquals(r.report.phase1.changed, false);
  assertEquals(r.report.phase1.after_order, [1, 2, 3]);
});

Deno.test("phase2: hops marker across each terminal/clause punctuation", () => {
  for (const [src, want] of [
    ["טקסט¹.", "טקסט.¹"],
    ["טקסט¹,", "טקסט,¹"],
    ["טקסט¹;", "טקסט;¹"],
    ["טקסט¹:", "טקסט:¹"],
    ["טקסט¹?", "טקסט?¹"],
    ["טקסט¹!", "טקסט!¹"],
  ] as const) {
    const r = applyCitationCleanup(src, [u(1)]);
    assertEquals(r.answer, want, `${src} → ${want}`);
    assert(r.report.phase2.applied);
    assertEquals(r.report.phase2.punct_swaps, 1);
  }
});

Deno.test("phase2: no hop when whitespace separates marker from punctuation", () => {
  const src = "קוראים¹ לי אופק.";
  const r = applyCitationCleanup(src, [u(1)]);
  assertEquals(r.answer, src);
  assertEquals(r.report.phase2.punct_swaps, 0);
});

Deno.test("phase2: idempotent — second pass produces no further swaps", () => {
  const src = "טקסט¹.";
  const r1 = applyCitationCleanup(src, [u(1)]);
  const r2 = applyCitationCleanup(r1.answer, r1.used);
  assertEquals(r2.answer, r1.answer);
  assertEquals(r2.report.phase2.punct_swaps, 0);
});

Deno.test("cluster telemetry: detects adjacent superscript runs without mutating answer", () => {
  const src = "אחריות¹²³⁴ ואחרי כך.";
  const r = applyCitationCleanup(src, [u(1), u(2), u(3), u(4)]);
  // No punctuation adjacent to the run, so answer unchanged after Phase 2.
  assertEquals(r.answer, src);
  assertEquals(r.report.clusters.count, 1);
  assertEquals(r.report.clusters.examples[0].run, "¹²³⁴");
});

Deno.test("marker count invariant under Phase 1 + Phase 2", () => {
  const src = "אחד², שני¹; שלישי³.";
  const before = (src.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/gu) ?? []).length;
  const r = applyCitationCleanup(src, [u(1), u(2), u(3)]);
  const after = (r.answer.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/gu) ?? []).length;
  assertEquals(after, before);
});

Deno.test("placement telemetry: max_cluster_len for clustered markers", () => {
  const r = validatePlacement("אחריות¹²³⁴ והשאר.");
  assertEquals(r.max_cluster_len, 4);
  assertEquals(r.cluster_run_count, 1);
});

Deno.test("placement telemetry: final_summary_dump=true on 5+ markers in last paragraph", () => {
  const answer = "פתיחה¹ ועוד טקסט².\n\nלסיכום, האחריות חלה.³⁴⁵⁶⁷";
  const r = validatePlacement(answer);
  assertEquals(r.final_summary_dump, true);
  assertEquals(r.final_summary_dump_count, 1);
  assert((r.final_paragraph_marker_count ?? 0) >= 5);
});

Deno.test("placement telemetry: final_summary_dump=false when markers are scattered", () => {
  const answer = "פתיחה¹.\n\nגוף² נוסף³.\n\nמסקנה קצרה⁴.";
  const r = validatePlacement(answer);
  assertEquals(r.final_summary_dump, false);
  assertEquals(r.final_summary_dump_count, 0);
  assertEquals(r.max_cluster_len, 0);
});

// ─── Phase 3: occurrence-indexed footnotes ────────────────────────────────
import { applyOccurrenceFootnotes, shortenTitle } from "./drafter.ts";

const src = (n: number, title: string, source_type = "case") => ({
  number: n,
  title,
  url: null,
  source_type,
  candidate_id: `c${n}`,
});
const fnUnique = (n: number, title: string, source_type = "case") => ({
  number: n,
  title,
  url: null,
  source_type,
});

Deno.test("phase3: separated repeat A,A → 1,2 with ibid", () => {
  const answer = "אחריות³ ושוב השפעה³.";
  const used = [src(3, "פלוני נ' אלמוני, פד\"י נא(2) 12")];
  const footnotes = [fnUnique(3, used[0].title)];
  const r = applyOccurrenceFootnotes(answer, used, footnotes);
  assert(r.applied);
  assert(/אחריות¹ ושוב השפעה²/.test(r.answer));
  assertEquals(r.footnotes.length, 2);
  assertEquals(r.footnotes[0].is_short_form, false);
  assertEquals(r.footnotes[1].is_short_form, true);
  assertEquals(r.footnotes[1].short_form_kind, "ibid");
  assertEquals(r.footnotes[1].back_ref_number, 1);
  assertEquals(r.footnotes[1].title, "שם.");
  assertEquals(r.used_sources.length, 1);
  assertEquals(r.used_sources[0].number, 1);
});

Deno.test("phase3: A,B,A → supra to 1", () => {
  const answer = "ראשון¹ שני² ושוב ראשון¹.";
  const used = [src(1, "פלוני נ' אלמוני, פד\"י נא(2) 12"), src(2, "ב נ' ג, פד\"י נב 5")];
  const footnotes = [fnUnique(1, used[0].title), fnUnique(2, used[1].title)];
  const r = applyOccurrenceFootnotes(answer, used, footnotes);
  assert(r.applied);
  assertEquals(r.footnotes.length, 3);
  assertEquals(r.footnotes[2].short_form_kind, "supra");
  assertEquals(r.footnotes[2].back_ref_number, 1);
  assert(/לעיל ה״ש 1/.test(r.footnotes[2].title));
});

Deno.test("phase3: A,A,B,A → ibid at 2, full B at 3, supra at 4", () => {
  const answer = "א¹ א¹ ב² א¹.";
  const used = [src(1, "פ נ' א"), src(2, "ב נ' ג")];
  const footnotes = [fnUnique(1, used[0].title), fnUnique(2, used[1].title)];
  const r = applyOccurrenceFootnotes(answer, used, footnotes);
  assert(r.applied);
  assertEquals(r.footnotes.map((f) => f.short_form_kind), [undefined, "ibid", undefined, "supra"]);
  assertEquals(r.footnotes[3].back_ref_number, 1);
});

Deno.test("phase3 v2: adjacent run ²³ with S={2,3} → tokenizes as split → adjacent token skip", () => {
  const answer = "אחריות²³ ועוד.";
  const used = [src(2, "X"), src(3, "Y")];
  const r = applyOccurrenceFootnotes(answer, used, [fnUnique(2, "X"), fnUnique(3, "Y")]);
  assertEquals(r.applied, false);
  assertEquals(r.report.discarded_reason, "adjacent_tokens_would_render_ambiguous");
  assertEquals(r.answer, answer);
});

Deno.test("phase3 v2: adjacent run ¹²³ with S={1,2,3} → unique split → adjacent token skip", () => {
  const answer = "ראיות¹²³ במצטבר.";
  const used = [src(1, "X"), src(2, "Y"), src(3, "Z")];
  const r = applyOccurrenceFootnotes(answer, used, [
    fnUnique(1, "X"),
    fnUnique(2, "Y"),
    fnUnique(3, "Z"),
  ]);
  assertEquals(r.applied, false);
  assertEquals(r.report.discarded_reason, "adjacent_tokens_would_render_ambiguous");
});

Deno.test("phase3 v2: ²⁴⁵ with no decode (245∉S, no split) → ambiguous skip", () => {
  const answer = "מקבץ²⁴⁵ כאן.";
  const used = [src(2, "X"), src(4, "Y")];
  const r = applyOccurrenceFootnotes(answer, used, [fnUnique(2, "X"), fnUnique(4, "Y")]);
  assertEquals(r.applied, false);
  assertEquals(r.report.discarded_reason, "ambiguous_raw_superscript_run");
});

Deno.test("phase3 v2: ¹² with BOTH 12∈S and 1+2 valid → ambiguous skip", () => {
  const answer = "טקסט¹² כאן.";
  const used = [src(1, "A"), src(2, "B"), src(12, "L")];
  const r = applyOccurrenceFootnotes(answer, used, [
    fnUnique(1, "A"),
    fnUnique(2, "B"),
    fnUnique(12, "L"),
  ]);
  assertEquals(r.applied, false);
  assertEquals(r.report.discarded_reason, "ambiguous_raw_superscript_run");
});

Deno.test("phase3 v2: ¹² with only 12∈S → unambiguous single → applies, renders ¹²", () => {
  // Build a doc that uses only source #12 (separated repeats so K≥1).
  const answer = "אחריות¹² ושוב השפעה¹².";
  const used = [src(12, "פלוני נ' אלמוני")];
  const r = applyOccurrenceFootnotes(answer, used, [fnUnique(12, used[0].title)]);
  assert(r.applied);
  // First occurrence becomes 1; second becomes 2 (ibid). Both single-digit
  // here, so the multi-digit-run proof should report 0 multi-digit runs.
  assert(/אחריות¹ ושוב השפעה²/.test(r.answer));
  assertEquals(r.report.multi_digit_marker_runs_count, 0);
  assertEquals(r.footnotes[1].short_form_kind, "ibid");
});

Deno.test("phase3 v2: K=10 now applies and renders ¹⁰ from a single token", () => {
  // 10 separated single-digit markers cycling 1..5.
  const parts: string[] = [];
  for (let i = 0; i < 10; i++) parts.push(`טקסט${toSup((i % 5) + 1)}`);
  const answer = parts.join(" ") + ".";
  const used = [1, 2, 3, 4, 5].map((n) => src(n, `T${n}`));
  const footnotes = used.map((u) => fnUnique(u.number, u.title));
  const r = applyOccurrenceFootnotes(answer, used, footnotes);
  assert(r.applied);
  assertEquals(r.report.occurrence_count, 10);
  // The 10th marker renders as ¹⁰ — a multi-digit run from one token.
  assert(/¹⁰/u.test(r.answer));
  assertEquals(r.report.multi_digit_marker_runs_count, 1);
  assertEquals(r.report.multi_digit_runs_from_single_token_count, 1);
  assertEquals(r.report.every_multi_digit_run_from_single_token, true);
});

Deno.test("phase3 v2: K=9 → applies (regression)", () => {
  const parts: string[] = [];
  for (let i = 0; i < 9; i++) parts.push(`טקסט${toSup((i % 5) + 1)}`);
  const answer = parts.join(" ") + ".";
  const used = [1, 2, 3, 4, 5].map((n) => src(n, `T${n}`));
  const footnotes = used.map((u) => fnUnique(u.number, u.title));
  const r = applyOccurrenceFootnotes(answer, used, footnotes);
  assert(r.applied);
  assertEquals(r.report.occurrence_count, 9);
});

function toSup(n: number): string {
  const d = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return String(n).split("").map((c) => d[Number(c)]).join("");
}

Deno.test("phase3 prose invariance: stripSup(out) === stripSup(in)", () => {
  const answer = "אחריות³ ושוב השפעה³.";
  const used = [src(3, "פלוני נ' אלמוני")];
  const r = applyOccurrenceFootnotes(answer, used, [fnUnique(3, used[0].title)]);
  assert(r.applied);
  const strip = (s: string) => s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/gu, "");
  assertEquals(strip(r.answer), strip(answer));
});

Deno.test("phase3 idempotency: no-repeats input maps 1:1 and re-applies identically", () => {
  // With no repeated sources, occurrence numbering equals source numbering.
  const answer = "א¹ ב² ג³.";
  const used = [src(1, "פ נ' א"), src(2, "ב נ' ג"), src(3, "ד נ' ה")];
  const footnotes = used.map((u) => fnUnique(u.number, u.title));
  const r1 = applyOccurrenceFootnotes(answer, used, footnotes);
  assert(r1.applied);
  assertEquals(r1.answer, answer);
  const r2 = applyOccurrenceFootnotes(r1.answer, r1.used_sources, r1.footnotes);
  assert(r2.applied);
  assertEquals(r2.answer, r1.answer);
});

Deno.test("shortenTitle: case takes up to first comma", () => {
  assertEquals(
    shortenTitle("פלוני נ' אלמוני, פד\"י נא(2) 12", "case"),
    "פלוני נ' אלמוני",
  );
});

Deno.test("shortenTitle: statute strips year tail", () => {
  const out = shortenTitle("חוק החוזים (חלק כללי), התשל\"ג-1973", "statute");
  assertEquals(out, "חוק החוזים");
});

Deno.test("shortenTitle: academic keeps author + few words", () => {
  const out = shortenTitle("דניאל פרידמן, דיני עשיית עושר ולא במשפט (מהדורה שנייה, 2015)", "academic");
  assert(out.startsWith("דניאל פרידמן, "));
});

Deno.test("shortenTitle: report truncates to 8 words", () => {
  const long = "אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע עשר";
  const out = shortenTitle(long, "report");
  assertEquals(out, "אחת שתיים שלוש ארבע חמש שש שבע שמונה…");
});
