// Deno tests for cardClaimContract.ts
// Run with: deno test supabase/functions/legal-qa/cardClaimContract.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  assignContractIds,
  attachCanonicalCitations,
  buildFootnotes,
  buildTelemetry,
  deriveCanonicalCitation,
  parseMarkers,
  type ContractSourceCard,
} from "./cardClaimContract.ts";

function makeCard(over: Partial<ContractSourceCard>): ContractSourceCard {
  return {
    id: 1,
    citation: "",
    source_type: "caselaw",
    provenance: "local",
    excerpt: "",
    ...over,
  };
}

Deno.test("assignContractIds assigns S1, S2 in order", () => {
  const cards = [makeCard({ id: 10 }), makeCard({ id: 20 }), makeCard({ id: 30 })];
  assignContractIds(cards);
  assertEquals(cards.map((c) => c.contractId), ["S1", "S2", "S3"]);
});

Deno.test("parseMarkers extracts single + multi-source markers", () => {
  const cards = [
    makeCard({ id: 1, citation: "ע\"א 1/20 פלוני נ' פלמוני (2020)." }),
    makeCard({ id: 2, citation: "חוק החוזים, התשל\"ג-1973, ס\"ח 118." }),
    makeCard({ id: 3, citation: "בג\"ץ 5/22 דוגמה נ' מ\"י (2022)." }),
  ];
  assignContractIds(cards);
  const body = "טענה ראשונה [cite:S1]. טענה שניה [cite:S2,S3]. הכלל [cite:S2].";
  const r = parseMarkers(body, cards);
  assertEquals(r.markers.length, 3);
  assertEquals(r.markers[0].validSourceIds, ["S1"]);
  assertEquals(r.markers[1].validSourceIds, ["S2", "S3"]);
  assertEquals(r.uniqueValidSourceIds, ["S1", "S2", "S3"]);
  assertEquals(r.invalidSourceIds, []);
});

Deno.test("parseMarkers reports invalid IDs", () => {
  const cards = [makeCard({ id: 1, citation: "חוק העונשין, התשל\"ז-1977, ס\"ח 226." })];
  assignContractIds(cards);
  const r = parseMarkers("יש כאן [cite:S1] וגם [cite:S99].", cards);
  assertEquals(r.uniqueValidSourceIds, ["S1"]);
  assertEquals(r.invalidSourceIds, ["S99"]);
  assertEquals(r.markers[1].invalidSourceIds, ["S99"]);
});

Deno.test("deriveCanonicalCitation REUSES upstream citation when substantive", () => {
  const card = makeCard({
    id: 1,
    citation: "חוק החוזים (חלק כללי), התשל\"ג-1973, ס\"ח 118.",
    source_type: "israeli_law",
  });
  deriveCanonicalCitation(card);
  assertEquals(card.canonicalFormatter, "reused_existing");
  assert(card.canonicalCitation && card.canonicalCitation.includes("חוק החוזים"));
});

Deno.test("deriveCanonicalCitation falls back to minimal for unresolvable web source", () => {
  const card = makeCard({
    id: 1,
    citation: "",
    source_type: "web_source",
    excerpt: "דף הנחיות באתר משרד המשפטים",
    url: "https://example.gov.il/x",
    provenance: "perplexity",
  });
  deriveCanonicalCitation(card);
  assert(["engine_resolved", "fallback_minimal", "engine_unresolved_then_fallback"]
    .includes(card.canonicalFormatter as string));
  assert(card.canonicalCitation && card.canonicalCitation.length > 0);
});

Deno.test("deriveCanonicalCitation tags missing year for thin book card", () => {
  const card = makeCard({
    id: 1,
    citation: "",
    source_type: "book",
    excerpt: "שלום ספרא דיני חוזים",
  });
  deriveCanonicalCitation(card);
  assert(card.canonicalCitation && /\[חסר:/.test(card.canonicalCitation),
    `expected missing-marker, got: ${card.canonicalCitation}`);
});

Deno.test("buildFootnotes preserves body order, dedups, replaces with superscripts", () => {
  const cards = [
    makeCard({ id: 1, citation: "פס\"ד אחד נ' שני, פ\"ד נ(1) 100 (1996).", source_type: "caselaw" }),
    makeCard({ id: 2, citation: "חוק החוזים (חלק כללי), התשל\"ג-1973, ס\"ח 118.", source_type: "israeli_law" }),
  ];
  attachCanonicalCitations(cards);
  const body = "ראשית [cite:S2]. שנית [cite:S1,S2]. שלישית [cite:S1].";
  const parse = parseMarkers(body, cards);
  const out = buildFootnotes(body, parse, cards);
  assertEquals(out.footnotes.length, 2);
  assertEquals(out.footnotes[0].source_id, "S2");
  assertEquals(out.footnotes[0].number, 1);
  assertEquals(out.footnotes[1].source_id, "S1");
  assertEquals(out.footnotes[1].number, 2);
  assert(out.body.includes("¹"), `body should contain superscript 1, got: ${out.body}`);
  assert(out.body.includes("²"), `body should contain superscript 2`);
  assert(!out.body.includes("[cite:"), "body should not contain cite markers");
  assertEquals(out.sourceIdUsage, { S2: 2, S1: 2 });
});

Deno.test("buildFootnotes drops invalid IDs without creating footnotes", () => {
  const cards = [makeCard({ id: 1, citation: "פס\"ד דוגמה.", source_type: "caselaw" })];
  attachCanonicalCitations(cards);
  const body = "טענה [cite:S99]. אחרת [cite:S1].";
  const parse = parseMarkers(body, cards);
  const out = buildFootnotes(body, parse, cards);
  assertEquals(out.footnotes.length, 1);
  assertEquals(out.footnotes[0].source_id, "S1");
  assertEquals(parse.invalidSourceIds, ["S99"]);
});

Deno.test("buildTelemetry — no markers → fallback shape", () => {
  const cards = [makeCard({ id: 1, citation: "x" })];
  assignContractIds(cards);
  const parse = parseMarkers("טקסט ללא סמנים בכלל.", cards);
  const t = buildTelemetry({
    used: false,
    legacy_fallback: true,
    reason: "no_cite_markers_found",
    parse,
  });
  assertEquals(t.used, false);
  assertEquals(t.legacy_fallback, true);
  assertEquals(t.reason, "no_cite_markers_found");
  assertEquals(t.markers_found, 0);
});

Deno.test("buildTelemetry — markers populate counters", () => {
  const cards = [
    makeCard({ id: 1, citation: "חוק החוזים (חלק כללי), התשל\"ג-1973, ס\"ח 118.", source_type: "israeli_law" }),
    makeCard({ id: 2, citation: "פס\"ד אחד נ' שני, פ\"ד נ(1) 100 (1996).", source_type: "caselaw" }),
  ];
  attachCanonicalCitations(cards);
  const body = "א [cite:S1]. ב [cite:S2]. ג [cite:S1].";
  const parse = parseMarkers(body, cards);
  const build = buildFootnotes(body, parse, cards);
  const t = buildTelemetry({ used: true, legacy_fallback: false, parse, build });
  assertEquals(t.markers_found, 3);
  assertEquals(t.unique_source_ids_used, 2);
  assertEquals(t.generated_footnotes, 2);
  assertEquals(t.claims_with_sources, 3);
  assertEquals(t.source_id_usage, { S1: 2, S2: 1 });
});
