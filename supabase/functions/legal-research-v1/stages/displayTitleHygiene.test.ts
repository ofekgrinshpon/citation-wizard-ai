// Tests for Phase A — display-title hygiene.
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeDisplayTitle } from "./displayTitleHygiene.ts";

Deno.test("junk meta: 'ניתוח שאילתה' → fallback", () => {
  const r = computeDisplayTitle({
    title: "ניתוח שאילתה",
    url: "https://www.nevo.co.il/laws/abc",
    source_type: "statute",
  });
  assertEquals(r.title_status, "fallback_junk_meta");
  assertNotEquals(r.display_title, "ניתוח שאילתה");
  assertEquals(r.display_title.includes("נבו"), true);
});

Deno.test("junk meta: 'query analysis' → fallback", () => {
  const r = computeDisplayTitle({
    title: "Query Analysis",
    url: "https://example.com/x",
  });
  assertEquals(r.title_status, "fallback_junk_meta");
});

Deno.test("junk meta: 'PDF' → fallback", () => {
  const r = computeDisplayTitle({ title: "PDF", url: "https://gov.il/x.pdf" });
  assertEquals(r.title_status, "fallback_junk_meta");
});

Deno.test("empty title → fallback", () => {
  const r = computeDisplayTitle({ title: "", url: "https://nevo.co.il/x" });
  assertEquals(r.title_status, "fallback_empty");
  assertEquals(r.display_title.includes("נבו"), true);
});

Deno.test("truncated mid-word → fallback", () => {
  const r = computeDisplayTitle({
    title: "האחריות הנזיקית של רופאים במשפט הישרא",
    url: "https://nevo.co.il/x",
    source_type: "academic",
  });
  // over_fallback_fix_v1: the generic "מקור אקדמי מתוך …" fallback is less
  // informative than the (clipped) real article title, so the title is kept.
  assertEquals(r.title_status, "ok");
  assertEquals(r.fallback_applied, false);
  assertEquals(r.display_title, "האחריות הנזיקית של רופאים במשפט הישרא");
});

Deno.test("ellipsis end → truncated", () => {
  const r = computeDisplayTitle({
    title: "פסק דין בעניין פלוני נגד אלמוני…",
    url: "https://example.com",
  });
  // over_fallback_fix_v1: titles carrying parties ("נגד") are protected.
  assertEquals(r.title_status, "ok");
  assertEquals(r.fallback_applied, false);
});

Deno.test("normal Hebrew title stays as-is", () => {
  const r = computeDisplayTitle({
    title: "חוק יסוד: כבוד האדם וחירותו",
    url: "https://main.knesset.gov.il/x",
  });
  assertEquals(r.title_status, "ok");
  assertEquals(r.display_title, "חוק יסוד: כבוד האדם וחירותו");
});

Deno.test("normal title with closing punctuation is OK even if Hebrew ending", () => {
  const r = computeDisplayTitle({
    title: 'בג"ץ פלוני נ\' היועץ המשפטי לממשלה (2019)',
    url: "https://supreme.court.gov.il/x",
  });
  assertEquals(r.title_status, "ok");
});

Deno.test("fallback prefers source_type hint + friendly host", () => {
  const r = computeDisplayTitle({
    title: "",
    url: "https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawBill.aspx",
    source_type: "statute",
  });
  assertEquals(r.title_status, "fallback_empty");
  assertEquals(r.display_title.includes("חקיקה"), true);
  assertEquals(r.display_title.includes("הכנסת"), true);
});

Deno.test("fallback when no url at all", () => {
  const r = computeDisplayTitle({ title: "", url: null, source_type: null });
  assertEquals(r.display_title, "מקור משפטי");
});

Deno.test("raw_title is preserved", () => {
  const r = computeDisplayTitle({ title: "ניתוח שאילתה", url: "https://x.com" });
  assertEquals(r.raw_title, "ניתוח שאילתה");
});
