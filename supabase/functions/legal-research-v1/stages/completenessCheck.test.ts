// Unit tests for the deterministic completeness check (drafterV2 truncation guard).
// Run with: deno test supabase/functions/legal-research-v1/stages/completenessCheck.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { checkCompleteness } from "./completenessCheck.ts";
import type { StructuredDraft } from "./structuredValidation.ts";

function draft(...paragraphs: string[]): StructuredDraft {
  return {
    blocks: paragraphs.map((text) => ({
      kind: "paragraph",
      text,
      source_refs: [],
    })),
  };
}

Deno.test("complete Hebrew paragraph — not truncated", () => {
  const r = checkCompleteness(draft("זהו משפט משפטי שלם המסתיים בנקודה."));
  assertEquals(r.truncated, false);
});

Deno.test("mid-word Hebrew fragment 'דו' — truncated (strong)", () => {
  const r = checkCompleteness(draft("סעיף 11 מבסס רציפות; דו"));
  assertEquals(r.truncated, true);
  assertEquals(
    r.signals.some((s) => s.code === "hebrew_fragment_token" && s.strength === "strong"),
    true,
  );
});

Deno.test("mid-word Hebrew fragment 'של' — truncated (strong)", () => {
  const r = checkCompleteness(draft("זהו סוף של"));
  assertEquals(r.truncated, true);
});

Deno.test("single Hebrew prefix letter 'ו' — truncated (strong)", () => {
  const r = checkCompleteness(draft("הוראה זו ו"));
  assertEquals(r.truncated, true);
  assertEquals(
    r.signals.some((s) => s.code === "hebrew_prefix_letter"),
    true,
  );
});

Deno.test("ends with comma — truncated (strong)", () => {
  const r = checkCompleteness(draft("החוק חל על כל אדם,"));
  assertEquals(r.truncated, true);
  assertEquals(
    r.signals.some((s) => s.code === "mid_clause_punct"),
    true,
  );
});

Deno.test("ends with em-dash — truncated (strong)", () => {
  const r = checkCompleteness(draft("ההלכה נקבעה בפסק הדין —"));
  assertEquals(r.truncated, true);
});

Deno.test("ends with opening paren — truncated (strong)", () => {
  const r = checkCompleteness(draft("ראו למשל ("));
  assertEquals(r.truncated, true);
});

Deno.test("no final punct alone — weak, NOT truncated", () => {
  // Long paragraph, no fragment, no mid-clause punct, no terminal dot.
  const r = checkCompleteness(
    draft("זהו משפט משפטי ארוך המסביר את הדוקטרינה בהרחבה ומדגים אותה בעזרת פסיקה"),
  );
  assertEquals(r.truncated, false);
  assertEquals(
    r.signals.some((s) => s.code === "no_final_punct" && s.strength === "weak"),
    true,
  );
});

Deno.test("very short unterminated final block — truncated (strong)", () => {
  const r = checkCompleteness(draft("הסיכום"));
  assertEquals(r.truncated, true);
  assertEquals(
    r.signals.some((s) => s.code === "very_short_unterminated_final"),
    true,
  );
});

Deno.test("ends with closing paren after period — not truncated", () => {
  const r = checkCompleteness(draft("זהו סוף המשפט (כפי שנקבע)."));
  assertEquals(r.truncated, false);
});

Deno.test("terminal period after closer — not truncated", () => {
  const r = checkCompleteness(draft("ראו שם.)"));
  // Trailing closer ')' is stripped; core ends with '.'; not truncated.
  assertEquals(r.truncated, false);
});

Deno.test("headings ignored — falls back to last paragraph", () => {
  const d: StructuredDraft = {
    blocks: [
      { kind: "paragraph", text: "פסקה שלמה.", source_refs: [] },
      { kind: "heading", level: 2, text: "סיכום" },
    ],
  };
  const r = checkCompleteness(d);
  assertEquals(r.truncated, false);
  assertEquals(r.last_block_kind, "paragraph");
});

Deno.test("empty draft — not truncated, no signals", () => {
  const r = checkCompleteness({ blocks: [] });
  assertEquals(r.truncated, false);
  assertEquals(r.signals.length, 0);
});

Deno.test("list_item as last block — inspected", () => {
  const d: StructuredDraft = {
    blocks: [
      { kind: "paragraph", text: "רקע.", source_refs: [] },
      { kind: "list_item", text: "פריט שלא הסתיים כי", source_refs: [] },
    ],
  };
  const r = checkCompleteness(d);
  assertEquals(r.truncated, true);
  assertEquals(r.last_block_kind, "list_item");
});
