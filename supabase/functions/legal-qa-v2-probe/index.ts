// Standalone V2 dry-run probe: ResearchPlan → ClaimRetrieval → Ledger.
// Does NOT call the drafter. Returns a structured report per question.
//
// POST body: { questions: string[], depth?: "fast"|"deep" }
// Auth: requires service-role key or a logged-in user (we just need admin client).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { buildResearchPlan, summarizeResearchPlan } from "../legal-qa/researchPlan.ts";
import { retrieveClaims, summarizeRetrieval } from "../legal-qa/claimRetrieval.ts";
import { verifyAndBuildLedger, summarizeLedger } from "../legal-qa/ledger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

async function embed(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) return null;
  try {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 2000), dimensions: 768 }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.data?.[0]?.embedding ?? null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const questions: string[] = Array.isArray(body.questions) ? body.questions : [];
    const depth: "fast" | "deep" = body.depth === "fast" ? "fast" : "deep";
    if (questions.length === 0) {
      return new Response(JSON.stringify({ error: "questions[] required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);
    const report: unknown[] = [];

    for (const question of questions) {
      const t0 = Date.now();
      // A. ResearchPlan
      const { plan, run: planRun } = await buildResearchPlan({ question, depth });
      if (!plan) {
        report.push({ question, error: "research_plan_failed", planRun });
        continue;
      }

      // B. ClaimRetrieval
      const packs = await retrieveClaims({
        adminClient, claims: plan.claims, depth, embed,
      });

      // C. Ledger
      const { ledger, runs: verifyRuns } = await verifyAndBuildLedger({
        claims: plan.claims, packs, depth, thesis: plan.thesis,
      });

      report.push({
        question,
        elapsed_ms: Date.now() - t0,
        A_research_plan: {
          summary: summarizeResearchPlan(plan, planRun),
          thesis: plan.thesis,
          claim_count: plan.claims.length,
          claims: plan.claims.map(c => ({
            id: c.id, statement: c.statement, kind: c.kind,
            required_evidence: c.required_evidence,
            search_targets: c.search_targets,
            hedge_if_partial: c.hedge_if_partial,
          })),
          counter_claims: plan.counter_claims,
        },
        B_retrieval: {
          summary: summarizeRetrieval(packs),
          per_claim: packs.map(p => ({
            claim_id: p.claimId,
            local_text_n: p.candidates.filter(c => c.origin === "text").length,
            local_vector_n: p.candidates.filter(c => c.origin === "vector").length,
            external_queries: p.externalQueries,
            top3: p.candidates.slice(0, 3).map(c => ({
              id: c.id, score: +c.score.toFixed(3), origin: c.origin,
              source_type: c.sourceType, title: c.title.slice(0, 120),
              citation: c.citation.slice(0, 140),
            })),
          })),
        },
        C_ledger: {
          summary: summarizeLedger(ledger),
          kept: ledger.entries.map(e => ({
            claim_id: e.claimId, claim: e.claim, verdict: e.verdict,
            hedge: e.hedge, hedge_template: e.hedgeTemplate,
            source_ids: e.sources.map(s => s.id),
            sources: e.sources.map(s => ({
              id: s.id, support: s.support, source_type: s.sourceType,
              title: s.title.slice(0, 120), citation: s.citation.slice(0, 140),
            })),
            evidence_note: e.evidenceNote,
          })),
          dropped: ledger.dropped,
          verdict_counts: {
            kept_supported: ledger.entries.filter(e => e.verdict === "supported").length,
            kept_partial: ledger.entries.filter(e => e.verdict === "partially_supported").length,
            dropped_unsupported: ledger.dropped.length,
          },
          verify_runs: verifyRuns.map(r => ({
            stage: r.stage, status: r.status, model: r.model, duration_ms: r.duration_ms,
            error: r.error_message,
          })),
        },
      });
    }

    return new Response(JSON.stringify({ depth, report }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e), stack: String(e?.stack ?? "") }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
