// Research V3 — scaffolding (gated by RESEARCH_V3=true, Deep only).
//
// V3 lives alongside V2 (V2 modules are NOT deleted). The goal of V3 is to
// land an early, explicit "legal research plan" with expected anchors
// (statutes, sections, cases, academics) and gate retrieval/verification on
// recall against that plan.
//
// This file currently provides:
//   • the `researchV3Enabled()` env flag (RESEARCH_V3=true);
//   • a `runResearchV3()` entry point that, for now, delegates to V2 and
//     stamps `v3_path: "deep_v3_scaffold"` plus the approved-domain tiering
//     into metadata. Real plan-first logic lands in the next patch.
//
// Wiring rule (caller in index.ts):
//   if (researchV3Enabled() && depth === "deep" && !academic && !evalForceLegacy) → V3
//   else if (researchV2Enabled() && depth === "deep" ...)                          → V2
//   else                                                                            → V1
// Fast remains V2/current. Academic remains V1.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { runResearchV2, type RunResearchV2Args, type RunResearchV2Result } from "./researchV2Pipeline.ts";
import { TIER_A_DOMAINS, TIER_B_DOMAINS } from "./approvedDomains.ts";

export function researchV3Enabled(): boolean {
  const raw = (Deno.env.get("RESEARCH_V3") ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

export interface RunResearchV3Args extends RunResearchV2Args {}
export interface RunResearchV3Result extends RunResearchV2Result {}

export async function runResearchV3(args: RunResearchV3Args): Promise<RunResearchV3Result> {
  console.log(`[research_v3] scaffold gate ON — delegating to V2 with V3 stamp`);
  const v2 = await runResearchV2(args);
  const stampedMetadata = {
    ...(v2.metadata ?? {}),
    v3_path: "deep_v3_scaffold",
    v3_approved_domains: {
      tier_a_count: TIER_A_DOMAINS.length,
      tier_b_count: TIER_B_DOMAINS.length,
    },
  };
  return { ...v2, metadata: stampedMetadata };
}
