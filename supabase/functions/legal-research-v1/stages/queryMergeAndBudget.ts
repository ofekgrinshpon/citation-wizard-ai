// query_merge_and_budget — the single funnel for every query producer.
//
// Before this stage the pipeline had five independent append points (planner,
// required anchors, judgment discovery, facets, core-authority registry) plus
// the new source_nomination_v1 producer, with no shared dedupe or budget.
// This stage normalizes, dedupes (exact + near), priority-sorts and caps them,
// recording a skip reason for everything dropped.
//
// Deterministic. No model call. Required-anchor queries are never dropped —
// they carry the deterministic primary-source duties (docket anchors, statute
// section anchors) other gates depend on.

import type { Query } from "../lib/types.ts";

export const QUERY_MERGE_VERSION = "query_merge_and_budget_v1";

export type QueryProducer =
  | "planner"
  | "required_anchors"
  | "judgment_discovery"
  | "facets"
  | "core_authority_registry"
  | "source_nomination";

/** Lower number = higher priority. Anchors are protected separately. */
const PRODUCER_PRIORITY: Record<QueryProducer, number> = {
  required_anchors: 0,
  source_nomination: 1,
  core_authority_registry: 2,
  planner: 3,
  facets: 4,
  judgment_discovery: 5,
};

const PROTECTED: QueryProducer[] = ["required_anchors"];

export interface ProducerInput {
  producer: QueryProducer;
  queries: Query[];
  /** Per-producer ceiling; undefined = no producer-level cap. */
  cap?: number;
}

export interface DroppedQuery {
  producer: QueryProducer;
  query_he: string;
  reason:
    | "duplicate_exact"
    | "duplicate_near"
    | "producer_cap"
    | "total_cap"
    | "empty";
  duplicate_of?: string;
}

export interface QueryMergeReport {
  version: typeof QUERY_MERGE_VERSION;
  planner_queries_count: number;
  nomination_queries_count: number;
  queries_added_from_nomination: number;
  queries_by_producer: Record<string, number>;
  queries_skipped_duplicate: number;
  queries_skipped_budget: number;
  final_query_count: number;
  source_type_mix: Record<string, number>;
  /** source_nomination_v2 bucket accounting. */
  actionable_queries: number;
  exploratory_queries: number;
  actionable_queries_preserved: number;
  exploratory_queries_preserved: number;
  actionability_mix: Record<string, number>;
  identifier_confidence_histogram: Record<string, number>;
  stripped_identifiers: number;
  demoted_identifiers: number;
  dropped: DroppedQuery[];
}

export interface QueryMergeResult {
  queries: Query[];
  protectedQueries: Query[];
  report: QueryMergeReport;
}

type Meta = Record<string, unknown>;
const meta = (q: Query): Meta => ((q?.metadata ?? {}) as Meta);
const bucketOf = (q: Query): string | null => {
  const b = meta(q).nomination_bucket;
  return typeof b === "string" ? b : null;
};


const NIQQUD_RE = /[\u0591-\u05C7]/g;

export function normalizeQueryText(s: string): string {
  return String(s ?? "")
    .replace(NIQQUD_RE, "")
    .replace(/["'`׳״]/g, "")
    .replace(/[־–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokens(s: string): Set<string> {
  return new Set(
    normalizeQueryText(s)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface MergeOptions {
  /** Global ceiling over non-protected queries. */
  max_total: number;
  /** Token-set similarity above which two queries are considered duplicates. */
  near_threshold?: number;
  /** Lanes reserved for actionable nomination queries (default 2). */
  reserve_actionable?: number;
  /** Lanes reserved for exploratory nomination queries (default 2). */
  reserve_exploratory?: number;
  /**
   * Doctrinal/legal-rule runs keep >= 1 exploratory query, academic/policy
   * runs keep >= 2 — exploratory searches are first-class output, never a
   * fallback that budget pressure may silently delete.
   */
  min_exploratory?: number;
  /** Nomination-stage hardening counters, surfaced in the merge report. */
  nomination_stats?: {
    actionability_mix?: Record<string, number>;
    identifier_confidence_histogram?: Record<string, number>;
    stripped_identifiers?: number;
    demoted_identifiers?: number;
  };
}


export function mergeAndBudgetQueries(
  producers: ProducerInput[],
  opts: MergeOptions,
): QueryMergeResult {
  const nearThreshold = opts.near_threshold ?? 0.85;
  const dropped: DroppedQuery[] = [];
  const byProducer: Record<string, number> = {};

  interface Entry {
    producer: QueryProducer;
    query: Query;
    norm: string;
    toks: Set<string>;
    bucket: string | null;
    reserved: boolean;
  }

  const reserveActionable = opts.reserve_actionable ?? 2;
  const reserveExploratory = Math.max(
    opts.reserve_exploratory ?? 2,
    opts.min_exploratory ?? 0,
  );
  let actionableSeen = 0;
  let exploratorySeen = 0;

  const entries: Entry[] = [];
  for (const p of producers) {
    let taken = 0;
    for (const q of p.queries ?? []) {
      const text = String(q?.query_he ?? "");
      if (!text.trim()) {
        dropped.push({ producer: p.producer, query_he: text, reason: "empty" });
        continue;
      }
      if (
        typeof p.cap === "number" && taken >= p.cap && !PROTECTED.includes(p.producer)
      ) {
        dropped.push({ producer: p.producer, query_he: text, reason: "producer_cap" });
        continue;
      }
      taken++;
      // Source-mix budgeting: reserve lanes for both nomination buckets so
      // neither actionable targets nor exploratory literature searches can be
      // squeezed out by planner/facet volume.
      const bucket = bucketOf(q);
      let reserved = false;
      if (bucket === "actionable") {
        reserved = actionableSeen < reserveActionable;
        actionableSeen++;
      } else if (bucket === "exploratory") {
        reserved = exploratorySeen < reserveExploratory;
        exploratorySeen++;
      }
      entries.push({
        producer: p.producer,
        query: q,
        norm: normalizeQueryText(text),
        toks: tokens(text),
        bucket,
        reserved,
      });
    }
  }

  entries.sort((a, b) =>
    PRODUCER_PRIORITY[a.producer] - PRODUCER_PRIORITY[b.producer] ||
    (a.reserved === b.reserved ? 0 : a.reserved ? -1 : 1)
  );

  const keptProtected: Query[] = [];
  const kept: Query[] = [];
  const keptEntries: Entry[] = [];
  const seenExact = new Map<string, string>();
  let actionableKept = 0;
  let exploratoryKept = 0;

  for (const e of entries) {
    const isProtected = PROTECTED.includes(e.producer);
    const dupOf = seenExact.get(e.norm);
    if (dupOf !== undefined) {
      dropped.push({
        producer: e.producer,
        query_he: e.query.query_he,
        reason: "duplicate_exact",
        duplicate_of: dupOf,
      });
      continue;
    }
    const near = keptEntries.find((k) => jaccard(k.toks, e.toks) >= nearThreshold);
    if (near) {
      dropped.push({
        producer: e.producer,
        query_he: e.query.query_he,
        reason: "duplicate_near",
        duplicate_of: near.query.query_he,
      });
      continue;
    }
    // Reserved bucket lanes survive the global ceiling.
    if (!isProtected && !e.reserved && kept.length >= opts.max_total) {
      dropped.push({ producer: e.producer, query_he: e.query.query_he, reason: "total_cap" });
      continue;
    }
    seenExact.set(e.norm, e.query.query_he);
    keptEntries.push(e);
    byProducer[e.producer] = (byProducer[e.producer] ?? 0) + 1;
    if (e.bucket === "actionable") actionableKept++;
    else if (e.bucket === "exploratory") exploratoryKept++;
    if (isProtected) keptProtected.push(e.query);
    else kept.push(e.query);
  }


  const source_type_mix: Record<string, number> = {};
  for (const q of [...keptProtected, ...kept]) {
    const t = String(q.expected_source_type ?? "other");
    source_type_mix[t] = (source_type_mix[t] ?? 0) + 1;
  }

  const plannerCount = producers.find((p) => p.producer === "planner")?.queries.length ?? 0;
  const nominationCount =
    producers.find((p) => p.producer === "source_nomination")?.queries.length ?? 0;

  return {
    queries: kept,
    protectedQueries: keptProtected,
    report: {
      version: QUERY_MERGE_VERSION,
      planner_queries_count: plannerCount,
      nomination_queries_count: nominationCount,
      queries_added_from_nomination: byProducer["source_nomination"] ?? 0,
      queries_by_producer: byProducer,
      queries_skipped_duplicate: dropped.filter((d) => d.reason.startsWith("duplicate")).length,
      queries_skipped_budget: dropped.filter(
        (d) => d.reason === "total_cap" || d.reason === "producer_cap",
      ).length,
      final_query_count: keptProtected.length + kept.length,
      source_type_mix,
      actionable_queries: actionableSeen,
      exploratory_queries: exploratorySeen,
      actionable_queries_preserved: actionableKept,
      exploratory_queries_preserved: exploratoryKept,
      actionability_mix: opts.nomination_stats?.actionability_mix ?? {},
      identifier_confidence_histogram:
        opts.nomination_stats?.identifier_confidence_histogram ?? {},
      stripped_identifiers: opts.nomination_stats?.stripped_identifiers ?? 0,
      demoted_identifiers: opts.nomination_stats?.demoted_identifiers ?? 0,
      dropped,

    },
  };
}
