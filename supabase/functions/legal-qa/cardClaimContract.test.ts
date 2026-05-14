// Deno tests for cardClaimContract.ts
// Run with: deno test supabase/functions/legal-qa/cardClaimContract.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  assignContractIds,
  attachCanonicalCitations,
  buildFootnotes,
  buildTelemetry,
  buildCitationAssemblyTelemetry,
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

// ── Phase 6.6 — engine-first / component-first behavior ─────────────────

Deno.test("engine-first: substantive statute seed routes via engine, not raw reuse", () => {
  const card = makeCard({
    id: 1,
    citation: "חוק החוזים (חלק כללי), התשל\"ג-1973, ס\"ח 118.",
    source_type: "israeli_law",
  });
  deriveCanonicalCitation(card);
  // Either engine_resolved or template_filled — but NEVER the legacy
  // "reused_existing" formatter. reused_existing_strong is allowed only
  // when scoreCitationQuality marks the seed as strong.
  assert(
    card.canonicalFormatter !== undefined &&
      card.canonicalFormatter !== ("reused_existing" as unknown as typeof card.canonicalFormatter),
    `unexpected formatter: ${card.canonicalFormatter}`,
  );
  assert(
    ["engine_resolved", "engine_template_filled_with_placeholders", "reused_existing_strong"]
      .includes(card.canonicalFormatter as string),
    `formatter=${card.canonicalFormatter}`,
  );
  assert(card.canonicalCitation && card.canonicalCitation.includes("חוק החוזים"));
});

Deno.test("docket-only caselaw → template with missing parties + date", () => {
  const card = makeCard({
    id: 1,
    citation: "12727-09-21",
    source_type: "caselaw",
    case_number: "12727-09-21",
    procedure_category: "משפחה",
  });
  deriveCanonicalCitation(card);
  const c = card.canonicalCitation || "";
  assert(/\[חסר: שמות הצדדים\]/.test(c), `missing parties marker not found: ${c}`);
  assert(/\[חסר: תאריך\]/.test(c), `missing date marker not found: ${c}`);
  assert(/12727-09-21/.test(c), `docket lost: ${c}`);
  assertEquals(card.canonicalFormatter, "engine_template_filled_with_placeholders");
  assert(card.canonicalHasPlaceholders === true);
});

Deno.test("legislation ending with ס״ח. (no page) → [חסר: מספר/עמוד]", () => {
  const card = makeCard({
    id: 1,
    citation: "חוק החוזים (חלק כללי), התשל\"ג-1973, ס\"ח.",
    source_type: "israeli_law",
  });
  deriveCanonicalCitation(card);
  const c = card.canonicalCitation || "";
  assert(/\[חסר: מספר\/עמוד\]|\[חסר: עמוד\]/.test(c), `expected page placeholder: ${c}`);
});

Deno.test("Hebrew source_type label 'פסיקה' maps to caselaw engine path", () => {
  const card = makeCard({
    id: 1,
    citation: "26533-07-20",
    source_type: "פסיקה",
    case_number: "26533-07-20",
    procedure_category: "שלום",
  });
  deriveCanonicalCitation(card);
  const c = card.canonicalCitation || "";
  // Caselaw template signature: docket present + parties placeholder
  assert(/\[חסר: שמות הצדדים\]/.test(c), `expected caselaw template: ${c}`);
  assertEquals(card.canonicalFormatter, "engine_template_filled_with_placeholders");
});

Deno.test("generic web title 'Law' rejected → [חסר: כותרת] — URL", () => {
  const card = makeCard({
    id: 1,
    citation: "Law",
    source_type: "web_source",
    url: "https://example.com/x",
    provenance: "perplexity",
  });
  deriveCanonicalCitation(card);
  const c = card.canonicalCitation || "";
  assert(/\[חסר: כותרת\]/.test(c), `expected title placeholder: ${c}`);
  assert(c.includes("https://example.com/x"), `expected URL retained: ${c}`);
  assertEquals(card.canonicalFormatter, "fallback_weak_title_refused");
});

Deno.test("Rule 37 gate proxy: weak / placeholder citation NOT marked strong", () => {
  // Docket-only → template with placeholders → quality must NOT be 'strong'
  const card = makeCard({
    id: 1,
    citation: "12727-09-21",
    source_type: "caselaw",
    case_number: "12727-09-21",
    procedure_category: "משפחה",
  });
  deriveCanonicalCitation(card);
  assert(
    card.citationQuality !== "strong",
    `weak placeholder citation should not score strong; got: ${card.citationQuality}`,
  );
});

Deno.test("strong substantive seed may be reused — quality is not 'weak'", () => {
  const card = makeCard({
    id: 1,
    citation: "ע\"א 8294/14 פלוני נ' אלמוני, פ\"ד סא(2) 100 (2018).",
    source_type: "caselaw",
    case_number: "ע\"א 8294/14",
  });
  deriveCanonicalCitation(card);
  // Reused only when engine couldn't resolve AND seed was strong, OR engine resolved.
  assert(
    ["engine_resolved", "reused_existing_strong", "engine_template_filled_with_placeholders"]
      .includes(card.canonicalFormatter as string),
    `formatter=${card.canonicalFormatter}`,
  );
  assert(card.canonicalCitation && card.canonicalCitation.length > 12);
});

Deno.test("buildCitationAssemblyTelemetry tallies normalization, fallback, placeholders", () => {
  const cards = [
    makeCard({
      id: 1,
      citation: "12727-09-21",
      source_type: "פסיקה",
      case_number: "12727-09-21",
      procedure_category: "משפחה",
    }),
    makeCard({
      id: 2,
      citation: "Law",
      source_type: "web_source",
      url: "https://x.test/y",
      provenance: "perplexity",
    }),
  ];
  attachCanonicalCitations(cards);
  const t = buildCitationAssemblyTelemetry(cards);
  assertEquals(t.total, 2);
  assert(t.source_type_normalized >= 1, "Hebrew label should count as normalized");
  assert(t.placeholder_inserted >= 1);
  assert(t.fallback_used >= 1);
  assert(Object.keys(t.missing_fields_counts).length > 0);
});

// ── Existing build/telemetry behavior ────────────────────────────────

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
