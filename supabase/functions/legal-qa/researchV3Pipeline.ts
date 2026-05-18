// Research V3 — Deep pipeline (gated by RESEARCH_V3=true).
//
// Step 2: V3 LegalResearchPlan runs in parallel with V2's research_plan +
// AnswerMap. Its expected_anchors are converted to V2 DoctrinalAnchor shape
// and injected into V2 via the new `externalAnchorsPromise` arg, where V2's
// existing reconciliation → retrieval → verification → lifecycle machinery
// handles them identically to AnswerMap anchors.
//
// V2 modules are NOT modified beyond the externalAnchorsPromise hook. On any
// V3 failure (plan timeout, empty anchors, conversion error) V2 still runs
// to completion — V3 is strictly additive.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { runResearchV2, type RunResearchV2Args, type RunResearchV2Result } from "./researchV2Pipeline.ts";
import { TIER_A_DOMAINS, TIER_B_DOMAINS } from "./approvedDomains.ts";
import { runAnchorFallback, anchorKey, type AnchorFallbackResult } from "./anchorFallbackV3.ts";
import type { ClaimCandidateSource } from "./claimRetrieval.ts";
import {
  buildLegalResearchPlanV3,
  summarizeLegalResearchPlanV3,
  type LegalResearchPlanV3,
  type V3ExpectedAnchor,
} from "./legalResearchPlanV3.ts";
import type { DoctrinalAnchor, AnchorType } from "./answerMap.ts";

export function researchV3Enabled(): boolean {
  const raw = (Deno.env.get("RESEARCH_V3") ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

export interface RunResearchV3Args extends RunResearchV2Args {}
export interface RunResearchV3Result extends RunResearchV2Result {}

// V3 anchor types map 1:1 to V2 AnswerMap types except `committee_report`,
// which V2 also supports verbatim. V3 has no `secondary_case`.
const V3_TO_V2_TYPE: Record<V3ExpectedAnchor["type"], AnchorType> = {
  statute_section: "statute_section",
  basic_law_section: "basic_law_section",
  regulation: "regulation",
  leading_case: "leading_case",
  academic: "academic",
  committee_report: "committee_report",
};

const V3_TO_V2_CENTRALITY = {
  seminal: "seminal",
  supporting: "supporting",
  background: "peripheral",
} as const;

/**
 * Step 2.1 — Short, tight queries optimised for FTS hit rate.
 *
 *   • leading_case      → docket-only first (e.g. `ע"א 6821/93`), then a
 *                         short party name (e.g. `בנק המזרחי`) without the
 *                         long "...בע"מ נ' שר האוצר" trailer that starves
 *                         the text index.
 *   • statute / basic   → short title + short section, e.g.
 *     law / regulation    `חוק-יסוד: כבוד האדם וחירותו סעיף 8`
 *                         and the bare short title as a backup.
 *   • academic / other  → just the short name.
 *
 * Cap: 2 queries per anchor (was 3); each ≤120 chars (was 160). Hebrew
 * tokens are heavy in the FTS pipeline — shorter is better.
 */
function shortCaseName(name: string, docket: string): string {
  // Strip the docket if it was embedded in the name. Then take the head of
  // the party name up to "נ'" / "נ' " / "בע"מ" / first comma.
  let n = (name || "").trim();
  if (docket) n = n.replace(docket, "").trim();
  // Cut at "נ'" / "נ׳" / " נ " (the "vs.") — keep only the first party.
  n = n.split(/\s+נ['׳]\s+/)[0];
  // Cut at "בע"מ" / "בע״מ" — drop corporate trailer for FTS.
  n = n.split(/\s+בע["״]מ/)[0];
  // Cut at first comma (publication ref).
  n = n.split(",")[0];
  return n.trim().slice(0, 60);
}

function shortStatuteName(name: string): string {
  // Drop the trailing ", התש...-YYYY" tail and any "ס"ח" reference. Keeps
  // the canonical short title (e.g. `חוק-יסוד: כבוד האדם וחירותו`).
  let n = (name || "").trim();
  n = n.split(",")[0];
  n = n.replace(/\s+ס["״]ח.*$/i, "").replace(/\s+ק["״]ת.*$/i, "");
  return n.trim().slice(0, 80);
}

function buildAnchorQueries(a: V3ExpectedAnchor): string[] {
  const queries = new Set<string>();
  const name = (a.name || "").trim();
  const docket = (a.docket || "").trim();
  const section = (a.section || "").trim();

  if (a.type === "leading_case") {
    // 1. Docket-only — tightest possible FTS signal for caselaw.
    if (docket) queries.add(docket.slice(0, 60));
    // 2. Short party name as backup (no "נ'", no "בע"מ", no publication tail).
    const shortName = shortCaseName(name, docket);
    if (shortName.length >= 3) queries.add(shortName);
  } else if (a.type === "statute_section" || a.type === "basic_law_section" || a.type === "regulation") {
    const shortName = shortStatuteName(name);
    if (shortName && section) {
      queries.add(`${shortName} סעיף ${section}`.slice(0, 120));
    }
    if (shortName) queries.add(shortName);
  } else if (name) {
    queries.add(shortStatuteName(name));
  }
  return [...queries].filter((q) => q.trim().length >= 3).slice(0, 2);
}

function convertV3AnchorsToV2(plan: LegalResearchPlanV3 | null): DoctrinalAnchor[] {
  if (!plan) return [];
  const out: DoctrinalAnchor[] = [];
  for (const a of plan.expected_anchors) {
    const v2Type = V3_TO_V2_TYPE[a.type];
    if (!v2Type) continue;
    const queries = buildAnchorQueries(a);
    if (queries.length === 0) continue;
    out.push({
      id: a.id, // V2 merge re-IDs if it collides.
      type: v2Type,
      name: a.name,
      ...(a.docket ? { docket: a.docket } : {}),
      ...(a.section ? { section: a.section } : {}),
      purpose: a.rationale.slice(0, 200),
      centrality: V3_TO_V2_CENTRALITY[a.centrality],
      queries,
    });
  }
  return out;
}

export async function runResearchV3(args: RunResearchV3Args): Promise<RunResearchV3Result> {
  console.log(`[research_v3] step2 gate ON — LegalResearchPlan(v3) → V2 external-anchor merge`);

  // Kick off V3 plan immediately so it runs in parallel with V2's research_plan
  // and AnswerMap. V2 awaits this promise (bounded) after its AnswerMap stage.
  const v3PlanT0 = Date.now();
  let v3PlanResult: Awaited<ReturnType<typeof buildLegalResearchPlanV3>> | null = null;
  let v3PlanError: string | undefined;
  const v3PlanPromise = buildLegalResearchPlanV3({ question: args.question, depth: "deep" })
    .then((r) => { v3PlanResult = r; return r; })
    .catch((e) => {
      v3PlanError = (e as Error).message ?? String(e);
      const errRun = {
        stage: "legal_research_plan_v3", status: "error" as const,
        model: null, duration_ms: 0, error_message: v3PlanError,
      };
      v3PlanResult = { plan: null, run: errRun, fallback_reason: "exception" };
      return v3PlanResult;
    });

  // Wrap as DoctrinalAnchor[] promise for V2. Resolves with [] on any V3 failure.
  const externalAnchorsPromise: Promise<DoctrinalAnchor[]> = v3PlanPromise.then((r) => {
    return convertV3AnchorsToV2(r.plan);
  }).catch(() => []);

  // ── Step 2.2: per-anchor local probe + Perplexity fallback ──────────
  // Runs in parallel with V2. For each V3 anchor we probe local DB, and on
  // 0 local hits fire ONE sonar-pro call scoped to that anchor with the
  // Tier A domain filter. Validated candidates are pre-shaped as V2
  // ClaimCandidateSource entries and handed to V2 via a new promise; V2
  // injects them into the matching claim pack BEFORE verification, so the
  // existing ledger/drafter/citation-engine path stays untouched.
  let fallbackResult: AnchorFallbackResult | null = null;
  const fallbackPromise: Promise<Map<string, ClaimCandidateSource[]>> = v3PlanPromise
    .then(async (r) => {
      const plan = r.plan;
      if (!plan || plan.expected_anchors.length === 0) {
        fallbackResult = { candidatesByAnchorKey: new Map(), perAnchor: [], wall_ms: 0 };
        return fallbackResult.candidatesByAnchorKey;
      }
      const queriesByAnchorId = new Map<string, string[]>();
      for (const a of plan.expected_anchors) {
        queriesByAnchorId.set(a.id, buildAnchorQueries(a));
      }
      try {
        fallbackResult = await runAnchorFallback({
          anchors: plan.expected_anchors,
          queriesByAnchorId,
          adminClient: args.adminClient,
        });
      } catch (e) {
        console.warn("[research_v3] anchor_fallback error:", (e as Error).message);
        fallbackResult = { candidatesByAnchorKey: new Map(), perAnchor: [], wall_ms: 0 };
      }
      return fallbackResult.candidatesByAnchorKey;
    })
    .catch(() => new Map());

  const v2Result = await runResearchV2({
    ...args,
    externalAnchorsPromise,
    // V3 plan timed at ~68s on Q3; AnswerMap typically completes ~50–90s in.
    // 75s gives V3 room to land before V2 reconciles, with a hard cap.
    externalAnchorsTimeoutMs: 75000,
    externalAnchorsSource: "v3_legal_research_plan",
    externalAnchorCandidatesPromise: fallbackPromise,
    // Anchor fallback can take up to ~20s (local probe + Perplexity).
    externalAnchorCandidatesTimeoutMs: 30000,
  });

  // V3 plan result should be settled by now since V2 awaited the promise.
  if (!v3PlanResult) {
    await v3PlanPromise.catch(() => {});
  }
  if (!fallbackResult) {
    await fallbackPromise.catch(() => {});
  }

  const v3Summary = summarizeLegalResearchPlanV3(
    v3PlanResult?.plan ?? null,
    v3PlanResult?.run ?? {
      stage: "legal_research_plan_v3", status: "error",
      model: null, duration_ms: 0,
    },
  );
  console.log(
    `[research_v3] LegalResearchPlanV3 status=${v3PlanResult?.run.status ?? "missing"} ` +
    `anchors=${v3Summary.anchor_count} seminal=${v3Summary.by_centrality.seminal} ` +
    `model=${v3PlanResult?.run.model ?? "none"}`,
  );

  // Backfill `verified` / `cited` from V2 anchor lifecycle (which now
  // includes external-anchor synthetic chunks injected pre-verification).
  const lifecycleAny = (v2Result.metadata as Record<string, unknown>)?.anchor_lifecycle as
    | { per_claim?: Array<{ candidates?: Array<{ anchor_id?: string; verified?: string; cited?: boolean }> }> }
    | undefined;
  const verifiedCountByAnchor = new Map<string, number>();
  const citedCountByAnchor = new Map<string, number>();
  if (lifecycleAny?.per_claim) {
    for (const pc of lifecycleAny.per_claim) {
      for (const c of pc.candidates ?? []) {
        if (!c.anchor_id) continue;
        if (c.verified && c.verified !== "unrelated") {
          verifiedCountByAnchor.set(c.anchor_id, (verifiedCountByAnchor.get(c.anchor_id) ?? 0) + 1);
        }
        if (c.cited) {
          citedCountByAnchor.set(c.anchor_id, (citedCountByAnchor.get(c.anchor_id) ?? 0) + 1);
        }
      }
    }
  }
  if (fallbackResult) {
    for (const pa of fallbackResult.perAnchor) {
      pa.verified = verifiedCountByAnchor.get(pa.anchor_id) ?? 0;
      pa.cited = citedCountByAnchor.get(pa.anchor_id) ?? 0;
    }
  }

  const v3PlanWallMs = Date.now() - v3PlanT0;
  const stampedMetadata = {
    ...(v2Result.metadata ?? {}),
    v3_path: "deep_v3_step2_3_frame_gate",
    v3_approved_domains: {
      tier_a_count: TIER_A_DOMAINS.length,
      tier_b_count: TIER_B_DOMAINS.length,
    },
    v3_legal_research_plan: {
      ...v3Summary,
      wall_ms: v3PlanWallMs,
      ...(v3PlanResult?.fallback_reason ? { fallback_reason: v3PlanResult.fallback_reason } : {}),
      ...(v3PlanError ? { error: v3PlanError } : {}),
      anchors: v3PlanResult?.plan?.expected_anchors ?? [],
      frame: v3PlanResult?.plan?.frame ?? null,
    },
    v3_anchor_fallback: fallbackResult
      ? {
          per_anchor: fallbackResult.perAnchor,
          wall_ms: fallbackResult.wall_ms,
          total_candidates_added: fallbackResult.perAnchor.reduce(
            (n, p) => n + p.candidate_added, 0,
          ),
          total_perplexity_calls: fallbackResult.perAnchor.filter(p => p.perplexity_called).length,
        }
      : { per_anchor: [], wall_ms: 0, total_candidates_added: 0, total_perplexity_calls: 0 },
  };
  return { ...v2Result, metadata: stampedMetadata };
}

