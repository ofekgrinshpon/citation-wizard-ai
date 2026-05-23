// =========================================================================
// legal-research-v1 — clean-slate research pipeline
// Phase: P1 (skeleton) + P2 (Claim Analyzer + Research Query Planner)
//
// Not yet implemented (intentionally):
//   P3 retrieval, P4 verifier, P5 drafter/footnotes, P6 frontend, P7 GA.
//
// See README.md and .lovable/plan.md for the full plan.
// =========================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { runClaimAnalyzer } from "./stages/claimAnalyzer.ts";
import { runQueryPlanner } from "./stages/queryPlanner.ts";
import { runLocalRetrieval } from "./stages/localRetrieval.ts";
import { runPerplexityRetrieval } from "./stages/perplexityRetrieval.ts";
import { buildCandidatePool } from "./stages/candidatePool.ts";
import { runVerifier } from "./stages/verifier.ts";
import { makeAdminClient, writeTelemetry } from "./lib/telemetry.ts";
import { StageRun } from "./lib/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STUB_ANSWER = "[stub] התשובה תיווצר בשלב P5. כרגע הצינור מבצע רק ניתוח טענות ותכנון שאילתות מחקר.";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });

  const run_id = crypto.randomUUID();
  const t_start = Date.now();
  const stage_runs: StageRun[] = [];

  // ─── Auth (with internal smoke-mode bypass) ──────────────────────────────
  // Smoke mode: header `x-smoke-mode: 1` + Authorization equal to service role
  // key. Runs the pipeline as a background task and returns {run_id} 202.
  // Telemetry is still written to qa_logs under the supplied smoke_user_id.
  // Never exposed in UI; service-role only.
  const authHeader = req.headers.get("Authorization");
  const smokeMode = req.headers.get("x-smoke-mode") === "1";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse(401, { error: "unauthorized", reason: "no_bearer" });
  }
  const token = authHeader.replace("Bearer ", "");

  // Service-role detection: either exact env match (covers sb_secret_… keys)
  // OR a JWT whose `role` claim is "service_role" (covers legacy JWT keys).
  let isServiceRole = !!token && token === serviceKey;
  if (!isServiceRole && token.split(".").length === 3) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload?.role === "service_role") isServiceRole = true;
    } catch { /* not a JWT */ }
  }
  console.log("[lrv1 auth]", { smokeMode, isServiceRole });

  let userId: string;
  let userClient: ReturnType<typeof createClient> | null = null;
  if (smokeMode && isServiceRole) {
    const peekBody = await req.clone().json().catch(() => ({}));
    const smokeUid = typeof (peekBody as { smoke_user_id?: unknown }).smoke_user_id === "string"
      ? (peekBody as { smoke_user_id: string }).smoke_user_id : "";
    if (!smokeUid || !UUID_RE.test(smokeUid)) {
      return jsonResponse(400, { error: "smoke_missing_user_id" });
    }
    userId = smokeUid;
  } else {
    userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !user) return jsonResponse(401, { error: "unauthorized", reason: "getuser_failed", err: userErr?.message });
    userId = user.id;
  }
  const user = { id: userId };

  // ─── Body validation ─────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return jsonResponse(400, { error: "invalid_input", field: "question" });
  if (question.length > 4000) return jsonResponse(400, { error: "question_too_long" });

  const project_id_raw = body.project_id;
  let project_id: string | null = null;
  if (project_id_raw !== undefined && project_id_raw !== null) {
    if (typeof project_id_raw !== "string" || !UUID_RE.test(project_id_raw)) {
      return jsonResponse(400, { error: "invalid_input", field: "project_id" });
    }
    project_id = project_id_raw;
  }

  // ─── Credit pre-flight (skipped in smoke mode) ───────────────────────────
  if (!smokeMode && userClient) {
    try {
      const { data: profile } = await userClient
        .from("profiles")
        .select("included_credits_remaining, topup_credits_remaining, plan")
        .eq("id", user.id)
        .maybeSingle();
      if (profile) {
        const plan = (profile as { plan?: string }).plan;
        const total =
          ((profile as { included_credits_remaining?: number }).included_credits_remaining ?? 0) +
          ((profile as { topup_credits_remaining?: number }).topup_credits_remaining ?? 0);
        if (plan !== "admin" && total < 5) {
          return jsonResponse(402, { error: "INSUFFICIENT_CREDITS", required: 5, remaining: total });
        }
      }
    } catch (e) {
      console.warn("[legal-research-v1] credit pre-flight skipped:", e);
    }
  }

  const admin = makeAdminClient();
  const telemetryBase = {
    user_id: user.id,
    project_id,
    question,
    answer: STUB_ANSWER,
    footnotes: [] as unknown[],
  };

  // Wrap the whole pipeline so smoke mode can run it in the background.
  const runPipeline = async (): Promise<Response> => {

  // ─── P2: Claim Analyzer ──────────────────────────────────────────────────
  let analyzerStage;
  try {
    analyzerStage = await runClaimAnalyzer(question);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await writeTelemetry(admin, {
      ...telemetryBase,
      metadata: {
        pipeline: "legal-research-v1",
        phase: "P2",
        run_id,
        stage_runs,
        error: { stage: "claim_analyzer", message: msg },
      },
    });
    return jsonResponse(500, { error: "stage_failed", stage: "claim_analyzer", detail: msg });
  }
  stage_runs.push(...analyzerStage.stage_runs);

  const analyzer = analyzerStage.result.value;
  const analyzerOk = analyzerStage.result.ok && !!analyzer && analyzer.claims.length > 0;
  if (!analyzerOk) {
    const planning_error = {
      stage: "claim_analyzer",
      reasons: [
        ...analyzerStage.escalation_reasons,
        ...analyzerStage.result.errors,
      ],
    };
    await writeTelemetry(admin, {
      ...telemetryBase,
      metadata: {
        pipeline: "legal-research-v1",
        phase: "P2",
        run_id,
        stage_runs,
        planning: {
          analyzer: {
            model_initial: analyzerStage.model_initial,
            model_final: analyzerStage.model_final,
            escalated_to_gpt5: analyzerStage.escalated,
            escalation_reason: analyzerStage.escalation_reasons,
            confidence: analyzer?.confidence ?? null,
            schema_valid: analyzerStage.result.ok,
            ms: analyzerStage.stage_runs.reduce((s, r) => s + r.ms, 0),
          },
          claims_count: analyzer?.claims.length ?? 0,
          queries_count: 0,
          truncated_claims_count: analyzerStage.result.truncated_claims_count,
          truncated_queries_count: 0,
          planning_error,
        },
      },
    });
    return jsonResponse(422, {
      answer: STUB_ANSWER,
      footnotes: [],
      debug: {
        run_id,
        phase: "P2",
        stage_runs,
        planning_error,
        claims: analyzer?.claims ?? [],
        queries: [],
      },
    });
  }

  // ─── P2: Research Query Planner ──────────────────────────────────────────
  let plannerStage;
  try {
    plannerStage = await runQueryPlanner(question, analyzer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await writeTelemetry(admin, {
      ...telemetryBase,
      metadata: {
        pipeline: "legal-research-v1",
        phase: "P2",
        run_id,
        stage_runs,
        error: { stage: "query_planner", message: msg },
      },
    });
    return jsonResponse(500, { error: "stage_failed", stage: "query_planner", detail: msg });
  }
  stage_runs.push(...plannerStage.stage_runs);

  const planner = plannerStage.result.value;
  const plannerOk = plannerStage.result.ok && !!planner && planner.queries.length > 0;

  const planningMeta = {
    analyzer: {
      model_initial: analyzerStage.model_initial,
      model_final: analyzerStage.model_final,
      escalated_to_gpt5: analyzerStage.escalated,
      escalation_reason: analyzerStage.escalation_reasons,
      confidence: analyzer.confidence,
      legal_area: analyzer.legal_area,
      answer_type: analyzer.answer_type,
      schema_valid: analyzerStage.result.ok,
      ms: analyzerStage.stage_runs.reduce((s, r) => s + r.ms, 0),
    },
    planner: {
      model_initial: plannerStage.model_initial,
      model_final: plannerStage.model_final,
      escalated_to_gpt5: plannerStage.escalated,
      escalation_reason: plannerStage.escalation_reasons,
      schema_valid: plannerStage.result.ok,
      ms: plannerStage.stage_runs.reduce((s, r) => s + r.ms, 0),
    },
    claims_count: analyzer.claims.length,
    queries_count: planner?.queries.length ?? 0,
    truncated_claims_count: analyzerStage.result.truncated_claims_count,
    truncated_queries_count: plannerStage.result.truncated_queries_count,
  };

  if (!plannerOk) {
    const planning_error = {
      stage: "query_planner",
      reasons: [
        ...plannerStage.escalation_reasons,
        ...plannerStage.result.errors,
      ],
    };
    await writeTelemetry(admin, {
      ...telemetryBase,
      metadata: {
        pipeline: "legal-research-v1",
        phase: "P2",
        run_id,
        stage_runs,
        planning: { ...planningMeta, planning_error },
      },
    });
    return jsonResponse(422, {
      answer: STUB_ANSWER,
      footnotes: [],
      debug: {
        run_id,
        phase: "P2",
        stage_runs,
        planning_error,
        claims: analyzer.claims,
        queries: planner?.queries ?? [],
      },
    });
  }

  // ─── P3: Retrieval (local DB + Perplexity) ───────────────────────────────
  const tRetrieval = Date.now();
  const [local, pplx] = await Promise.all([
    runLocalRetrieval(admin, planner!.queries, { question, claims: analyzer.claims }),
    runPerplexityRetrieval(planner!.queries),
  ]);
  stage_runs.push(...local.stage_runs, ...pplx.stage_runs);
  const pool = buildCandidatePool([...local.candidates, ...pplx.candidates]);
  const role_corrections = pplx.per_query.flatMap((pq) =>
    pq.results
      .filter((r) => r.role_corrected_from)
      .map((r) => ({
        claim_id: pq.claim_id,
        from: r.role_corrected_from,
        to: r.role_corrected_to,
        url: r.url,
        title: r.title,
        admitted: r.admitted_to_candidate_pool,
      })),
  );
  const retrievalMeta = {
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
      role_corrections,
    },
    pool: {
      found: pool.found,
      after_dedup: pool.after_dedup,
      dedup_drops: pool.dedup_drops,
      counts: pool.counts,
    },
  };

  // ─── Success: write telemetry + return P3 payload ────────────────────────
  await writeTelemetry(admin, {
    ...telemetryBase,
    metadata: {
      pipeline: "legal-research-v1",
      phase: "P3",
      run_id,
      total_ms: Date.now() - t_start,
      stage_runs,
      planning: planningMeta,
      claims: analyzer.claims,
      queries: planner!.queries,
      retrieval: retrievalMeta,
      candidates: pool.candidates,
      dropped_sources: pplx.dropped,
    },
  });

  return jsonResponse(200, {
    answer: STUB_ANSWER,
    footnotes: [],
    debug: {
      run_id,
      phase: "P3",
      stage_runs,
      planning: planningMeta,
      claims: analyzer.claims,
      queries: planner!.queries,
      retrieval: retrievalMeta,
      candidates: pool.candidates,
      dropped_sources: pplx.dropped,
    },
  });
  }; // end runPipeline

  if (smokeMode) {
    const bg = runPipeline().catch((e) => console.error("[lrv1 smoke bg]", e));
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(bg);
    }
    return jsonResponse(202, { ok: true, run_id, smoke: true });
  }
  return await runPipeline();
}

serve(handle);
