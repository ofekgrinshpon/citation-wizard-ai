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
