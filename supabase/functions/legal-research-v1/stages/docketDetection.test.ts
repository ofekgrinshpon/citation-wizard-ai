import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { detectDockets, candidateMatchesDocket } from "./docketDetection.ts";

Deno.test("detectDockets — Hebrew canonical bagatz", () => {
  const d = detectDockets('מהי ההלכה בבג"ץ 5555/18?');
  assertEquals(d.length, 1);
  assertEquals(d[0].docket_id, "bagatz-5555-18");
  assertEquals(d[0].prefix_he, 'בג"ץ');
  assertEquals(d[0].prefix_en, "HCJ");
  assertEquals(d[0].number, "5555/18");
  assert(d[0].variants.includes('בג"ץ 5555/18'));
  assert(d[0].variants.includes("בג״ץ 5555/18"));
  assert(d[0].variants.includes("HCJ 5555/18"));
});

Deno.test("detectDockets — Hebrew gershayim", () => {
  const d = detectDockets("פסק דין בג״ץ 5555/18");
  assertEquals(d.length, 1);
  assertEquals(d[0].docket_id, "bagatz-5555-18");
});

Deno.test("detectDockets — Hebrew no-quote", () => {
  const d = detectDockets("ראו בגץ 5555/18 שם נקבע");
  assertEquals(d.length, 1);
  assertEquals(d[0].docket_id, "bagatz-5555-18");
});

Deno.test("detectDockets — Hebrew ע\"א rotman", () => {
  const d = detectDockets('מה נפסק בע"א 8622/07 רוטמן?');
  assertEquals(d.length, 1);
  assertEquals(d[0].docket_id, "aa-8622-07");
  assertEquals(d[0].prefix_he, 'ע"א');
});

Deno.test("detectDockets — English HCJ alias", () => {
  const d = detectDockets("What was held in HCJ 5555/18?");
  assertEquals(d.length, 1);
  assertEquals(d[0].docket_id, "bagatz-5555-18");
});

Deno.test("detectDockets — English CA alias", () => {
  const d = detectDockets("Discuss CA 8622/07 Rotman");
  assertEquals(d.length, 1);
  assertEquals(d[0].docket_id, "aa-8622-07");
});

Deno.test("detectDockets — district ע\"מ with three-part number", () => {
  const d = detectDockets('בערעור ע"מ 39040-12-21 נדונה השאלה');
  assertEquals(d.length, 1);
  assertEquals(d[0].docket_id, "am-39040-12-21");
  assertEquals(d[0].number, "39040/12/21");
});

Deno.test("detectDockets — רע\"א", () => {
  const d = detectDockets('רע"א 1234/20');
  assertEquals(d.length, 1);
  assertEquals(d[0].docket_id, "raa-1234-20");
});

Deno.test("detectDockets — multiple dockets deduped by id", () => {
  const d = detectDockets('בג"ץ 5555/18 ובג״ץ 5555/18 וגם ע"א 8622/07');
  assertEquals(d.length, 2);
  const ids = d.map((x) => x.docket_id).sort();
  assertEquals(ids, ["aa-8622-07", "bagatz-5555-18"]);
});

Deno.test("detectDockets — no false positive on bare number", () => {
  const d = detectDockets("סעיף 5 לחוק 5555");
  assertEquals(d.length, 0);
});

Deno.test("candidateMatchesDocket — url variant", () => {
  const [d] = detectDockets('בג"ץ 5555/18');
  assert(candidateMatchesDocket({
    title: "פסק דין",
    url: "https://supremedecisions.court.gov.il/foo?docket=5555/18",
  }, [d]));
});

Deno.test("candidateMatchesDocket — English variant in Hebrew source", () => {
  const [d] = detectDockets('בג"ץ 5555/18');
  assert(candidateMatchesDocket({
    title: "HCJ 5555/18 — commentary",
  }, [d]));
});

Deno.test("candidateMatchesDocket — no match on unrelated case", () => {
  const [d] = detectDockets('בג"ץ 5555/18');
  assert(!candidateMatchesDocket({
    title: 'בג"ץ 1234/22 מקרה אחר',
    snippet: "background on Nation-State Law",
  }, [d]));
});
