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
import { runDrafter } from "./drafting/draft.ts";
import { renderAnswer } from "./drafting/render.ts";


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

export function buildIntake(input: {
  run_id: string;
  question: string;
  attachment_text?: string | null;
  budgets?: Partial<ToolBudgets>;
  /** Evaluation-only Research Agent override. */
  agent_model?: string | null;
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
    budgets: { ...DEFAULT_BUDGETS, ...(input.budgets ?? {}) },
    agent_model: input.agent_model?.trim() || null,
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
}

async function runPipeline(
  admin: SupabaseClient,
  intake: Intake,
  opts: { resume?: ResumeState | null; chunked?: boolean } = {},
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
    maxStepsThisChunk: opts.chunked ? CHUNK.MAX_STEPS : undefined,
    deadlineAt: opts.chunked ? Date.now() + CHUNK.MAX_MS : undefined,
    checkpoint: opts.chunked
      ? async (state) => {
        await admin.from("v2_eval_runs").update({
          agent_state: {
            resume: { agent_state: state, chunk_index: chunk_index - 1, usage, started_at: started },
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
      },
    };
  }

  const expected: ExpectedIdentity = {
    dockets: intake.docket_obligations.map((d) => d.display),
    statutes: intake.statute_obligations.map((s) => ({ statute: s.statute, section: s.section })),
  };

  let repair_cycles = 0;
  let verification = agent.memo
    ? await verifyMemo({
      memo: agent.memo,
      store,
      expected,
      model: models.verifier,
      usage,
    })
    : null;

  // ── One bounded repair cycle, driven by verification rejections ─────────
  const needsRepair = !!verification &&
    verification.pack.unsupported_claims.some((c) => c.importance === "core") &&
    !agent.policy.allExhausted();
  if (agent.memo && verification && needsRepair) {
    repair_cycles = 1;
    const repaired = await runResearchAgent({
      admin,
      intake,
      store,
      model: agentModel,
      usage,
      priorMessages: agent.messages,
      extraUserMessage: buildRepairMessage({
        unsupported: verification.pack.unsupported_claims,
        rejected: verification.rejected,
      }),
      policy: agent.policy,
      discovered: agent.discovered,
    });
    if (repaired.memo) {
      const reVerified = await verifyMemo({
        memo: repaired.memo,
        store,
        expected,
        model: models.verifier,
        usage,
      });
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
    const t = await assessTemporalValidity({
      pack: verification.pack,
      store,
      model: models.verifier,
      usage,
    });
    temporalCounters = t.counters;
    temporalAssessments = t.assessments;

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
        priorMessages: agent.messages,
        extraUserMessage: buildTemporalRepairMessage(t.assessments),
        policy: agent.policy,
        discovered: agent.discovered,
      });
      if (repaired.memo) {
        const reVerified = await verifyMemo({
          memo: repaired.memo,
          store,
          expected,
          model: models.verifier,
          usage,
        });
        const reTemporal = await assessTemporalValidity({
          pack: reVerified.pack,
          store,
          model: models.verifier,
          usage,
        });
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
      priorMessages: agent.messages,
      extraUserMessage: buildDerivativeFallbackMessage(missing),
      policy: agent.policy,
      discovered: agent.discovered,
    });
    if (fallback.memo) {
      // Same body / identity / span / support checks — nothing is loosened.
      const reVerified = await verifyMemo({
        memo: fallback.memo,
        store,
        expected,
        model: models.verifier,
        usage,
      });
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

  // ── Draft + deterministic render ────────────────────────────────────────
  const pack = verification?.pack ?? { claims: [], unsupported_claims: [] };
  const draft = await runDrafter({
    question: intake.question,
    pack,
    model: models.drafter,
    usage,
    advisories,
  });
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
  const rendered = renderAnswer(blocks, pack);


  // ── Telemetry ───────────────────────────────────────────────────────────
  const citedSet = new Set(rendered.cited_source_ids);
  const identityOk = new Set<string>();
  const spanOk = new Set<string>();
  const supportOk = new Set<string>();
  for (const c of pack.claims) {
    for (const s of c.sources) {
      identityOk.add(s.source_id);
      spanOk.add(s.source_id);
      supportOk.add(s.source_id);
    }
  }
  const source_funnel: SourceFunnelRow[] = store.all().map((s) => ({
    source_id: s.source_id,
    title: s.title,
    url: s.url,
    discovered: true,
    fetched: s.fetch_status === "ok" && s.is_actual_document,
    identity_verified: identityOk.has(s.source_id),
    span_verified: spanOk.has(s.source_id),
    support_verified: supportOk.has(s.source_id),
    cited: citedSet.has(s.source_id),
  }));

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
): Promise<void> {
  try {
    const out = await runPipeline(admin, intake, { resume, chunked: true });
    if ("paused" in out && out.paused) {
      await admin.from("v2_eval_runs").update({
        status: "paused",
        agent_state: { resume: out.resume, intake },
      }).eq("run_id", intake.run_id);
      await selfInvokeResume(intake.run_id, supabaseUrl, serviceKey);
      return;
    }
    await admin.from("v2_eval_runs").update({
      status: "done",
      result: out,
      agent_state: null,
      finished_at: new Date().toISOString(),
    }).eq("run_id", intake.run_id);
  } catch (e) {
    await admin.from("v2_eval_runs").update({
      status: "error",
      error: e instanceof Error ? e.message : String(e),
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

  if (!isSmoke) return json({ error: "v2_internal_only" }, 403);


  const admin = createClient(supabaseUrl, serviceKey) as unknown as SupabaseClient;

  // ── Resume a paused chunked run in a fresh worker ───────────────────────
  if (resumeRunId) {
    const { data: row } = await admin
      .from("v2_eval_runs")
      .select("run_id, status, agent_state")
      .eq("run_id", resumeRunId)
      .maybeSingle();
    const saved = (row?.agent_state ?? null) as
      | { resume: ResumeState; intake: Intake }
      | null;
    if (!row || !saved) return json({ error: "resume_state_not_found" }, 404);
    // A run killed mid-chunk (CPU-time) stays "running" but has a checkpoint;
    // it is resumable from the last completed step.
    if (row.status !== "paused" && row.status !== "running") {
      return json({ error: `not_resumable:${row.status}` }, 409);
    }
    await admin.from("v2_eval_runs").update({ status: "running" }).eq("run_id", resumeRunId);
    const task = driveRun(admin, saved.intake, saved.resume, supabaseUrl, serviceKey);
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(task);
    return json({ ok: true, resumed: true, run_id: resumeRunId }, 202);
  }

  const intake = buildIntake({
    run_id: String(body.run_id ?? crypto.randomUUID()),
    question,
    attachment_text: typeof body.attachment_text === "string" ? body.attachment_text : null,
    budgets: (body.budgets ?? undefined) as Partial<ToolBudgets> | undefined,
    agent_model: typeof body.agent_model === "string" ? body.agent_model : null,
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

