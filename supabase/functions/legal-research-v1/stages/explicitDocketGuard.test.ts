import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { runExplicitDocketGuard } from "./explicitDocketGuard.ts";
import { detectDockets } from "./docketDetection.ts";
import type { NominatedSource, SourceNominationResult } from "./sourceNomination.ts";

function nom(candidates: NominatedSource[] = []): SourceNominationResult {
  return {
    version: "source_nomination_v2",
    enabled: true,
    skip_reason: null,
    model_initial: null,
    model_final: null,
    escalated: false,
    escalation_reason: null,
    stage_failed: false,
    mini_retry_used: false,
    fallback_to_mini_used: false,
    mini_candidates_count_before_hardening: 0,
    mini_candidates_count_after_hardening: 0,
    finish_reason: null,
    reasoning_tokens: null,
    parse_error: null,
    http_status: null,
    candidates,
    actionable: candidates.filter((c) => c.bucket === "actionable"),
    exploratory: candidates.filter((c) => c.bucket === "exploratory"),
    dropped: [],
    queries: [],
    category_mix: {},
    actionability_mix: { known_identifier: 0, known_name_no_docket: 0, topic_only: 0 },
    identifier_confidence_histogram: {},
    identifier_bearing_count: 0,
    known_name_no_docket_count: 0,
    topic_only_count: 0,
    actionable_count: 0,
    exploratory_count: 0,
    stripped_identifiers: [],
    demoted_identifiers: [],
    queries_by_bucket: { actionable: 0, exploratory: 0 },
    stage_runs: [],
    ms: 0,
  };
}

function judgment(docket: string, label: string): NominatedSource {
  return {
    nomination_id: "N1",
    bucket: "actionable",
    actionability: "known_identifier",
    category: "judgment",
    label_he: label,
    docket,
    statute_title: null,
    statute_section: null,
    authors: [],
    journal_or_publisher: null,
    institution: null,
    year: null,
    topic_query: null,
    role_in_answer: null,
    relevance_confidence: 0.9,
    identifier_confidence: 0.9,
    confidence: 0.9,
    must_verify: true,
    nominated_by: "source_nomination_v2",
    stripped_fields: [],
    demoted: false,
    demoted_reason: null,
  };
}

Deno.test("guard adds an actionable judgment target for an explicit docket", () => {
  const r = runExplicitDocketGuard('מה נקבע בבג"ץ 5555/18 חסון נ\' כנסת ישראל?', nom(), "C1");
  assertEquals(r.report.added_count, 1);
  const g = r.nomination.actionable[0];
  assertEquals(g.category, "judgment");
  assertEquals(g.actionability, "known_identifier");
  assertEquals(g.nominated_by, "explicit_docket_guard");
  assert(g.docket?.includes("5555/18"));
  assertEquals(r.nomination.queries.length, 1);
});

Deno.test("guard dedupes against an existing nomination for the same docket", () => {
  const r = runExplicitDocketGuard(
    'מה נקבע בע"א 6821/93 בנק המזרחי?',
    nom([judgment('ע"א 6821/93', "בנק המזרחי המאוחד נ' מגדל")]),
    "C1",
  );
  assertEquals(r.report.added_count, 0);
  assertEquals(r.report.merged_count, 1);
  assertEquals(r.nomination.actionable.length, 1);
  assert(r.nomination.actionable[0].nominated_by.includes("explicit_docket_guard"));
});

Deno.test("guard is inert without an explicit docket", () => {
  const r = runExplicitDocketGuard("מהי אמת המידה לביקורת שיפוטית?", nom(), "C1");
  assertEquals(r.report.detected_count, 0);
  assertEquals(r.report.skip_reason, "no_explicit_docket");
});

Deno.test("un-punctuated and extra prefixes are detected", () => {
  for (const q of ["בגץ 5555/18", "עא 6821/93", 'עת"ם 1234/20', "עעם 1234/20", "רעא 1234/20"]) {
    assert(detectDockets(q).length === 1, q);
  }
  assertEquals(detectDockets("המועצא 12 חברים").length, 0);
});
