// =========================================================================
// legal-research-v2 — agentic research core (vertical slice).
//
//   Question → Intake → Research Agent (search / lookup_authority / fetch)
//            → Research Memo → Verification (4 checks) → Verified Evidence
//            → Drafter → Deterministic Citation Renderer → Answer
//
// V1 remains deployed and untouched. This function is invoked explicitly
// (internal / smoke) and carries no production traffic.
// =========================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import {
  DEFAULT_BUDGETS,
  type Intake,
  type SourceFunnelRow,
  type ToolBudgets,
  type V2Telemetry,
} from "./types.ts";
import {
  detectDockets,
  detectStatuteSections,
  type SupabaseClient,
} from "./shared/primitives.ts";
import { modelConfig, newUsageLedger, type UsageLedger } from "./shared/model.ts";
import { EvidenceStore } from "./evidence/evidenceStore.ts";
import { buildAcademicYield } from "./evidence/academicYield.ts";
import {
  EMPTY_ATTACHMENT_TELEMETRY,
  preloadUserDocuments,
} from "./evidence/userDocumentSources.ts";
import {
  type AgentStateJson,
  deserializeAgentState,
  runResearchAgent,
  serializeAgentState,
} from "./agent/researchAgent.ts";
import { buildCoverageRepairMessage, buildRepairMessage } from "./agent/prompt.ts";
import { verifyMemo, type ExpectedIdentity } from "./verification/verify.ts";
import {
  applyTemporalGate,
  assessTemporalValidity,
  buildTemporalRepairMessage,
  newTemporalCounters,
  type TemporalAssessment,
} from "./verification/temporalValidity.ts";
import {
  annotateProvenance,
  assessPrimaryGap,
  buildDerivativeDisclosure,
  buildDerivativeFallbackMessage,
  shouldAttemptDerivativeFallback,
} from "./verification/primaryProvenance.ts";
import { createProgressSink, type ProgressSink, type ProgressStage } from "./beta/progress.ts";
import {
  type BetaJob,
  finishJobError,
  gatewayFailure,
  finishJobSuccess,
  ACADEMIC_CHAPTER_CREDIT_COST,
  academicWritingEnabled,
  RESEARCH_CREDIT_COST,
  SOURCE_SEARCH_CREDIT_COST,
  toBetaResult,
} from "./beta/job.ts";
import { resolveOwnedProjectId } from "./beta/projectOwnership.ts";
import {
  decideAutoResume,
  RESUME_WATCHDOG,
  type ResumeDecision,
  type WatchdogRow,
} from "./beta/resumePolicy.ts";
import { egressTelemetry, resetEgressStateForRun } from "./shared/egressTelemetry.ts";
import {
  acquireOperationLock,
  heartbeatOperationLock,
  lockUnavailablePayload,
  operationInProgressPayload,
  releaseOperationLock,
} from "../_shared/operationLock.ts";
import { runDrafter } from "./drafting/draft.ts";
import { projectVerifiedSynthesis } from "./drafting/synthesis.ts";
import { renderAnswer } from "./drafting/render.ts";
import { RunTimer, type RunTimingJson } from "./shared/timing.ts";
import { decideRepairAcceptance, decideResearchRepair } from "./verification/repairPolicy.ts";
import {
  buildVerificationForensics,
  type ForensicEvidenceRow,
} from "./verification/forensics.ts";


// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-smoke-mode, x-smoke-token",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}


import {
  type AcademicProjectContext,
  buildProjectContextBlock,
  parseProjectContext,
} from "./academic/projectContext.ts";
import { ACADEMIC_BODY_GUIDE_VERSION, buildAcademicWritingGuide } from "./academic/writingGuide.ts";
import { isAcademicDeliverable } from "./drafting/draftingBrief.ts";

import { buildChapterMemory } from "./academic/chapterMemory.ts";
import { SOURCE_SCOUTING_CONTRACT, SOURCE_SEARCH_BUDGETS } from "./sources/contract.ts";
import { buildSourcePack } from "./sources/sourcePack.ts";

export function buildIntake(input: {
  run_id: string;
  question: string;
  attachment_text?: string | null;
  /** Owned user uploads to preload as evidence sources. */
  attachments?: Array<{ storage_path: string; file_name: string; mime_type: string; size?: number }>;
  attachment_owner_id?: string | null;
  budgets?: Partial<ToolBudgets>;
  /** Evaluation-only Research Agent override. */
  agent_model?: string | null;
  /** Academic Writing body chapter only — framing context, never evidence. */
  academic_context?: AcademicProjectContext | null;
  footnote_offset?: number;
  /** Evaluation-only deliverable-level research contract. */
  research_contract?: string | null;
  /** "sources" terminates in the Source Renderer instead of the drafter. */
  output_mode?: "answer" | "sources";
}): Intake {
  const question = (input.question ?? "").trim();
  const dockets = detectDockets(question).map((d) => ({
    docket_id: d.docket_id,
    display: `${d.prefix_he} ${d.number}`,
    variants: d.variants,
  }));
  const statutes = detectStatuteSections(question).map((s) => ({
    statute: s.statute_title_he,
    section: s.section || null,
    variants: [s.section_display].filter(Boolean),
  }));
  return {
    run_id: input.run_id,
    question,
    normalized_question: question.replace(/\s+/g, " ").trim(),
    docket_obligations: dockets,
    statute_obligations: statutes,
    attachment_text: input.attachment_text?.trim() || null,
    attachments: (input.attachments ?? []).slice(0, 5),
    attachment_owner_id: input.attachment_owner_id ?? null,
    // Research depth is the Research Agent's decision, including for academic
    // body chapters — no deterministic classification here.
    budgets: {
      ...(input.output_mode === "sources" ? SOURCE_SEARCH_BUDGETS : DEFAULT_BUDGETS),
      ...(input.budgets ?? {}),
    },
    agent_model: input.agent_model?.trim() || null,
    academic_context: input.academic_context ?? null,
    footnote_offset: Math.max(0, Math.floor(input.footnote_offset ?? 0)),
    research_contract: input.output_mode === "sources"
      ? (input.research_contract?.trim() || SOURCE_SCOUTING_CONTRACT)
      : (input.research_contract?.trim() || null),
    output_mode: input.output_mode === "sources" ? "sources" : "answer",
  };
}

/**
 * Chunked execution: a single worker only ever runs a bounded slice of the
 * research loop. When the slice ends without a memo, the agent state is
 * serialized and a fresh invocation resumes it — long literature-scale runs
 * therefore survive the lifetime of one edge worker.
 */
export const CHUNK = {
  MAX_STEPS: 8,
  MAX_MS: 90_000,
  MAX_CHUNKS: 8,
};

export interface ResumeState {
  agent_state: AgentStateJson;
  chunk_index: number;
  usage: UsageLedger;
  started_at: number;
  /** Timing ledger carried across chunks (measurement only). */
  timing?: RunTimingJson;
  /** When the previous chunk stopped — the next chunk measures the gap. */
  paused_at?: number;
}

async function runPipeline(
  admin: SupabaseClient,
  intake: Intake,
  opts: {
    resume?: ResumeState | null;
    chunked?: boolean;
    progress?: ProgressSink;
    /** Carried into the mid-chunk checkpoint so an unattended resume can still
     * finalize the user-facing job row. */
    job?: BetaJob | null;
  } = {},
): Promise<
  | ({ ok: true; paused?: false } & Record<string, unknown>)
  | { ok: true; paused: true; run_id: string; resume: ResumeState }
> {
  const resume = opts.resume ?? null;
  const started = resume?.started_at ?? Date.now();
  const usage = resume?.usage ?? newUsageLedger();
  const models = modelConfig();
  // Evaluation-only: the Research Agent model may be overridden per run.
  // Verifier and drafter are always the configured defaults.
  const agentModel = intake.agent_model || models.agent;
  const prior = resume ? deserializeAgentState(intake, resume.agent_state) : null;
  const store = prior?.store ?? new EvidenceStore();
  const chunk_index = (resume?.chunk_index ?? 0) + 1;
  const timer = RunTimer.fromJSON(resume?.timing);
  // Time spent between a paused chunk and the worker that picks it up is
  // orchestration cost, not research cost — measure it explicitly.
  if (resume?.paused_at) timer.add("resume_gap", Date.now() - resume.paused_at);
  const heartbeat = () => opts.progress?.heartbeat();

  // ── User-uploaded documents become evidence sources BEFORE research ─────
  // Only on the first chunk: a resumed run restores them from the serialized
  // EvidenceStore, so a preloaded attachment survives worker handover.
  let attachments = EMPTY_ATTACHMENT_TELEMETRY;
  if (!resume && (intake.attachments?.length ?? 0) > 0) {
    try {
      attachments = await preloadUserDocuments(admin, intake, store);
    } catch (e) {
      attachments = {
        ...EMPTY_ATTACHMENT_TELEMETRY,
        attachment_count: intake.attachments?.length ?? 0,
        attachment_extract_errors: [{
          file_name: "*",
          message: e instanceof Error ? e.message : String(e),
        }],
      };
    }
  } else if (resume) {
    attachments = {
      ...EMPTY_ATTACHMENT_TELEMETRY,
      attachment_count: intake.attachments?.length ?? 0,
      attachment_sources_preloaded: store.all()
        .filter((s) => s.origin === "user_document")
        .map((s) => s.source_id),
    };
    attachments.attachment_documents_loaded = attachments.attachment_sources_preloaded.length;
  }

  // Egress ledgers are module globals in a reused isolate: a cap or a stop
  // reason from an earlier run must never suppress acquisition in this one.
  // Caps, backoff and the relay host allowlist are untouched.
  if (!resume) resetEgressStateForRun();

  // ── Research (one bounded chunk when chunked execution is requested) ─────
  let agent = await runResearchAgent({
    admin,
    intake,
    store,
    model: agentModel,
    usage,
    priorMessages: prior?.messages,
    policy: prior?.policy,
    discovered: prior?.discovered,
    commit: prior?.commit,
    ledger: prior?.ledger,
    trace: prior?.trace,
    stats: prior?.stats,
    timer,
    chunkIndex: chunk_index,
    heartbeat,
    onActivity: (kind) => { void opts.progress?.advance(kind); },
    maxStepsThisChunk: opts.chunked ? CHUNK.MAX_STEPS : undefined,
    deadlineAt: opts.chunked ? Date.now() + CHUNK.MAX_MS : undefined,
    checkpoint: opts.chunked
      ? async (state) => {
        await admin.from("v2_eval_runs").update({
          agent_state: {
            resume: {
              agent_state: state,
              chunk_index: chunk_index - 1,
              usage,
              started_at: started,
              timing: timer.toJSON(),
              paused_at: Date.now(),
            },
            intake,
            // Without these a mid-chunk recovery would lose the user's job.
            job: opts.job ?? null,
            stage: opts.progress?.current() ?? null,
          },
          chunk_index,
          last_beat_at: new Date().toISOString(),
        }).eq("run_id", intake.run_id);
      }
      : undefined,
  });

  if (agent.paused && !agent.memo && chunk_index < CHUNK.MAX_CHUNKS) {
    return {
      ok: true,
      paused: true,
      run_id: intake.run_id,
      resume: {
        agent_state: serializeAgentState({ result: agent, store }),
        chunk_index,
        usage,
        started_at: started,
        timing: timer.toJSON(),
        paused_at: Date.now(),
      },
    };
  }

  await opts.progress?.advance("verifying");

  const expected: ExpectedIdentity = {
    dockets: intake.docket_obligations.map((d) => d.display),
    statutes: intake.statute_obligations.map((s) => ({ statute: s.statute, section: s.section })),
  };

  let repair_cycles = 0;
  let verification = agent.memo
    ? await timer.time("verification_model", () =>
      verifyMemo({
        memo: agent.memo!,
        store,
        expected,
        model: models.verifier,
        usage,
      }))
    : null;
  await heartbeat();

  // ── One bounded repair cycle, driven by verification rejections ─────────
  // Verification strictness is unchanged. The only new judgement is whether
  // reopening research could plausibly fix the rejection at all: a missing or
  // unreadable body can be fixed by more research; a span/support failure on a
  // body that WAS read cannot, and the memo is simply narrowed instead.
  const repairDecision = verification
    ? decideResearchRepair(verification, {
      question: intake.question,
      issue_summary: agent.memo?.issue_summary,
      // Answer mode only. Source mode keeps its existing repair semantics.
      assess_empty_core_sufficiency: intake.output_mode !== "sources",
    })
    : { repair: false, reason: "no_unsupported_core_claims" as const, coverage: undefined };
  const coverage = repairDecision.coverage;
  const repair_due_to_central_insufficiency =
    repairDecision.reason === "central_issue_not_covered_after_narrowing";
  let repair_acceptance_reason: string | null = null;
  // Evaluation-only forensics: the full per-claim verification chain of the
  // memo as first written, captured before any repair can replace it.
  const forensics_pre_repair = buildVerificationForensics(agent.memo, verification);
  let forensics_repaired: ForensicEvidenceRow[] = [];
  const repairCapacityExhausted = repairDecision.repair && agent.policy.allExhausted();
  const repair_skip_reason = repairDecision.repair
    ? (repairCapacityExhausted ? "research_capacity_exhausted" : null)
    : repairDecision.reason;
  const needsRepair = repairDecision.repair && !repairCapacityExhausted;

  if (agent.memo && verification && needsRepair) {
    repair_cycles = 1;
    const repaired = await runResearchAgent({
      admin,
      intake,
      store,
      model: agentModel,
      usage,
      timer,
      chunkIndex: chunk_index,
      heartbeat,
      priorMessages: agent.messages,
      extraUserMessage: repair_due_to_central_insufficiency
        ? buildCoverageRepairMessage({
          question: intake.question,
          issue_summary: agent.memo.issue_summary,
          verified: verification.pack.claims,
          unsupported: verification.pack.unsupported_claims,
        })
        : buildRepairMessage({
          unsupported: verification.pack.unsupported_claims,
          rejected: verification.rejected,
        }),
      policy: agent.policy,
      discovered: agent.discovered,
      // Repair continues the SAME run: acquisition memory, commit discipline and
      // cumulative counters must not restart. Trace stays fresh and is merged below.
      ledger: agent.ledger,
      commit: agent.commit,
      stats: agent.stats,
    });
    if (repaired.memo) {
      const reVerified = await timer.time("verification_model", () =>
        verifyMemo({
          memo: repaired.memo!,
          store,
          expected,
          model: models.verifier,
          usage,
        }));
      const acceptance = decideRepairAcceptance({
        triggerReason: repairDecision.reason,
        before: verification,
        after: reVerified,
        question: intake.question,
        // Judge the repair against the SAME central-issue frame that triggered
        // it. The repaired memo must not move the goalposts by redefining its
        // own issue_summary.
        issue_summary: agent.memo.issue_summary,
      });
      forensics_repaired = buildVerificationForensics(repaired.memo, reVerified);
      repair_acceptance_reason = acceptance.reason;
      if (acceptance.accept) {
        agent = { ...repaired, trace: [...agent.trace, ...repaired.trace] };
        verification = reVerified;
      }

    }
  }

  // ═════ SOURCE SEARCH — terminate in the Source Renderer ═════════════════
  // Same agent, same tools, same evidence store, same verification. The run
  // simply ends in a deterministic source pack: no drafter, no answer
  // citation synthesis, no temporal/derivative answer safeguards.
  if (intake.output_mode === "sources") {
    const source_pack = buildSourcePack({
      run_id: intake.run_id,
      question: intake.question,
      sources: store.all(),
      verification,
      memo: agent.memo ?? null,
      discovered: [...agent.discovered.values()],
    });
    const sourcesTelemetry = {
      run_id: intake.run_id,
      output_mode: "sources",
      agent_steps: agent.policy.steps,
      search_calls: agent.policy.search_calls,
      fetch_calls: agent.policy.fetch_calls,
      lookup_calls: agent.policy.lookup_calls,
      documents_fetched: store.all().length,
      successful_body_reads: store.readable().length,
      recommended_source_count: source_pack.recommended.length,
      lead_count: source_pack.leads.length,
      identity_verified_pairs: verification?.counters.identity_verified_pairs ?? 0,
      span_verified_pairs: verification?.counters.span_verified_pairs ?? 0,
      drafter_invoked: false,
      latency_ms: Date.now() - started,
      model_calls: usage.model_calls,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      chunks_executed: chunk_index,
    pipeline: "legal-research-v2",
    attachment_count: attachments.attachment_count,
    attachment_documents_loaded: attachments.attachment_documents_loaded,
    attachment_chars_loaded: attachments.attachment_chars_loaded,
    attachment_extract_errors: attachments.attachment_extract_errors,
    attachment_sources_preloaded: attachments.attachment_sources_preloaded,
    attachment_sources_cited: rendered.cited_source_ids.filter((id) =>
      store.get(id)?.origin === "user_document"
    ),
    attachment_authority_rejections: (verification?.rejected ?? []).filter((r) =>
      r.reason === "user_document_not_legal_authority"
    ).length,
    /** body_only_identity_v1 — why an uploaded document was / was not authority. */
    authority_promotions: verification?.authority_promotions ?? [],
      phase_ms: timer.totalsMs(),
    };
    return {
      ok: true,
      run_id: intake.run_id,
      output_mode: "sources",
      source_pack,
      answer_markdown: "",
      footnotes: [],
      invariant_errors: [],
      unresolved_questions: agent.memo?.unresolved_questions ?? [],
      agent_error: agent.error ?? null,
      drafter_error: null,
      agent_trace: agent.trace,
      telemetry: sourcesTelemetry,
    };
  }

  // ═════ SAFEGUARD A — current-law / temporal validity ════════════════════
  // A claim about what the law IS now needs a current authoritative check.
  // Old sources are never downgraded for being old; only current-state claims
  // are gated. Missing is better than wrong.
  const advisories: string[] = [];
  let temporalCounters = newTemporalCounters();
  let temporalAssessments: TemporalAssessment[] = [];
  if (verification && verification.pack.claims.length) {
    const t = await timer.time("temporal_model", () =>
      assessTemporalValidity({
        pack: verification!.pack,
        store,
        model: models.verifier,
        usage,
      }));
    temporalCounters = t.counters;
    temporalAssessments = t.assessments;
    await heartbeat();

    // One targeted temporal repair when a current-state claim is stale or unverifiable.
    const needsTemporalRepair = agent.memo &&
      t.assessments.some((a) => a.temporal_status !== "current_verified") &&
      !agent.policy.allExhausted();
    if (needsTemporalRepair) {
      temporalCounters.temporal_repairs = 1;
      const repaired = await runResearchAgent({
        admin,
        intake,
        store,
        model: agentModel,
        usage,
        timer,
        chunkIndex: chunk_index,
        heartbeat,
        priorMessages: agent.messages,
        extraUserMessage: buildTemporalRepairMessage(t.assessments),
        policy: agent.policy,
        discovered: agent.discovered,
        ledger: agent.ledger,
        commit: agent.commit,
        stats: agent.stats,
      });
      if (repaired.memo) {
        const reVerified = await timer.time("verification_model", () =>
          verifyMemo({
            memo: repaired.memo!,
            store,
            expected,
            model: models.verifier,
            usage,
          }));
        const reTemporal = await timer.time("temporal_model", () =>
          assessTemporalValidity({
            pack: reVerified.pack,
            store,
            model: models.verifier,
            usage,
          }));
        agent = { ...repaired, trace: [...agent.trace, ...repaired.trace] };
        verification = reVerified;
        temporalAssessments = reTemporal.assessments;
        temporalCounters = { ...reTemporal.counters, temporal_repairs: 1 };
      }
    }
  }
  if (verification && temporalAssessments.length) {
    const gated = applyTemporalGate(verification.pack, temporalAssessments);
    verification = { ...verification, pack: gated.pack };
    advisories.push(...gated.advisories);
  }

  // ═════ SAFEGUARD B — unreadable primary authority fallback ══════════════
  const obligations = intake.docket_obligations.map((d) => d.display);
  let gapReport = verification
    ? assessPrimaryGap(verification.pack, store, obligations)
    : { obligations, unreadable: obligations, derivative: [] };
  let derivative_fallback_attempted = false;
  if (
    verification && agent.memo && obligations.length &&
    shouldAttemptDerivativeFallback(gapReport) && !agent.policy.allExhausted()
  ) {
    derivative_fallback_attempted = true;
    const missing = gapReport.unreadable.filter((d) => !gapReport.derivative.includes(d));
    const fallback = await runResearchAgent({
      admin,
      intake,
      store,
      model: agentModel,
      usage,
      timer,
      chunkIndex: chunk_index,
      heartbeat,
      priorMessages: agent.messages,
      extraUserMessage: buildDerivativeFallbackMessage(missing),
      policy: agent.policy,
      discovered: agent.discovered,
      ledger: agent.ledger,
      commit: agent.commit,
      stats: agent.stats,
    });
    if (fallback.memo) {
      // Same body / identity / span / support checks — nothing is loosened.
      const reVerified = await timer.time("verification_model", () =>
        verifyMemo({
          memo: fallback.memo!,
          store,
          expected,
          model: models.verifier,
          usage,
        }));
      const reGap = assessPrimaryGap(reVerified.pack, store, obligations);
      if (reVerified.pack.claims.length >= verification.pack.claims.length) {
        agent = { ...fallback, trace: [...agent.trace, ...fallback.trace] };
        verification = reVerified;
        gapReport = reGap;
      }
    }
  }

  let derivative_disclosure_shown = false;
  if (verification) {
    verification = {
      ...verification,
      pack: annotateProvenance(verification.pack, store, obligations),
    };
    if (gapReport.derivative.length) {
      derivative_disclosure_shown = true;
      advisories.push(
        `${
          buildDerivativeDisclosure(gapReport.derivative)
        } פתח את התשובה במשפט גילוי זה, ואל תייחס ציטוט לפסק הדין המקורי.`,
      );
    }
  }

  await opts.progress?.advance("writing");

  // ── Draft + deterministic render ────────────────────────────────────────
  const pack = verification?.pack ?? { claims: [], unsupported_claims: [] };

  // High-level, source-level gap notices. Rejected propositions themselves are
  // NEVER handed to the drafter — they stay in telemetry.
  const unresolvedAuthorities = agent.ledger.all()
    .filter((r) => !r.acquired_source_id)
    .map((r) => r.authority_key);
  const unusableSources = store.all()
    .filter((s) => !(s.fetch_status === "ok" && s.is_actual_document))
    .map((s) => s.title || s.url || s.source_id);
  const gapNotices: string[] = [];
  if (unresolvedAuthorities.length) {
    gapNotices.push(
      `לא הושג נוסח קריא עבור: ${unresolvedAuthorities.slice(0, 4).join(", ")}.`,
    );
  }
  if (unusableSources.length) {
    gapNotices.push(
      `מקורות שנוסו ולא סיפקו טקסט שמיש: ${unusableSources.slice(0, 3).map((t) => String(t).slice(0, 70)).join("; ")}.`,
    );
  }
  // Verified synthesis projection — computed AFTER verification, accepted
  // repair, the temporal gate and provenance handling, against the final pack.
  // `agent.memo` is always the accepted memo (repairs replace `agent` wholesale),
  // so memo and synthesis can never come from different research states.
  const synthesisProjection = projectVerifiedSynthesis(agent.memo?.research_synthesis, pack);

  // Agent-owned description of the deliverable. Writing guidance only — it is
  // never evidence and can never add a claim.
  const draftingBrief = agent.memo?.drafting_brief ?? null;
  // The academic guide follows the deliverable, not only the Academic Writing
  // project: an academic chapter asked for in ordinary research gets it too.
  const academicRole = intake.academic_context?.chapter.role ?? "body";
  const academicGuide = intake.academic_context
    ? {
      guide: buildAcademicWritingGuide(academicRole),
      contextBlock: buildProjectContextBlock(intake.academic_context),
    }
    : isAcademicDeliverable(draftingBrief)
    ? {
      guide: buildAcademicWritingGuide(
        draftingBrief?.deliverable === "academic_introduction" ? "introduction" : "body",
      ),
    }
    : null;

  const draft = await timer.time("drafting_model", () =>
    runDrafter({
      question: intake.question,
      pack,
      synthesis: synthesisProjection.synthesis,
      model: models.drafter,
      usage,
      advisories,
      gapNotices,
      brief: draftingBrief,
      academic: academicGuide,
    }));

  const blocks = derivative_disclosure_shown
    ? [
      {
        type: "paragraph" as const,
        text: buildDerivativeDisclosure(gapReport.derivative),
        source_ids: [],
      },
      ...draft.blocks,
    ]
    : draft.blocks;
  const renderStarted = Date.now();
  const rendered = renderAnswer(blocks, pack, {
    footnote_offset: intake.footnote_offset ?? 0,
  });
  timer.add("rendering", Date.now() - renderStarted);


  // ── Telemetry ───────────────────────────────────────────────────────────
  const citedSet = new Set(rendered.cited_source_ids);
  // Per-stage funnel comes from verification itself, not from final-pack
  // membership: a source that passed identity but lost its span must not be
  // reported as an identity failure.
  const stages = verification?.per_source ?? {};
  const temporalOkSet = new Set<string>();
  for (const c of pack.claims) for (const s of c.sources) temporalOkSet.add(s.source_id);
  const source_funnel: SourceFunnelRow[] = store.all().map((s) => {
    const st = stages[s.source_id];
    return {
      source_id: s.source_id,
      title: s.title,
      url: s.url,
      discovered: true,
      fetched: s.fetch_status === "ok",
      readable: st?.readable ?? (s.fetch_status === "ok" && s.is_actual_document),
      identity_verified: st?.identity ?? false,
      identity_basis: st?.identity_basis ?? "not_submitted_as_evidence",
      span_verified: st?.span ?? false,
      support_verified: st?.support ?? false,
      temporal_ok: st?.support ? temporalOkSet.has(s.source_id) : undefined,
      terminal_stage: st?.terminal_stage,
      rejection_code: st?.rejection_code,
      cited: citedSet.has(s.source_id),
    };
  });



  // Academic evidence yield + bibliographic identity (diagnostic only).
  const academicYield = buildAcademicYield({
    sources: store.all(),
    quotes: store.servedQuotes(),
    memo: agent.memo,
    verification,
    pack,
    cited_source_ids: rendered.cited_source_ids,
  });

  const telemetry: V2Telemetry = {
    run_id: intake.run_id,
    agent_steps: agent.policy.steps,
    search_calls: agent.policy.search_calls,
    fetch_calls: agent.policy.fetch_calls,
    lookup_calls: agent.policy.lookup_calls,
    documents_fetched: store.all().length,
    successful_body_reads: store.readable().length,
    research_claim_count: agent.memo?.claims.length ?? 0,
    verified_claim_count: pack.claims.length,
    unsupported_claim_count: pack.unsupported_claims.length,
    total_evidence_pairs: verification?.counters.total_evidence_pairs ?? 0,
    identity_verified_pairs: verification?.counters.identity_verified_pairs ?? 0,
    span_verified_pairs: verification?.counters.span_verified_pairs ?? 0,
    support_verdicts: verification?.counters.support_verdicts ??
      { supports: 0, supports_partially: 0, does_not_support: 0 },
    cited_source_count: rendered.cited_source_ids.length,
    footnote_count: rendered.footnotes.length,
    repair_cycles,
    latency_ms: Date.now() - started,
    model_calls: usage.model_calls,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    estimated_cost_usd: null,
    prompt_tokens_per_call: usage.prompt_tokens_per_call,
    max_prompt_tokens_single_call: usage.max_prompt_tokens_single_call,
    largest_tool_response_chars: agent.stats.largest_tool_response_chars,
    evidence_context_chars_last_turn: agent.stats.evidence_context_chars_last_turn,
    repeated_tool_calls_prevented: agent.stats.repeated_tool_calls_prevented,
    commit_directives: agent.stats.commit_directives,
    chunks_executed: chunk_index,
    pipeline: "legal-research-v2",
    attachment_count: attachments.attachment_count,
    attachment_documents_loaded: attachments.attachment_documents_loaded,
    attachment_chars_loaded: attachments.attachment_chars_loaded,
    attachment_extract_errors: attachments.attachment_extract_errors,
    attachment_sources_preloaded: attachments.attachment_sources_preloaded,
    attachment_sources_cited: rendered.cited_source_ids.filter((id) =>
      store.get(id)?.origin === "user_document"
    ),
    attachment_authority_rejections: (verification?.rejected ?? []).filter((r) =>
      r.reason === "user_document_not_legal_authority"
    ).length,
    /** body_only_identity_v1 — why an uploaded document was / was not authority. */
    authority_promotions: verification?.authority_promotions ?? [],
    /** Latency efficiency (legal_research_v2_latency_efficiency_v1). */
    phase_ms: timer.totalsMs(),
    agent_turns: timer.toJSON().turns,
    already_read_actions: agent.stats.already_read_actions,
    noop_already_read_suppressed: agent.stats.noop_already_read_suppressed,
    targeted_rereads: agent.stats.targeted_rereads,
    targeted_rereads_new_quote: agent.stats.targeted_rereads_new_quote,
    targeted_rereads_no_new_quote: agent.stats.targeted_rereads_no_new_quote,
    span_hunting_exhaustions: agent.stats.span_hunting_exhaustions,
    span_hunting_reads_suppressed: agent.stats.span_hunting_reads_suppressed,
    new_quotes_served: agent.stats.new_quotes_served,
    duplicate_quotes_resurfaced: agent.stats.duplicate_quotes_resurfaced,
    authority_reacquisitions_prevented: agent.stats.authority_reacquisitions_prevented,
    authority_bindings_created: agent.stats.authority_bindings_created,
    authority_bindings_withheld: agent.stats.authority_bindings_withheld,
    context_compactions: agent.stats.context_compactions,
    context_chars_saved: agent.stats.context_chars_saved,
    section_reads_yielded: agent.ledger.allReads().reduce((n, r) => n + r.yielded, 0),
    section_reads_missing: agent.ledger.allReads().reduce((n, r) => n + r.missing_locators.length, 0),
    sources_marked_exhausted: agent.ledger.allReads().filter((r) => r.exhausted).length,
    unresolved_authorities: unresolvedAuthorities,
    repair_skip_reason,
    repair_acceptance_reason,
    sufficiency_assessed: !!coverage?.assessed,
    surviving_core_claims: coverage?.surviving_core_claim_ids ?? [],
    unsupported_core_claims: coverage?.unsupported_core_claim_ids ?? [],
    // An answer-mode run that ends with zero verified claims has covered
    // nothing, whether or not a coverage assessment object exists.
    central_issue_covered: pack.claims.length === 0
      ? false
      : (coverage ? coverage.central_issue_covered : true),
    central_coverage_ratio: pack.claims.length === 0 ? 0 : coverage?.coverage_ratio,
    central_coverage_gap_terms: coverage?.lost_central_terms ?? [],
    repair_due_to_central_insufficiency,
    /** Evaluation-only forensic verification chain (never user-facing). */
    verification_forensics: forensics_pre_repair,
    verification_forensics_repaired: forensics_repaired,
    /** Research → drafter synthesis handoff (evaluation only, never a quota). */
    memo_synthesis_sections: agent.memo?.research_synthesis?.sections.length ?? 0,
    memo_synthesis_relationships: agent.memo?.research_synthesis?.relationships.length ?? 0,
    memo_synthesis_source_roles: agent.memo?.research_synthesis?.source_roles.length ?? 0,
    verified_synthesis_sections: synthesisProjection.synthesis?.sections.length ?? 0,
    verified_synthesis_relationships: synthesisProjection.synthesis?.relationships.length ?? 0,
    synthesis_claim_refs_dropped: synthesisProjection.claim_refs_dropped,
    synthesis_source_refs_dropped: synthesisProjection.source_refs_dropped,
    verified_sources_available_to_drafter: new Set(
      pack.claims.flatMap((c) => c.sources.map((s) => s.source_id)),
    ).size,
    verified_sources_cited: rendered.cited_source_ids.length,
    ...temporalCounters,
    primary_authority_obligations: gapReport.obligations,
    primary_unreadable: gapReport.unreadable,
    derivative_fallback_attempted,
    derivative_supported_authorities: gapReport.derivative,
    derivative_disclosure_shown,
    acquisition_ledger: agent.ledger.all(),
    source_funnel,
    ...academicYield.counters,
    academic_yield_ratios: academicYield.ratios,
    academic_source_yield: academicYield.rows,
    bibliographic_sources_with_authors: store.all().filter((s) =>
      (s.bibliographic?.authors?.length ?? 0) > 0
    ).length,
    bibliographic_citations_rendered: rendered.footnotes.filter((f) =>
      f.sources.some((x) =>
        academicYield.rows.some((r) => r.source_id === x.source_id && r.has_bibliographic)
      )
    ).length,
    /** Acquisition transport (v2_local_corpus_body_acquisition_v1). */
    local_corpus_acquisitions: agent.stats.local_corpus_acquisitions,
    local_corpus_bindings: agent.stats.local_corpus_bindings,
    /** Broad web search (v2_raw_web_search_v1). */
    raw_web_search_calls: agent.stats.raw_web_search_calls,
    raw_web_search_results: agent.stats.raw_web_search_results,
    raw_web_search_unique_domains: agent.stats.raw_web_search_domains.length,
    raw_web_search_deduped_queries: agent.stats.raw_web_search_deduped_queries,
    raw_web_results_fetched: agent.stats.raw_web_results_fetched,
    raw_web_identity_rejects: agent.stats.raw_web_identity_rejects,
    authority_targets_opened: agent.stats.authority_targets_opened,
    authority_candidates_attached: agent.stats.authority_candidates_attached,
    authority_concrete_attempts: agent.stats.authority_concrete_attempts,
    authority_discovery_refreshes: agent.stats.authority_discovery_refreshes,
    authority_targets_acquired: agent.stats.authority_targets_acquired,
    authority_targets_exhausted: agent.stats.authority_targets_exhausted,
    authority_candidates_skipped_attempted: agent.stats.authority_candidates_skipped_attempted,
    authority_candidates_skipped_discovery_entry: agent.stats.authority_candidates_skipped_discovery_entry,
    authority_parent_statute_reuse: agent.stats.authority_parent_statute_reuse,
    authority_section_from_parent: agent.stats.authority_section_from_parent,
    authority_identity_conflicts: agent.stats.authority_identity_conflicts,
    authority_memo_gate_used: agent.stats.authority_memo_gate_used,
    /** Exact-authority recovery (v2_exact_authority_recovery_v1). */
    authority_recovery_triggered: agent.stats.authority_recovery_triggered,
    /** Same-work live recovery (same_work_live_recovery_v1). Diagnostic only. */
    same_work_recovery_triggered: agent.stats.same_work_recovery_triggered,
    same_work_recovery_query_count: agent.stats.same_work_recovery_query_count,
    same_work_candidates_seen: agent.stats.same_work_candidates_seen,
    same_work_candidates_rejected_identity: agent.stats.same_work_candidates_rejected_identity,
    same_work_candidates_rejected_host: agent.stats.same_work_candidates_rejected_host,
    same_work_recovery_success: agent.stats.same_work_recovery_success,
    same_work_recovery_failed: agent.stats.same_work_recovery_failed,
    same_work_recovery_failed_reasons: agent.stats.same_work_recovery_failed_reasons,
    same_work_recovery_skipped_no_identity: agent.stats.same_work_recovery_skipped_no_identity,
    same_work_recovery_basis: agent.stats.same_work_recovery_basis,
    same_work_recovered_host: agent.stats.same_work_recovered_host,
    /** Same-work identity enrichment (same_work_identity_enrichment_v1). */
    same_work_enrichment_triggered: agent.stats.same_work_enrichment_triggered,
    same_work_enrichment_landing_meta: agent.stats.same_work_enrichment_landing_meta,
    same_work_enrichment_doi_lookup: agent.stats.same_work_enrichment_doi_lookup,
    same_work_enrichment_crossref: agent.stats.same_work_enrichment_crossref,
    same_work_enrichment_openalex: agent.stats.same_work_enrichment_openalex,
    same_work_enrichment_search_metadata: agent.stats.same_work_enrichment_search_metadata,
    same_work_enrichment_success: agent.stats.same_work_enrichment_success,
    same_work_enrichment_still_insufficient: agent.stats.same_work_enrichment_still_insufficient,
    same_work_enrichment_conflict: agent.stats.same_work_enrichment_conflict,
    same_work_recovered_after_enrichment: agent.stats.same_work_recovered_after_enrichment,
    same_work_equivalence_basis: agent.stats.same_work_equivalence_basis,
    same_work_enrichment_basis: agent.stats.same_work_enrichment_basis,
    /** Same-work trust boundary (same_work_trust_boundary_v1). */
    same_work_original_identity_trusted_fields:
      agent.stats.same_work_original_identity_trusted_fields,
    same_work_search_hint_fields: agent.stats.same_work_search_hint_fields,
    same_work_agent_hint_used_for_query: agent.stats.same_work_agent_hint_used_for_query,
    same_work_agent_hint_used_for_equivalence:
      agent.stats.same_work_agent_hint_used_for_equivalence,
    authority_recovery_candidates_attached: agent.stats.authority_recovery_candidates_attached,
    authority_recovery_success: agent.stats.authority_recovery_success,
    authority_recovery: agent.stats.authority_recovery_records,
    unsafe_urls_blocked: agent.stats.unsafe_urls_blocked,
    /** Pre-memo coverage reflection (agent_owned_coverage_check_v1). Diagnostic only. */
    memo_coverage_check_triggered: agent.stats.memo_coverage_check_triggered,
    memo_coverage_unused_read_sources: agent.stats.memo_coverage_unused_read_sources,
    memo_coverage_used_existing_read_source: agent.stats.memo_coverage_used_existing_read_source,
    memo_coverage_continued_research: agent.stats.memo_coverage_continued_research,
    memo_coverage_claims_added: agent.stats.memo_coverage_claims_added,
    memo_coverage_gap_left_explicit: agent.stats.memo_coverage_gap_left_explicit,
    memo_coverage_reverted_to_pre_check: agent.stats.memo_coverage_reverted_to_pre_check,
    /** Durable quote references (durable_quote_references_v1). Diagnostic only. */
    quotes_available_at_memo: agent.stats.quotes_available_at_memo,
    quote_ids_referenced_in_memo: agent.stats.quote_ids_referenced_in_memo,
    memo_evidence_resolved_from_quote_id: agent.stats.memo_evidence_resolved_from_quote_id,
    invalid_quote_id: agent.stats.invalid_quote_id,
    quote_source_mismatch: agent.stats.quote_source_mismatch,
    memo_evidence_dropped_unresolvable: agent.stats.memo_evidence_dropped_unresolvable,
    sources_with_quotes_not_memoed: agent.stats.sources_with_quotes_not_memoed,
    /** Source utilization funnel (read → memo → pack). Diagnostic only. */
    readable_unique_sources: readableIds.size,
    memo_unique_sources: memoSourceIds.size,
    verified_pack_unique_sources: packSourceIds.size,
    readable_to_memo_ratio: readableIds.size ? memoSourceIds.size / readableIds.size : 0,
    memo_to_pack_ratio: memoSourceIds.size ? packSourceIds.size / memoSourceIds.size : 0,
    terminal_loss_stage: terminalLossStage,
    /** Agent-owned drafting brief (agent_owned_drafting_brief_v1). Diagnostic only. */
    drafting_brief_present: !!draftingBrief,
    drafting_brief_deliverable: draftingBrief?.deliverable ?? null,
    drafting_brief_depth: draftingBrief?.depth ?? null,
    drafting_brief_target_words_min: draftingBrief?.target_words?.min ?? null,
    drafting_brief_target_words_max: draftingBrief?.target_words?.max ?? null,
    drafting_brief_goals_count: draftingBrief?.goals?.length ?? 0,
    drafting_brief_structure_items: draftingBrief?.structure?.length ?? 0,
    /** Draft result. Diagnostic only — length is a soft target, never a gate. */
    draft_word_count: draftWordCount,
    draft_blocks: draft.blocks.length,
    drafter_finish_reason: draft.finish_reason ?? null,
    target_range_met: targetRangeMet,
    target_range_shortfall_reason: targetShortfallReason,
    /** Per-run egress state (v2_per_run_egress_reset_v1). */
    egress: { ...egressTelemetry() },

  };

  return {
    ok: true,
    run_id: intake.run_id,
    answer_markdown: rendered.answer_markdown,
    footnotes: rendered.footnotes,
    invariant_errors: rendered.invariant_errors,
    unresolved_questions: agent.memo?.unresolved_questions ?? [],
    issue_summary: agent.memo?.issue_summary ?? "",
    verified_evidence: pack,
    rejected_evidence: verification?.rejected ?? [],
    agent_error: agent.error ?? null,
    drafter_error: draft.error ?? null,
    agent_trace: agent.trace,
    telemetry,
    ...(intake.academic_context
      ? {
        academic: {
          guide_version: ACADEMIC_BODY_GUIDE_VERSION,
          chapter_index: intake.academic_context.chapter.index,
          chapter_title: intake.academic_context.chapter.title,
          footnote_offset: intake.footnote_offset ?? 0,
          chapter_memory: buildChapterMemory({
            chapterTitle: intake.academic_context.chapter.title,
            pack,
            footnotes: rendered.footnotes,
            citedSourceIds: rendered.cited_source_ids,
          }),
        },
      }
      : {}),
  };
}

/** Kick a fresh worker to continue a paused run. */
async function selfInvokeResume(run_id: string, supabaseUrl: string, serviceKey: string) {
  await fetch(`${supabaseUrl}/functions/v1/legal-research-v2`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      "x-smoke-mode": "1",
    },
    body: JSON.stringify({ resume_run_id: run_id }),
  });
}

/**
 * Run-row liveness. The watchdog only touches a run that has stopped beating,
 * so an actively working worker can never be resumed underneath itself.
 * Throttled, best-effort, and never allowed to fail a run.
 */
function createRunBeat(admin: SupabaseClient, run_id: string) {
  let last = 0;
  return async (force = false) => {
    if (!force && Date.now() - last < RESUME_WATCHDOG.BEAT_MIN_INTERVAL_MS) return;
    last = Date.now();
    try {
      await admin.from("v2_eval_runs")
        .update({ last_beat_at: new Date().toISOString() })
        .eq("run_id", run_id);
    } catch {/* liveness is best-effort */}
  };
}

/**
 * Run one chunk of a persisted run and either finish it or hand it to a new
 * worker. The chunk budget and MAX_CHUNKS bound the total work; the next hop
 * fires only when research actually remains.
 */
async function driveRun(
  admin: SupabaseClient,
  intake: Intake,
  resume: ResumeState | null,
  supabaseUrl: string,
  serviceKey: string,
  job: BetaJob | null = null,
  initialStage: ProgressStage | null = null,
): Promise<void> {
  const outputMode = intake.output_mode === "sources" ? "sources" : "answer";
  // Progress is persisted on the beta job row; internal runs get a no-op sink.
  const progress = createProgressSink(
    job ? (admin as unknown as Parameters<typeof createProgressSink>[0]) : null,
    job?.id ?? null,
    initialStage,
    outputMode,
    job?.operation_id
      ? {
        userId: job.user_id,
        operationId: job.operation_id,
        beat: () => heartbeatOperationLock(admin, job.user_id, job.operation_id!),
      }
      : null,
  );
  // Every progress beat also proves to the watchdog that this worker is alive.
  const beat = createRunBeat(admin, intake.run_id);
  const liveProgress: ProgressSink = {
    current: () => progress.current(),
    advance: async (s) => {
      await progress.advance(s);
      await beat();
    },
    heartbeat: async () => {
      await progress.heartbeat();
      await beat();
    },
    finish: () => progress.finish(),
  };
  await beat(true);
  try {
    const out = await runPipeline(admin, intake, {
      resume,
      chunked: true,
      progress: liveProgress,
      job,
    });
    if ("paused" in out && out.paused) {
      await admin.from("v2_eval_runs").update({
        status: "paused",
        agent_state: { resume: out.resume, intake, job, stage: progress.current() },
        last_beat_at: new Date().toISOString(),
      }).eq("run_id", intake.run_id);
      await selfInvokeResume(intake.run_id, supabaseUrl, serviceKey);
      return;
    }
    // The user-facing job row is finalized FIRST: an edge worker can be shut
    // down at any moment, and the answer must never be the thing that is lost.
    if (job) {
      const blocked = gatewayFailure(out as Record<string, unknown>);
      if (blocked) await finishJobError(admin, job, blocked);
      else await finishJobSuccess(admin, job, toBetaResult(out as Record<string, unknown>));
      await progress.finish();
    }
    await admin.from("v2_eval_runs").update({
      status: "done",
      result: out,
      agent_state: null,
      finished_at: new Date().toISOString(),
    }).eq("run_id", intake.run_id);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (job) await finishJobError(admin, job, message);
    await admin.from("v2_eval_runs").update({
      status: "error",
      error: message,
      finished_at: new Date().toISOString(),
    }).eq("run_id", intake.run_id);
  }
}

/**
 * One watchdog sweep: find abandoned checkpoints and hand each to exactly one
 * fresh worker. Bounded by RESUME_WATCHDOG; every decision is reported.
 *
 * The claim is optimistic and atomic — `auto_resume_count` is advanced with the
 * previously observed value in the WHERE clause, so two concurrent sweepers can
 * never both own the same run.
 */
async function sweepStalledRuns(
  admin: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
): Promise<{ examined: number; decisions: ResumeDecision[] }> {
  const now = Date.now();
  const staleBefore = new Date(now - RESUME_WATCHDOG.STALE_MS).toISOString();
  const { data } = await admin
    .from("v2_eval_runs")
    .select("run_id, status, agent_state, last_beat_at, created_at, auto_resume_count, watchdog_claimed_at")
    .in("status", ["running", "paused"])
    .or(`last_beat_at.is.null,last_beat_at.lt.${staleBefore}`)
    // Long-abandoned historical rows must never crowd the batch: they are not
    // revivable, and a live run waiting for recovery always comes first.
    .gt("created_at", new Date(now - RESUME_WATCHDOG.MAX_RUN_AGE_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(RESUME_WATCHDOG.BATCH);

  const rows = (data ?? []) as WatchdogRow[];
  const decisions: ResumeDecision[] = [];

  for (const row of rows) {
    const decision = decideAutoResume(row, now);
    if (!decision.automatic_resume_triggered) {
      decisions.push(decision);
      continue;
    }
    const prior = row.auto_resume_count ?? 0;
    const { data: claimed } = await admin
      .from("v2_eval_runs")
      .update({
        auto_resume_count: prior + 1,
        watchdog_claimed_at: new Date().toISOString(),
        auto_resume_reason: decision.automatic_resume_reason,
      })
      .eq("run_id", row.run_id)
      .eq("auto_resume_count", prior)
      .in("status", ["running", "paused"])
      .select("run_id");
    if (!claimed?.length) {
      decisions.push({
        ...decision,
        automatic_resume_triggered: false,
        automatic_resume_reason: "claimed_by_other",
        duplicate_resume_prevented: true,
      });
      continue;
    }
    // Same entry point a manual resume uses: the persisted checkpoint is
    // replayed as-is, so usage, evidence and idempotency are untouched.
    let ok = false;
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/legal-research-v2`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          "x-smoke-mode": "1",
        },
        body: JSON.stringify({ resume_run_id: row.run_id }),
      });
      ok = res.ok;
    } catch {/* reported as a failed resume; the next sweep retries */}
    decisions.push({
      ...decision,
      automatic_resume_count: prior + 1,
      ...(ok ? {} : { automatic_resume_triggered: true }),
    });
    console.log(JSON.stringify({ watchdog: "auto_resume", run_id: row.run_id, ok, ...decision }));
  }
  return { examined: rows.length, decisions };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const resumeRunId = typeof body.resume_run_id === "string" ? body.resume_run_id : null;
  const watchdogTick = body.action === "resume_watchdog";
  const question = String(body.question ?? "").trim();
  if (!question && !resumeRunId && !watchdogTick) return json({ error: "question_required" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return json({ error: "backend_not_configured" }, 500);

  // Internal / smoke invocation only — V2 carries no production traffic yet.
  const authHeader = req.headers.get("Authorization") ?? "";
  const smokeTokens = [
    Deno.env.get("V2_EVAL_TOKEN_E"),
    Deno.env.get("V2_EVAL_TOKEN_D"),
    Deno.env.get("V2_EVAL_TOKEN_C"),
    Deno.env.get("V2_EVAL_TOKEN"),
    Deno.env.get("V2_SMOKE_TOKEN_B"),
    Deno.env.get("V2_SMOKE_TOKEN"),
  ].filter((t): t is string => !!t);
  const presented = req.headers.get("x-smoke-token") ?? "";

  const isSmoke = req.headers.get("x-smoke-mode") === "1" &&
    (authHeader === `Bearer ${serviceKey}` ||
      (!!presented && smokeTokens.includes(presented)));

  const admin = createClient(supabaseUrl, serviceKey) as unknown as SupabaseClient;

  // ── Unattended checkpoint recovery sweep (scheduler / service-role only) ─
  if (watchdogTick) {
    // The scheduler authenticates with a single-use, short-lived nonce that
    // only the database can mint; no credential travels with the request.
    let schedulerOk = false;
    const nonce = typeof body.watchdog_nonce === "string" ? body.watchdog_nonce : null;
    if (nonce) {
      const { data: claimedTick } = await admin
        .from("v2_watchdog_ticks")
        .update({ used_at: new Date().toISOString() })
        .eq("nonce", nonce)
        .is("used_at", null)
        .gt("created_at", new Date(Date.now() - 120_000).toISOString())
        .select("nonce");
      schedulerOk = !!claimedTick?.length;
    }
    if (!schedulerOk && !isSmoke) return json({ error: "unauthorized" }, 401);
    const swept = await sweepStalledRuns(admin, supabaseUrl, serviceKey);
    return json({ ok: true, watchdog: true, ...swept }, 200);
  }


  // ══ Beta production entry ═══════════════════════════════════════════════
  // An authenticated beta user request. Routing/config only: the same job
  // table, the same 5-credit charge, the same refund rules as before — the
  // research itself is the unchanged V2 pipeline below.
  if (!isSmoke) {
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    }) as unknown as SupabaseClient;
    // deno-lint-ignore no-explicit-any
    const { data: userData } = await (userClient as any).auth.getUser();
    const user = userData?.user as { id: string } | undefined;
    if (!user) return json({ error: "unauthorized" }, 401);
    if (question.length < 5) return json({ error: "question_required" }, 400);

    // Academic Writing body chapter: same job table, same refund rules, same
    // unchanged research pipeline — only the intake carries paper framing.
    const academicContext = body.mode === "academic_chapter"
      ? parseProjectContext(body.project_context)
      : null;
    if (body.mode === "academic_chapter" && !academicContext) {
      return json({ error: "invalid_project_context" }, 400);
    }
    // Product availability freeze — Academic Writing is not part of the public
    // beta. Rejected before any credit charge or job row; V2 Legal Research is
    // untouched. Internal/eval runs use the smoke path above.
    if (body.mode === "academic_chapter" && !academicWritingEnabled()) {
      return json({
        error: "academic_writing_unavailable",
        message: "כתיבה אקדמית עדיין בפיתוח ותיפתח בהמשך.",
      }, 503);
    }
    // Source search: same V2 agent + evidence + verification, terminating in
    // the Source Renderer. Priced below full research (no drafter phase).
    const sourceSearch = body.mode === "source_search";
    const creditCost = academicContext
      ? ACADEMIC_CHAPTER_CREDIT_COST
      : sourceSearch
      ? SOURCE_SEARCH_CREDIT_COST
      : RESEARCH_CREDIT_COST;
    const footnoteOffset = Number.isFinite(body.footnote_offset)
      ? Math.max(0, Math.floor(Number(body.footnote_offset)))
      : 0;

    // Client-supplied project association is authorized under the caller's own
    // RLS before it is stored; an unowned/unknown id is silently dropped.
    const projectId = await resolveOwnedProjectId(userClient, body.project_id);
    const clientRequestId = typeof body.client_request_id === "string" && body.client_request_id
      ? body.client_request_id
      : crypto.randomUUID();

    // Idempotency: a retried submit reattaches to the same job, never charges twice.
    const { data: existing } = await admin
      .from("legal_research_jobs")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("client_request_id", clientRequestId)
      .maybeSingle();
    if (existing?.id) {
      return json({ ok: true, job_id: existing.id, status: existing.status, reused: true }, 202);
    }

    // ── Account-level concurrency protection ────────────────────────────
    // Acquired BEFORE any credit charge: a refused second attempt costs the
    // user nothing and never reaches a model provider. Answer mode and source
    // search share one lock — both are protected research operations.
    const operationType = academicContext
      ? "academic_chapter"
      : sourceSearch
      ? "source_search"
      : "research_answer";
    const lock = await acquireOperationLock(
      userClient as unknown as { rpc(fn: string, params?: Record<string, unknown>): unknown },
      operationType,
      clientRequestId,
      projectId,
    );
    if (!lock.ok) {
      return lock.error === "lock_unavailable"
        ? json(lockUnavailablePayload(), 503)
        : json(operationInProgressPayload(lock.active_operation_type), 409);
    }
    const lockOperationId = lock.bypass ? null : clientRequestId;

    // deno-lint-ignore no-explicit-any
    const { data: consumeData, error: consumeErr } = await (userClient as any).rpc(
      "consume_credits",
      {
        _amount: creditCost,
        _reason: academicContext
          ? "legal-research-v2:academic_chapter"
          : sourceSearch
          ? "legal-research-v2:source_search"
          : "legal-research-v2",
        _request_id: clientRequestId,
      },
    );
    const releaseLockNow = async (reason: string) => {
      if (lockOperationId) await releaseOperationLock(admin, user.id, lockOperationId, reason);
    };
    if (consumeErr) {
      await releaseLockNow("credit_charge_failed");
      return json({ error: "credit_charge_failed", detail: consumeErr.message }, 500);
    }
    const cr = (consumeData ?? {}) as Record<string, unknown>;
    if (!cr.ok) {
      await releaseLockNow("insufficient_credits");
      if (cr.error === "INSUFFICIENT_CREDITS") {
        return json({
          error: "INSUFFICIENT_CREDITS",
          required: (cr.required as number) ?? creditCost,
          remaining_included: (cr.remaining_included as number) ?? 0,
          remaining_topup: (cr.remaining_topup as number) ?? 0,
        }, 402);
      }
      return json({ error: (cr.error as string) || "CREDIT_ERROR" }, 500);
    }
    // Admin accounts record a zero-delta consume; those are never refunded.
    const creditRequestId = cr.admin ? null : clientRequestId;

    // Attachments travel with the same authenticated request the client
    // already sends; only the destination function changed. Ownership is
    // validated at extraction time against this user's storage prefix.
    const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
    const attachmentInputs = rawAttachments
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
      .map((a) => ({
        storage_path: String(a.storage_path ?? ""),
        file_name: String(a.file_name ?? ""),
        mime_type: String(a.mime_type ?? ""),
        size: typeof a.size === "number" ? a.size : undefined,
      }))
      .filter((a) => a.storage_path && a.file_name)
      .slice(0, 5);

    const betaIntake = buildIntake({
      run_id: crypto.randomUUID(),
      question,
      attachment_text: null,
      attachments: attachmentInputs,
      attachment_owner_id: user.id,
      academic_context: academicContext,
      footnote_offset: footnoteOffset,
      output_mode: sourceSearch ? "sources" : "answer",
    });

    const { data: jobRow, error: jobErr } = await admin
      .from("legal_research_jobs")
      .insert({
        user_id: user.id,
        project_id: projectId,
        question,
        status: "running",
        client_request_id: clientRequestId,
        credit_request_id: creditRequestId,
        current_stage: "searching",
        progress_label_he: sourceSearch ? "חושב על כיווני חיפוש" : "מחפש מקורות",
        completed_stages: [],
        started_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    if (jobErr || !jobRow?.id) {
      if (creditRequestId) {
        // deno-lint-ignore no-explicit-any
        await (admin as any).rpc("refund_credits_for_user", {
          _user_id: user.id,
          _request_id: creditRequestId,
          _reason: "auto-refund: job_create_failed",
        });
      }
      await releaseLockNow("job_create_failed");
      return json({ error: "job_create_failed", detail: jobErr?.message ?? null }, 500);
    }

    const job: BetaJob = {
      id: jobRow.id,
      user_id: user.id,
      credit_request_id: creditRequestId,
      operation_id: lockOperationId,
    };
    await admin.from("v2_eval_runs").insert({
      run_id: betaIntake.run_id,
      label: academicContext
        ? "beta_academic_chapter"
        : sourceSearch
        ? "beta_source_search"
        : "beta",
      question: betaIntake.question,
      status: "running",
    });
    const betaTask = driveRun(
      admin,
      betaIntake,
      null,
      supabaseUrl,
      serviceKey,
      job,
      "searching",
    );
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(betaTask);
    }
    return json({ ok: true, job_id: job.id, run_id: betaIntake.run_id, status: "running" }, 202);
  }

  // ── Resume a paused chunked run in a fresh worker ───────────────────────
  if (resumeRunId) {
    const { data: row } = await admin
      .from("v2_eval_runs")
      .select("run_id, status, agent_state")
      .eq("run_id", resumeRunId)
      .maybeSingle();
    const saved = (row?.agent_state ?? null) as
      | { resume: ResumeState; intake: Intake; job?: BetaJob | null; stage?: ProgressStage | null }
      | null;
    if (!row || !saved) return json({ error: "resume_state_not_found" }, 404);
    // A run killed mid-chunk (CPU-time) stays "running" but has a checkpoint;
    // it is resumable from the last completed step.
    if (row.status !== "paused" && row.status !== "running") {
      return json({ error: `not_resumable:${row.status}` }, 409);
    }
    await admin.from("v2_eval_runs").update({
      status: "running",
      last_beat_at: new Date().toISOString(),
      watchdog_claimed_at: null,
    }).eq("run_id", resumeRunId);
    const task = driveRun(
      admin,
      saved.intake,
      saved.resume,
      supabaseUrl,
      serviceKey,
      saved.job ?? null,
      saved.stage ?? null,
    );
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(task);
    return json({ ok: true, resumed: true, run_id: resumeRunId }, 202);
  }

  const intake = buildIntake({
    run_id: String(body.run_id ?? crypto.randomUUID()),
    question,
    attachment_text: typeof body.attachment_text === "string" ? body.attachment_text : null,
    // Internal/smoke: attachments may be exercised with an explicit owner id.
    attachments: Array.isArray(body.attachments)
      // deno-lint-ignore no-explicit-any
      ? (body.attachments as any[]).slice(0, 5)
      : [],
    attachment_owner_id: typeof body.smoke_user_id === "string" ? body.smoke_user_id : null,
    budgets: (body.budgets ?? undefined) as Partial<ToolBudgets> | undefined,
    agent_model: typeof body.agent_model === "string" ? body.agent_model : null,
    // Evaluation-only: the internal entry point may run an Academic Writing
    // body chapter with a deliverable-level research contract.
    academic_context: body.academic_context ? parseProjectContext(body.academic_context) : null,
    footnote_offset: typeof body.footnote_offset === "number" ? body.footnote_offset : 0,
    research_contract: typeof body.research_contract === "string" ? body.research_contract : null,
    output_mode: body.output_mode === "sources" || body.mode === "source_search"
      ? "sources"
      : "answer",
  });

  // Background execution: evaluation runs routinely exceed the synchronous
  // request limit, so the result is persisted and polled instead.
  if (body.background === true) {
    await admin.from("v2_eval_runs").insert({
      run_id: intake.run_id,
      label: typeof body.label === "string" ? body.label : null,
      question: intake.question,
      status: "running",
    });
    const task = driveRun(admin, intake, null, supabaseUrl, serviceKey);
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(task);
    }
    return json({ ok: true, background: true, run_id: intake.run_id }, 202);
  }

  try {
    return json(await runPipeline(admin, intake));
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : String(e), run_id: intake.run_id },
      500,
    );
  }
});

