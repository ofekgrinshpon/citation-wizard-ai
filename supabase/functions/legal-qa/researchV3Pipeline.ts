// Research V3 — Deep pipeline (gated by RESEARCH_V3=true).
//
// Step 1 (current): produce a LegalResearchPlan with `expected_anchors` in
// parallel with V2's existing planner+retrieval. V2 still owns retrieval,
// verification, ledger, drafter. V3 only adds the anchors-expected layer
// and stamps it into metadata for inspection.
//
// Step 2+ (future): exact-anchor retrieval track, anchor lifecycle telemetry,
// ledger integration, mini-eval. V2 modules are NOT deleted.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { runResearchV2, type RunResearchV2Args, type RunResearchV2Result } from "./researchV2Pipeline.ts";
import { TIER_A_DOMAINS, TIER_B_DOMAINS } from "./approvedDomains.ts";
import {
  buildLegalResearchPlanV3,
  summarizeLegalResearchPlanV3,
} from "./legalResearchPlanV3.ts";

export function researchV3Enabled(): boolean {
  const raw = (Deno.env.get("RESEARCH_V3") ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

export interface RunResearchV3Args extends RunResearchV2Args {}
export interface RunResearchV3Result extends RunResearchV2Result {}

export async function runResearchV3(args: RunResearchV3Args): Promise<RunResearchV3Result> {
  console.log(`[research_v3] step1 gate ON — LegalResearchPlan(v3) || V2 retrieval`);

  // Run V3 plan in parallel with full V2 pipeline so we don't add wall-time.
  // V3 plan failures NEVER block V2 — they're soft telemetry only.
  const v3PlanT0 = Date.now();
  const [v2Result, v3PlanRes] = await Promise.all([
    runResearchV2(args),
    buildLegalResearchPlanV3({ question: args.question, depth: "deep" })
      .catch((e) => ({
        plan: null,
        run: { stage: "legal_research_plan_v3", status: "error" as const, model: null, duration_ms: 0, error_message: (e as Error).message },
        fallback_reason: "exception",
      })),
  ]);
  const v3PlanWallMs = Date.now() - v3PlanT0;

  const v3Summary = summarizeLegalResearchPlanV3(v3PlanRes.plan, v3PlanRes.run);
  console.log(
    `[research_v3] LegalResearchPlanV3 status=${v3PlanRes.run.status} anchors=${v3Summary.anchor_count} ` +
    `seminal=${v3Summary.by_centrality.seminal} model=${v3PlanRes.run.model ?? "none"}`,
  );

  const stampedMetadata = {
    ...(v2Result.metadata ?? {}),
    v3_path: "deep_v3_step1_plan",
    v3_approved_domains: {
      tier_a_count: TIER_A_DOMAINS.length,
      tier_b_count: TIER_B_DOMAINS.length,
    },
    v3_legal_research_plan: {
      ...v3Summary,
      wall_ms: v3PlanWallMs,
      ...(v3PlanRes.fallback_reason ? { fallback_reason: v3PlanRes.fallback_reason } : {}),
      // Full anchors kept here for triage. NOT used by retrieval in step 1.
      anchors: v3PlanRes.plan?.expected_anchors ?? [],
      frame: v3PlanRes.plan?.frame ?? null,
    },
  };
  return { ...v2Result, metadata: stampedMetadata };
}
