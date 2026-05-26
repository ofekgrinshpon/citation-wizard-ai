// Unit tests for scrubInternalClaimLabels — narrow C# scaffolding cleanup.
import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { scrubInternalClaimLabels } from "./drafter.ts";

Deno.test("scrub: line-start 'C1 — ' headings are removed", () => {
  const input = "C1 — הגדרת העוולה\nטקסט משפטי כאן.\nC2 — יסודות\nטקסט נוסף.";
  const out = scrubInternalClaimLabels(input);
  assert(out.changed);
  assert(!/\bC\d+\b/.test(out.text));
  assert(out.patterns.includes("line_prefix"));
});

Deno.test("scrub: standalone parenthetical '(C1)' at line start removed", () => {
  const input = "(C1) זוהי טענה ראשונה.\n(C2) זוהי טענה שנייה.";
  const out = scrubInternalClaimLabels(input);
  assert(out.changed);
  assert(!/\bC\d+\b/.test(out.text));
  assert(out.patterns.includes("paren_label"));
});

Deno.test("scrub: 'טענה C1:' prefix removed", () => {
  const input = "טענה C1: הגדרה משפטית\nטענה C2: יסודות";
  const out = scrubInternalClaimLabels(input);
  assert(out.changed);
  assert(!/\bC\d+\b/.test(out.text));
  assert(out.patterns.includes("claim_word_prefix"));
});

Deno.test("scrub: bold wrapper '**C1** —' removed", () => {
  const input = "**C1** — הגדרת המונח\nטקסט.";
  const out = scrubInternalClaimLabels(input);
  assert(out.changed);
  assert(!/\bC\d+\b/.test(out.text));
  assert(out.patterns.includes("bold_label"));
});

Deno.test("scrub: standalone ' (C1)' parenthetical mid-text removed", () => {
  const input = "הדוקטרינה מוכרת בפסיקה (C1). היא חלה גם על מקרים אחרים.";
  const out = scrubInternalClaimLabels(input);
  assert(out.changed);
  assert(!/\bC\d+\b/.test(out.text));
  assert(out.patterns.includes("standalone_paren"));
});

Deno.test("scrub: bare 'C1' mid-sentence is NOT touched", () => {
  // No separator after C1, no leading line-start anchor — must be left alone.
  const input = "הדוקטרינה C1 מתייחסת לכך."; // pretend hostile input
  const out = scrubInternalClaimLabels(input);
  assertEquals(out.changed, false);
  assertEquals(out.patterns.length, 0);
  assert(/\bC1\b/.test(out.text));
});

Deno.test("scrub: footnote markers and substantive text preserved", () => {
  const input = "C1 — **הגדרה**: זוהי דוקטרינת ההסתמכות¹.\nC2 — **יסודות**: שלושה²³.";
  const out = scrubInternalClaimLabels(input);
  assert(out.changed);
  assert(!/\bC\d+\b/.test(out.text));
  // Superscript footnote markers preserved unchanged.
  assert(/¹/.test(out.text));
  assert(/²/.test(out.text));
  assert(/³/.test(out.text));
  assert(/הגדרה/.test(out.text));
  assert(/יסודות/.test(out.text));
});
