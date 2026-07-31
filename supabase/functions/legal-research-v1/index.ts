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
import { summarizeSynthesisPack, type SynthesisRole } from "./stages/synthesisRole.ts";
import { runVerifier } from "./stages/verifier.ts";
import { runDrafter } from "./stages/drafter.ts";
import { runDrafterV2 } from "./stages/drafterV2.ts";
import { evaluateAnswerStyle } from "./stages/answerStyleGate.ts";
import {
  buildDocketAnchors,
  buildRequiredAnchorQueries,
  buildStatuteSectionAnchors,
  computeRequiredAnchorStatuses,
  pickAnchorsRequiringDrafterLimitation,
  resolveRequiredAnchors,
} from "./stages/requiredAnchors.ts";
import { detectStatuteSections } from "./stages/statuteSectionDetection.ts";
import { makeAdminClient, writeTelemetry } from "./lib/telemetry.ts";
import { extractAttachments, buildAnalyzerContext, ATTACHMENT_LIMITS, type AttachmentInput } from "./lib/attachments.ts";
import { StageRun } from "./lib/types.ts";
import { buildSourcesOnlyPayload } from "./lib/sourcesOnly.ts";

type PipelineMode = "answer" | "sources_only";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STUB_ANSWER = "[stub] התשובה תיווצר בשלב P5. כרגע הצינור מבצע רק ניתוח טענות ותכנון שאילתות מחקר.";
const VERIFIER_FAILURE_ANSWER = "השלב שאמור לאמת את המקורות לא הושלם בהצלחה, ולכן לא ניתן להפיק תשובה משפטית אמינה מהמקורות שנמצאו. נסו להריץ שוב, או צרפו מקור רלוונטי.";


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

  // job row helper (declared early so runPipeline closure can use it)
  let jobId: string | null = null;
  const adminEarly = makeAdminClient();
  const setJobStatus = async (patch: Record<string, unknown>) => {
    if (!jobId) return;
    try {
      await adminEarly.from("legal_research_jobs").update({ ...patch }).eq("id", jobId);
    } catch (e) {
      console.error("[lrv1 job update failed]", e);
    }
  };

  // Per-stage progress tracking for the client UI.
  const completedStages: string[] = [];
  let currentStage: string | null = null;
  const markStage = async (stage: string) => {
    if (currentStage && !completedStages.includes(currentStage)) {
      completedStages.push(currentStage);
    }
    currentStage = stage;
    await setJobStatus({
      current_stage: stage,
      completed_stages: completedStages,
    });
  };
  const completeAllStages = async () => {
    if (currentStage && !completedStages.includes(currentStage)) {
      completedStages.push(currentStage);
    }
    currentStage = null;
    await setJobStatus({
      current_stage: null,
      completed_stages: completedStages,
    });
  };

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

  // Pipeline mode: "answer" (default — current Research v1 behavior) or
  // "sources_only" (skip drafter, return grouped/ranked sources).
  const mode_raw = body.mode;
  let pipeline_mode: PipelineMode = "answer";
  if (mode_raw !== undefined && mode_raw !== null) {
    if (mode_raw !== "answer" && mode_raw !== "sources_only") {
      return jsonResponse(400, { error: "invalid_input", field: "mode" });
    }
    pipeline_mode = mode_raw;
  }
  const is_sources_only = pipeline_mode === "sources_only";

  // Attachments (optional). Up to MAX_FILES PDF/DOCX uploaded to user-documents
  // under {user.id}/research/...
  const attachmentsRaw = Array.isArray(body.attachments) ? body.attachments : [];
  const attachments: AttachmentInput[] = [];
  for (const a of attachmentsRaw.slice(0, ATTACHMENT_LIMITS.MAX_FILES)) {
    const obj = (a ?? {}) as Record<string, unknown>;
    const sp = typeof obj.storage_path === "string" ? obj.storage_path : "";
    const fn = typeof obj.file_name === "string" ? obj.file_name : "";
    const mt = typeof obj.mime_type === "string" ? obj.mime_type : "";
    const sz = typeof obj.size === "number" ? obj.size : undefined;
    if (!sp || !fn || !mt) {
      return jsonResponse(400, { error: "invalid_input", field: "attachments[*]" });
    }
    attachments.push({ storage_path: sp, file_name: fn, mime_type: mt, size: sz });
  }
  const useAsSource = body.use_as_source !== false; // default true
  // (x-atomic-markers header and atomic mode were removed with the Phase 3 cleanup.)

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

  const admin = adminEarly;
  const telemetryBase = {
    user_id: user.id,
    project_id,
    question,
    answer: STUB_ANSWER,
    footnotes: [] as unknown[],
  };

  // ─── Create job row so the client can poll for status/result ─────────────
  try {
    const { data: jobRow, error: jobErr } = await admin
      .from("legal_research_jobs")
      .insert({ user_id: user.id, project_id, question, status: "running" })
      .select("id")
      .single();
    if (jobErr || !jobRow) {
      console.error("[lrv1] job insert failed:", jobErr);
      return jsonResponse(500, { error: "job_insert_failed", detail: jobErr?.message });
    }
    jobId = (jobRow as { id: string }).id;
  } catch (e) {
    return jsonResponse(500, { error: "job_insert_threw", detail: e instanceof Error ? e.message : String(e) });
  }

  // Wrap the whole pipeline so it runs in the background.
  const runPipeline = async (): Promise<Response> => {

  // Detect any docket references early so attachment extraction can raise
  // per-file caps when the user uploads the actual judgment.
  const docketAnchors = buildDocketAnchors(question);
  const docketVariants = docketAnchors.flatMap((a) => a.docket_variants ?? []);

  // ─── P1.5: Extract attachments (PDF/DOCX) ────────────────────────────────
  const attachmentResult = attachments.length > 0
    ? await extractAttachments(admin, user.id, attachments, { priorityDockets: docketVariants })
    : { documents: [], total_chars: 0, global_truncated: false, errors: [], ms: 0 };
  if (attachments.length > 0) {
    stage_runs.push({
      stage: "attachments.extract",
      ms: attachmentResult.ms,
      ok: attachmentResult.documents.some((d) => d.chunks.length > 0),
    });
  }
  const analyzerContext = buildAnalyzerContext(attachmentResult.documents);

  // ─── P2: Claim Analyzer ──────────────────────────────────────────────────
  await markStage("analyzer");
  let analyzerStage;
  try {
    analyzerStage = await runClaimAnalyzer(question, { attachmentsContext: analyzerContext });
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
    const transport_failed = analyzerStage.transport_failed;
    const planning_error = {
      stage: "claim_analyzer",
      reasons: [
        ...analyzerStage.escalation_reasons,
        ...analyzerStage.result.errors,
        ...(transport_failed ? ["transport_failed"] : []),
      ],
      transport_failed,
      attempts: analyzerStage.attempts_summary,
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
            transport_failed,
            attempts: analyzerStage.attempts_summary,
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
    if (transport_failed) {
      return jsonResponse(503, {
        error: "analyzer_escalation_unavailable",
        message: "מודל הניתוח המשפטי לא היה זמין רגעית. נסו שוב בעוד דקה.",
        debug: {
          run_id,
          phase: "P2",
          stage_runs,
          planning_error,
          claims: [],
          queries: [],
        },
      });
    }
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

  // Deterministic post-analyzer shape override — statute-section definition.
  //
  // Analyzer sometimes classifies "מה קובע סעיף X ל<חוק> ומהם התנאים"-type
  // questions as `analysis`, which disables the statute-section anchor /
  // direct-only guard machinery (B3 §6 חוק החברות regression). When the
  // question names a registered statute AND at least one `סעיף N` marker
  // AND opens with a "what does the section provide / what are the
  // conditions per §" phrasing, we force `output_shape = definition` so
  // the existing statute-section pipeline can run. Never overrides `quote`.
  const EXPLICIT_QUOTE_CUE = /(צטט|צטטו|נוסח\s+מדויק|כלשונו|כלשונה|לשון\s+הסעיף)/;
  const DEFINITION_CUE =
    /(מהי\s+הגדרת|מה\s+ההגדרה|כיצד\s+מוגדר|מה\s+(קובע|נקבע|אומר|מגדיר)|מהם?\s+התנאים|מהי\s+ההגדרה|מהם\s+היסודות)/;
  if (analyzer) {
    const currentShape = analyzer.answer_intent?.output_shape;
    const hasStatuteSection = detectStatuteSections(question).length > 0;
    const hasDefinitionCue = DEFINITION_CUE.test(question);
    const hasQuoteCue = EXPLICIT_QUOTE_CUE.test(question);

    let overrideReason: string | null = null;
    if (currentShape !== "quote") {
      // Analyzer classified as analysis/other for "מה קובע סעיף X" phrasing —
      // force definition so the statute-section machinery can run.
      if (hasStatuteSection && hasDefinitionCue) overrideReason = "statute_section_definition_cue";
    } else if (hasDefinitionCue && !hasQuoteCue) {
      // Analyzer over-classified as `quote` although the user asked a
      // definition/statute-section question with no explicit quote cue.
      overrideReason = "definition_cue_demotes_quote";
    }

    if (overrideReason) {
      const before = currentShape ?? "unknown";
      analyzer.answer_intent = { ...(analyzer.answer_intent ?? {}), output_shape: "definition" };
      (analyzer as unknown as { _shape_override?: unknown })._shape_override = {
        applied: true,
        from: before,
        to: "definition",
        reason: overrideReason,
      };
    }
  }




  // ─── P2: Research Query Planner ──────────────────────────────────────────
  await markStage("planner");
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
      interpretation_note: analyzer.interpretation_note ?? null,
      answer_intent: analyzer.answer_intent ?? null,
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
      mode_plan: plannerStage.mode_plan ?? null,
    },
    research_mode: plannerStage.mode_plan?.mode ?? null,
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

  // ─── Required anchors — append deterministic primary-source queries ───────
  // Interpretation-note anchors (registry-driven, e.g. Mandate-era) +
  // docket-anchored-judgment anchors (deterministic from the question text
  // — force retrieval of the specific ruling the user asked about).
  const noteAnchors = resolveRequiredAnchors(analyzer);
  // docketAnchors already computed before attachment extraction.
  const statuteSectionAnchors = buildStatuteSectionAnchors(question);
  const requiredAnchors = [...noteAnchors, ...docketAnchors, ...statuteSectionAnchors];
  const anchorQueries = requiredAnchors.length > 0
    ? buildRequiredAnchorQueries(analyzer, requiredAnchors)
    : [];
  const allQueries = [...planner!.queries, ...anchorQueries];
  const requiredAnchorsMeta = {
    enabled: true,
    count: requiredAnchors.length,
    anchors: requiredAnchors.map((a) => ({
      anchor_id: a.anchor_id,
      description: a.description,
      anchor_type: a.anchor_type,
      is_docket_anchor: !!a.is_docket_anchor,
      is_statute_section_anchor: !!a.is_statute_section_anchor,
      target: a.target,
      query_count: a.suggested_queries.length,
    })),
    queries_emitted: anchorQueries.map((q) => ({
      claim_id: q.claim_id,
      role: q.role,
      query_he: q.query_he,
      targets: q.targets,
      required_anchor_id: (q.metadata as Record<string, unknown> | undefined)?.required_anchor_id,
      is_docket_anchor: (q.metadata as Record<string, unknown> | undefined)?.is_docket_anchor === true,
    })),
  };

  // ─── P3: Retrieval (local DB + Perplexity) ───────────────────────────────
  await markStage("retrieval");
  const tRetrieval = Date.now();
  const [local, pplx] = await Promise.all([
    runLocalRetrieval(admin, allQueries, { question, claims: analyzer.claims }),
    runPerplexityRetrieval(allQueries),
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
      aggregate: local.aggregate,
    },
    perplexity: {
      ms: pplx.ms,
      candidates: pplx.candidates.length,
      dropped: pplx.dropped.length,
      per_query: pplx.per_query,
      role_corrections,
      parallel: pplx.parallel,
      concurrency_limit: pplx.concurrency_limit,
      query_count: pplx.query_count,
      query_ms: pplx.query_ms,
      total_wall_ms: pplx.total_wall_ms,
      total_sum_ms: pplx.total_sum_ms,
      rate_limit_count: pplx.rate_limit_count,
      retry_count: pplx.retry_count,
      fallback_to_sequential: pplx.fallback_to_sequential,
      merge_order_preserved: pplx.merge_order_preserved,
      hygiene_counts: pplx.hygiene_counts,
    },
    pool: {
      found: pool.found,
      after_dedup: pool.after_dedup,
      dedup_drops: pool.dedup_drops,
      drops: pool.drops,
      drop_reason_counts: pool.drops.reduce((acc, d) => {
        acc[d.drop_reason] = (acc[d.drop_reason] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      counts: pool.counts,
    },
    source_integrity: {
      rejects: pool.integrity_rejects,
      admitted: pool.integrity,
      tier_counts: pool.integrity.reduce((acc, r) => {
        acc[r.authority_tier] = (acc[r.authority_tier] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      citable_counts: pool.integrity.reduce((acc, r) => {
        acc[r.citable_as] = (acc[r.citable_as] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      role_unsatisfied: pool.integrity.filter((r) => !r.can_satisfy_role).length,
      judgment_documents: pool.integrity.filter((r) => r.is_judgment_document).length,
      judgments_with_holding_text: pool.integrity.filter(
        (r) => r.is_judgment_document && r.has_holding_text,
      ).length,
      synthesis_role_counts: pool.integrity.reduce((acc, r) => {
        acc[r.synthesis_role] = (acc[r.synthesis_role] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      synthesis_role_overrides: pool.integrity.filter((r) => r.synthesis_role_overridden).length,
      downgrades: pool.integrity
        .filter((r) => !!r.downgrade_reason)
        .map((r) => ({ candidate_id: r.candidate_id, reason: r.downgrade_reason })),
    },


  };

  // ─── P4: Source Verifier ─────────────────────────────────────────────────
  await markStage("verifier");
  const forceSplit = (req.headers.get("x-verifier-force-split") ?? "") === "1";
  const verifier = await runVerifier(question, analyzer.claims, pool.candidates, { forceSplit });
  stage_runs.push(...verifier.stage_runs);
  const verifierMeta = {
    ms: verifier.ms,
    model_initial: verifier.model_initial,
    model_final: verifier.model_final,
    escalated_claims: verifier.escalated_claims,
    per_claim_ms: verifier.per_claim_ms,
    counts: verifier.counts,
    candidates_verified: verifier.candidates_verified,
    candidates_usable: verifier.candidates_usable,
    candidates_dropped: verifier.candidates_dropped,
    verdicts: verifier.verdicts,
    usable: verifier.usable,
    dropped: verifier.dropped,
    errors: verifier.errors,
    batches: verifier.batches,
    parallel: verifier.parallel,
    concurrency_limit: verifier.concurrency_limit,
    batch_count: verifier.batch_count,
    batch_ms: verifier.batch_ms,
    total_wall_ms: verifier.total_wall_ms,
    total_sum_ms: verifier.total_sum_ms,
    escalated_batches: verifier.escalated_batches,
    merge_order_preserved: verifier.merge_order_preserved,
    rate_limit_count: verifier.rate_limit_count,
    retry_count: verifier.retry_count,
    fallback_to_sequential: verifier.fallback_to_sequential,
    call_failed: verifier.call_failed,
    call_failures: verifier.call_failures,
    recovered_batches: verifier.recovered_batches,
    retry_attempts: verifier.retry_attempts,
    split_probe_attempts: verifier.split_probe_attempts,

    demotions: verifier.demotions,
    demotions_by_rule: verifier.demotions_by_rule,
  };

  // ─── Sources-only short-circuit (skip drafter) ───────────────────────────
  if (is_sources_only) {
    await markStage("ranking");
    const sourcesPayload = await buildSourcesOnlyPayload({
      question,
      run_id,
      candidates: pool.candidates,
      usable: verifier.usable,
      verdicts: verifier.verdicts,
      candidates_verified: verifier.candidates_verified,
      candidates_usable: verifier.candidates_usable,
      candidates_dropped: verifier.candidates_dropped,
      perplexityDropped: pplx.dropped,
      verifierDropped: verifier.dropped,
    });
    await completeAllStages();

    const debugBlock = {
      run_id,
      phase: "sources_only",
      stage_runs,
      planning: planningMeta,
      claims: analyzer.claims,
      queries: allQueries,
      retrieval: retrievalMeta,
      candidates: pool.candidates,
      dropped_sources: pplx.dropped,
      verifier: verifierMeta,
    };

    await writeTelemetry(admin, {
      ...telemetryBase,
      // Non-null answer so the existing history sidebar query
      // (.not("answer","is",null)) still surfaces these runs.
      answer: "(חיפוש מקורות)",
      // Wrap the full payload in a sentinel envelope inside `footnotes` so the
      // history sidebar can re-hydrate the source list on click without
      // schema changes (mirrors __case_summary pattern).
      footnotes: [{ __sources_only: true, payload: sourcesPayload }] as unknown[],
      task_mode: "legal_source_search",
      metadata: {
        pipeline: "legal-research-v1",
        pipeline_mode: "sources_only",
        phase: "sources_only",
        run_id,
        total_ms: Date.now() - t_start,
        stage_runs,
        planning: planningMeta,
        claims: analyzer.claims,
        queries: allQueries,
        retrieval: retrievalMeta,
        candidates: pool.candidates,
        dropped_sources: pplx.dropped,
        verifier: verifierMeta,
        sources_only: {
          summary: sourcesPayload.summary,
          source_count: sourcesPayload.sources.length,
        },
      },
    });

    return jsonResponse(200, {
      ...sourcesPayload,
      debug: debugBlock,
    });
  }


  await markStage("drafter");
  // Pre-compute required-anchor statuses (before drafter; used set is empty
  // here — recomputed post-drafter for the final debug record).
  const usableIdSet = new Set(verifier.usable.map((u) => u.candidate_id));
  const preDraftAnchorStatuses = computeRequiredAnchorStatuses({
    anchors: requiredAnchors,
    candidates: pool.candidates,
    usableIds: usableIdSet,
    verdicts: verifier.verdicts,
    usedCandidateIds: new Set(),
    userDocs: attachmentResult.documents,
  });
  const missingForCaveat = pickAnchorsRequiringDrafterLimitation(
    preDraftAnchorStatuses,
    analyzer.answer_intent?.output_shape,
  )
    .map((s) => ({
      anchor_id: s.anchor_id,
      description: s.description,
      is_docket: s.is_docket_anchor,
      is_statute_section: !!s.is_statute_section_anchor,
    }));
  const requiredAnchorCandidateIds = new Set<string>(
    preDraftAnchorStatuses.flatMap((s) => s.candidate_ids ?? []),
  );

  // Satisfied statute-section anchors (verified_support === "direct") — used
  // by the drafter's deterministic canonical-quote path so statutory wording
  // is never paraphrased. Correlate the status list with the original
  // RequiredAnchor entries to recover the StatuteSectionRef.
  const anchorRefById = new Map<string, typeof requiredAnchors[number]>();
  for (const a of requiredAnchors) anchorRefById.set(a.anchor_id, a);
  const satisfiedStatuteSectionAnchors = preDraftAnchorStatuses
    .filter((s) => s.is_statute_section_anchor && s.verified_support === "direct")
    .map((s) => {
      const anchor = anchorRefById.get(s.anchor_id);
      if (!anchor?.statute_section_ref) return null;
      return {
        description: s.description,
        ref: anchor.statute_section_ref,
        candidate_ids: s.candidate_ids ?? [],
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // V2.1c is the default drafter (structured blocks + deterministic
  // footnoteBuilder). The legacy Markdown baseline `runDrafter` remains
  // imported for easy revert — re-point this call to `runDrafter(...)` and
  // restore the baseline-shaped `drafterMeta` if V2 needs to be rolled back.
  const drafter = await runDrafterV2(
    question,
    analyzer.claims,
    pool.candidates,
    { usable: verifier.usable, verdicts: verifier.verdicts },
    {
      userDocs: attachmentResult.documents,
      useAsSource,
      missingRequiredAnchors: missingForCaveat,
      answerIntent: analyzer.answer_intent,
      requiredAnchorCandidateIds,
      satisfiedStatuteSectionAnchors,
      researchMode: plannerStage.mode_plan?.mode ?? null,
    },
  );
  stage_runs.push(...drafter.stage_runs);

  // Re-compute statuses post-drafter to reflect citation outcome.
  const usedIdSetForAnchors = new Set(drafter.used_sources.map((u) => u.candidate_id));
  const requiredAnchorStatuses = computeRequiredAnchorStatuses({
    anchors: requiredAnchors,
    candidates: pool.candidates,
    usableIds: usableIdSet,
    verdicts: verifier.verdicts,
    usedCandidateIds: usedIdSetForAnchors,
    userDocs: attachmentResult.documents,
  });

  // Harness-only: when x-drafter-v2-compare-models is set, re-run drafterV2
  // additional times against the *same* input pack (same candidates, same
  // verifier verdicts, same claims, same userDocs). Served answer/footnotes
  // are unchanged; comparison output is stashed in metadata.
  //   "full"        → B = openai/gpt-5
  //   "full+claude" → B = openai/gpt-5, C = claude sonnet, D = claude opus
  const compareModel = req.headers.get("x-drafter-v2-compare-models");
  let drafterFullCompare: Awaited<ReturnType<typeof runDrafterV2>> | null = null;
  let drafterSonnetCompare: Awaited<ReturnType<typeof runDrafterV2>> | null = null;
  let drafterOpusCompare: Awaited<ReturnType<typeof runDrafterV2>> | null = null;
  const wantsFull = compareModel === "full" || compareModel === "full+claude";
  const wantsClaude = compareModel === "full+claude";
  const wantsSonnetOnly = compareModel === "sonnet";
  if (wantsFull) {
    try {
      drafterFullCompare = await runDrafterV2(
        question,
        analyzer.claims,
        pool.candidates,
        { usable: verifier.usable, verdicts: verifier.verdicts },
        {
          userDocs: attachmentResult.documents,
          useAsSource,
          forceModel: "openai/gpt-5",
          skipEscalation: true,
          answerIntent: analyzer.answer_intent,
        },
      );
    } catch (e) {
      console.error("[lrv1] drafter_v2_full_compare failed", e);
    }
  }
  if (wantsClaude || wantsSonnetOnly) {
    try {
      drafterSonnetCompare = await runDrafterV2(
        question,
        analyzer.claims,
        pool.candidates,
        { usable: verifier.usable, verdicts: verifier.verdicts },
        {
          userDocs: attachmentResult.documents,
          useAsSource,
          forceModel: "claude-sonnet-4-5",
          skipEscalation: true,
          provider: "anthropic",
          answerIntent: analyzer.answer_intent,
        },
      );
    } catch (e) {
      console.error("[lrv1] drafter_v2_sonnet_compare failed", e);
    }
  }
  if (wantsClaude) {
    try {
      drafterOpusCompare = await runDrafterV2(
        question,
        analyzer.claims,
        pool.candidates,
        { usable: verifier.usable, verdicts: verifier.verdicts },
        {
          userDocs: attachmentResult.documents,
          useAsSource,
          forceModel: "claude-opus-4-1",
          skipEscalation: true,
          provider: "anthropic",
          answerIntent: analyzer.answer_intent,
        },
      );
    } catch (e) {
      console.error("[lrv1] drafter_v2_opus_compare failed", e);
    }
  }


  // Compute omitted candidate ids (verifier.usable \ used by drafter) so the
  // frontend debug panel keeps the same shape as the baseline drafter.
  const usedIds = new Set(drafter.used_sources.map((u) => u.candidate_id));
  const omitted_candidate_ids = verifier.usable
    .map((u) => u.candidate_id)
    .filter((id) => !usedIds.has(id));

  // Synthetic marker_validation for shape compatibility. V2's footnoteBuilder
  // emits markers deterministically, so by construction there are no unused
  // sources, no missing sources, no internal-id leaks, and no marker repair.
  const marker_validation = {
    ok: drafter.ok,
    markers_in_answer: drafter.footnotes.map((f) => f.number),
    unused_sources: [] as string[],
    missing_sources: [] as string[],
    internal_id_leak: false,
    leaked_tokens: [] as string[],
    repaired: false,
    error: drafter.ok ? undefined : (drafter.error ?? drafter.schema_failure_reason),
  };

  const drafterMeta = {
    ok: drafter.ok,
    model_initial: drafter.model_initial,
    model_final: drafter.model_final,
    escalated: drafter.escalated,
    ms: drafter.ms,
    sources_passed: drafter.sources_passed,
    sources_used: drafter.sources_used,
    footnote_count: drafter.footnotes.length,
    unique_source_count: drafter.used_sources.length,
    marker_validation,
    omitted_candidate_ids,
    used_sources: drafter.used_sources,
    // Authority-role / judgment-typing view of the final pack (labelling only).
    synthesis_pack: summarizeSynthesisPack(
      drafter.used_sources.map((u) => ({
        citable_as: String(u.citable_as ?? "unknown"),
        text_usability: String(u.text_usability ?? "unknown"),
        synthesis_role: (u.synthesis_role ?? "unknown") as SynthesisRole,
        has_holding_text: u.has_holding_text,
      })),
    ),
    // Synthesis snippet budget telemetry (case-law synthesis runs only).
    snippet_budget: drafter.snippet_budget_report ?? null,
    marker_format: "superscript" as const,
    error: drafter.error,
    raw_text: drafter.raw_text,
    // V2-specific telemetry (additive — does not break baseline consumers).
    drafter_version: "v2.1c" as const,
    structured_validation: drafter.structured_validation,
    builder_report: drafter.builder_report,
    schema_failure_reason: drafter.schema_failure_reason,
    quality_warning: drafter.quality_warning,
    missing_anchor_caveat_injected: drafter.missing_anchor_caveat_injected ?? false,
    missing_anchor_descriptions: drafter.missing_anchor_descriptions ?? [],
    lead_ref: drafter.lead_ref ?? null,
    // Narrow default-on merge telemetry (Track: lead_ref + deterministic branches).
    deterministic_branch: drafter.deterministic_branch ?? null,
    missing_docket_limitation_fired: drafter.deterministic_branch === "docket_limitation",
    statute_section_limitation_fired: drafter.deterministic_branch === "statute_section_limitation",
    canonical_quote_fired:
      drafter.deterministic_branch === "canonical_quote_registry" ||
      drafter.deterministic_branch === "canonical_quote_verified",
    // Source-sufficiency gate telemetry.
    source_sufficiency: drafter.sufficiency ?? null,
    insufficient_sources_limitation_fired:
      drafter.deterministic_branch === "insufficient_sources_limitation",
    // Named-doctrine premise/framing telemetry.
    named_doctrine_framing: drafter.named_doctrine_framing ?? null,
    framing_correction_required:
      drafter.named_doctrine_framing?.framing_correction_required ?? false,



    // Truncation guard telemetry (drafterV2-only, additive).
    completeness: drafter.completeness,
    completeness_initial: drafter.completeness_initial,
    truncation_retry: drafter.truncation_retry,
    max_completion_tokens_used: drafter.max_completion_tokens_used,
    // Phase C — report-only answer-style gate (no automatic retry).
    answer_style_report: drafter.ok
      ? evaluateAnswerStyle({
          answer: drafter.answer_markdown,
          draft: drafter.structured_draft ?? null,
          footnotes: drafter.footnotes,
          inputSources: drafter.input_sources ?? [],
        })
      : null,
  };

  const requiredAnchorsRuntime = {
    ...requiredAnchorsMeta,
    statuses: requiredAnchorStatuses,
  };

  // If the verifier call ultimately failed (no real model verdicts and a
  // deterministic branch did not fire), surface a clear technical limitation
  // instead of the P5 dev stub.
  const verifierFailedNoDrafter = !drafter.ok
    && drafter.error === "no_usable_candidates"
    && verifier.call_failed;
  const finalAnswer = drafter.ok
    ? drafter.answer_markdown
    : (verifierFailedNoDrafter ? VERIFIER_FAILURE_ANSWER : STUB_ANSWER);
  const finalFootnotes = drafter.ok ? drafter.footnotes : [];


  // Mark final stage (footnote rendering / finalize) as active then complete.
  await markStage("finalize");
  await completeAllStages();

  // ─── Telemetry write (always) ────────────────────────────────────────────
  await writeTelemetry(admin, {
    ...telemetryBase,
    answer: finalAnswer,
    footnotes: finalFootnotes,
    metadata: {
      pipeline: "legal-research-v1",
      phase: "P5",
      run_id,
      total_ms: Date.now() - t_start,
      stage_runs,
      planning: planningMeta,
      claims: analyzer.claims,
      queries: allQueries,
      retrieval: retrievalMeta,
      candidates: pool.candidates,
      dropped_sources: pplx.dropped,
      verifier: verifierMeta,
      drafter: drafterMeta,
      required_anchors: requiredAnchorsRuntime,
      drafter_v2_full_compare: drafterFullCompare
        ? {
            ok: drafterFullCompare.ok,
            model_initial: drafterFullCompare.model_initial,
            model_final: drafterFullCompare.model_final,
            provider: drafterFullCompare.provider,
            escalated: drafterFullCompare.escalated,
            ms: drafterFullCompare.ms,
            sources_passed: drafterFullCompare.sources_passed,
            sources_used: drafterFullCompare.sources_used,
            answer_markdown: drafterFullCompare.answer_markdown,
            footnotes: drafterFullCompare.footnotes,
            used_sources: drafterFullCompare.used_sources,
            structured_validation: drafterFullCompare.structured_validation,
            builder_report: drafterFullCompare.builder_report,
            quality_warning: drafterFullCompare.quality_warning,
            schema_failure_reason: drafterFullCompare.schema_failure_reason,
            usage: drafterFullCompare.usage,
            error: drafterFullCompare.error,
          }
        : null,
      drafter_v2_sonnet_compare: drafterSonnetCompare
        ? {
            ok: drafterSonnetCompare.ok,
            model_initial: drafterSonnetCompare.model_initial,
            model_final: drafterSonnetCompare.model_final,
            provider: drafterSonnetCompare.provider,
            escalated: drafterSonnetCompare.escalated,
            ms: drafterSonnetCompare.ms,
            sources_passed: drafterSonnetCompare.sources_passed,
            sources_used: drafterSonnetCompare.sources_used,
            answer_markdown: drafterSonnetCompare.answer_markdown,
            footnotes: drafterSonnetCompare.footnotes,
            used_sources: drafterSonnetCompare.used_sources,
            structured_validation: drafterSonnetCompare.structured_validation,
            builder_report: drafterSonnetCompare.builder_report,
            quality_warning: drafterSonnetCompare.quality_warning,
            schema_failure_reason: drafterSonnetCompare.schema_failure_reason,
            usage: drafterSonnetCompare.usage,
            error: drafterSonnetCompare.error,
          }
        : null,
      drafter_v2_opus_compare: drafterOpusCompare
        ? {
            ok: drafterOpusCompare.ok,
            model_initial: drafterOpusCompare.model_initial,
            model_final: drafterOpusCompare.model_final,
            provider: drafterOpusCompare.provider,
            escalated: drafterOpusCompare.escalated,
            ms: drafterOpusCompare.ms,
            sources_passed: drafterOpusCompare.sources_passed,
            sources_used: drafterOpusCompare.sources_used,
            answer_markdown: drafterOpusCompare.answer_markdown,
            footnotes: drafterOpusCompare.footnotes,
            used_sources: drafterOpusCompare.used_sources,
            structured_validation: drafterOpusCompare.structured_validation,
            builder_report: drafterOpusCompare.builder_report,
            quality_warning: drafterOpusCompare.quality_warning,
            schema_failure_reason: drafterOpusCompare.schema_failure_reason,
            usage: drafterOpusCompare.usage,
            error: drafterOpusCompare.error,
          }
        : null,

      attachments: {
        count: attachmentResult.documents.length,
        use_as_source: useAsSource,
        total_chars: attachmentResult.total_chars,
        global_truncated: attachmentResult.global_truncated,
        errors: attachmentResult.errors,
        documents: attachmentResult.documents.map((d) => ({
          id: d.id,
          file_name: d.file_name,
          chunk_count: d.chunks.length,
          truncated: d.truncated,
        })),
      },
    },
  });

  return jsonResponse(200, {
    answer: finalAnswer,
    footnotes: finalFootnotes,
    used_sources: drafter.ok ? drafter.used_sources : [],
    marker_format: "superscript" as const,
    debug: {
      run_id,
      phase: "P5",
      stage_runs,
      planning: planningMeta,
      claims: analyzer.claims,
      queries: allQueries,
      retrieval: retrievalMeta,
      candidates: pool.candidates,
      dropped_sources: pplx.dropped,
      verifier: verifierMeta,
      drafter: drafterMeta,
      required_anchors: requiredAnchorsRuntime,
    },
  });
  }; // end runPipeline

  const bg = (async () => {
    try {
      const resp = await runPipeline();
      const payload = await resp.clone().json().catch(() => null);
      if (resp.status === 200) {
        await setJobStatus({ status: "done", result: payload });
      } else {
        const errMsg = (payload && typeof payload === "object")
          ? JSON.stringify(payload).slice(0, 4000)
          : `http_${resp.status}`;
        await setJobStatus({ status: "error", error: errMsg, result: payload });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[lrv1 bg]", msg);
      await setJobStatus({ status: "error", error: msg });
    }
  })();
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(bg);
  }
  return jsonResponse(202, {
    ok: true,
    run_id,
    job_id: jobId,
    status: smokeMode ? "queued_smoke" : "queued",
  });
}

serve(handle);
