// TEMPORARY SMOKE RUNNER — service-role only. Not exposed in UI.
// Triggers the legal-research-v1 P3 pipeline in the background, writes the
// resulting metadata blob into qa_logs (with task_mode='lrv1_smoke'), and
// returns immediately so the caller can poll.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { runClaimAnalyzer } from "../legal-research-v1/stages/claimAnalyzer.ts";
import { runQueryPlanner } from "../legal-research-v1/stages/queryPlanner.ts";
import { runLocalRetrieval } from "../legal-research-v1/stages/localRetrieval.ts";
import { runPerplexityRetrieval } from "../legal-research-v1/stages/perplexityRetrieval.ts";
import { buildCandidatePool } from "../legal-research-v1/stages/candidatePool.ts";
import { makeAdminClient, writeTelemetry } from "../legal-research-v1/lib/telemetry.ts";
import { StageRun } from "../legal-research-v1/lib/types.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const FIXTURES: Record<string, string> = {
  L3: "מתי בית המשפט יפחית פיצוי מוסכם לפי סעיף 15 לחוק החוזים תרופות?",
  L4: "מהי דוקטרינת השתק פלוגתא?",
};

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

async function runPipeline(question: string, run_id: string, smoke_user_id: string, fixture: string) {
  const admin = makeAdminClient();
  const t_start = Date.now();
  const stage_runs: StageRun[] = [];
  try {
    const analyzerStage = await runClaimAnalyzer(question);
    stage_runs.push(...analyzerStage.stage_runs);
    const analyzer = analyzerStage.result.value;
    if (!analyzer || !analyzer.claims.length) throw new Error("analyzer_failed");

    const plannerStage = await runQueryPlanner(question, analyzer);
    stage_runs.push(...plannerStage.stage_runs);
    const planner = plannerStage.result.value;
    if (!planner || !planner.queries.length) throw new Error("planner_failed");

    const tRetrieval = Date.now();
    const [local, pplx] = await Promise.all([
      runLocalRetrieval(admin, planner.queries, { question, claims: analyzer.claims }),
      runPerplexityRetrieval(planner.queries),
    ]);
    stage_runs.push(...local.stage_runs, ...pplx.stage_runs);
    const pool = buildCandidatePool([...local.candidates, ...pplx.candidates]);

    await writeTelemetry(admin, {
      user_id: smoke_user_id,
      project_id: null,
      question,
      answer: `[smoke ${fixture}]`,
      footnotes: [],
      metadata: {
        pipeline: "legal-research-v1-smoke",
        smoke_fixture: fixture,
        phase: "P3",
        run_id,
        total_ms: Date.now() - t_start,
        stage_runs,
        planning: {
          analyzer: {
            model_initial: analyzerStage.model_initial,
            model_final: analyzerStage.model_final,
            escalated_to_gpt5: analyzerStage.escalated,
            ms: analyzerStage.stage_runs.reduce((s, r) => s + r.ms, 0),
          },
          planner: {
            model_initial: plannerStage.model_initial,
            model_final: plannerStage.model_final,
            escalated_to_gpt5: plannerStage.escalated,
            ms: plannerStage.stage_runs.reduce((s, r) => s + r.ms, 0),
          },
          claims_count: analyzer.claims.length,
          queries_count: planner.queries.length,
        },
        claims: analyzer.claims,
        queries: planner.queries,
        retrieval: {
          ms: Date.now() - tRetrieval,
          local: {
            ms: local.ms,
            candidates: local.candidates.length,
            per_query: local.per_query,
            global_exact: local.global_exact,
          },
          perplexity: {
            ms: pplx.ms,
            candidates: pplx.candidates.length,
            dropped: pplx.dropped.length,
            per_query: pplx.per_query,
          },
          pool: {
            found: pool.found,
            after_dedup: pool.after_dedup,
            counts: pool.counts,
          },
        },
        candidates: pool.candidates,
        dropped_sources: pplx.dropped,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await writeTelemetry(admin, {
      user_id: smoke_user_id,
      project_id: null,
      question,
      answer: `[smoke ${fixture} error]`,
      footnotes: [],
      metadata: {
        pipeline: "legal-research-v1-smoke",
        smoke_fixture: fixture,
        phase: "ERROR",
        run_id,
        total_ms: Date.now() - t_start,
        stage_runs,
        error: msg,
      },
    });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405, headers: cors });

  // Service-role gate.
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!token || token !== serviceKey) {
    return new Response(JSON.stringify({ error: "service_role_required" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const fixture = String(body.fixture || "").toUpperCase();
  const smoke_user_id = String(body.smoke_user_id || "");
  if (!FIXTURES[fixture]) {
    return new Response(JSON.stringify({ error: "invalid_fixture", allowed: Object.keys(FIXTURES) }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (!smoke_user_id) {
    return new Response(JSON.stringify({ error: "missing_smoke_user_id" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const run_id = crypto.randomUUID();
  const work = runPipeline(FIXTURES[fixture], run_id, smoke_user_id, fixture);
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    EdgeRuntime.waitUntil(work);
  } else {
    // Fallback: detach
    work.catch((e) => console.error("smoke_bg_error", e));
  }

  return new Response(JSON.stringify({ ok: true, run_id, fixture }), {
    status: 202, headers: { ...cors, "Content-Type": "application/json" },
  });
});
