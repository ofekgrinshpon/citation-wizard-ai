import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeHebrewNumberRanges } from "./hebrewNumberRange.ts";

Deno.test("swaps ascending year range in Hebrew paragraph", () => {
  const input = "אהוד לוז מקבילים נפגשים: דת ולאומיות בתנועה הציונית במיזרח אירופה בראשיתה 1882-1904 (1985).";
  const out = normalizeHebrewNumberRanges(input);
  assertEquals(out.includes("1904-1882"), true);
  assertEquals(out.includes("1882-1904"), false);
});

Deno.test("leaves descending range untouched", () => {
  const input = "ספר עברי 1904-1882.";
  assertEquals(normalizeHebrewNumberRanges(input), "ספר עברי 1904-1882.");
});

Deno.test("leaves English paragraph untouched", () => {
  const input = "See pp. 12-34 in the report.";
  assertEquals(normalizeHebrewNumberRanges(input), "See pp. 12-34 in the report.");
});

Deno.test("handles en-dash and page ranges in Hebrew", () => {
  const input = "ראו עמ׳ 12–34 בספר.";
  const out = normalizeHebrewNumberRanges(input);
  assertEquals(out, "ראו עמ׳ 34–12 בספר.");
});

Deno.test("does not touch dd-mm-yyyy date in Hebrew", () => {
  const input = "ניתן ביום 15-03-2024.";
  assertEquals(normalizeHebrewNumberRanges(input), "ניתן ביום 15-03-2024.");
});

Deno.test("equal numbers left alone", () => {
  const input = "טווח 1990-1990 בלבד.";
  assertEquals(normalizeHebrewNumberRanges(input), "טווח 1990-1990 בלבד.");
});

Deno.test("multiple ranges in one Hebrew paragraph both flip", () => {
  const input = "בין השנים 1882-1904 ובעמ׳ 12-34.";
  const out = normalizeHebrewNumberRanges(input);
  assertEquals(out, "בין השנים 1904-1882 ובעמ׳ 34-12.");
});

Deno.test("Hebrew and English paragraphs handled independently", () => {
  const input = "פסקה עברית 1882-1904.\n\nEnglish paragraph 12-34.";
  const out = normalizeHebrewNumberRanges(input);
  assertEquals(out, "פסקה עברית 1904-1882.\n\nEnglish paragraph 12-34.");
});
