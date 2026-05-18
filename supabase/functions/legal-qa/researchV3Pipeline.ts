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
 * Convert a V3 ExpectedAnchor into 1–3 concrete Hebrew search queries that
 * V2 retrieval can execute against local DB + Perplexity. Mirrors the
 * shape that AnswerMap's sanitizer enforces (≥3 chars, ≤160 chars, ≤3).
 */
function buildAnchorQueries(a: V3ExpectedAnchor): string[] {
  const queries = new Set<string>();
  const name = (a.name || "").trim();
  const docket = (a.docket || "").trim();
  const section = (a.section || "").trim();

  if (a.type === "leading_case" && docket) {
    // Docket-first query is the strongest signal for case retrieval.
    queries.add(docket.slice(0, 160));
    if (name) {
      // Combined docket + party name (deduped via the regex below).
      const combo = `${docket} ${name.replace(docket, "").trim()}`.trim();
      if (combo.length >= 3) queries.add(combo.slice(0, 160));
    }
  } else if (
    (a.type === "statute_section" || a.type === "basic_law_section" || a.type === "regulation")
    && section
  ) {
    // "סעיף N לחוק X" canonical form.
    queries.add(`סעיף ${section} ל${name}`.slice(0, 160));
    queries.add(name.slice(0, 160));
  } else if (name) {
    queries.add(name.slice(0, 160));
  }
  return [...queries].filter((q) => q.trim().length >= 3).slice(0, 3);
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

  const v2Result = await runResearchV2({
    ...args,
    externalAnchorsPromise,
    // V3 plan timed at ~68s on Q3; AnswerMap typically completes ~50–90s in.
    // 75s gives V3 room to land before V2 reconciles, with a hard cap.
    externalAnchorsTimeoutMs: 75000,
    externalAnchorsSource: "v3_legal_research_plan",
  });

  // V3 plan result should be settled by now since V2 awaited the promise.
  if (!v3PlanResult) {
    // Defensive: if V2 returned without awaiting (e.g. empty plan early-exit),
    // briefly await V3 so telemetry isn't lost.
    await v3PlanPromise.catch(() => {});
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

  const v3PlanWallMs = Date.now() - v3PlanT0;
  const stampedMetadata = {
    ...(v2Result.metadata ?? {}),
    v3_path: "deep_v3_step2_anchor_merge",
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
  };
  return { ...v2Result, metadata: stampedMetadata };
}
