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
import {
  type AgentStateJson,
  deserializeAgentState,
  runResearchAgent,
  serializeAgentState,
} from "./agent/researchAgent.ts";
import { buildRepairMessage } from "./agent/prompt.ts";
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
  RESEARCH_CREDIT_COST,
  toBetaResult,
} from "./beta/job.ts";
import { runDrafter } from "./drafting/draft.ts";
import { renderAnswer } from "./drafting/render.ts";
import { RunTimer, type RunTimingJson } from "./shared/timing.ts";
import { decideResearchRepair } from "./verification/repairPolicy.ts";


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

import { classifyDeliverable } from "./agent/deliverable.ts";
import {
  type AcademicProjectContext,
  buildProjectContextBlock,
  parseProjectContext,
} from "./academic/projectContext.ts";
import { ACADEMIC_BODY_CHAPTER_GUIDE, ACADEMIC_BODY_GUIDE_VERSION } from "./academic/writingGuide.ts";
import { buildChapterMemory } from "./academic/chapterMemory.ts";

export function buildIntake(input: {
  run_id: string;
  question: string;
  attachment_text?: string | null;
  budgets?: Partial<ToolBudgets>;
  /** Evaluation-only Research Agent override. */
  agent_model?: string | null;
  /** Academic Writing body chapter only — framing context, never evidence. */
  academic_context?: AcademicProjectContext | null;
  footnote_offset?: number;
  /** Evaluation-only deliverable-level research contract. */
  research_contract?: string | null;
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
    // An academic body chapter is a developed product by construction.
    deliverable: input.academic_context ? "developed" : classifyDeliverable(question),
    budgets: { ...DEFAULT_BUDGETS, ...(input.budgets ?? {}) },
    agent_model: input.agent_model?.trim() || null,
    academic_context: input.academic_context ?? null,
    footnote_offset: Math.max(0, Math.floor(input.footnote_offset ?? 0)),
    research_contract: input.research_contract?.trim() || null,
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
  opts: { resume?: ResumeState | null; chunked?: boolean; progress?: ProgressSink } = {},
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
          },
          chunk_index,
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
    ? decideResearchRepair(verification)
    : { repair: false, reason: "no_unsupported_core_claims" as const };
  const repair_skip_reason = repairDecision.repair ? null : repairDecision.reason;
  const needsRepair = repairDecision.repair && !agent.policy.allExhausted();
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
      extraUserMessage: buildRepairMessage({
        unsupported: verification.pack.unsupported_claims,
        rejected: verification.rejected,
      }),
      policy: agent.policy,
      discovered: agent.discovered,
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
      if (reVerified.pack.claims.length >= verification.pack.claims.length) {
        agent = { ...repaired, trace: [...agent.trace, ...repaired.trace] };
        verification = reVerified;
      }
    }
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
  const draft = await timer.time("drafting_model", () =>
    runDrafter({
      question: intake.question,
      pack,
      model: models.drafter,
      usage,
      advisories,
      gapNotices,
      academic: intake.academic_context
        ? {
          guide: ACADEMIC_BODY_CHAPTER_GUIDE,
          contextBlock: buildProjectContextBlock(intake.academic_context),
        }
        : null,
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
    /** Latency efficiency (legal_research_v2_latency_efficiency_v1). */
    phase_ms: timer.totalsMs(),
    agent_turns: timer.toJSON().turns,
    already_read_actions: agent.stats.already_read_actions,
    noop_already_read_suppressed: agent.stats.noop_already_read_suppressed,
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
    ...temporalCounters,
    primary_authority_obligations: gapReport.obligations,
    primary_unreadable: gapReport.unreadable,
    derivative_fallback_attempted,
    derivative_supported_authorities: gapReport.derivative,
    derivative_disclosure_shown,
    acquisition_ledger: agent.ledger.all(),
    source_funnel,
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
  // Progress is persisted on the beta job row; internal runs get a no-op sink.
  const progress = createProgressSink(
    job ? (admin as unknown as Parameters<typeof createProgressSink>[0]) : null,
    job?.id ?? null,
    initialStage,
  );
  try {
    const out = await runPipeline(admin, intake, { resume, chunked: true, progress });
    if ("paused" in out && out.paused) {
      await admin.from("v2_eval_runs").update({
        status: "paused",
        agent_state: { resume: out.resume, intake, job, stage: progress.current() },
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
  const question = String(body.question ?? "").trim();
  if (!question && !resumeRunId) return json({ error: "question_required" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return json({ error: "backend_not_configured" }, 500);

  // Internal / smoke invocation only — V2 carries no production traffic yet.
  const authHeader = req.headers.get("Authorization") ?? "";
  const smokeTokens = [
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
    const creditCost = academicContext ? ACADEMIC_CHAPTER_CREDIT_COST : RESEARCH_CREDIT_COST;
    const footnoteOffset = Number.isFinite(body.footnote_offset)
      ? Math.max(0, Math.floor(Number(body.footnote_offset)))
      : 0;

    const projectId = typeof body.project_id === "string" ? body.project_id : null;
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

    // deno-lint-ignore no-explicit-any
    const { data: consumeData, error: consumeErr } = await (userClient as any).rpc(
      "consume_credits",
      {
        _amount: creditCost,
        _reason: academicContext ? "legal-research-v2:academic_chapter" : "legal-research-v2",
        _request_id: clientRequestId,
      },
    );
    if (consumeErr) return json({ error: "credit_charge_failed", detail: consumeErr.message }, 500);
    const cr = (consumeData ?? {}) as Record<string, unknown>;
    if (!cr.ok) {
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

    const betaIntake = buildIntake({
      run_id: crypto.randomUUID(),
      question,
      attachment_text: null,
      academic_context: academicContext,
      footnote_offset: footnoteOffset,
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
        progress_label_he: "מחפש מקורות",
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
      return json({ error: "job_create_failed", detail: jobErr?.message ?? null }, 500);
    }

    const job: BetaJob = { id: jobRow.id, user_id: user.id, credit_request_id: creditRequestId };
    await admin.from("v2_eval_runs").insert({
      run_id: betaIntake.run_id,
      label: academicContext ? "beta_academic_chapter" : "beta",
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
    await admin.from("v2_eval_runs").update({ status: "running" }).eq("run_id", resumeRunId);
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
    budgets: (body.budgets ?? undefined) as Partial<ToolBudgets> | undefined,
    agent_model: typeof body.agent_model === "string" ? body.agent_model : null,
    // Evaluation-only: the internal entry point may run an Academic Writing
    // body chapter with a deliverable-level research contract.
    academic_context: body.academic_context ? parseProjectContext(body.academic_context) : null,
    footnote_offset: typeof body.footnote_offset === "number" ? body.footnote_offset : 0,
    research_contract: typeof body.research_contract === "string" ? body.research_contract : null,
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

