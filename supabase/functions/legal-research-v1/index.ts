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
  classifySourceDepth,
  disabledSourceDepth,
  SOURCE_DEPTH_VERSION,
  type SourceDepthDecision,
} from "./stages/sourceDepthPolicy.ts";
import {
  buildFacetDirective,
  computeFacetCoverage,
  expandClaimFacets,
  FacetSourceView,
  inferLegalAreaId,
} from "./stages/claimFacetExpansion.ts";
import {
  computeAuthorityOutcomes,
  normalizeStatuteTitles,
  seedCoreAuthorityQueries,
} from "./stages/coreAuthorityRegistry.ts";
import {
  admitQueries,
  selectRouterProfile,
  STATUTE_FIRST_LIMITATION,
} from "./stages/routerProfiles.ts";

import { runLocalRetrieval } from "./stages/localRetrieval.ts";
import { runPerplexityRetrieval } from "./stages/perplexityRetrieval.ts";
import {
  extractTopicTerms,
  summarizeAcademicPackAdmission,
} from "./stages/academicCandidateAdmission.ts";
import { buildPrimaryAnchorAcquisitionReport } from "./stages/primaryAnchorAcquisitionStatus.ts";
import { buildCandidatePool } from "./stages/candidatePool.ts";
import { enrichLocalCaselawListingGate } from "./stages/localCaselawListingGate.ts";
import { summarizeSynthesisPack, type SynthesisRole } from "./stages/synthesisRole.ts";
import { runJudgmentTextAcquisition } from "./stages/judgmentTextAcquisition.ts";
import { runStatuteTextAcquisition } from "./stages/statuteTextAcquisition.ts";
import { runSecondaryBodyAcquisition } from "./stages/secondaryBodyAcquisition.ts";
import {
  bestSupportByCandidate,
  buildDoctrinalPoolSnapshot,
  decideDoctrinalRecovery,
} from "./stages/doctrinalCandidateStabilization.ts";
import {
  annotateCanonicalUsage,
  runCanonicalAuthorityAcquisition,
} from "./stages/canonicalAuthorityAcquisition.ts";
import { runSourceNomination } from "./stages/sourceNomination.ts";
import {
  EXPLICIT_DOCKET_GUARD_VERSION,
  runExplicitDocketGuard,
} from "./stages/explicitDocketGuard.ts";
import { mergeAndBudgetQueries } from "./stages/queryMergeAndBudget.ts";
import { runOfficialSourceDiscovery } from "./stages/officialSourceDiscovery.ts";
import { runCanonicalRegistryDiscovery } from "./stages/canonicalRegistryDiscovery.ts";
import {
  detectStatutoryTarget,
  type NonAcademicLocalJudgmentPackFlow,
  type NonAcademicPrimaryAnchorBinding,
  type NonAcademicRuntimeBreakdown,
} from "./stages/nonAcademicBinding.ts";
import { courtEgressTelemetry, resetCourtEgressLedger } from "./lib/courtEgress.ts";
import {
  courtRelayDiagnostics,
  directFetchDiagnostic,
  relayFetchDiagnostic,
  resetCourtRelayDiagnostics,
} from "./lib/courtEgress.ts";
import { judgmentUrlTelemetry, resetJudgmentUrlLedger } from "./lib/judgmentUrlEligibility.ts";
import {
  officialFetchTelemetry,
  resetOfficialFetchLedger,
} from "./lib/officialFetch.ts";


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
import { planSourceUseIntent } from "./stages/sourceUseIntent.ts";
import {
  isLiteratureOnlyRequest,
  scoreLiteratureTopicality,
} from "./stages/academicLiteratureRichness.ts";
import {
  assessCenterOfGravity,
  buildUnusedLiteraturePackTelemetry,
  type CenterOfGravityView,
  detectNaturalLiteratureMode,
  NATURAL_LITERATURE_MODE_VERSION,
} from "./stages/naturalLiteratureMode.ts";
import {
  buildLiteratureGateTrace,
  checkNamedSynthesis,
  classifyBodyTopicality,
  decideThinPackRecovery,
  isStrongDirectLiteratureCandidate,
  LITERATURE_GATE_REPAIR_VERSION,
} from "./stages/academicLiteratureGateRepair.ts";
import { makeAdminClient, writeTelemetry, beginTraceRow } from "./lib/telemetry.ts";
import { getWebTierHealth, resetWebTierHealth } from "./lib/webTierHealth.ts";
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
  // Hebrew labels are persisted so any surface (result page, history) can show
  // the live stage without duplicating the mapping.
  const STAGE_LABELS_HE: Record<string, string> = {
    analyzer: "מנתח את השאלה",
    planner: "מתכנן מחקר",
    retrieval: "מחפש מקורות",
    reading: "קורא מקורות",
    verifier: "מאמת התאמה",
    ranking: "בודק מספיקות",
    drafter: "מנסח תשובה",
    finalize: "מסיים",
  };
  const completedStages: string[] = [];
  let currentStage: string | null = null;
  const markStage = async (stage: string) => {
    if (currentStage && !completedStages.includes(currentStage)) {
      completedStages.push(currentStage);
    }
    currentStage = stage;
    await setJobStatus({
      current_stage: stage,
      progress_label_he: STAGE_LABELS_HE[stage] ?? null,
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
      progress_label_he: null,
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

  // ─── canonical_body_acquisition_and_csm_survival_v1 — relay parity probe ──
  // Service-role + smoke-mode only. Runs the exact relay fetch/extraction path
  // for a manually supplied public court/gov document URL and returns the full
  // `court_relay_fetch_diagnostic`. No credits, no drafting, no persistence.
  if (body.relay_probe && smokeMode && isServiceRole) {
    const probe = body.relay_probe as Record<string, unknown>;
    const urls = (Array.isArray(probe.urls) ? probe.urls : [probe.url])
      .filter((u): u is string => typeof u === "string" && u.length > 0)
      .slice(0, 8);
    if (urls.length === 0) return jsonResponse(400, { error: "relay_probe_missing_url" });
    const transports = Array.isArray(probe.transports)
      ? (probe.transports as string[])
      : ["direct_edge", "relay"];
    const out: unknown[] = [];
    for (const u of urls) {
      if (transports.includes("direct_edge")) {
        out.push(
          await directFetchDiagnostic(u, {
            run_id,
            url_source: "manual_test_url",
            identity_must_contain: typeof probe.identity_must_contain === "string"
              ? probe.identity_must_contain
              : null,
            extract: probe.extract !== false,
          }),
        );
      }
      if (transports.includes("relay")) {
        out.push(
          await relayFetchDiagnostic(u, {
            run_id,
            url_source: "manual_test_url",
            identity_must_contain: typeof probe.identity_must_contain === "string"
              ? probe.identity_must_contain
              : null,
            extract: probe.extract !== false,
          }),
        );
      }
    }
    return jsonResponse(200, { run_id, relay_probe: out });
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

  // ─── Idempotency (persistent_background_research_jobs_v1) ────────────────
  // The client generates a fresh id per submit attempt and re-sends it only on
  // a retry/double-submit of that same attempt. If we already have a job for
  // (user, client_request_id) we return it without charging again.
  const cridRaw = body.client_request_id;
  const clientRequestId = typeof cridRaw === "string" && cridRaw.trim().length >= 8
    ? cridRaw.trim().slice(0, 120)
    : null;
  if (clientRequestId && !smokeMode) {
    try {
      const { data: existing } = await adminEarly
        .from("legal_research_jobs")
        .select("id, status, created_at")
        .eq("user_id", user.id)
        .eq("client_request_id", clientRequestId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const row = existing as { id: string; status: string; created_at: string } | null;
      if (row) {
        console.log("[lrv1 idempotent replay]", { job_id: row.id, status: row.status });
        return jsonResponse(202, {
          ok: true,
          job_id: row.id,
          status: row.status,
          idempotent_replay: true,
        });
      }
    } catch (e) {
      console.error("[lrv1 idempotency lookup failed]", e);
    }
  }



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
  // official_fetch_profile_v1 — per-run serialisation/cap ledger.
  resetOfficialFetchLedger();
  resetCourtEgressLedger();
  resetCourtRelayDiagnostics();
  // judgment_url_guess_suppression_v1 — per-run URL provenance ledger.
  resetJudgmentUrlLedger();
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
      .insert({
        user_id: user.id,
        project_id,
        question,
        status: "running",
        started_at: new Date().toISOString(),
        // Lets the stale-job reaper refund this run's charge if the worker dies.
        ...(creditsCharged && creditRequestId ? { credit_request_id: creditRequestId } : {}),
        ...(clientRequestId && !smokeMode ? { client_request_id: clientRequestId } : {}),
      })
      .select("id")
      .single();
    if (jobErr || !jobRow) {
      // Unique-index race on (user_id, client_request_id): a concurrent
      // double-submit already created the job — hand back that one and refund
      // this attempt's charge so the user is billed once.
      if (clientRequestId && (jobErr as { code?: string } | null)?.code === "23505") {
        await refundCredits("duplicate_submit_refund");
        const { data: dup } = await admin
          .from("legal_research_jobs")
          .select("id, status")
          .eq("user_id", user.id)
          .eq("client_request_id", clientRequestId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const dupRow = dup as { id: string; status: string } | null;
        if (dupRow) {
          return jsonResponse(202, {
            ok: true,
            job_id: dupRow.id,
            status: dupRow.status,
            idempotent_replay: true,
          });
        }
      }
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
        doctrinal_sufficiency_trace: {
          ran: false,
          reason: "pipeline_exit_before_drafter",
          exit_phase: "P2",
        },
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
        doctrinal_sufficiency_trace: {
          ran: false,
          reason: "pipeline_exit_before_drafter",
          exit_phase: "P2",
        },
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
        doctrinal_sufficiency_trace: {
          ran: false,
          reason: "pipeline_exit_before_drafter",
          exit_phase: "P2",
        },
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




  // ─── source_use_intent_planning_v1 ───────────────────────────────────────
  // Normalize the analyzer's task/source-use plan and apply deterministic
  // safety floors (docket → judgment body, statute section → official text).
  const sourceUseIntent = planSourceUseIntent(question, analyzer);

  // ─── five_mode_source_depth_policy_v1 ────────────────────────────────────
  // Research-depth decision, taken *before* planning, nomination, discovery
  // and acquisition. Raises source-type diversity floors only; router budgets
  // and every downstream gate stay authoritative.
  // Smoke-only control switch used by the A/B validation runner.
  const depthControlRun = req.headers.get("x-smoke-mode") === "1" &&
    req.headers.get("x-disable-source-depth") === "1";
  // research_richness_execution_unblock_v1 — per-run web-tier health ledger.
  resetWebTierHealth();
  const sourceDepth: SourceDepthDecision = depthControlRun
    ? disabledSourceDepth()
    : classifySourceDepth({ question, analyzer });

  // ─── P2: Research Query Planner ──────────────────────────────────────────
  await markStage("planner");
  let plannerStage;
  try {
    plannerStage = await runQueryPlanner(question, analyzer, sourceDepth);

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    await writeTelemetry(admin, {
      ...telemetryBase,
      row_id: traceRowId,
      metadata: {
        pipeline: "legal-research-v1",
        phase: "P2",
        doctrinal_sufficiency_trace: {
          ran: false,
          reason: "pipeline_exit_before_drafter",
          exit_phase: "P2",
        },
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
        doctrinal_sufficiency_trace: {
          ran: false,
          reason: "pipeline_exit_before_drafter",
          exit_phase: "P2",
        },
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
        doctrinal_sufficiency_trace: {
          ran: false,
          reason: "pipeline_exit_before_drafter",
          exit_phase: "P2",
        },
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
        legal_area_lock: null, lock_terms: [], facets: [], queries: [],
        contamination_guard: [] }
    : expandClaimFacets(question, analyzer, {
      mode: plannerStage.mode_plan?.mode ?? null,
      outputShape: plannerStage.mode_plan?.output_shape ?? null,
      run_id,
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
  // ─── core_authority_registry_v1 ──────────────────────────────────────────
  // Stage 2(a): normalise informal statute names inside planner-side query
  // text. Stage 1: seed at most 2 name-anchored canonical-authority queries
  // for the highest-priority doctrine that fires. Seeding affects retrieval
  // only — no gate, verifier, drafter or footnote behaviour changes.
  const statuteNorm = normalizeStatuteTitles([
    ...planner!.queries,
    ...judgmentDiscovery.queries,
    ...facetExpansion.queries,
  ]);
  const normalizedQueries = statuteNorm.queries;
  // Split the normalised block back into its producers (order is preserved).
  const nPlanner = planner!.queries.length;
  const nDiscovery = judgmentDiscovery.queries.length;
  const plannerQueriesNorm = normalizedQueries.slice(0, nPlanner);
  const discoveryQueriesNorm = normalizedQueries.slice(nPlanner, nPlanner + nDiscovery);
  const facetQueriesNorm = normalizedQueries.slice(nPlanner + nDiscovery);
  let coreAuthorityRegistry = seedCoreAuthorityQueries(
    question,
    analyzer,
    facetExpansion.facets,
    [...anchorQueries, ...normalizedQueries],
  );

  // ─── source_nomination_v1 ────────────────────────────────────────────────
  // "What sources would a competent Israeli legal researcher expect to
  // obtain here?" — nominated sources are never citations: each one must
  // still be retrieved, acquired, validated and admitted by every gate.
  const nominationSkip = router.skipped_stages.includes("source_nomination") ||
    plannerStage.mode_plan?.mode === "canonical_quote";
  const nominationRaw = await runSourceNomination({
    question,
    analyzer,
    mode: plannerStage.mode_plan?.mode ?? null,
    depth_mode: sourceDepth.depth_mode,
    depth_mix_line_he: Object.entries(sourceDepth.source_mix)
      .map(([k, v]) => `${k}=${v[0]}-${v[1]}`)
      .join(", "),
    max_candidates: router.max_retrieval_queries <= 8 ? 3 : 5,
    skip: nominationSkip,
    skip_reason: nominationSkip ? "router_or_mode_skip" : undefined,
  });
  stage_runs.push(...nominationRaw.stage_runs);

  // ─── judgment_nomination_coverage_for_named_dockets_v1 ───────────────────
  // Deterministic coverage guard: an explicit docket in the user question
  // always yields an actionable judgment target (dedupe-merged when nomination
  // already emitted it). Opens the lane only — no URL guessing, no citation.
  const explicitDocketGuard = nominationSkip
    ? { nomination: nominationRaw, report: {
        version: EXPLICIT_DOCKET_GUARD_VERSION,
        enabled: false,
        skip_reason: "router_or_mode_skip",
        detected_count: 0,
        added_count: 0,
        merged_count: 0,
        dockets: [],
        ms: 0,
      } }
    : runExplicitDocketGuard(
      question,
      nominationRaw,
      analyzer.claims?.[0]?.claim_id ?? "C1",
    );
  const sourceNomination = explicitDocketGuard.nomination;

  // ─── query_merge_and_budget ──────────────────────────────────────────────
  // Single funnel over every query producer: normalise, dedupe (exact +
  // near), priority-sort, cap. Required-anchor queries are never dropped.
  // source_nomination_v2 — academic/policy questions treat exploratory
  // literature searches as the primary output; doctrinal runs still keep at
  // least one exploratory scholarship/institutional lane.
  const nominationMode = plannerStage.mode_plan?.mode ?? "";
  const academicish =
    /academic|policy|theor|comparative|literature|research_survey/i.test(nominationMode);
  const queryMerge = mergeAndBudgetQueries([
    { producer: "required_anchors", queries: anchorQueries },
    { producer: "source_nomination", queries: sourceNomination.queries, cap: 5 },
    { producer: "core_authority_registry", queries: coreAuthorityRegistry.queries, cap: 2 },
    { producer: "planner", queries: plannerQueriesNorm },
    { producer: "facets", queries: facetQueriesNorm },
    { producer: "judgment_discovery", queries: discoveryQueriesNorm },
  ], {
    max_total: Math.max(4, router.max_retrieval_queries),
    reserve_actionable: 2,
    reserve_exploratory: 2,
    min_slots_by_source_type: sourceDepth.min_slots_by_source_type,
    min_exploratory: academicish ? 2 : 1,
    nomination_stats: {
      actionability_mix: sourceNomination.actionability_mix,
      identifier_confidence_histogram: sourceNomination.identifier_confidence_histogram,
      stripped_identifiers: sourceNomination.stripped_identifiers.length,
      demoted_identifiers: sourceNomination.demoted_identifiers.length,
    },
  });


  // router_profiles_v1 — path-scoped query admission. Required-anchor queries
  // are never dropped (they carry the deterministic primary-source duties).
  const queryAdmission = admitQueries(
    router,
    queryMerge.protectedQueries,
    queryMerge.queries,
  );
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
  // discovery_precision_stage2_blockers_v1 — record up-front that the stage has
  // not started yet and why, so an aborted retrieval still leaves telemetry.
  budget.mark("discovery_precision_pending", {
    status: "not_started",
    not_run_reason: "awaiting_retrieval_completion",
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
  // five_mode_source_depth_policy_v1 — Perplexity is gated by research depth.
  // `never` (exact_source) skips the open-web leg entirely unless nothing else
  // is available; `targeted` keeps a small slice; `allowed` keeps everything.
  let perplexityReason = "depth_allowed";
  let pplxQueries = fastLaneHit ? [] : allQueries;
  if (fastLaneHit) {
    perplexityReason = "fast_lane_hit";
  } else if (sourceDepth.perplexity_policy === "never") {
    if (allQueries.length === 0) {
      perplexityReason = "depth_never_no_queries";
    } else {
      pplxQueries = [];
      perplexityReason = "depth_never";
    }
  } else if (sourceDepth.perplexity_policy === "targeted") {
    pplxQueries = allQueries.slice(0, Math.min(allQueries.length, 4));
    perplexityReason = "depth_targeted";
  }
  const perplexityCalled = pplxQueries.length > 0;
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
        const r = await runPerplexityRetrieval(pplxQueries, {
          budget,
          // academic_citation_authority_alignment_v1
          academicMode: sourceUseIntent.plan?.user_task_intent === "academic_writing",
          // academic_candidate_admission_and_slotting_v1 — topical-fit terms.
          topicTerms: extractTopicTerms(question),
        });
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
  // discovery_precision_stage2_blockers_v1 — durable lifecycle marks so the
  // stage is auditable even when the isolate/reaper terminates the run.
  await budget.markDurable("discovery_precision_start", {
    candidates_at_start: local.candidates.length + pplx.candidates.length,
    task_intent: sourceUseIntent.plan?.user_task_intent ?? null,
  });
  // local_caselaw_content_aware_listing_gate_v1 — content-aware verdict for
  // local_db caselaw whose stored URL is a gov.il collector/listing artefact.
  // One batched bounded RPC; no LLM, no network fetch, no extraction.
  const localCaselawGate = await enrichLocalCaselawListingGate(
    admin as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }> },
    local.candidates,
  );
  await budget.markDurable("local_caselaw_content_listing_gate", {
    status: localCaselawGate.status,
    candidates_checked: localCaselawGate.candidates_checked,
    bypassed: localCaselawGate.bypassed,
    still_suppressed: localCaselawGate.still_suppressible,
    classification_counts: localCaselawGate.classification_counts,
    p50_ms: localCaselawGate.p50_ms,
    p95_ms: localCaselawGate.p95_ms,
    elapsed_ms: localCaselawGate.elapsed_ms,
    rpc_error: localCaselawGate.rpc_error ?? null,
  });
  await budget.markDurable("doctrine_mapping_v1", {
    doctrine_mapping: coreAuthorityRegistry.doctrine_mapping ?? null,
    canonical_registry_selection: coreAuthorityRegistry.canonical_registry_selection ?? null,
  });
  const pool = buildCandidatePool([...local.candidates, ...pplx.candidates], {
    task_intent: sourceUseIntent.plan?.user_task_intent ?? null,
    academic_mode: sourceUseIntent.plan?.user_task_intent === "academic_writing",
  });
  if (pool.pool_collapse) {
    await budget.markDurable("pool_collapse_v1", pool.pool_collapse);
  }
  await budget.markDurable("discovery_precision_done", {
    status: pool.discovery_precision.status,
    candidates_at_start: pool.discovery_precision.candidates_at_start,
    processed: pool.discovery_precision.processed,
    o_n_guard_ok: pool.discovery_precision.o_n_guard_ok,
    suppression_ran: pool.discovery_precision.suppression_ran,
    backfill_ran: pool.discovery_precision.backfill_ran,
    suppressed: pool.discovery_precision.suppressed.length,
    backfilled: pool.discovery_precision.backfilled,
    raw_index_or_listing_ratio: pool.discovery_precision.raw_index_or_listing_ratio,
    suppressible_index_or_listing_ratio:
      pool.discovery_precision.suppressible_index_or_listing_ratio,
    final_suppressible_listing_ratio: pool.discovery_precision.final_suppressible_listing_ratio,
    ms: pool.discovery_precision.ms,
  });
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

  // ─── official_source_discovery + verified_legal_sources cache ────────────
  // Identifier-bearing nominations: cache lookup first (a hit costs no fetch
  // and no extraction slot), then official URLs retrieval already surfaced,
  // then deterministic court-file derivation. Identity is proven inside the
  // body before anything is injected or cached.
  // non_academic_source_binding_and_csm_v1 — ordinary statutory questions
  // ("מה אומר חוק-יסוד…") must anchor on the local statutory text. When the
  // nominator produced no statute target, inject exactly one synthetic
  // statute nomination so the existing local-first resolver runs. Bounded: one
  // target, no extra retrieval, no new fetch lane.
  const nonAcademicRun = sourceUseIntent.plan?.user_task_intent !== "academic_writing";
  const statutoryTarget = nonAcademicRun
    ? detectStatutoryTarget(question)
    : { detected: false, statute_title: null, statute_section: null, matched_pattern: null };
  const hasStatuteNomination = sourceNomination.candidates.some((c) => c.category === "statute");
  let syntheticStatuteInjected = false;
  let nominationForDiscovery = sourceNomination;
  if (statutoryTarget.detected && !hasStatuteNomination) {
    const synthetic = {
      nomination_id: "syn_statute_1",
      bucket: "actionable" as const,
      actionability: "known_name_no_docket" as const,
      category: "statute" as const,
      label_he: statutoryTarget.statute_title!,
      docket: null,
      statute_title: statutoryTarget.statute_title,
      statute_section: statutoryTarget.statute_section,
      authors: [],
      journal_or_publisher: null,
      institution: null,
      year: null,
      topic_query: null,
      role_in_answer: "primary_statute",
      relevance_confidence: 0.9,
      identifier_confidence: 0.9,
      confidence: 0.9,
      must_verify: true as const,
      nominated_by: "non_academic_statutory_target_detector",
      stripped_fields: [],
      demoted: false,
      demoted_reason: null,
    };
    nominationForDiscovery = {
      ...sourceNomination,
      candidates: [synthetic, ...sourceNomination.candidates],
      actionable: [synthetic, ...sourceNomination.actionable],
    };
    syntheticStatuteInjected = true;
  }

  const officialDiscovery = await runOfficialSourceDiscovery({
    admin,
    nomination: nominationForDiscovery,
    candidates: pool.candidates,
    integrity: pool.integrity,
    budget,
    max_targets: fastLaneHit
      ? 0
      : Math.min(
        syntheticStatuteInjected ? 3 : 2,
        Math.max(syntheticStatuteInjected ? 1 : 0, router.max_speculative_acquisitions ?? 2),
      ),
    markDurable: (name, detail) => budget.markDurable(name, detail),
  });

  // ─── canonical_judgment_text_acquisition_v1 (Option B) ───────────────────
  // research_richness_execution_unblock_v1: re-enabled as a *bounded* lane
  // (max 2 seeded dockets) for the depth modes where a canonical authority is
  // actually expected. All existing identity / URL / body / integrity gates
  // inside the stage are unchanged; nothing is cited without passing them.
  const canonicalDepthEligible = sourceDepth.depth_mode === "narrow_doctrine" ||
    sourceDepth.depth_mode === "broad_research" ||
    sourceDepth.depth_mode === "academic_research";
  const canonicalMaxDockets = canonicalDepthEligible ? 2 : 0;
  // web_source_usability_and_authority_selection_v1 (fix 2) — official URLs
  // that discovery actually produced feed the canonical lane; derived guesses
  // remain a fallback and stay suppressed by isGuessedCourtUrl.
  const discoveredJudgmentUrls = officialDiscovery.attempts.flatMap((a) =>
    (a.url_candidates ?? [])
      .filter((u) => !u.suppressed)
      .map((u) => ({
        url: u.url,
        title: a.label,
        discovery_source: u.url_source ?? "official_discovery",
      }))
  );
  // canonical_registry_discovery_and_representative_source_use_v1 (fix 1) —
  // official discovery only queries *nominated* sources, so registry-seeded
  // canonical authorities were never searched for and acquisition starved with
  // `discovery_candidate_count: 0`. This bounded lane resolves them locally
  // first, then issues targeted official discovery queries per authority.
  const canonicalRegistryDiscovery = await runCanonicalRegistryDiscovery({
    admin,
    registry: coreAuthorityRegistry,
    candidates: pool.candidates,
    integrity: pool.integrity,
    run_id,
    max_authorities: canonicalMaxDockets === 0 ? 0 : 3,
    budget,
    markDurable: (name, detail) => budget.markDurable(name, detail),
  });

  const canonicalAcquisition = await runCanonicalAuthorityAcquisition({
    registry: coreAuthorityRegistry,
    candidates: pool.candidates,
    discovered_urls: [
      ...canonicalRegistryDiscovery.discovered_urls,
      ...discoveredJudgmentUrls,
    ],
    integrity: pool.integrity,
    budget,
    max_dockets: canonicalMaxDockets,
    markDurable: (name, detail) => budget.markDurable(name, detail),
  });
  const canonicalAcquisitionTrigger = {
    depth_mode: sourceDepth.depth_mode,
    depth_eligible: canonicalDepthEligible,
    max_dockets: canonicalMaxDockets,
    reason: canonicalDepthEligible ? "depth_mode_eligible" : "depth_mode_not_eligible",
  };



  // ─── doctrinal_secondary_body_acquisition_v1 ────────────────────────────
  // Broad / academic / narrow-doctrine runs only. For secondary and doctrinal
  // candidates ALREADY admitted to the pool, obtain the substantive body text
  // (local corpus → verified cache → one bounded open-web fetch) so the
  // doctrinal sufficiency and claim-source-match gates can see real text
  // instead of a snippet. Never touches judgments, statutes or the relay;
  // anything without an acquired body stays bibliography-only.
  await budget.markDurable("secondary_body_acquisition_gate", {
    depth_mode: sourceDepth.depth_mode ?? null,
    budget_exceeded: budget.exceeded(),
  });
  // academic_literature_gate_repair_and_thin_pack_recovery_v1 — assess which
  // already-found candidates are strong DIRECT legal scholarship for this
  // question, so body budget goes to them first and `discovery_only` stops
  // being a terminal state for real scholarship.
  // natural_literature_mode_and_topic_guard_v1 — natural Hebrew literature
  // prompts ("תעשה לי סקירת ספרות על…", seminar / theoretical-background
  // requests) must activate the same machinery as the lab phrasing.
  const naturalLiteratureMode = detectNaturalLiteratureMode({
    run_id,
    question,
    user_task_intent: sourceUseIntent.plan?.user_task_intent ?? null,
    answer_strategy: sourceUseIntent.plan?.answer_strategy ?? null,
    asks_for_sources: /(מקורות|ספרות|ביבליוגרפיה|רקע\s+תיאורטי)/.test(question),
    mode_before: sourceUseIntent.plan?.user_task_intent === "academic_writing" &&
      isLiteratureOnlyRequest(question),
  });
  const literatureModeRun = naturalLiteratureMode.academic_literature_mode_after;
  await budget.markDurable("natural_literature_mode_activation", naturalLiteratureMode);
  const literatureCandidateViews = pool.candidates.map((c) => ({
    candidate_id: c.candidate_id,
    title: String(c.title ?? ""),
    url: c.source_url ?? null,
    snippet: c.snippet ?? null,
    source_type: c.source_type ? String(c.source_type) : null,
    role: c.role ? String(c.role) : null,
    origin: c.origin ? String(c.origin) : null,
  }));
  const literatureStrongDirect = literatureModeRun
    ? literatureCandidateViews.map((v) => isStrongDirectLiteratureCandidate(question, v))
    : [];
  const literatureStrongDirectIds = new Set(
    literatureStrongDirect.filter((s) => s.strong_direct).map((s) => s.candidate_id),
  );
  const literatureDirectIds = literatureStrongDirect
    .filter((s) => s.strong_direct)
    .sort((a, b) => b.topicality_score - a.topicality_score)
    .slice(0, 8)
    .map((s) => s.candidate_id);
  if (literatureModeRun) {
    await budget.markDurable("academic_literature_strong_direct_candidates", {
      total_candidates: pool.candidates.length,
      strong_direct: literatureDirectIds.length,
      top: literatureStrongDirect
        .filter((s) => s.strong_direct)
        .slice(0, 10)
        .map((s) => ({
          source_id: s.candidate_id,
          title: s.title,
          host: s.host,
          topicality_score: s.topicality_score,
          journal: s.detected_journal_or_institution,
          mirror_status: s.mirror_status,
        })),
    });
  }
  const secondaryBodyAcquisition = await runSecondaryBodyAcquisition({
    admin,
    candidates: pool.candidates,
    depth_mode: sourceDepth.depth_mode ?? null,
    enabled: !fastLaneHit && !budget.exceeded(),
    // academic_literature_richness_without_fixed_source_count_v1 — spend body
    // budget on topically direct scholarship, not on whatever fetches easily.
    question,
    literature_mode: literatureModeRun,
    literature_direct_ids: literatureDirectIds,
    // doctrinal_candidate_pool_stabilization_v1 — drop clear index/listing
    // pages before they consume acquisition budget.
    suppress_listings: true,
    retrieval_budget: {
      exceeded: () => budget.exceeded(),
      allowExtraction: (bytes: number) => budget.allowExtraction?.(bytes) ?? true,
    },
    markDurable: (name, detail) => budget.markDurable(name, detail),
  });
  if (secondaryBodyAcquisition.acquired_candidate_ids.length > 0) {
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
      // web_source_usability_and_authority_selection_v1
      web_source_classification: pplx.web_source_classification,
      web_rate_limit_control: pplx.web_rate_limit_control,
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
    // local_retrieval_precision_tuning_v1
    local_vector_quota_tuning: pool.vector_tuning
      ? { run_id, ...pool.vector_tuning }
      : null,
    local_candidate_reranking: pool.reranking.map((r) => ({ run_id, ...r })),
    // discovery_precision_and_listing_suppression_v1
    discovery_precision: {
      version: "discovery_precision_and_listing_suppression_v1",
      task_intent: sourceUseIntent.plan?.user_task_intent ?? null,
      ...pool.discovery_precision,
    },
    // local_caselaw_content_aware_listing_gate_v1
    local_caselaw_content_listing_gate: {
      version: "local_caselaw_content_aware_listing_gate_v1",
      run_id,
      ...localCaselawGate,
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
    canonical_authority_acquisition: canonicalAcquisition,
    canonical_authority_acquisition_trigger: canonicalAcquisitionTrigger,
    // canonical_registry_discovery_and_representative_source_use_v1 (fix 1).
    canonical_registry_discovery: {
      version: canonicalRegistryDiscovery.version,
      enabled: canonicalRegistryDiscovery.enabled,
      skip_reason: canonicalRegistryDiscovery.skip_reason,
      doctrine_id: canonicalRegistryDiscovery.doctrine_id,
      authorities_considered: canonicalRegistryDiscovery.authorities_considered,
      authorities_queried: canonicalRegistryDiscovery.authorities_queried,
      canonical_registry_discovery_query: canonicalRegistryDiscovery.queries,
      canonical_discovery_candidate_selection: canonicalRegistryDiscovery.selections,
      candidate_count: canonicalRegistryDiscovery.candidate_count,
      local_bodies_injected: canonicalRegistryDiscovery.local_bodies_injected,
      ms: canonicalRegistryDiscovery.ms,
    },
    web_tier_health: getWebTierHealth(),
    secondary_body_acquisition: secondaryBodyAcquisition,
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
        doctrinal_sufficiency_trace: {
          ran: false,
          reason: "pipeline_exit_before_drafter",
          exit_phase: "exact_case_body_unavailable",
        },
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
        doctrinal_sufficiency_trace: {
          ran: false,
          reason: "pipeline_exit_before_drafter",
          exit_phase: "exact_case_body_unavailable",
        },
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
        doctrinal_sufficiency_trace: {
          ran: false,
          reason: "pipeline_exit_before_drafter",
          exit_phase: "retrieval_cpu_guard",
        },
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
        doctrinal_sufficiency_trace: {
          ran: false,
          reason: "pipeline_exit_before_drafter",
          exit_phase: "retrieval_cpu_guard",
        },
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
        doctrinal_sufficiency_trace: {
          ran: false,
          reason: "pipeline_exit_before_drafter",
          exit_phase: "sources_only",
        },
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

  // ─── doctrinal_candidate_pool_stabilization_v1 ──────────────────────────
  // Pre-sufficiency pool snapshot + a strictly bounded recovery pass. Recovery
  // may fail safely: nothing here forces sufficiency success — when it does not
  // produce acquired, integrity-passing, eligible doctrinal sources the normal
  // insufficiency branch runs and the exact failure is logged.
  const stabilizationAttemptedIds = [
    ...secondaryBodyAcquisition.acquired_candidate_ids,
    ...secondaryBodyAcquisition.bibliography_only_candidate_ids,
  ];
  const poolSnapshotBefore = buildDoctrinalPoolSnapshot({
    candidates: pool.candidates,
    verdicts: verifier.verdicts,
    attempted_candidate_ids: stabilizationAttemptedIds,
  });
  const recoveryDecision = decideDoctrinalRecovery({
    snapshot: poolSnapshotBefore,
    plan: sourceUseIntent.plan,
    depth_mode: sourceDepth.depth_mode ?? null,
    candidates: pool.candidates,
    verdicts: verifier.verdicts,
    budget_allows: !budget.exceeded(),
  });
  let recoveryReport: Awaited<ReturnType<typeof runSecondaryBodyAcquisition>> | null = null;
  let poolSnapshotAfter = poolSnapshotBefore;
  if (recoveryDecision.should_run) {
    await budget.markDurable("doctrinal_pool_recovery_start", {
      candidates: recoveryDecision.candidate_ids.length,
      doctrinal_eligible_before: poolSnapshotBefore.doctrinal_eligible,
    });
    try {
      recoveryReport = await runSecondaryBodyAcquisition({
        admin,
        candidates: pool.candidates,
        depth_mode: sourceDepth.depth_mode ?? null,
        enabled: true,
        recovery_pass: true,
        suppress_listings: true,
        restrict_to_candidate_ids: recoveryDecision.candidate_ids,
        support_by_candidate: bestSupportByCandidate(verifier.verdicts),
        limits: {
          max_local_lookups: recoveryDecision.budget.max_local_lookups,
          max_web_attempts: recoveryDecision.budget.max_web_attempts,
          total_ms: recoveryDecision.budget.total_ms,
        },
        retrieval_budget: {
          exceeded: () => budget.exceeded(),
          allowExtraction: (bytes: number) => budget.allowExtraction?.(bytes) ?? true,
        },
        markDurable: (name, detail) => budget.markDurable(name, detail),
      });
      if (recoveryReport.acquired_candidate_ids.length > 0) {
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
    } catch (err) {
      await budget.markDurable("doctrinal_pool_recovery_failed", {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    poolSnapshotAfter = buildDoctrinalPoolSnapshot({
      candidates: pool.candidates,
      verdicts: verifier.verdicts,
      attempted_candidate_ids: [
        ...stabilizationAttemptedIds,
        ...(recoveryReport?.acquired_candidate_ids ?? []),
        ...(recoveryReport?.bibliography_only_candidate_ids ?? []),
      ],
    });
    await budget.markDurable("doctrinal_pool_recovery_done", {
      acquired: recoveryReport?.acquired_candidate_ids.length ?? 0,
      doctrinal_eligible_after: poolSnapshotAfter.doctrinal_eligible,
      stop_reason: recoveryReport?.stage_stop_reason ?? "exception",
    });
  }
  const candidatePoolStabilization = {
    version: "doctrinal_candidate_pool_stabilization_v1",
    depth_mode: sourceDepth.depth_mode ?? null,
    user_task_intent: sourceUseIntent.plan?.user_task_intent ?? null,
    snapshot_before: poolSnapshotBefore,
    snapshot_after: poolSnapshotAfter,
    listing_suppressed: secondaryBodyAcquisition.listing_suppressed ?? 0,
    listing_suppressed_ids: secondaryBodyAcquisition.listing_suppressed_ids ?? [],
    reconsidered_candidate_ids: secondaryBodyAcquisition.reconsidered_candidate_ids ?? [],
    recovery: {
      considered: true,
      ran: recoveryDecision.should_run,
      reason: recoveryDecision.reason,
      candidate_ids: recoveryDecision.candidate_ids,
      budget: recoveryDecision.budget,
      acquired_candidate_ids: recoveryReport?.acquired_candidate_ids ?? [],
      bibliography_only_candidate_ids: recoveryReport?.bibliography_only_candidate_ids ?? [],
      stop_reason: recoveryReport?.stage_stop_reason ?? null,
      ms: recoveryReport?.ms ?? 0,
      failures: (recoveryReport?.per_candidate ?? [])
        .filter((r) => !r.ok)
        .map((r) => ({
          candidate_id: r.candidate_id,
          url: r.url,
          failure_reason: r.failure_reason,
          web_result: r.web_result,
          substantive_reason: r.substantive_reason,
        })),
      eligibility_gain: poolSnapshotAfter.doctrinal_eligible -
        poolSnapshotBefore.doctrinal_eligible,
    },
  };

  // ─── academic_declared_category_remap_and_body_acquisition_v2 ───────────
  // Bounded re-acquisition: in academic runs, verifier-direct doctrinal
  // sources that were acquired only as tiny stubs (a few hundred chars) get
  // ONE extra attempt so they can qualify as substantive doctrinal support.
  const academicRunForBodies = sourceUseIntent.plan?.user_task_intent === "academic_writing";
  let academicShortBodyReacquisition:
    | { ran: boolean; reason: string; candidate_ids: string[]; acquired: string[]; stop_reason: string | null; ms: number }
    | null = null;
  if (academicRunForBodies && !budget.exceeded()) {
    const support = bestSupportByCandidate(verifier.verdicts);
    const shortIds = pool.candidates
      .filter((c) => {
        if (support.get(c.candidate_id) !== "direct") return false;
        const meta = (c.metadata ?? {}) as Record<string, unknown>;
        const chars = Math.max(
          typeof meta.extended_text === "string" ? meta.extended_text.length : 0,
          String(c.snippet ?? "").length,
        );
        return chars > 0 && chars < 1500;
      })
      .slice(0, 3)
      .map((c) => c.candidate_id);
    if (shortIds.length === 0) {
      academicShortBodyReacquisition = {
        ran: false,
        reason: "no_short_direct_doctrinal_candidates",
        candidate_ids: [],
        acquired: [],
        stop_reason: null,
        ms: 0,
      };
    } else {
      const t0short = Date.now();
      try {
        const rep = await runSecondaryBodyAcquisition({
          admin,
          candidates: pool.candidates,
          depth_mode: sourceDepth.depth_mode ?? null,
          enabled: true,
          suppress_listings: true,
          restrict_to_candidate_ids: shortIds,
          reacquire_short_bodies_under: 1500,
          support_by_candidate: support,
          limits: { max_local_lookups: 3, max_web_attempts: 3, total_ms: 9_000 },
          retrieval_budget: {
            exceeded: () => budget.exceeded(),
            allowExtraction: (bytes: number) => budget.allowExtraction?.(bytes) ?? true,
          },
          markDurable: (name, detail) => budget.markDurable(name, detail),
        });
        academicShortBodyReacquisition = {
          ran: true,
          reason: rep.reason,
          candidate_ids: shortIds,
          acquired: rep.acquired_candidate_ids,
          stop_reason: rep.stage_stop_reason,
          ms: Date.now() - t0short,
        };
      } catch (err) {
        academicShortBodyReacquisition = {
          ran: false,
          reason: err instanceof Error ? err.message : String(err),
          candidate_ids: shortIds,
          acquired: [],
          stop_reason: "exception",
          ms: Date.now() - t0short,
        };
      }
    }
  }

  // ─── academic_literature_gate_repair_and_thin_pack_recovery_v1 ──────────
  // Bounded safety net, NOT a retrieval stage: when a literature-only review
  // still has a thin usable pack and strong direct scholarship that was
  // already found never got a body, retry at most 3 of those candidates once
  // each, with a short time box and no new search of any kind.
  const literatureBodyOutcome = new Map<
    string,
    { attempted: boolean; acquired: boolean; chars: number; failure_reason?: string | null }
  >();
  for (
    const rep of [secondaryBodyAcquisition, recoveryReport].filter((r): r is NonNullable<typeof r> =>
      !!r
    )
  ) {
    for (const r of rep.per_candidate ?? []) {
      literatureBodyOutcome.set(r.candidate_id, {
        attempted: r.web_attempted || r.local_lookup_attempted,
        acquired: r.ok,
        chars: r.body_chars ?? 0,
        failure_reason: r.failure_reason ?? null,
      });
    }
  }
  const bodyAcquiredIds = new Set(
    pool.candidates
      .filter((c) => ((c.metadata ?? {}) as Record<string, unknown>).body_acquired === true)
      .map((c) => c.candidate_id),
  );
  const definitivelyRejectedIds = new Set(
    pool.integrity.filter((r) =>
      (r as { reject?: boolean }).reject === true
    ).map((r) => r.candidate_id),
  );
  const usableLiteratureCount = verifier.usable.filter((u) => {
    const c = pool.candidates.find((x) => x.candidate_id === u.candidate_id);
    if (!c) return false;
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const citable = String(
      (meta.source_integrity as { citable_as?: string } | undefined)?.citable_as ?? "",
    );
    return meta.body_acquired === true && citable !== "judgment" && citable !== "statute";
  }).length;
  const thinPackRecoveryDecision = decideThinPackRecovery({
    literature_mode: literatureModeRun,
    usable_literature_count: usableLiteratureCount,
    strong_direct: literatureStrongDirect,
    body_acquired: bodyAcquiredIds,
    definitively_rejected: definitivelyRejectedIds,
    budget_allows: !budget.exceeded(),
  });
  let thinPackRecoveryReport: {
    triggered: boolean;
    trigger_reason: string;
    added_latency_ms: number;
    attempts: Array<Record<string, unknown>>;
  } = {
    triggered: false,
    trigger_reason: thinPackRecoveryDecision.trigger_reason,
    added_latency_ms: 0,
    attempts: [],
  };
  if (thinPackRecoveryDecision.triggered) {
    const tRec = Date.now();
    await budget.markDurable("thin_pack_recovery_start", {
      trigger_reason: thinPackRecoveryDecision.trigger_reason,
      candidates: thinPackRecoveryDecision.candidate_ids.length,
    });
    try {
      const rec = await runSecondaryBodyAcquisition({
        admin,
        candidates: pool.candidates,
        depth_mode: sourceDepth.depth_mode ?? null,
        enabled: true,
        recovery_pass: true,
        suppress_listings: true,
        question,
        literature_mode: true,
        literature_direct_ids: thinPackRecoveryDecision.candidate_ids,
        restrict_to_candidate_ids: thinPackRecoveryDecision.candidate_ids,
        limits: {
          max_local_lookups: thinPackRecoveryDecision.bounds.max_candidates,
          max_web_attempts: thinPackRecoveryDecision.bounds.max_web_attempts,
          total_ms: thinPackRecoveryDecision.bounds.total_ms,
        },
        retrieval_budget: {
          exceeded: () => budget.exceeded(),
          allowExtraction: (bytes: number) => budget.allowExtraction?.(bytes) ?? true,
        },
        markDurable: (name, detail) => budget.markDurable(name, detail),
      });
      const acquired = new Set(rec.acquired_candidate_ids);
      for (const r of rec.per_candidate ?? []) {
        const c = pool.candidates.find((x) => x.candidate_id === r.candidate_id);
        const meta = (c?.metadata ?? {}) as Record<string, unknown>;
        const body = typeof meta.extended_text === "string" ? meta.extended_text : null;
        const topical = c
          ? classifyBodyTopicality(question, {
            candidate_id: c.candidate_id,
            title: String(c.title ?? ""),
            snippet: c.snippet,
            url: c.source_url,
            body,
          }, run_id)
          : null;
        thinPackRecoveryReport.attempts.push({
          run_id,
          candidate_id: r.candidate_id,
          title: r.title,
          url: r.url,
          original_loss_stage: literatureBodyOutcome.get(r.candidate_id)?.attempted
            ? "body_acquisition_failed"
            : "body_not_attempted",
          recovery_action: "retry_body_acquisition_for_found_candidate",
          body_attempted: r.web_attempted || r.local_lookup_attempted,
          body_acquired: acquired.has(r.candidate_id),
          extracted_chars: r.body_chars ?? 0,
          post_body_topicality: topical?.post_body_topicality ?? null,
          admitted_after_recovery: acquired.has(r.candidate_id) &&
            topical?.eligible_for_pack === true,
          final_reason: acquired.has(r.candidate_id)
            ? (topical?.eligible_for_pack === false
              ? "recovered_body_off_topic_rejected"
              : "recovered_usable_body")
            : (r.failure_reason ?? "recovery_fetch_failed"),
        });
        // A recovered body that turns out to be off-topic is refused, not used.
        if (acquired.has(r.candidate_id) && topical?.eligible_for_pack === false && c) {
          c.metadata = { ...(c.metadata ?? {}), literature_off_topic_body: true };
        }
      }
      // Refresh integrity rows for bodies the recovery pass acquired.
      if (rec.acquired_candidate_ids.length > 0) {
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
      thinPackRecoveryReport = {
        ...thinPackRecoveryReport,
        triggered: true,
        added_latency_ms: Date.now() - tRec,
      };
    } catch (err) {
      thinPackRecoveryReport = {
        ...thinPackRecoveryReport,
        triggered: true,
        trigger_reason: `${thinPackRecoveryDecision.trigger_reason}|exception:${
          err instanceof Error ? err.message : String(err)
        }`,
        added_latency_ms: Date.now() - tRec,
      };
    }
    await budget.markDurable("thin_pack_recovery_done", {
      added_latency_ms: thinPackRecoveryReport.added_latency_ms,
      attempts: thinPackRecoveryReport.attempts.length,
      acquired: thinPackRecoveryReport.attempts.filter((a) => a.body_acquired === true).length,
    });
  }

  // Post-body topicality for every acquired scholarship body (report only —
  // pack eligibility for off-topic bodies is enforced by the pack gates).
  const literatureBodyTopicality = literatureModeRun
    ? pool.candidates
      .filter((c) => ((c.metadata ?? {}) as Record<string, unknown>).body_acquired === true)
      .map((c) =>
        classifyBodyTopicality(question, {
          candidate_id: c.candidate_id,
          title: String(c.title ?? ""),
          snippet: c.snippet,
          url: c.source_url,
          body: typeof ((c.metadata ?? {}) as Record<string, unknown>).extended_text === "string"
            ? String(((c.metadata ?? {}) as Record<string, unknown>).extended_text)
            : null,
        }, run_id)
      )
    : [];


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
      depthMode: sourceDepth.depth_mode,
      sourceUsePlan: sourceUseIntent.plan,
      specificCaseGate,
      facetDirective,
      // router_profiles_v1 — path-scoped answer shape.
      blockCeiling: router.drafter_block_ceiling,
      dropUnsupportedBlocks: router.drop_unsupported_blocks,
      literatureMode: literatureModeRun,

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

  // core_authority_registry_v1 — per-authority outcome telemetry (no behaviour).
  coreAuthorityRegistry = computeAuthorityOutcomes(coreAuthorityRegistry, {
    candidates: pool.candidates,
    usableIds: usableIdSet,
    usedCandidateIds: facetUsedIds,
  });
  const coreAuthorityRegistryMeta = {
    registry_version: coreAuthorityRegistry.registry_version,
    triggered: coreAuthorityRegistry.triggered,
    doctrine_id: coreAuthorityRegistry.doctrine_id,
    doctrine_label: coreAuthorityRegistry.doctrine_label,
    matched_facet: coreAuthorityRegistry.matched_facet,
    trigger_reason: coreAuthorityRegistry.trigger_reason,
    area: coreAuthorityRegistry.area,
    authority_candidates: coreAuthorityRegistry.authority_candidates,
    queries_added: coreAuthorityRegistry.queries_added,
    queries: coreAuthorityRegistry.queries.map((q) => q.query_he),
    skipped_because_already_present: coreAuthorityRegistry.skipped_because_already_present,
    authorities: coreAuthorityRegistry.authorities,
    statute_title_normalization: statuteNorm.report,
  };

  // canonical_judgment_text_acquisition_v1 — post-draft measurement only.
  const citedCandidateIds = new Set<string>(
    (drafter.footnotes ?? []).flatMap((f) =>
      ((f as unknown as { source_candidate_ids?: string[] }).source_candidate_ids ?? []) as string[]
    ),
  );
  const canonicalAcquisitionMeta = annotateCanonicalUsage(canonicalAcquisition, {
    usedCandidateIds: facetUsedIds,
    citedCandidateIds,
    citedSources: drafter.used_sources.map((u) => {
      const usability = String(u.text_usability ?? "unknown");
      const bodyAcquired = /full_text|substantive_excerpt/.test(usability);
      return {
        candidate_id: u.candidate_id,
        citable_as: u.citable_as ? String(u.citable_as) : null,
        body_acquired: bodyAcquired,
        metadata_only: /metadata_only/.test(usability) &&
          String(u.citable_as ?? "") === "judgment",
      };
    }),
  });
  (retrievalMeta as Record<string, unknown>).canonical_authority_acquisition =
    canonicalAcquisitionMeta;





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

    candidate_pool_stabilization: candidatePoolStabilization,
    academic_short_body_reacquisition: academicShortBodyReacquisition,

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
    // non_academic_source_binding_and_csm_v1 telemetry.
    non_academic_primary_anchor_binding: nonAcademicRun
      ? ((): NonAcademicPrimaryAnchorBinding => {
        const att = officialDiscovery.attempts.find((a) => a.local_statute_anchor_resolution);
        const res = att?.local_statute_anchor_resolution as
          | { resolved?: boolean; reason?: string }
          | undefined;
        const statuteRefs = drafter.used_sources.filter((u) =>
          String(u.citable_as ?? "") === "statute" || String(u.citable_as ?? "") === "regulation"
        );
        return {
          question_id: "answer",
          detected_statutory_target: statutoryTarget.statute_title,
          local_primary_anchor_attempted: !!att,
          local_primary_anchor_found: res?.resolved === true,
          bound_to_blocks: statuteRefs.length,
          block_ids: statuteRefs.map((u) => String(u.candidate_id)),
          failure_reason: res?.resolved === true ? null : (res?.reason ?? "no_statute_lane_attempt"),
          synthetic_nomination_injected: syntheticStatuteInjected,
        };
      })()
      : undefined,
    non_academic_local_judgment_pack_flow: nonAcademicRun
      ? ((): NonAcademicLocalJudgmentPackFlow => {
        const finalJudgments = drafter.used_sources.filter((u) =>
          String(u.citable_as ?? "") === "judgment"
        ).length;
        const eligible = verifier.usable.filter((u) =>
          String((u as { citable_as?: string }).citable_as ?? "") === "judgment"
        ).length;
        return {
          question_id: "answer",
          protected_local_judgments: localCaselawGate.bypassed ?? 0,
          eligible_local_judgments: eligible,
          admitted_to_synthesis_pack: finalJudgments,
          rejected_count: Math.max(0, eligible - finalJudgments),
          rejection_reasons: (drafter.claim_source_match?.dropped_source_refs ?? [])
            .reduce((acc: Record<string, number>, d: { reason: string }) => {
              acc[d.reason] = (acc[d.reason] ?? 0) + 1;
              return acc;
            }, {}),
          final_judgment_count: finalJudgments,
        };
      })()
      : undefined,
    non_academic_runtime_breakdown: nonAcademicRun
      ? ({
        question_id: "answer",
        total_ms: Date.now() - t_start,
        stage_ms: {
          retrieval_ms: (pool as unknown as { ms?: number }).ms ?? 0,
          discovery_ms: officialDiscovery.ms ?? 0,
          verifier_ms: verifier.ms ?? 0,
          drafter_ms: drafter.ms ?? 0,
        },
        failure_stage: null,
        reaped: false,
        refund_triggered: false,
        recommended_fix: null,
      } as NonAcademicRuntimeBreakdown)
      : undefined,
    non_academic_limitation_note: drafter.non_academic_limitation_note ?? null,
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
    footnote_density_emission: drafter.footnote_density_emission ?? [],
    // academic_richness_last_mile_and_doctrine_mapping_v1 telemetry.
    footnote_builder_richness_summary: drafter.footnote_builder_richness_summary ?? null,
    footnote_materialization: drafter.footnote_materialization ?? [],

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
    // source_use_intent_planning_v1 telemetry.
    source_use_intent: {
      ...sourceUseIntent,
      planned_sufficiency: {
        research_guidance_sufficiency:
          drafter.sufficiency?.research_guidance_sufficiency ?? false,
        planned_user_task_intent: drafter.sufficiency?.planned_user_task_intent ?? null,
        planned_answer_strategy: drafter.sufficiency?.planned_answer_strategy ?? null,
        source_buckets: drafter.sufficiency?.source_buckets ?? null,
        sufficiency_reason: drafter.sufficiency?.reason ?? null,
        deterministic_branch: drafter.deterministic_branch ?? null,
      },
    },
    // claim_facet_expansion_v1 telemetry.
    claim_facet_expansion: claimFacetExpansionMeta,
    // core_authority_registry_v1 telemetry.
    core_authority_registry: coreAuthorityRegistryMeta,
    // judgment_nomination_coverage_for_named_dockets_v1 telemetry.
    explicit_docket_guard: explicitDocketGuard.report,
    // source_nomination_v1 telemetry.
    source_nomination: {
      version: sourceNomination.version,
      enabled: sourceNomination.enabled,
      skip_reason: sourceNomination.skip_reason,
      stage_failed: sourceNomination.stage_failed,
      model_first: sourceNomination.model_initial,
      model_final: sourceNomination.model_final,
      escalated: sourceNomination.escalated,
      escalation_reason: sourceNomination.escalation_reason,
      mini_retry_used: sourceNomination.mini_retry_used,
      fallback_to_mini_used: sourceNomination.fallback_to_mini_used,
      mini_candidates_count_before_hardening:
        sourceNomination.mini_candidates_count_before_hardening,
      mini_candidates_count_after_hardening:
        sourceNomination.mini_candidates_count_after_hardening,
      finish_reason: sourceNomination.finish_reason,
      reasoning_tokens: sourceNomination.reasoning_tokens,
      parse_error: sourceNomination.parse_error,
      dropped_count: sourceNomination.dropped.length,
      dropped_reasons: sourceNomination.dropped.map((d) => d.reason),
      nomination_candidates_count: sourceNomination.candidates.length,
      identifier_bearing_count: sourceNomination.identifier_bearing_count,
      category_mix: sourceNomination.category_mix,
      // source_nomination_v2 bucket telemetry.
      actionable_count: sourceNomination.actionable_count,
      exploratory_count: sourceNomination.exploratory_count,
      actionability_mix: sourceNomination.actionability_mix,
      known_name_no_docket_count: sourceNomination.known_name_no_docket_count,
      topic_only_count: sourceNomination.topic_only_count,
      identifier_confidence_histogram: sourceNomination.identifier_confidence_histogram,
      stripped_identifiers: sourceNomination.stripped_identifiers,
      demoted_identifiers: sourceNomination.demoted_identifiers,
      source_nomination_queries_by_bucket: sourceNomination.queries_by_bucket,
      exploratory_queries_preserved: queryMerge.report.exploratory_queries_preserved,
      actionable_queries_preserved: queryMerge.report.actionable_queries_preserved,
      candidates: sourceNomination.candidates,
      dropped: sourceNomination.dropped,
      ms: sourceNomination.ms,

    },
    // query_merge_and_budget telemetry.
    query_merge: queryMerge.report,
    // five_mode_source_depth_policy_v1 telemetry.
    source_depth_policy: {
      version: SOURCE_DEPTH_VERSION,
      depth_mode: sourceDepth.depth_mode,
      reasons: sourceDepth.reasons,
      signals: sourceDepth.signals,
      source_mix: sourceDepth.source_mix,
      min_slots_by_source_type: sourceDepth.min_slots_by_source_type,
      planner_depth_audit: plannerStage.depth_audit,
      planner_queries_by_source_type:
        plannerStage.depth_audit?.planner_queries_by_source_type ?? {},
      nomination_targets_by_source_type: sourceNomination.category_mix ?? {},
      merge_kept_by_source_type: queryMerge.report.kept_by_source_type,
      merge_dropped_by_source_type: queryMerge.report.dropped_by_source_type,
      depth_slots_preserved: queryMerge.report.depth_slots_preserved,
      perplexity_policy: sourceDepth.perplexity_policy,
      perplexity_called: perplexityCalled,
      perplexity_reason: perplexityReason,
      control_run: !sourceDepth.enabled,
    },
    // official_source_discovery + verified_legal_sources cache telemetry.
    verified_source_cache: {
      version: officialDiscovery.cache_version,
      cache_hits: officialDiscovery.cache_hits,
      cache_misses: officialDiscovery.cache_misses,
      cache_cooldowns: officialDiscovery.cache_cooldowns,
      cache_writes: officialDiscovery.cache_writes,
    },
    official_source_discovery: officialDiscovery,
    // academic_candidate_admission_and_slotting_v1 telemetry.
    academic_scholarship_admission_gate: pplx.academic_scholarship_admission_gate ?? [],
    academic_role_slotting_decision: pplx.academic_role_slotting_decision ?? [],
    academic_pack_admission_summary: summarizeAcademicPackAdmission(
      pplx.academic_scholarship_admission_gate ?? [],
      pplx.academic_role_slotting_decision ?? [],
    ),
    academic_primary_anchor_acquisition_status: buildPrimaryAnchorAcquisitionReport(
      (officialDiscovery.attempts ?? []) as never,
      officialFetchTelemetry().attempts ?? [],
    ),
    // official_fetch_profile_v1 telemetry.
    official_fetch: officialFetchTelemetry(),
    court_egress: courtEgressTelemetry(),
    // canonical_body_acquisition_and_csm_survival_v1 — per-fetch relay stage diagnostics.
    court_relay_fetch_diagnostics: courtRelayDiagnostics(),
    // judgment_url_guess_suppression_v1 telemetry.
    judgment_url_eligibility: judgmentUrlTelemetry(),
    // router_profiles_v1 telemetry.
    router_profiles: {
      version: router.version,
      selected_router_profile: router.selected_router_profile,
      profile_reason: router.profile_reason,
      skipped_stages: router.skipped_stages,
      retrieval_query_count: allQueries.length,
      retrieval_queries_dropped: queryAdmission.report.dropped,
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
    // topic_aware_source_role_and_claim_alignment_v1 telemetry.
    topic_aware_alignment: drafter.topic_aware_alignment ?? null,
    limitation_note_alignment: drafter.limitation_note_alignment ?? null,
    // topic_aware_claim_source_alignment_v1 telemetry.
    claim_source_plan: drafter.claim_source_plan ?? null,
    drafter_block_source_compliance: drafter.drafter_block_source_compliance ?? null,
    post_draft_alignment_filter: drafter.post_draft_alignment_filter ?? null,
    // canonical_registry_discovery_and_representative_source_use_v1 telemetry.
    representative_source_selection: drafter.representative_source_selection ?? null,
    representative_source_use: drafter.representative_source_use ?? null,
    drafter_representative_source_compliance:
      drafter.drafter_representative_source_compliance ?? null,
    statute_dominance_check: drafter.statute_dominance_check ?? null,
    source_last_mile_funnel: drafter.source_last_mile_funnel ?? null,

    // academic_drafter_source_ref_coverage_v2 telemetry.
    academic_drafter_source_ref_emission: drafter.academic_drafter_source_ref_emission ?? null,
    pre_csm_source_ref_filtering: drafter.pre_csm_source_ref_filtering ?? null,

    claim_source_mismatch_count: drafter.claim_source_match?.source_ref_mismatch_count ?? 0,
    claim_source_mismatch_reasons: drafter.claim_source_match?.mismatch_reason ?? [],
    claim_source_unsupported_blocks: drafter.claim_source_match?.unsupported_block_count ?? 0,
    claim_source_limitation_added: drafter.claim_source_match?.limitation_added ?? false,
    primary_support_by_main_claim: drafter.claim_source_match?.primary_support_by_main_claim ?? false,
    commentary_only_claims: drafter.claim_source_match?.commentary_only_claims ?? [],
    // substance_based_doctrinal_sufficiency_v1 telemetry.
    doctrinal_typing: drafter.doctrinal_typing ?? null,
    claim_support_categories: drafter.claim_source_match?.claim_categories ?? [],
    authority_overstatements: drafter.claim_source_match?.authority_overstatements ?? [],
    limited_doctrinal_answer: drafter.sufficiency?.limited_doctrinal_answer ?? false,
    doctrinal_fallback_combination: drafter.sufficiency?.doctrinal_fallback_combination ?? null,
    // doctrinal_sufficiency_telemetry_persistence_v1 — one consolidated,
    // never-null trace so any run can be attributed to a stage + reason.
    doctrinal_sufficiency_trace: {
      ran: true,
      depth_mode: sourceDepth.depth_mode ?? null,
      deterministic_branch: drafter.deterministic_branch ?? null,
      sufficiency_ran: drafter.sufficiency ? true : false,
      sufficient: drafter.sufficiency?.sufficient ?? null,
      sufficiency_reason: drafter.sufficiency?.reason ?? null,
      limited_doctrinal_answer: drafter.sufficiency?.limited_doctrinal_answer ?? false,
      doctrinal_fallback_combination: drafter.sufficiency?.doctrinal_fallback_combination ?? null,
      doctrinal_fallback_declined_reason:
        drafter.sufficiency?.doctrinal_fallback_declined_reason ?? null,
      doctrinal_secondary_refs: drafter.sufficiency?.doctrinal_secondary_refs ?? [],
      doctrinal_eligible_count: drafter.sufficiency?.doctrinal_secondary_refs?.length ?? 0,
      doctrinal_ineligible_reasons: drafter.sufficiency?.doctrinal_ineligible_reasons ?? {},
      typing_ran: drafter.doctrinal_typing ? true : false,
      typing_remapped_count: drafter.doctrinal_typing?.remapped?.length ?? 0,
      // academic_source_type_whitelist_consistency_v1 — per-reason ineligibility
      // counts (not_doctrinal_type / no_acquired_body_text /
      // integrity_failed_or_metadata_only / verifier_not_direct_or_partial) so
      // a type-whitelist gap is visible without a manual join.
      typing_ineligible_reason_counts:
        drafter.doctrinal_typing?.ineligible_reason_counts ?? {},
      // doctrinal_secondary_body_acquisition_v1 — why doctrinal sources did or
      // did not arrive at the drafter with substantive text.
      secondary_body_stage_ran: secondaryBodyAcquisition.ran,
      secondary_body_stop_reason: secondaryBodyAcquisition.stage_stop_reason,
      secondary_bodies_acquired: secondaryBodyAcquisition.acquired_candidate_ids.length,
      secondary_local_hits: secondaryBodyAcquisition.local_hits,
      secondary_web_successes: secondaryBodyAcquisition.web_successes,
      secondary_bibliography_only:
        secondaryBodyAcquisition.bibliography_only_candidate_ids.length,
      // secondary_web_body_acquisition_v1 — open-web lane detail.
      secondary_web_attempts: secondaryBodyAcquisition.web_attempts,
      secondary_metadata_pages_detected: (secondaryBodyAcquisition.per_candidate ?? [])
        .filter((r) => r.metadata_page_detected).length,
      secondary_fulltext_links_followed: (secondaryBodyAcquisition.per_candidate ?? [])
        .filter((r) => r.fulltext_link_followed).length,
      secondary_type_remaps: (secondaryBodyAcquisition.per_candidate ?? [])
        .filter((r) => r.type_remap?.mapped).length,
      secondary_cache_writes: (secondaryBodyAcquisition.per_candidate ?? [])
        .filter((r) => r.cache_write === "ok").length,
      secondary_web_failure_reasons: (secondaryBodyAcquisition.per_candidate ?? [])
        .filter((r) => r.web_attempted && !r.ok)
        .map((r) => r.failure_reason ?? "unknown"),

      // ── academic_literature_gate_repair_and_thin_pack_recovery_v1 ───────
      academic_literature_gate_repair_version: LITERATURE_GATE_REPAIR_VERSION,
      academic_literature_mode: literatureModeRun,
      academic_literature_gate_trace: literatureModeRun
        ? buildLiteratureGateTrace({
          run_id,
          question,
          candidates: literatureCandidateViews.filter((v) =>
            literatureStrongDirectIds.has(v.candidate_id)
          ),
          admission: new Map(
            literatureCandidateViews.map((v) => [v.candidate_id, {
              admitted: !definitivelyRejectedIds.has(v.candidate_id),
              reason: definitivelyRejectedIds.has(v.candidate_id)
                ? "rejected_by_integrity_or_admission_gate"
                : "admitted_to_pool",
              initial_class: v.source_type ?? undefined,
            }])
          ),
          body: literatureBodyOutcome,
          verifier_usable_ids: new Set(verifier.usable.map((u) => u.candidate_id)),
          pack_ids: new Set(
            (drafter.input_sources ?? []).map((s) =>
              String((s as { candidate_id?: string }).candidate_id ?? s.ref)
            ),
          ),
          post_body_topicality: new Map(
            literatureBodyTopicality.map((r) => [r.source_id, r.post_body_topicality]),
          ),
        })
        : null,
      academic_literature_body_topicality: literatureBodyTopicality,
      academic_literature_thin_pack_recovery: thinPackRecoveryReport,
      academic_literature_named_synthesis: literatureModeRun
        ? checkNamedSynthesis(drafter.answer_markdown ?? "", {
          run_id,
          named_sources: (drafter.input_sources ?? []).map((s) => String(s.title ?? "")),
          footnote_count: drafter.footnotes?.length ?? 0,
          limitation_required: (drafter.footnotes?.length ?? 0) <= 2,
        })
        : null,


      claim_match_ran: drafter.claim_source_match
        ? drafter.claim_source_match.stage_not_run !== true
        : false,
      claim_match_not_run_reason: drafter.claim_source_match?.stage_not_run_reason ?? null,
      claim_category_count: drafter.claim_source_match?.claim_categories?.length ?? 0,
      authority_overstatement_count:
        drafter.claim_source_match?.authority_overstatements?.length ?? 0,
      input_source_count: drafter.input_sources?.length ?? 0,
      footnote_count: drafter.footnotes?.length ?? 0,
    },
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
  // router_profiles_v1 / statute_first — a statute-text answer is a complete
  // answer. It carries an explicit "no usable case law" notice instead of a
  // generic retrieval-interruption message, and never a partial-retrieval note.
  const statuteFirstPath = router.selected_router_profile === "statute_first";
  const statuteFirstNoCaseLaw = statuteFirstPath && drafter.ok &&
    !(drafter.footnotes ?? []).some((f) =>
      (f as { source_type?: string }).source_type === "case"
    );
  // academic_draft_presentation_hygiene_v1 — academic drafts carry exactly one
  // trailing "הערת עבודה" note; pipeline interruption notes are suppressed.
  const academicDraftAnswer = sourceUseIntent?.plan?.user_task_intent === "academic_writing";
  const suppressInterruptionNotes =
    (statuteFirstPath && statuteAcquisition.successes > 0) || academicDraftAnswer;

  const finalAnswer = drafter.ok
    ? `${drafter.answer_markdown}${
        partialRetrieval && !suppressInterruptionNotes ? PARTIAL_RETRIEVAL_NOTE : ""
      }${extractionCutShort && !suppressInterruptionNotes ? EXTRACTION_CUT_SHORT_NOTE : ""}${
        statuteFirstNoCaseLaw && !drafter.answer_markdown.includes(STATUTE_FIRST_LIMITATION)
          ? `\n\n> ${STATUTE_FIRST_LIMITATION}`
          : ""
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
      status: "timed_out",
      error: "pipeline_watchdog_timeout",
      current_stage: null,
      progress_label_he: null,
      completed_at: new Date().toISOString(),
      result: {
        answer: "",
        footnotes: [],
        used_sources: [],
        branch: "infrastructure_timeout",
        infrastructure_failure: true,
        timed_out: true,
        run_id,
      },
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
        await setJobStatus({ status: "done", result: payload, completed_at: new Date().toISOString() });
      } else {
        await refundCredits(`pipeline_status_${resp.status}`);
        const errMsg = (payload && typeof payload === "object")
          ? JSON.stringify(payload).slice(0, 4000)
          : `http_${resp.status}`;
        await setJobStatus({
          status: "error",
          error: errMsg,
          result: payload,
          completed_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[lrv1 bg]", msg);
      await refundCredits("pipeline_threw");
      if (settled) return;
      settled = true;
      await setJobStatus({ status: "error", error: msg, completed_at: new Date().toISOString() });
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
