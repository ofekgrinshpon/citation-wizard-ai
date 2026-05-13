// Phase 3 unit tests — pure helpers only (no network).
// Covers `shouldRunDiscovery` (Fast vs Deep gating) plus sanitization +
// URL tier classification.

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  classifyUrlTier,
  sanitizeText,
  sanitizeDiscovery,
  shouldRunDiscovery,
  type OpenWebDiscovery,
} from "./openWebDiscovery.ts";
import type { LegalIssueRoute } from "./legalIssueRouter.ts";

function route(partial: Partial<LegalIssueRoute> = {}): LegalIssueRoute {
  return {
    query_type: "doctrinal",
    legal_domain: "contract_law",
    secondary_domains: [],
    forbidden_domains: [],
    forbidden_topics: [],
    target_statute: { name: null, section: null, amendment: null },
    requires_current_context: false,
    ambiguous_terms: {},
    confidence: 0.9,
    notes: "",
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// shouldRunDiscovery — mode gating
// ---------------------------------------------------------------------------

Deno.test("shouldRunDiscovery: mode=off never triggers", () => {
  const d = shouldRunDiscovery(route(), "מה הדין?", "deep", "off");
  assertEquals(d.triggered, false);
  assertEquals(d.triggers, []);
});

Deno.test("shouldRunDiscovery: mode=always always triggers", () => {
  const d = shouldRunDiscovery(null, "מה הדין?", "fast", "always");
  assertEquals(d.triggered, true);
  assert(d.triggers.includes("mode=always"));
});

// ---------------------------------------------------------------------------
// Fast mode — quiet question + healthy router → does NOT trigger
// ---------------------------------------------------------------------------

Deno.test("shouldRunDiscovery: Fast quiet doctrinal question does not trigger", () => {
  const d = shouldRunDiscovery(
    route({ query_type: "doctrinal", confidence: 0.9 }),
    "מהי תורת ההסתמכות?",
    "fast",
    "conditional",
  );
  assertEquals(d.triggered, false);
});

// ---------------------------------------------------------------------------
// Deep mode — same quiet question still triggers (opportunistic)
// ---------------------------------------------------------------------------

Deno.test("shouldRunDiscovery: Deep mode opportunistically triggers on quiet question", () => {
  const d = shouldRunDiscovery(
    route({ query_type: "doctrinal", confidence: 0.9 }),
    "מהי תורת ההסתמכות?",
    "deep",
    "conditional",
  );
  assertEquals(d.triggered, true);
  assert(d.triggers.includes("deep_opportunistic"));
});

// ---------------------------------------------------------------------------
// Trigger signals
// ---------------------------------------------------------------------------

Deno.test("shouldRunDiscovery: amendment query type triggers in Fast", () => {
  const d = shouldRunDiscovery(
    route({ query_type: "statutory_amendment_comparison" }),
    "האם התיקון האחרון לחוק החוזים מהווה שינוי מהותי?",
    "fast",
    "conditional",
  );
  assertEquals(d.triggered, true);
  assert(d.triggers.some((t) => t.includes("statutory_amendment_comparison")));
  // (Note: question_current_context is hit only when the question uses bare
  // "תיקון אחרון" — not "התיקון האחרון" with prefix. Don't assert it here.)
});

Deno.test("shouldRunDiscovery: case_law_application triggers in Fast", () => {
  const d = shouldRunDiscovery(
    route({ query_type: "case_law_application" }),
    "האם הלכת אפרופים שונתה?",
    "fast",
    "conditional",
  );
  assertEquals(d.triggered, true);
  assert(d.triggers.some((t) => t.includes("case_law_application")));
});

Deno.test("shouldRunDiscovery: requires_current_context fires", () => {
  const d = shouldRunDiscovery(
    route({ requires_current_context: true }),
    "מהו המצב המשפטי?",
    "fast",
    "conditional",
  );
  assertEquals(d.triggered, true);
  assert(d.triggers.includes("requires_current_context"));
});

Deno.test("shouldRunDiscovery: target_statute_present fires", () => {
  const d = shouldRunDiscovery(
    route({ target_statute: { name: "חוק החוזים", section: null, amendment: null } }),
    "מהו סעיף 25?",
    "fast",
    "conditional",
  );
  assertEquals(d.triggered, true);
  assert(d.triggers.includes("target_statute_present"));
});

Deno.test("shouldRunDiscovery: low router confidence fires", () => {
  const d = shouldRunDiscovery(
    route({ confidence: 0.3 }),
    "שאלה כללית",
    "fast",
    "conditional",
  );
  assertEquals(d.triggered, true);
  assert(d.triggers.includes("low_router_confidence"));
});

Deno.test("shouldRunDiscovery: missing router (timeout) fires", () => {
  const d = shouldRunDiscovery(null, "שאלה כללית", "fast", "conditional");
  assertEquals(d.triggered, true);
  assert(d.triggers.includes("router_missing"));
});

Deno.test("shouldRunDiscovery: question current-context keyword fires", () => {
  const d = shouldRunDiscovery(
    route(),
    "מהי ההלכה כיום בעניין זה?",
    "fast",
    "conditional",
  );
  assertEquals(d.triggered, true);
  assert(d.triggers.includes("question_current_context"));
});

// ---------------------------------------------------------------------------
// Sanitization helpers
// ---------------------------------------------------------------------------

Deno.test("sanitizeText: strips sentences with forbidden conclusion phrases", () => {
  const { text, stripped } = sanitizeText(
    "פסק הדין עוסק בפרשנות חוזה. נפסק כי הפרשנות הנכונה היא תכליתית. החתימה הייתה ב-2019.",
  );
  assertEquals(stripped, true);
  assert(!text.includes("נפסק"));
  assert(text.includes("פרשנות חוזה"));
});

Deno.test("sanitizeText: keeps clean text untouched", () => {
  const { text, stripped } = sanitizeText("הצדדים: ראובן ושמעון. תיק: ע\"א 1234/20.");
  assertEquals(stripped, false);
  assert(text.includes("ראובן"));
});

Deno.test("classifyUrlTier: official domains", () => {
  assertEquals(classifyUrlTier("https://www.nevo.co.il/law_html/foo"), "official");
  assertEquals(classifyUrlTier("https://main.knesset.gov.il/x"), "official");
  assertEquals(classifyUrlTier("https://supreme.court.gov.il/y"), "official");
});

Deno.test("classifyUrlTier: primary legal databases", () => {
  assertEquals(classifyUrlTier("https://www.takdin.co.il/foo"), "primary_legal");
  assertEquals(classifyUrlTier("https://www.psakdin.co.il/bar"), "primary_legal");
});

Deno.test("classifyUrlTier: approved secondary academic", () => {
  assertEquals(classifyUrlTier("https://www.idi.org.il/foo"), "approved_secondary");
  assertEquals(classifyUrlTier("https://law.tau.ac.il/x"), "approved_secondary");
});

Deno.test("classifyUrlTier: open web untrusted (default)", () => {
  assertEquals(classifyUrlTier("https://ynet.co.il/news"), "open_web_untrusted");
  assertEquals(classifyUrlTier("not a url"), "open_web_untrusted");
});

Deno.test("sanitizeDiscovery: drops URL-less candidates and counts cleaned snippets", () => {
  const raw: OpenWebDiscovery = {
    resolved_entities: [
      { type: "case", name: "אפרופים", notes: "ההלכה היא תכליתית." },
    ],
    suggested_trusted_queries: ["חוק החוזים תיקון אחרון"],
    candidate_authoritative_sources: [
      { url: "https://www.nevo.co.il/x", title: "חוק החוזים", tier: "open_web_untrusted", snippet: "נפסק כי..." },
      // @ts-expect-error intentionally bad
      { url: null, title: "bad", tier: "open_web_untrusted" },
    ],
    ambiguity_notes: ["ייתכן בלבול עם חוק החוזים האחידים"],
    confidence: 1.5,
    must_verify_before_answering: true,
  };
  const { discovery, sanitized_fields } = sanitizeDiscovery(raw);
  assertEquals(sanitized_fields.candidates_dropped_no_url, 1);
  assertEquals(sanitized_fields.candidate_snippets_cleaned, 1);
  assertEquals(sanitized_fields.resolved_entities_notes_cleaned, 1);
  assertEquals(discovery.candidate_authoritative_sources.length, 1);
  assertEquals(discovery.candidate_authoritative_sources[0].tier, "official");
  assertEquals(discovery.confidence, 1); // clamped
  assertEquals(discovery.resolved_entities[0].notes, undefined);
});
