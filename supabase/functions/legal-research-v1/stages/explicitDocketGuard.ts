// judgment_nomination_coverage_for_named_dockets_v1
//
// Deterministic coverage guard: when the user question states an Israeli
// judgment docket explicitly, an actionable judgment target MUST exist, even
// if source_nomination_v2 failed to emit one. The guard only opens the lane —
// it is never a citation, never a URL, and never revives guessed-URL
// derivation. The target flows through the accepted path:
//   verified cache → search-first official discovery → eligible relay →
//   identity validation → existing gates.

import { detectDockets, DocketRef, normalizedDocketId } from "./docketDetection.ts";
import {
  isDiscoveryEligible,
  NOMINATION_LIMITS,
  NominatedSource,
  SourceNominationResult,
} from "./sourceNomination.ts";
import { Query } from "../lib/types.ts";

export const EXPLICIT_DOCKET_GUARD_VERSION =
  "judgment_nomination_coverage_for_named_dockets_v1";

const GUARD_NOMINATED_BY = "explicit_docket_guard";
const GUARD_PROVENANCE = "user_question_explicit_identifier";
/** Never open more than two lanes from one question. */
const MAX_GUARD_TARGETS = 2;

export interface ExplicitDocketRecord {
  raw_prefix: string;
  docket: string;
  normalized_docket: string;
  case_name: string | null;
  already_nominated: boolean;
  matched_nomination_id: string | null;
  action: "added" | "merged" | "skipped_cap";
  nomination_id: string | null;
}

export interface ExplicitDocketGuardReport {
  version: string;
  enabled: boolean;
  skip_reason: string | null;
  detected_count: number;
  added_count: number;
  merged_count: number;
  dockets: ExplicitDocketRecord[];
  ms: number;
}

export interface ExplicitDocketGuardResult {
  nomination: SourceNominationResult;
  report: ExplicitDocketGuardReport;
}

/** Best-effort case name sitting next to the docket in the question. */
function caseNameNear(question: string, docket: DocketRef): string | null {
  const idx = question.indexOf(docket.number);
  if (idx < 0) return null;
  const tail = question.slice(idx + docket.number.length, idx + docket.number.length + 90);
  const m = tail.match(/^[\s,]*([^?.,;:\n()]{4,80})/);
  if (!m) return null;
  const name = m[1].replace(/\s+/g, " ").trim();
  // Require a party separator or at least two Hebrew words to avoid grabbing
  // arbitrary prose.
  if (/\sנ['׳"]?\s/.test(name)) return name;
  return null;
}

function dockletsOfNomination(n: NominatedSource): string[] {
  const src = `${n.label_he ?? ""} ${n.docket ?? ""}`.trim();
  if (!src) return [];
  return detectDockets(src).map(normalizedDocketId);
}

function buildGuardNomination(
  d: DocketRef,
  caseName: string | null,
  idx: number,
): NominatedSource {
  const label = caseName
    ? `${d.prefix_he} ${d.number} ${caseName}`
    : `${d.prefix_he} ${d.number}`;
  return {
    nomination_id: `G${idx + 1}`,
    bucket: "actionable",
    actionability: "known_identifier",
    category: "judgment",
    label_he: label,
    docket: `${d.prefix_he} ${d.number}`,
    statute_title: null,
    statute_section: null,
    authors: [],
    journal_or_publisher: null,
    institution: null,
    year: null,
    topic_query: `${d.prefix_he} ${d.number}${caseName ? ` ${caseName}` : ""}`,
    role_in_answer: "פסק הדין שנשאל עליו במפורש",
    relevance_confidence: 0.95,
    identifier_confidence: 0.95,
    confidence: 0.95,
    must_verify: true,
    nominated_by: GUARD_NOMINATED_BY,
    stripped_fields: [],
    demoted: false,
    demoted_reason: null,
  };
}

function guardQuery(n: NominatedSource, claimId: string): Query {
  return {
    claim_id: claimId,
    role: "primary_authority",
    query_he: (n.topic_query ?? n.label_he).slice(0, 120),
    targets: ["local_db", "perplexity"],
    expected_source_type: "case",
    reason: `${GUARD_NOMINATED_BY}:${n.nomination_id}`,
    metadata: {
      source_nomination: true,
      nomination_id: n.nomination_id,
      nominated_by: GUARD_NOMINATED_BY,
      provenance: GUARD_PROVENANCE,
      nomination_bucket: "actionable",
      nomination_actionability: "known_identifier",
      nomination_category: "judgment",
      nomination_confidence: n.relevance_confidence,
      relevance_confidence: n.relevance_confidence,
      identifier_confidence: n.identifier_confidence,
      role_in_answer: n.role_in_answer,
      must_verify: true,
      discovery_eligible: true,
    },
  } as unknown as Query;
}

export function runExplicitDocketGuard(
  question: string,
  nomination: SourceNominationResult,
  claimId: string,
): ExplicitDocketGuardResult {
  const t0 = Date.now();
  const empty = (skip_reason: string | null, dockets: ExplicitDocketRecord[] = []) => ({
    nomination,
    report: {
      version: EXPLICIT_DOCKET_GUARD_VERSION,
      enabled: true,
      skip_reason,
      detected_count: dockets.length,
      added_count: 0,
      merged_count: dockets.filter((d) => d.action === "merged").length,
      dockets,
      ms: Date.now() - t0,
    },
  });

  const detected = detectDockets(String(question ?? ""));
  if (detected.length === 0) return empty("no_explicit_docket");

  const existing = new Map<string, NominatedSource>();
  for (const n of nomination.candidates ?? []) {
    for (const nd of dockletsOfNomination(n)) {
      if (!existing.has(nd)) existing.set(nd, n);
    }
  }

  const records: ExplicitDocketRecord[] = [];
  const added: NominatedSource[] = [];

  for (const d of detected) {
    const nd = normalizedDocketId(d);
    const hit = existing.get(nd);
    if (hit) {
      // Dedupe: merge provenance onto the existing nomination, never duplicate.
      if (!hit.nominated_by.includes(GUARD_NOMINATED_BY)) {
        hit.nominated_by = `${hit.nominated_by}+${GUARD_NOMINATED_BY}`;
      }
      if (!hit.docket) hit.docket = `${d.prefix_he} ${d.number}`;
      if (hit.category === "judgment" && hit.actionability !== "known_identifier") {
        hit.actionability = "known_identifier";
        hit.identifier_confidence = Math.max(hit.identifier_confidence, 0.9);
      }
      records.push({
        raw_prefix: d.prefix_he,
        docket: d.number,
        normalized_docket: nd,
        case_name: caseNameNear(question, d),
        already_nominated: true,
        matched_nomination_id: hit.nomination_id,
        action: "merged",
        nomination_id: hit.nomination_id,
      });
      continue;
    }
    if (added.length >= MAX_GUARD_TARGETS) {
      records.push({
        raw_prefix: d.prefix_he,
        docket: d.number,
        normalized_docket: nd,
        case_name: null,
        already_nominated: false,
        matched_nomination_id: null,
        action: "skipped_cap",
        nomination_id: null,
      });
      continue;
    }
    const caseName = caseNameNear(question, d);
    const n = buildGuardNomination(d, caseName, added.length);
    added.push(n);
    existing.set(nd, n);
    records.push({
      raw_prefix: d.prefix_he,
      docket: d.number,
      normalized_docket: nd,
      case_name: caseName,
      already_nominated: false,
      matched_nomination_id: null,
      action: "added",
      nomination_id: n.nomination_id,
    });
  }

  if (added.length === 0) {
    return empty(records.length ? null : "no_explicit_docket", records);
  }

  // Guard targets go first: they are the judgments the user named.
  const actionable = [...added, ...(nomination.actionable ?? [])];
  const exploratory = nomination.exploratory ?? [];
  const candidates = [...actionable, ...exploratory];
  const queries = [
    ...added.map((n) => guardQuery(n, claimId)),
    ...(nomination.queries ?? []),
  ].slice(0, NOMINATION_LIMITS.MAX_QUERIES + added.length);

  const category_mix: Record<string, number> = {};
  for (const n of candidates) category_mix[n.category] = (category_mix[n.category] ?? 0) + 1;

  const next: SourceNominationResult = {
    ...nomination,
    enabled: true,
    skip_reason: null,
    stage_failed: false,
    candidates,
    actionable,
    exploratory,
    queries,
    category_mix,
    actionability_mix: {
      ...nomination.actionability_mix,
      known_identifier: (nomination.actionability_mix?.known_identifier ?? 0) + added.length,
    },
    identifier_bearing_count: (nomination.identifier_bearing_count ?? 0) + added.length,
    actionable_count: actionable.length,
    exploratory_count: exploratory.length,
    queries_by_bucket: {
      actionable: (nomination.queries_by_bucket?.actionable ?? 0) + added.length,
      exploratory: nomination.queries_by_bucket?.exploratory ?? 0,
    },
  };
  // Sanity: the guard target must be discovery-eligible or the lane never opens.
  const eligible = added.every((n) => isDiscoveryEligible(n));

  return {
    nomination: next,
    report: {
      version: EXPLICIT_DOCKET_GUARD_VERSION,
      enabled: true,
      skip_reason: eligible ? null : "guard_target_not_discovery_eligible",
      detected_count: detected.length,
      added_count: added.length,
      merged_count: records.filter((r) => r.action === "merged").length,
      dockets: records,
      ms: Date.now() - t0,
    },
  };
}
