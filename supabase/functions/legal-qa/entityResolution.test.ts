// Phase 4 unit tests — pure helpers only.
import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { checkSourcePackGate } from "./entityResolution.ts";
import type { LegalSourcePack, LegalSourcePackItem } from "./contracts.ts";
import type { LegalIssueRoute } from "./legalIssueRouter.ts";

function item(
  authorityClass: LegalSourcePackItem["authorityClass"],
  id = `src-${Math.random().toString(36).slice(2)}`,
): LegalSourcePackItem {
  return {
    sourceId: id,
    title: "t",
    sourceType: "x",
    authorityClass,
    excerpt: "",
    anchorPresent: true,
    usableForAnalysis: true,
    usableForCitation: true,
    provenanceInternal: "local",
  };
}

function pack(items: LegalSourcePackItem[] = []): LegalSourcePack {
  return {
    coreSources: items.filter((i) =>
      ["primary_legislation", "primary_caselaw", "user_document"].includes(i.authorityClass),
    ),
    supportingSources: items.filter((i) =>
      ["secondary_official", "secondary_academic"].includes(i.authorityClass),
    ),
    secondarySources: items.filter((i) =>
      ["external_reference", "unknown"].includes(i.authorityClass),
    ),
  };
}

function route(partial: Partial<LegalIssueRoute> = {}): LegalIssueRoute {
  return {
    query_type: "statutory_amendment_comparison",
    legal_domain: "contract_law",
    secondary_domains: [],
    forbidden_domains: [],
    forbidden_topics: [],
    target_statute: { name: "חוק החוזים", section: null, amendment: "latest" },
    requires_current_context: true,
    ambiguous_terms: {},
    confidence: 0.9,
    notes: "",
    ...partial,
  };
}

Deno.test("checkSourcePackGate: mode=off short-circuits", () => {
  const r = checkSourcePackGate(route(), pack(), "?", "off");
  assertEquals(r.ok, true);
  assertEquals(r.missing, []);
  assertEquals(r.banner, null);
});

Deno.test("checkSourcePackGate: missing pack/route returns ok", () => {
  const r1 = checkSourcePackGate(null, pack(), "?", "soft");
  const r2 = checkSourcePackGate(route(), null, "?", "soft");
  assertEquals(r1.ok, true);
  assertEquals(r2.ok, true);
});

Deno.test("checkSourcePackGate: non-amendment query types not gated yet", () => {
  const r = checkSourcePackGate(
    route({ query_type: "doctrinal" }),
    pack(),
    "מה הדין?",
    "soft",
  );
  assertEquals(r.ok, true);
  assertEquals(r.missing, []);
});

Deno.test("amendment gate: empty pack with router-identified statute → still missing authoritative", () => {
  const r = checkSourcePackGate(route(), pack(), "מה התיקון?", "soft");
  // Statute IS identified by router → that check passes.
  assert(!r.missing.includes("statute_identified_or_present"));
  // But no authoritative sources at all → missing + blocking.
  assert(r.missing.includes("authoritative_source_for_amendment"));
  assert(r.blocking_missing.includes("authoritative_source_for_amendment"));
  // Soft mode never reports !ok.
  assertEquals(r.ok, true);
  assert(r.banner !== null);
});

Deno.test("amendment gate: no router statute AND no primary_legislation → blocking", () => {
  const r = checkSourcePackGate(
    route({ target_statute: { name: null, section: null, amendment: null } }),
    pack(),
    "?",
    "soft",
  );
  assert(r.blocking_missing.includes("statute_identified_or_present"));
  assert(r.blocking_missing.includes("authoritative_source_for_amendment"));
  // Soft → still ok=true.
  assertEquals(r.ok, true);
});

Deno.test("amendment gate: strict mode flips ok=false when blocking_missing present", () => {
  const r = checkSourcePackGate(route(), pack(), "?", "strict");
  assertEquals(r.ok, false);
});

Deno.test("amendment gate: doctrine-change question requires caselaw baseline", () => {
  const onlyLeg = pack([item("primary_legislation")]);
  const r = checkSourcePackGate(
    route(),
    onlyLeg,
    "האם הלכת אפרופים שונתה בעקבות התיקון?",
    "soft",
  );
  assert(r.missing.includes("caselaw_baseline"));
  assert(r.blocking_missing.includes("caselaw_baseline"));
});

Deno.test("amendment gate: no doctrine-change signal → caselaw missing is preferred not blocking", () => {
  const onlyLeg = pack([item("primary_legislation")]);
  const r = checkSourcePackGate(route(), onlyLeg, "מה התיקון אומר?", "soft");
  assert(r.missing.includes("caselaw_baseline"));
  assert(!r.blocking_missing.includes("caselaw_baseline"));
});

Deno.test("amendment gate: full pack with caselaw + leg → ok, no banner", () => {
  const fullPack = pack([item("primary_legislation"), item("primary_caselaw")]);
  const r = checkSourcePackGate(route(), fullPack, "האם הדוקטרינה שונתה?", "soft");
  assertEquals(r.ok, true);
  assertEquals(r.missing, []);
  assertEquals(r.blocking_missing, []);
  assertEquals(r.banner, null);
});

Deno.test("amendment gate: prior-text request without supporting sources → preferred only", () => {
  const fullPack = pack([item("primary_legislation"), item("primary_caselaw")]);
  const r = checkSourcePackGate(
    route(),
    fullPack,
    "מה היה הנוסח קודם לתיקון? יש דברי הסבר?",
    "soft",
  );
  assert(r.missing.includes("prior_text_or_explanatory"));
  assert(!r.blocking_missing.includes("prior_text_or_explanatory"));
  assertEquals(r.ok, true);
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 5 — gap-driven targeted retrieval helpers
// ─────────────────────────────────────────────────────────────────────────
import {
  identifyMissingSlots,
  classifyGap,
  buildRound2Queries,
  extractDoctrineTerm,
} from "./entityResolution.ts";

Deno.test("identifyMissingSlots mirrors checkSourcePackGate(soft).missing", () => {
  const r = identifyMissingSlots(route(), pack(), "מה התיקון?");
  assert(r.missing.includes("authoritative_source_for_amendment"));
  assert(r.blocking_missing.includes("authoritative_source_for_amendment"));
});

Deno.test("classifyGap: essential slots", () => {
  assertEquals(classifyGap("statute_identified_or_present", "?"), "essential");
  assertEquals(classifyGap("authoritative_source_for_amendment", "?"), "essential");
});

Deno.test("classifyGap: caselaw_baseline depends on doctrine-change signal", () => {
  assertEquals(
    classifyGap("caselaw_baseline", "האם הלכת אפרופים שונתה?"),
    "essential",
  );
  assertEquals(
    classifyGap("caselaw_baseline", "מה הלכת אפרופים?"),
    "preferred",
  );
});

Deno.test("classifyGap: preferred slots", () => {
  assertEquals(classifyGap("prior_text_or_explanatory", "?"), "preferred");
  assertEquals(classifyGap("committee_protocol", "?"), "preferred");
  assertEquals(classifyGap("approved_secondary_commentary", "?"), "preferred");
  assertEquals(classifyGap("totally_unknown_slot", "?"), "preferred");
});

Deno.test("extractDoctrineTerm recovers הלכת X", () => {
  assertEquals(extractDoctrineTerm("האם הלכת אפרופים שונתה?"), "אפרופים");
  assertEquals(extractDoctrineTerm("מה הדין?"), null);
});

Deno.test("buildRound2Queries: empty input → []", () => {
  assertEquals(buildRound2Queries(route(), [], "?"), []);
  assertEquals(buildRound2Queries(null, ["statute_identified_or_present"], "?"), []);
});

Deno.test("buildRound2Queries: emits per-slot Hebrew queries", () => {
  const qs = buildRound2Queries(
    route(),
    ["statute_identified_or_present", "authoritative_source_for_amendment"],
    "מה התיקון?",
  );
  assert(qs.some((q) => q.includes("חוק החוזים") && q.includes("נוסח מלא")));
  assert(qs.some((q) => q.includes("חוק החוזים") && q.includes("תיקון")));
  assert(qs.some((q) => q.includes('ס"ח')));
});

Deno.test("buildRound2Queries: caselaw_baseline uses doctrine term when available", () => {
  const qs = buildRound2Queries(
    route(),
    ["caselaw_baseline"],
    "האם הלכת אפרופים שונתה בעקבות התיקון?",
  );
  assert(qs.some((q) => q.includes("אפרופים")));
});

Deno.test("buildRound2Queries: caselaw_baseline falls back to statute when no doctrine term", () => {
  const qs = buildRound2Queries(route(), ["caselaw_baseline"], "מה התיקון אומר?");
  assert(qs.length >= 1);
  assert(qs.some((q) => q.includes("חוק החוזים")));
});

Deno.test("buildRound2Queries: dedupes identical templates", () => {
  const qs = buildRound2Queries(
    route(),
    ["statute_identified_or_present", "statute_identified_or_present"],
    "?",
  );
  assertEquals(qs.length, 1);
});

Deno.test("buildRound2Queries: skips slots that need a statute when none is set", () => {
  const noStatute = route({
    target_statute: { name: null, section: null, amendment: null },
  });
  const qs = buildRound2Queries(
    noStatute,
    ["statute_identified_or_present", "prior_text_or_explanatory"],
    "?",
  );
  assertEquals(qs, []);
});
