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
import {
  buildFacetDirective,
  computeFacetCoverage,
  expandClaimFacets,
  FacetSourceView,
  inferLegalAreaId,
} from "./stages/claimFacetExpansion.ts";
import {
  admitQueries,
  selectRouterProfile,
  STATUTE_FIRST_LIMITATION,
} from "./stages/routerProfiles.ts";

import { runLocalRetrieval } from "./stages/localRetrieval.ts";
import { runPerplexityRetrieval } from "./stages/perplexityRetrieval.ts";
import { buildCandidatePool } from "./stages/candidatePool.ts";
import { summarizeSynthesisPack, type SynthesisRole } from "./stages/synthesisRole.ts";
import { runJudgmentTextAcquisition } from "./stages/judgmentTextAcquisition.ts";
import { runStatuteTextAcquisition } from "./stages/statuteTextAcquisition.ts";

import { buildJudgmentDiscoveryQueries } from "./stages/judgmentDiscovery.ts";
import { runSpecificCaseResolution, type SpecificCaseResolution } from "./stages/specificCaseResolution.ts";
import { detectDockets } from "./stages/docketDetection.ts";
import { RetrievalBudget, RETRIEVAL_BUDGET } from "./stages/retrievalBudget.ts";

import { runSpecificCaseIdentity } from "./stages/specificCaseIdentity.ts";
import { runVerifier } from "./stages/verifier.ts";
import { labelCpuStats, runDrafter } from "./stages/drafter.ts";
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
import { makeAdminClient, writeTelemetry, beginTraceRow } from "./lib/telemetry.ts";
import { extractAttachments, buildAnalyzerContext, ATTACHMENT_LIMITS, type AttachmentInput } from "./lib/attachments.ts";
import { StageRun, type Candidate } from "./lib/types.ts";
import { buildSourcesOnlyPayload } from "./lib/sourcesOnly.ts";

type PipelineMode = "answer" | "sources_only";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Observability only: stable per-isolate id + in-flight run counter, so we can
// tell whether a death correlates with concurrent load in the same isolate.
const ISOLATE_ID = crypto.randomUUID().slice(0, 8);
let IN_FLIGHT = 0;

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
  // Observability: id of the in-progress qa_logs trace row for this run. When
  // set, terminal telemetry UPDATEs that row instead of inserting a new one.
  let traceRowId: string | null = null;
  const concurrencyHint = req.headers.get("x-conc-hint");
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

  // ─── Credit charge (skipped in smoke mode) ───────────────────────────────
  // Charge the per-query cost up front. The pipeline runs in the background
  // after we return 202; if it does not deliver a real answer (refusal, stub,
  // limitation, or error) we refund the charge asynchronously in the bg block.
  const RESEARCH_COST = 5;
  let creditsCharged = false;
  let creditRequestId: string | null = null;
  // Set to true by runPipeline right before a return that delivers real value
  // (a drafted answer or a sources_only list). Anything else triggers a refund.
  let pipelineDelivered = false;
  const refundCredits = async (reason: string) => {
    if (!creditsCharged || !creditRequestId || !userClient) return;
    try {
      const { data: refundData, error: refundErr } = await userClient.rpc(
        "refund_credits",
        { _request_id: creditRequestId, _reason: `auto-refund: ${reason}` },
      );
      const ok = Boolean((refundData as Record<string, unknown> | null)?.ok);
      if (refundErr || !ok) {
        console.error("[lrv1 refund failed]", refundErr?.message ?? "no_ok");
        return;
      }
      creditsCharged = false;
      console.log("[lrv1 refund ok]", reason);
    } catch (e) {
      console.error("[lrv1 refund threw]", e instanceof Error ? e.message : e);
    }
  };

  if (!smokeMode && userClient) {
    const reqId = crypto.randomUUID();
    creditRequestId = reqId;
    try {
      const { data: consumeData, error: consumeErr } = await userClient.rpc(
        "consume_credits",
        { _amount: RESEARCH_COST, _reason: "legal-research-v1", _request_id: reqId },
      );
      if (consumeErr) {
        creditRequestId = null;
        return jsonResponse(500, { error: "credit_charge_failed", detail: consumeErr.message });
      }
      const cr = (consumeData ?? {}) as Record<string, unknown>;
      if (!cr.ok) {
        creditRequestId = null;
        if (cr.error === "INSUFFICIENT_CREDITS") {
          return jsonResponse(402, {
            error: "INSUFFICIENT_CREDITS",
            required: (cr.required as number) ?? RESEARCH_COST,
            remaining_included: (cr.remaining_included as number) ?? 0,
            remaining_topup: (cr.remaining_topup as number) ?? 0,
          });
        }
        return jsonResponse(500, { error: (cr.error as string) || "CREDIT_ERROR" });
      }
      // Admin accounts record a zero-delta consume; never refund those.
      if (cr.admin) {
        creditRequestId = null;
        creditsCharged = false;
      } else {
        creditsCharged = true;
      }
    } catch (e) {
      creditRequestId = null;
      console.error("[legal-research-v1] credit charge threw:", e);
      return jsonResponse(500, {
        error: "credit_charge_error",
        detail: e instanceof Error ? e.message : String(e),
      });
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
      await refundCredits("job_insert_failed");
      return jsonResponse(500, { error: "job_insert_failed", detail: jobErr?.message });
    }
    jobId = (jobRow as { id: string }).id;
  } catch (e) {
    await refundCredits("job_insert_threw");
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
      row_id: traceRowId,
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
      row_id: traceRowId,
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
      row_id: traceRowId,
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
      row_id: traceRowId,
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

  // ─── router_profiles_v1 — select the pipeline path ───────────────────────
  // The existing research-mode classification now drives real budgets, caps
  // and ceilings instead of every question walking the maximal heavy path.
  // No gate is removed: every deterministic branch downstream still runs.
  const router = selectRouterProfile({
    question,
    research_mode: plannerStage.mode_plan?.mode ?? null,
    output_shape: analyzer.answer_intent?.output_shape ?? null,
    claim_count: analyzer.claims.length,
    is_sources_only,
  });

  // ─── Profile E — citation_only: bypass retrieval/verifier/drafter ────────
  // Delegated to the existing citation engine; the research charge is refunded
  // (the citation engine bills its own). Any failure falls through to the
  // normal pipeline so behaviour can only improve, never regress.
  let citationOnlyFellThrough: string | null = null;
  if (router.selected_router_profile === "citation_only" && !is_sources_only) {
    if (!userClient || !authHeader) {
      citationOnlyFellThrough = "no_user_token";
    } else {
      try {
        const resp = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/citation-chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: authHeader },
            body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
          },
        );
        const payload = await resp.json().catch(() => null) as
          | { content?: string; answer?: string; footnotes?: unknown[] }
          | null;
        const answer = payload?.content ?? payload?.answer ?? "";
        if (!resp.ok || !answer) {
          citationOnlyFellThrough = `citation_engine_status_${resp.status}`;
        } else {
          await completeAllStages();
          await writeTelemetry(admin, {
            ...telemetryBase,
            row_id: traceRowId,
            answer,
            footnotes: (payload?.footnotes ?? []) as unknown[],
            task_mode: "legal_research",
            metadata: {
              pipeline: "legal-research-v1",
              phase: "citation_only",
              run_id,
              total_ms: Date.now() - t_start,
              stage_runs,
              planning: planningMeta,
              router_profiles: { ...router, retrieval_query_count: 0,
                speculative_acquisition_count: 0, verifier_candidate_count: 0 },
            },
          });
          // The citation engine charges separately → refund the research charge.
          pipelineDelivered = false;
          return jsonResponse(200, {
            answer,
            footnotes: (payload?.footnotes ?? []) as unknown[],
            debug: { run_id, phase: "citation_only", router_profiles: router },
          });
        }
      } catch (e) {
        citationOnlyFellThrough = e instanceof Error ? e.message : String(e);
      }
    }
  }
  if (citationOnlyFellThrough) {
    router.selected_router_profile = "doctrine_explainer";
    router.profile_reason = `citation_only_fallthrough:${citationOnlyFellThrough}`;
    router.skipped_stages = [];
    router.path_budget_ms = 140_000;
    router.max_retrieval_queries = 14;
    router.max_speculative_acquisitions = 2;
    router.max_facets = 3;
    router.verifier_same_area_only = true;
    router.drafter_block_ceiling = 7;
    router.drop_unsupported_blocks = true;
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
  // ─── Judgment-focused discovery queries (Parts 2 & 3) ────────────────────
  // Source-type targeting for case-law synthesis / doctrine / survey-like
  // questions: real judgment documents must be discoverable before the
  // acquisition budget is spent. No case names, no doctrine dictionaries.
  const skipJudgmentDiscovery = router.skipped_stages.includes("judgment_discovery");
  const judgmentDiscovery = skipJudgmentDiscovery
    ? { enabled: false, survey_like: false, topic: null, layers: [], queries: [],
        judgment_discovery_queries: 0 } as unknown as ReturnType<typeof buildJudgmentDiscoveryQueries>
    : buildJudgmentDiscoveryQueries(
      question,
      plannerStage.mode_plan?.mode ?? null,
      analyzer,
    );
  // ─── claim_facet_expansion_v1 — doctrinal facets + area-locked queries ───
  // router_profiles_v1 caps the facet fan-out per path (0 = disabled).
  const facetExpansionRaw = router.max_facets === 0
    ? { enabled: false, gate_reason: `router_profile:${router.selected_router_profile}`,
        legal_area_lock: null, lock_terms: [], facets: [], queries: [] }
    : expandClaimFacets(question, analyzer, {
      mode: plannerStage.mode_plan?.mode ?? null,
      outputShape: plannerStage.mode_plan?.output_shape ?? null,
    });
  const keptFacets = facetExpansionRaw.facets.slice(0, router.max_facets);
  const keptFacetIds = new Set(keptFacets.map((f) => f.facet_id));
  const facetExpansion = {
    ...facetExpansionRaw,
    facets: keptFacets,
    queries: facetExpansionRaw.queries.filter((q) => {
      const fid = (q.metadata as Record<string, unknown> | undefined)?.facet_id;
      return typeof fid === "string" ? keptFacetIds.has(fid) : true;
    }),
  };
  const facetsDroppedByRouter = facetExpansionRaw.facets.length - keptFacets.length;
  const facetDirective = buildFacetDirective(facetExpansion);
  // router_profiles_v1 — path-scoped query admission. Required-anchor queries
  // are never dropped (they carry the deterministic primary-source duties).
  const queryAdmission = admitQueries(router, anchorQueries, [
    ...planner!.queries,
    ...judgmentDiscovery.queries,
    ...facetExpansion.queries,
  ]);
  const allQueries = queryAdmission.queries;

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

  const researchMode = plannerStage.mode_plan?.mode ?? null;
  // Specific-case runs with an explicit docket take the deterministic fast
  // lane: exact-docket resolution runs *before* broad web retrieval, so the
  // expensive path is only paid for when the cheap one fails.
  const fastLaneDockets = researchMode === "specific_case" ? detectDockets(question) : [];
  const fastLaneEligible = fastLaneDockets.length > 0;

  const budget = new RetrievalBudget(
    // router_profiles_v1 — per-path wall-clock budget. Specific-case runs keep
    // the tight deterministic fast-lane deadline.
    fastLaneEligible
      ? Math.min(router.path_budget_ms || RETRIEVAL_BUDGET.SPECIFIC_CASE_DEADLINE_MS,
        RETRIEVAL_BUDGET.SPECIFIC_CASE_DEADLINE_MS)
      : (router.path_budget_ms || RETRIEVAL_BUDGET.DEFAULT_DEADLINE_MS),

    (checkpoints) => {
      // Heartbeat: survives an isolate kill so we can see where retrieval died.
      // Returned so `markDurable` can await the first checkpoint of the stage.
      return setJobStatus({
        result: { run_id, phase: "retrieval", retrieval_checkpoints: checkpoints },
      });
    },
  );

  // Durable in-progress trace row + first checkpoint, written BEFORE any
  // expensive retrieval work. An isolate killed after this point still leaves
  // a qa_logs row and a persisted checkpoint saying where it died.
  traceRowId = await beginTraceRow(admin, {
    user_id: user.id,
    project_id,
    question,
    run_id,
    task_mode: is_sources_only ? "legal_source_search" : undefined,
    trace_stage: "retrieval_entering",
    detail: {
      research_mode: researchMode,
      fast_lane_eligible: fastLaneEligible,
      isolate: ISOLATE_ID,
      concurrency_hint: concurrencyHint,
      in_flight_at_retrieval: IN_FLIGHT,
    },
  });

  await budget.markDurable("retrieval_entered", {
    mode: researchMode,
    fast_lane_eligible: fastLaneEligible,
    dockets: fastLaneDockets.map((d) => `${d.prefix_he} ${d.number}`),
    isolate: ISOLATE_ID,
    concurrency_hint: concurrencyHint,
    in_flight: IN_FLIGHT,
    trace_row_id: traceRowId,
  });
  budget.mark("retrieval_started", {
    mode: researchMode,
    fast_lane_eligible: fastLaneEligible,
    dockets: fastLaneDockets.map((d) => `${d.prefix_he} ${d.number}`),
  });

  // ── Fast lane: deterministic exact-docket resolution ────────────────────
  const fastLaneCandidates: Candidate[] = [];
  let fastLane: SpecificCaseResolution | null = null;
  if (fastLaneEligible) {
    await budget.markDurable("deterministic_start");
    budget.mark("deterministic_resolution_started");
    fastLane = await runSpecificCaseResolution({
      admin,
      research_mode: researchMode,
      question,
      candidates: fastLaneCandidates,
      budget,
    });
    budget.mark("derived_urls_probed", {
      count: fastLane.derived_urls_probed?.length ?? 0,
      budget_exceeded: fastLane.budget_exceeded,
      probe_stages: fastLane.probe_stages.slice(-20),
    });
    if (fastLane.acquisition_success) {
      budget.mark("derived_url_resolved", {
        methods: fastLane.acquisition_methods_attempted,
      });
    }
    budget.mark("deterministic_done", {
      acquisition_success: fastLane.acquisition_success,
    });
  }

  const fastLaneHit = fastLane?.acquisition_success === true;

  // ── Broad retrieval (skipped/narrowed once the fast lane already won) ───
  budget.mark("broad_retrieval_started", { fast_lane_hit: fastLaneHit });
  const localQueries = fastLaneHit ? allQueries.slice(0, 3) : allQueries;
  await budget.markDurable("local_db_start", { queries: localQueries.length });
  const pplxQueries = fastLaneHit ? [] : allQueries;
  // retrieval_budget_enforcement_v1: both legs are raced against the hard
  // wall-clock budget. A leg that has not settled by the deadline is ignored
  // (counted) and retrieval continues with whatever is already in hand.
  const emptyLocal = { candidates: [], stage_runs: [] } as unknown as
    Awaited<ReturnType<typeof runLocalRetrieval>>;
  const emptyPplx = { candidates: [], stage_runs: [] } as unknown as
    Awaited<ReturnType<typeof runPerplexityRetrieval>>;
  const [local, pplx] = await Promise.all([
    budget.raceDeadline(
      "local_retrieval",
      budget.timed("local_retrieval", () =>
        runLocalRetrieval(admin, localQueries, { question, claims: analyzer.claims }, { budget })
          .then((r) => {
            budget.mark("local_db_done", { candidates: r.candidates.length });
            return r;
          })),
      emptyLocal,
    ),
    // Perplexity is the dominant CPU/wall cost. A resolved exact-docket body
    // already answers the question, so don't spend it.
    budget.raceDeadline(
      "perplexity_retrieval",
      budget.timed("perplexity_retrieval", async () => {
        budget.mark("perplexity_start", { queries: pplxQueries.length, skipped: fastLaneHit });
        const r = await runPerplexityRetrieval(pplxQueries, { budget });
        budget.mark("perplexity_done", { candidates: r.candidates.length });
        return r;
      }),
      emptyPplx,
    ),
  ]);
  stage_runs.push(...local.stage_runs, ...pplx.stage_runs);
  budget.mark("candidate_pool_start", {
    local: local.candidates.length,
    perplexity: pplx.candidates.length,
  });
  const pool = buildCandidatePool([...local.candidates, ...pplx.candidates]);
  // Fast-lane candidates bypass pool filtering exactly as before: they are
  // docket-verified official bodies, not search results.
  if (fastLaneCandidates.length > 0) pool.candidates.unshift(...fastLaneCandidates);
  budget.mark("broad_retrieval_done", { pool_size: pool.candidates.length });
  await budget.markDurable("post_retrieval_start", {
    pool_size: pool.candidates.length,
    integrity_rows: pool.integrity.length,
    integrity_rejects: pool.integrity_rejects,
  });


  // ─── Judgment-body acquisition (first-class stage) ───────────────────────
  // Bounded, fail-closed attempt to obtain real judgment text for high-value
  // judgment candidates in every judgment-bearing mode, with per-role budgets.
  // When the fast lane or the deadline already settled it, spend nothing.
  const skipAcquisition = fastLaneHit || budget.exceeded();
  await budget.markDurable("judgment_acquisition_start", {
    skipped: skipAcquisition,
    candidates: skipAcquisition ? 0 : pool.candidates.length,
  });
  if (!skipAcquisition) budget.noteBodyAcquisition();
  const judgmentAcquisition = await runJudgmentTextAcquisition({
    admin,
    research_mode: researchMode,
    question,
    candidates: skipAcquisition ? [] : pool.candidates,
    retrieval_budget: budget,
    markDurable: (name, detail) => budget.markDurable(name, detail),
    // router_profiles_v1 — path ceiling on speculative judgment acquisition.
    max_acquisitions: router.max_speculative_acquisitions,

  });
  await budget.markDurable("judgment_acquisition_done", {
    skipped: skipAcquisition,
    successes: judgmentAcquisition.successes,
    stop_reason: judgmentAcquisition.stage_stop_reason,
    retrieval_budget_exceeded: judgmentAcquisition.retrieval_budget_exceeded,
  });


  await budget.markDurable("candidate_enrichment_start", {
    successes: judgmentAcquisition.successes,
  });
  if (judgmentAcquisition.successes > 0) {
    // Refresh the integrity telemetry rows for upgraded candidates.
    const byId = new Map(pool.candidates.map((c) => [c.candidate_id, c]));
    for (const row of pool.integrity) {
      const c = byId.get(row.candidate_id);
      const integ = ((c?.metadata ?? {}) as Record<string, unknown>).source_integrity as
        | { text_usability?: string; has_holding_text?: boolean; integrity_flags?: string[] }
        | undefined;
      if (!integ) continue;
      row.text_usability = String(integ.text_usability ?? row.text_usability);
      row.has_holding_text = integ.has_holding_text ?? row.has_holding_text;
      row.integrity_flags = integ.integrity_flags ?? row.integrity_flags;
    }
  }
  await budget.markDurable("candidate_enrichment_done");

  // ─── Statute-text acquisition (bounded, admitted candidates only) ────────
  // When the question names a specific statute section, make the official
  // statute text visible to the deterministic anchor predicates. No new
  // retrieval: only candidates already in the admitted pool are fetched.
  const statuteSectionRefsForAcquisition = detectStatuteSections(question);
  const skipStatuteAcquisition = statuteSectionRefsForAcquisition.length === 0 ||
    budget.exceeded();
  await budget.markDurable("statute_text_acquisition_start", {
    skipped: skipStatuteAcquisition,
    refs: statuteSectionRefsForAcquisition.map((r) => r.ref_id),
  });
  const statuteAcquisition = await runStatuteTextAcquisition({
    candidates: skipStatuteAcquisition ? [] : pool.candidates,
    statuteSectionRefs: statuteSectionRefsForAcquisition,
    retrieval_budget: budget,
    markDurable: (name, detail) => budget.markDurable(name, detail),
  });
  await budget.markDurable("statute_text_acquisition_done", {
    attempted: statuteAcquisition.attempted,
    successes: statuteAcquisition.successes,
    stop_reason: statuteAcquisition.stage_stop_reason,
  });
  if (statuteAcquisition.successes > 0) {
    const byId = new Map(pool.candidates.map((c) => [c.candidate_id, c]));
    for (const row of pool.integrity) {
      const c = byId.get(row.candidate_id);
      const integ = ((c?.metadata ?? {}) as Record<string, unknown>).source_integrity as
        | { text_usability?: string; integrity_flags?: string[] }
        | undefined;
      if (!integ) continue;
      row.text_usability = String(integ.text_usability ?? row.text_usability);
      row.integrity_flags = integ.integrity_flags ?? row.integrity_flags;
    }
  }


  // ─── Specific-case authority resolution (specific_case mode only) ───────
  // Exact-docket guard + bounded judgment-text acquisition. Fail-closed: when
  // no admitted source carries the exact requested docket with usable text,
  // the drafter fires `docket_limitation` regardless of pool size.
  await budget.markDurable("specific_case_resolution_start", { fast_lane_hit: fastLaneHit });
  const specificCase = fastLaneHit && fastLane
    ? fastLane
    : await runSpecificCaseResolution({
      admin,
      research_mode: researchMode,
      question,
      candidates: pool.candidates,
      skip_derived_urls: fastLaneEligible,
      prior_derived_urls: fastLane?.derived_urls_probed ?? [],
      budget,
    });

  // The post-retrieval pass may add telemetry but must never *downgrade* a
  // successful fast-lane result (R01/B2: the fast-lane body was being lost).
  if (fastLane && specificCase !== fastLane) {
    if (fastLane.derived_urls_probed.length > 0 && specificCase.derived_urls_probed.length === 0) {
      specificCase.derived_urls_probed = fastLane.derived_urls_probed;
    }
    specificCase.derived_url_resolved ??= fastLane.derived_url_resolved;
    if (fastLane.exact_docket_source_found && !specificCase.exact_docket_source_found) {
      specificCase.exact_docket_source_found = true;
      specificCase.exact_docket_source_title ??= fastLane.exact_docket_source_title;
      specificCase.exact_docket_source_url ??= fastLane.exact_docket_source_url;
    }
    if (fastLane.exact_docket_source_usable && !specificCase.exact_docket_source_usable) {
      specificCase.exact_docket_source_usable = true;
      specificCase.allow_case_holding_answer = true;
      specificCase.final_docket_branch_reason = fastLane.final_docket_branch_reason;
      specificCase.acquisition_success = specificCase.acquisition_success ||
        fastLane.acquisition_success;
      specificCase.acquisition_method ??= fastLane.acquisition_method;
      specificCase.acquisition_method_successful ??= fastLane.acquisition_method_successful;
    }
    if (fastLane.acquired_text_length > specificCase.acquired_text_length) {
      specificCase.acquired_text_length = fastLane.acquired_text_length;
    }
    specificCase.injected_candidate_id ??= fastLane.injected_candidate_id;
    specificCase.exact_docket_candidate_id ??= fastLane.exact_docket_candidate_id;
  }
  await budget.markDurable("specific_case_resolution_done", {
    acquisition_success: specificCase.acquisition_success,
    exact_docket_source_usable: specificCase.exact_docket_source_usable,
    exact_docket_candidate_id: specificCase.exact_docket_candidate_id,
    fast_lane_hit: fastLaneHit,
  });



  // ─── Specific-case judgment identity + title recovery ───────────────────
  // A case-holding answer requires a usable judgment body that provably is the
  // requested case. Generic-titled official documents get a recovered title.
  await budget.markDurable("specific_case_identity_start", {
    candidates: pool.candidates.length,
  });
  const specificCaseIdentity = runSpecificCaseIdentity({
    research_mode: plannerStage.mode_plan?.mode ?? null,
    question,
    candidates: pool.candidates,
  });
  await budget.markDurable("specific_case_identity_done", {
    required: specificCaseIdentity.specific_case_identity_required,
    passed: specificCaseIdentity.specific_case_identity_passed,
  });

  const specificCaseGate =
    specificCase.enabled || specificCaseIdentity.specific_case_identity_required
      ? {
          allow:
            (!specificCase.enabled ||
              // Key on usable exact-docket text, never on the post-retrieval
              // `acquisition_success` flag alone.
              specificCase.exact_docket_source_usable ||
              specificCase.allow_case_holding_answer) &&
            specificCaseIdentity.specific_case_identity_passed,
          docket_display:
            specificCase.requested_docket_display ?? specificCaseIdentity.requested_docket,
          reason: !specificCaseIdentity.specific_case_identity_passed
            ? `specific_case_identity_limitation:${specificCaseIdentity.specific_case_identity_failure_reason}`
            : specificCase.final_docket_branch_reason,
        }
      : null;

  await budget.markDurable("verifier_input_build_start", {
    pool_size: pool.candidates.length,
    pplx_queries: pplx.per_query.length,
    pool_drops: pool.drops.length,
  });

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
      url_dedupe: {
        identity_source_counts: pool.url_dedupe_identity_source_counts,
        rescued_from_legacy_collapse: pool.url_dedupe_rescued_from_legacy_collapse,
        rows: pool.url_dedupe.filter((r) => r.dedupe_identity_source !== "normal_url"),
      },
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
    judgment_text_acquisition: judgmentAcquisition,
    statute_text_acquisition: {
      attempted: statuteAcquisition.attempted,
      successes: statuteAcquisition.successes,
      stage_stop_reason: statuteAcquisition.stage_stop_reason,
      acquired_candidate_ids: statuteAcquisition.acquired_candidate_ids,
      attempts: statuteAcquisition.attempts,
      ms: statuteAcquisition.ms,
    },

    specific_case_resolution: specificCase,
    specific_case_identity: specificCaseIdentity,
    judgment_discovery: {
      enabled: judgmentDiscovery.enabled,
      survey_like: judgmentDiscovery.survey_like,
      topic: judgmentDiscovery.topic,
      layers: judgmentDiscovery.layers,
      judgment_discovery_queries: judgmentDiscovery.judgment_discovery_queries,
      judgment_candidate_rank_before_acquisition:
        judgmentAcquisition.judgment_candidate_rank_before_acquisition,
      judgment_candidate_rank_reason:
        judgmentAcquisition.judgment_candidate_rank_before_acquisition.map((r) => ({
          candidate_id: r.candidate_id,
          rank: r.rank,
          reason: r.rank_reason,
        })),
      acquisition_budget_spent_on: judgmentAcquisition.acquisition_budget_spent_on,
      skipped_higher_quality_candidates: judgmentAcquisition.skipped_higher_quality_candidates,
      institutional_pages_excluded_before_budget:
        judgmentAcquisition.institutional_pages_excluded_before_budget,
      official_judgment_documents_found: judgmentAcquisition.official_judgment_documents_found,
      official_judgment_documents_acquired:
        judgmentAcquisition.official_judgment_documents_acquired,
      commentary_share_of_admitted_pack: (() => {
        const rows = pool.integrity;
        if (rows.length === 0) return 0;
        const commentary = rows.filter(
          (r) => r.citable_as === "scholarship" || r.citable_as === "commentary",
        ).length;
        return Math.round((commentary / rows.length) * 100) / 100;
      })(),
    },
    fast_lane: {
      eligible: fastLaneEligible,
      hit: fastLaneHit,
      dockets: fastLaneDockets.map((d) => `${d.prefix_he} ${d.number}`),
      web_retrieval_skipped: fastLaneHit,
      acquisition_skipped: skipAcquisition,
    },
    retrieval_budget: budget.report(),
  };
  await budget.markDurable("verifier_input_build_done", {
    pool_size: pool.candidates.length,
  });

  // ─── Exact-case body unavailable (large_pdf_extraction_preemption_v1) ────
  // The requested judgment *was* located at its official archive path, but its
  // body was too large to extract inside the isolate. This is a different fact
  // from "not found", and the user is told so precisely — never a silent
  // fallback to secondary sources for a case-holding question.
  if (
    !is_sources_only && fastLaneEligible &&
    !specificCase.acquisition_success &&
    specificCase.exact_case_body_unavailable === true
  ) {
    const docketLabel = fastLaneDockets.map((d) => `${d.prefix_he} ${d.number}`).join(", ");
    const answer =
      `איתרתי את פסק הדין ${docketLabel} במאגר הרשמי של בית המשפט, אך קובץ פסק הדין גדול מכדי שניתן לחלץ ממנו את הנוסח המלא בתוך משאבי העיבוד שהוקצו לשאילתה. ` +
      `מכיוון שאין בידי את גוף פסק הדין, איני מוסר מה נקבע בו כדי שלא להסתמך על מקורות משניים או על ידע כללי. ` +
      `ניתן לצרף את קובץ פסק הדין לשאילתה ואשיב על בסיס הנוסח המצורף.`;
    await completeAllStages();
    const limitation = {
      reason: "exact_case_body_unavailable",
      deterministic_branch: "exact_case_body_unavailable",
      dockets: fastLaneDockets.map((d) => `${d.prefix_he} ${d.number}`),
      source_url: specificCase.exact_case_body_unavailable_url,
      body_unavailable_reason: specificCase.body_unavailable_reason,
      extraction_skipped_reason: specificCase.extraction_skipped_reason,
      pdf_preflight_size: specificCase.pdf_preflight_size,
      pdf_preflight_decision: specificCase.pdf_preflight_decision,
      specific_case: specificCase,
    };
    await writeTelemetry(admin, {
      ...telemetryBase,
      row_id: traceRowId,
      answer,
      footnotes: [],
      task_mode: "legal_research",
      metadata: {
        pipeline: "legal-research-v1",
        phase: "exact_case_body_unavailable",
        run_id,
        total_ms: Date.now() - t_start,
        stage_runs,
        planning: planningMeta,
        claims: analyzer.claims,
        queries: allQueries,
        retrieval: { ...retrievalMeta, retrieval_budget: budget.report() },
        limitation,
      },
    });
    return jsonResponse(200, {
      answer,
      footnotes: [],
      debug: {
        run_id,
        phase: "exact_case_body_unavailable",
        stage_runs,
        limitation,
        retrieval: { ...retrievalMeta, retrieval_budget: budget.report() },
      },
    });
  }


  // ─── Retrieval CPU guard (specific_case) ─────────────────────────────────
  // Fail closed instead of letting the isolate get killed mid-retrieval: if the
  // deadline passed and we still have no docket-verified judgment body, refuse
  // with explicit acquisition telemetry rather than drafting from whatever the
  // pool happens to contain.
  if (
    !is_sources_only && fastLaneEligible &&
    (budget.exceeded() || specificCase.budget_exceeded === true ||
      fastLane?.budget_exceeded === true) &&
    !specificCase.acquisition_success
  ) {

    budget.trigger("post_retrieval");
    const docketLabel = fastLaneDockets.map((d) => `${d.prefix_he} ${d.number}`).join(", ");
    const answer =
      `לא הצלחתי לאתר בתוך זמן העיבוד שהוקצב את נוסח פסק הדין ${docketLabel} ממקור רשמי, ולכן איני יכול למסור מה נקבע בו. ` +
      `כדי להימנע ממסירת תוכן שאינו מבוסס על גוף פסק הדין עצמו, אני נמנע מתשובה לגופה. ` +
      `ניתן לצרף את פסק הדין כקובץ ואשיב על בסיס הנוסח המצורף, או להריץ את השאילתה שוב.`;
    await completeAllStages();
    await writeTelemetry(admin, {
      ...telemetryBase,
      row_id: traceRowId,
      answer,
      footnotes: [],
      task_mode: "legal_research",
      metadata: {
        pipeline: "legal-research-v1",
        phase: "retrieval_cpu_guard",
        run_id,
        total_ms: Date.now() - t_start,
        stage_runs,
        planning: planningMeta,
        claims: analyzer.claims,
        queries: allQueries,
        retrieval: { ...retrievalMeta, retrieval_budget: budget.report() },
        limitation: {
          reason: "retrieval_timeout",
          deterministic_branch: "retrieval_timeout",
          dockets: fastLaneDockets.map((d) => `${d.prefix_he} ${d.number}`),
          specific_case: specificCase,
        },
      },
    });
    return jsonResponse(200, {
      answer,
      footnotes: [],
      debug: {
        run_id,
        phase: "retrieval_cpu_guard",
        stage_runs,
        retrieval: { ...retrievalMeta, retrieval_budget: budget.report() },
      },
    });
  }


  // ─── P4: Source Verifier ─────────────────────────────────────────────────
  await markStage("verifier");
  await budget.markDurable("verifier_start", { candidates: pool.candidates.length });
  const forceSplit = (req.headers.get("x-verifier-force-split") ?? "") === "1";
  // router_profiles_v1 — on the doctrine path the verifier only spends calls on
  // candidates inside the locked legal area. Area-neutral candidates (no area
  // vocabulary at all) are kept: the filter drops cross-area contamination
  // only, never silently starves the pool.
  const verifierAreaLock = router.verifier_same_area_only
    ? (facetExpansion.legal_area_lock ?? inferLegalAreaId(question))
    : null;
  const verifierPool = verifierAreaLock
    ? pool.candidates.filter((c) => {
      const area = inferLegalAreaId(`${c.title ?? ""} ${c.snippet ?? ""}`);
      return area === null || area === verifierAreaLock;
    })
    : pool.candidates;
  const verifierCandidates = verifierPool.length > 0 ? verifierPool : pool.candidates;
  const verifierAreaFiltered = pool.candidates.length - verifierCandidates.length;
  const verifier = await runVerifier(question, analyzer.claims, verifierCandidates, { forceSplit });
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
      row_id: traceRowId,
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

    // sources_only mode delivers a curated source list → keep the charge.
    pipelineDelivered = true;
    return jsonResponse(200, {
      ...sourcesPayload,
      debug: debugBlock,
    });
  }


  await markStage("drafter");
  // Specific-case handoff: the docket-verified judgment body must reach the
  // drafter's input sources even if the verifier never marked it usable — it
  // is the one source the question is about (identity already validated).
  const exactDocketCandidateId = specificCase.exact_docket_candidate_id ??
    specificCase.injected_candidate_id;
  let specific_case_forced_usable: string | null = null;
  if (
    specificCaseGate?.allow === true && exactDocketCandidateId &&
    pool.candidates.some((c) => c.candidate_id === exactDocketCandidateId) &&
    !verifier.usable.some((u) => u.candidate_id === exactDocketCandidateId)
  ) {
    verifier.usable.unshift({
      candidate_id: exactDocketCandidateId,
      best_support: "direct",
      role_match: true,
      verdict_claim_ids: [],
    });
    specific_case_forced_usable = exactDocketCandidateId;
  }
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
      specificCaseGate,
      facetDirective,
      // router_profiles_v1 — path-scoped answer shape.
      blockCeiling: router.drafter_block_ceiling,
      dropUnsupportedBlocks: router.drop_unsupported_blocks,

    },
  );
  stage_runs.push(...drafter.stage_runs);

  // claim_facet_expansion_v1 — per-facet coverage telemetry (no behavior).
  const facetUsedIds = new Set(drafter.used_sources.map((u) => u.candidate_id));
  const facetSupportById = new Map<string, string>();
  for (const v of verifier.verdicts) {
    facetSupportById.set(
      (v as { candidate_id: string }).candidate_id,
      String((v as { support?: string }).support ?? "unknown"),
    );
  }
  const facetSourceViews: FacetSourceView[] = pool.candidates.map((c) => ({
    candidate_id: c.candidate_id,
    title: c.title ?? "",
    snippet: c.snippet ?? "",
    source_type: String(c.source_type ?? ""),
    role: String(c.role ?? ""),
    support: facetSupportById.get(c.candidate_id) ?? "unknown",
    citable_as: (c.metadata as Record<string, unknown> | undefined)?.citable_as as string | undefined,
    text_usability: (c.metadata as Record<string, unknown> | undefined)?.text_usability as
      | string
      | undefined,
    used: facetUsedIds.has(c.candidate_id),
    query_he: c.query_he,
    facet_id: ((c.metadata as Record<string, unknown> | undefined)?.facet_id ?? null) as
      | string
      | null,
  }));
  const facetTelemetry = facetExpansion.enabled
    ? computeFacetCoverage(facetExpansion.facets, facetSourceViews)
    : [];
  const claimFacetExpansionMeta = {
    version: "claim_facet_expansion_v1" as const,
    enabled: facetExpansion.enabled,
    gate_reason: facetExpansion.gate_reason,
    legal_area_lock: facetExpansion.legal_area_lock,
    facet_count: facetExpansion.facets.length,
    facet_queries_count: facetExpansion.queries.length,
    directive_applied: facetDirective.length > 0,
    facets: facetTelemetry,
    facets_without_primary_support: facetTelemetry.filter((f) => !f.primary_support_found).length,
    facets_commentary_only: facetTelemetry.filter((f) => f.commentary_only).length,
  };
  // retrieval_budget_enforcement_v1: candidates admitted per doctrinal facet.
  const candidateCountByFacet: Record<string, number> = {};
  for (const c of pool.candidates) {
    const fid = ((c.metadata as Record<string, unknown> | undefined)?.facet_id ?? "unfaceted") as string;
    candidateCountByFacet[fid] = (candidateCountByFacet[fid] ?? 0) + 1;
  }



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
          missingRequiredAnchors: missingForCaveat,
          answerIntent: analyzer.answer_intent,
          requiredAnchorCandidateIds,
          satisfiedStatuteSectionAnchors,
          researchMode: plannerStage.mode_plan?.mode ?? null,
          specificCaseGate,
          forceModel: "openai/gpt-5",
          skipEscalation: true,
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

  // research_pack_hierarchy_v1 — carried research pack: what we are willing to
  // show as research material. Unrelated verdicts are excluded entirely;
  // tangential ones are kept in telemetry only.
  const carriedPack = verifier.usable.filter(
    (u) => u.best_support === "direct" || u.best_support === "partial",
  );
  const unrelated_excluded_from_carried_pack_count =
    verifier.usable.length - carriedPack.length;
  const tangential_excluded_from_carried_pack_count = verifier.usable.filter(
    (u) => String(u.best_support) === "tangential",
  ).length;

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
    // research_pack_hierarchy_v1 telemetry.
    hierarchy: drafter.hierarchy_report ?? null,
    hierarchy_order_applied: true as const,
    used_sources_hierarchy_counts: drafter.hierarchy_report?.used_sources_hierarchy_counts ?? {},
    first_primary_position: drafter.hierarchy_report?.first_primary_position ?? null,
    first_secondary_position: drafter.hierarchy_report?.first_secondary_position ?? null,
    primary_before_secondary_passed:
      drafter.hierarchy_report?.primary_before_secondary_passed ?? true,
    mixed_hierarchy_footnotes_count: drafter.hierarchy_report?.mixed_hierarchy_footnotes_count ?? 0,
    commentary_head_count: drafter.hierarchy_report?.commentary_head_count ?? 0,
    statute_identity_dedup_count: drafter.hierarchy_report?.statute_identity_dedup_count ?? 0,
    carried_pack_size: carriedPack.length,
    unrelated_excluded_from_carried_pack_count,
    tangential_excluded_from_carried_pack_count,
    structured_validation: drafter.structured_validation,

    builder_report: drafter.builder_report,
    // footnote_rendering_invariant_v1 telemetry.
    footnote_render_report: drafter.footnote_render_report ?? null,
    inline_marker_count: drafter.footnote_render_report?.inline_marker_count ?? 0,
    footnotes_length: drafter.footnote_render_report?.footnotes_length ?? 0,
    used_sources_length: drafter.footnote_render_report?.used_sources_length ?? 0,
    dangling_marker_count: drafter.footnote_render_report?.dangling_marker_count ?? 0,
    orphan_source_row_count: drafter.footnote_render_report?.orphan_source_row_count ?? 0,
    footnote_invariant_passed: drafter.footnote_render_report?.invariant_passed ?? true,
    // source_label_quality_v1 telemetry (per-source label audit trail).
    source_label_quality: {
      total: (drafter.input_sources ?? []).length,
      fallback_used_count: (drafter.input_sources ?? []).filter((s) => s.fallback_applied === true)
        .length,
      reclassified_count: (drafter.input_sources ?? []).filter((s) => !!s.classification_reason)
        .length,
      classification_cache_hit_count: labelCpuStats.classification_cache_hit_count,
      classification_rerun_count: labelCpuStats.classification_rerun_count,
      classification_rerun_reason: labelCpuStats.classification_rerun_reason,
      source_label_cpu_guard_applied: labelCpuStats.source_label_cpu_guard_applied,
      rows: (drafter.input_sources ?? []).map((s) => ({
        ref: s.ref,
        candidate_id: s.candidate_id,
        raw_title: s.raw_title,
        title: s.title,
        title_status: s.title_status,
        title_hygiene_action: s.title_hygiene_action ?? null,
        title_hygiene_reasons: s.title_hygiene_reasons ?? [],
        fallback_used: s.fallback_used ?? null,
        fallback_applied: s.fallback_applied === true,
        fallback_candidate: s.fallback_candidate ?? null,
        fallback_rejected_reason: s.fallback_rejected_reason ?? null,
        fallback_improvement_reason: s.fallback_improvement_reason ?? null,
        classification_cache_hit: s.classification_cache_hit ?? null,
        classification_rerun_reason: s.classification_rerun_reason ?? null,
        classification_before: s.classification_before ?? null,
        classification_after: s.classification_after ?? null,
        classification_reason: s.classification_reason ?? null,
        judgment_identity_signals: s.judgment_identity_signals ?? [],
        commentary_identity_signals: s.commentary_identity_signals ?? [],
        uncertain_identity: s.uncertain_identity === true,
        downgrade_reason: s.downgrade_reason ?? null,
        url: s.url,
      })),
    },


    schema_failure_reason: drafter.schema_failure_reason,
    quality_warning: drafter.quality_warning,
    missing_anchor_caveat_injected: drafter.missing_anchor_caveat_injected ?? false,
    missing_anchor_descriptions: drafter.missing_anchor_descriptions ?? [],
    lead_ref: drafter.lead_ref ?? null,
    // Narrow default-on merge telemetry (Track: lead_ref + deterministic branches).
    deterministic_branch: drafter.deterministic_branch ?? null,
    missing_docket_limitation_fired: drafter.deterministic_branch === "docket_limitation",
    // Specific-case authority resolution telemetry.
    specific_case_resolution: specificCase,
    specific_case_identity: specificCaseIdentity,
    requested_docket_normalized: specificCase.requested_docket_normalized,
    exact_docket_source_found: specificCase.exact_docket_source_found,
    exact_docket_source_title: specificCase.exact_docket_source_title,
    exact_docket_source_url: specificCase.exact_docket_source_url,
    text_acquisition_attempted: specificCase.text_acquisition_attempted,
    acquisition_method: specificCase.acquisition_method,
    acquisition_method_successful: specificCase.acquisition_method_successful,
    acquisition_methods_attempted: specificCase.acquisition_methods_attempted,
    acquisition_failure_reasons: specificCase.acquisition_failure_reasons,
    last_acquisition_failure_reason: specificCase.last_acquisition_failure_reason,
    acquisition_success: specificCase.acquisition_success,
    acquired_text_length: specificCase.acquired_text_length,
    exact_docket_candidate_id: specificCase.exact_docket_candidate_id,
    specific_case_forced_usable,
    final_docket_branch_reason: specificCase.final_docket_branch_reason,
    near_match_sources_ignored_count: specificCase.near_match_sources_ignored_count,
    statute_section_limitation_fired: drafter.deterministic_branch === "statute_section_limitation",
    canonical_quote_fired:
      drafter.deterministic_branch === "canonical_quote_registry" ||
      drafter.deterministic_branch === "canonical_quote_verified",
    // Source-sufficiency gate telemetry.
    source_sufficiency: drafter.sufficiency ?? null,
    insufficient_sources_limitation_fired:
      drafter.deterministic_branch === "insufficient_sources_limitation",
    // Authority-type-aware sufficiency telemetry.
    sufficiency_profile: drafter.sufficiency?.sufficiency_profile ?? null,
    authority_type_sufficiency_passed:
      drafter.sufficiency?.authority_type_sufficiency_passed ?? null,
    sufficiency_authority_basis: drafter.sufficiency?.sufficiency_authority_basis ?? null,
    statute_only_answer: drafter.sufficiency?.statute_only_answer ?? false,
    case_law_required: drafter.sufficiency?.case_law_required ?? false,
    case_law_missing_but_not_required:
      drafter.sufficiency?.case_law_missing_but_not_required ?? false,
    thin_governing_statute_refs: drafter.sufficiency?.thin_governing_statute_refs ?? [],
    thin_governing_regulation_refs: drafter.sufficiency?.thin_governing_regulation_refs ?? [],
    morphology_domain_match: drafter.sufficiency?.morphology_domain_match ?? false,
    normalized_question_tokens: drafter.sufficiency?.normalized_question_tokens ?? [],
    normalized_source_tokens: drafter.sufficiency?.normalized_source_tokens ?? [],
    practical_steps_thin_authority_passed:
      drafter.sufficiency?.practical_steps_thin_authority_passed ?? false,
    exact_amounts_allowed: drafter.sufficiency?.exact_amounts_allowed ?? null,
    // claim_facet_expansion_v1 telemetry.
    claim_facet_expansion: claimFacetExpansionMeta,
    // router_profiles_v1 telemetry.
    router_profiles: {
      version: router.version,
      selected_router_profile: router.selected_router_profile,
      profile_reason: router.profile_reason,
      skipped_stages: router.skipped_stages,
      retrieval_query_count: allQueries.length,
      retrieval_queries_dropped: queryAdmission.dropped_count,
      speculative_acquisition_count: judgmentAcquisition.successes ?? 0,
      verifier_candidate_count: verifierCandidates.length,
      verifier_area_filtered_count: verifierAreaFiltered,
      drafter_block_ceiling: router.drafter_block_ceiling,
      path_budget_ms: router.path_budget_ms,
      downgraded_from_research_memo: router.downgraded_from_research_memo,
      facets_dropped_by_router: facetsDroppedByRouter,
      block_trim: drafter.router_block_trim ?? null,
      signals: router.signals,
    },

    // Named-doctrine premise/framing telemetry.
    named_doctrine_framing: drafter.named_doctrine_framing ?? null,
    framing_correction_required:
      drafter.named_doctrine_framing?.framing_correction_required ?? false,
    // Case-law synthesis rendering telemetry.
    synthesis_rendering: drafter.synthesis_rendering ?? null,
    synthesis_rendering_applied:
      drafter.synthesis_rendering?.synthesis_rendering_applied ?? false,
    // claim_source_match_validation_v1 telemetry.
    claim_source_match: drafter.claim_source_match ?? null,
    claim_source_mismatch_count: drafter.claim_source_match?.source_ref_mismatch_count ?? 0,
    claim_source_mismatch_reasons: drafter.claim_source_match?.mismatch_reason ?? [],
    claim_source_unsupported_blocks: drafter.claim_source_match?.unsupported_block_count ?? 0,
    claim_source_limitation_added: drafter.claim_source_match?.limitation_added ?? false,
    primary_support_by_main_claim: drafter.claim_source_match?.primary_support_by_main_claim ?? false,
    commentary_only_claims: drafter.claim_source_match?.commentary_only_claims ?? [],
    // metadata_only_holding_gate_v1 telemetry.
    metadata_only_holding_gate: drafter.metadata_only_holding_gate ?? null,

    metadata_only_holdings_remaining:
      drafter.metadata_only_holding_gate?.metadata_only_holdings_remaining ?? 0,
    source_split_read_in_full:
      drafter.metadata_only_holding_gate?.source_split_counts.read_in_full ?? 0,
    source_split_reference_only:
      drafter.metadata_only_holding_gate?.source_split_counts.reference_only ?? 0,






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
  const budgetReport = budget.report();
  budget.dispose();
  // retrieval_budget_enforcement_v1: when retrieval was cut short by the hard
  // wall-clock budget, the answer must disclose that the source search was
  // incomplete. Presentation-only: no change to drafting or source selection.
  const PARTIAL_RETRIEVAL_NOTE =
    "\n\n> החיפוש הופסק עקב מגבלת זמן, ולכן ייתכן שלא אותרו כל המקורות הרלוונטיים.";
  // f07_extraction_stability_v1: the same disclosure duty applies when body
  // extraction (not the clock) was cut short by the CPU-safety ledger.
  const EXTRACTION_CUT_SHORT_NOTE =
    "\n\n> קריאת גוף פסקי הדין הופסקה מטעמי מגבלת עיבוד, ולכן ייתכן שחלק מהמקורות נותחו לפי מטא-נתונים בלבד.";
  const extractionCutShort = budgetReport.extraction_ledger_exhausted ||
    budgetReport.speculative_extraction_stopped;
  const partialRetrieval = budgetReport.partial_retrieval_used ||
    budgetReport.budget_exceeded;
  const finalAnswer = drafter.ok
    ? `${drafter.answer_markdown}${partialRetrieval ? PARTIAL_RETRIEVAL_NOTE : ""}${
        extractionCutShort ? EXTRACTION_CUT_SHORT_NOTE : ""
      }`
    : (verifierFailedNoDrafter ? VERIFIER_FAILURE_ANSWER : STUB_ANSWER);
  const finalFootnotes = drafter.ok ? drafter.footnotes : [];


  // Mark final stage (footnote rendering / finalize) as active then complete.
  await markStage("finalize");
  await completeAllStages();

  // ─── Telemetry write (always) ────────────────────────────────────────────
  await writeTelemetry(admin, {
    ...telemetryBase,
    row_id: traceRowId,
    answer: finalAnswer,
    footnotes: finalFootnotes,
    metadata: {
      pipeline: "legal-research-v1",
      phase: "P5",
      run_id,
      total_ms: Date.now() - t_start,
      stage_runs,
      // retrieval_budget_enforcement_v1 telemetry.
      retrieval_budget_enforcement: {
        version: "retrieval_budget_enforcement_v1",
        retrieval_budget_ms: budgetReport.retrieval_budget_ms,
        retrieval_elapsed_ms: budgetReport.retrieval_elapsed_ms,
        budget_exceeded: budgetReport.budget_exceeded,
        aborted_tasks_count: budgetReport.aborted_tasks_count,
        ignored_late_tasks_count: budgetReport.ignored_late_tasks_count,
        partial_retrieval_used: partialRetrieval,
        partial_sources_count: partialRetrieval ? pool.candidates.length : 0,
        body_acquisition_count: budgetReport.body_acquisition_count,
        extraction_count: budgetReport.extraction_count,
        extraction_bytes: budgetReport.extraction_bytes,
        // f07_extraction_stability_v1
        extraction_attempt_count: budgetReport.extraction_attempt_count,
        extraction_success_count: budgetReport.extraction_success_count,
        extraction_input_bytes: budgetReport.extraction_input_bytes,
        extraction_output_chars: budgetReport.extraction_output_chars,
        extraction_ledger_exhausted: budgetReport.extraction_ledger_exhausted,
        speculative_extraction_stopped: budgetReport.speculative_extraction_stopped ||
          judgmentAcquisition.speculative_extraction_stopped === true,
        extraction_cut_short_disclosure_shown: extractionCutShort,
        reaper_terminal_limitation_written: false,
        longest_retrieval_step: budgetReport.longest_retrieval_step,
        candidate_count_by_facet: candidateCountByFacet,
        terminal_result_written: true,
      },
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

  // A real drafted answer keeps the charge; refusals/stubs are refunded.
  if (drafter.ok) pipelineDelivered = true;
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

  // Terminal-state watchdog: a job row must never be left `running` with a
  // NULL error. If the pipeline neither resolves nor throws within the hard
  // wall budget, persist a controlled failure.
  const WATCHDOG_MS = 9 * 60_000;
  let settled = false;
  const watchdog = setTimeout(() => {
    if (settled) return;
    settled = true;
    void refundCredits("watchdog_timeout");
    void setJobStatus({
      status: "error",
      error: "pipeline_watchdog_timeout",
      current_stage: null,
    });
  }, WATCHDOG_MS) as unknown as number;

  const bg = (async () => {
    IN_FLIGHT += 1;
    try {
      const resp = await runPipeline();
      const payload = await resp.clone().json().catch(() => null);
      if (settled) return;
      settled = true;
      if (resp.status === 200) {
        // Refund when the pipeline did not deliver a real answer/source-list
        // (refusal, stub, or limitation branch).
        if (!pipelineDelivered) {
          await refundCredits("no_answer_delivered");
        }
        await setJobStatus({ status: "done", result: payload });
      } else {
        await refundCredits(`pipeline_status_${resp.status}`);
        const errMsg = (payload && typeof payload === "object")
          ? JSON.stringify(payload).slice(0, 4000)
          : `http_${resp.status}`;
        await setJobStatus({ status: "error", error: errMsg, result: payload });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[lrv1 bg]", msg);
      await refundCredits("pipeline_threw");
      if (settled) return;
      settled = true;
      await setJobStatus({ status: "error", error: msg });
    } finally {
      IN_FLIGHT = Math.max(0, IN_FLIGHT - 1);
      clearTimeout(watchdog);
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
