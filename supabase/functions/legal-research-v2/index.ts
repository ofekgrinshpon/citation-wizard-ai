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
import { modelConfig, newUsageLedger } from "./shared/model.ts";
import { EvidenceStore } from "./evidence/evidenceStore.ts";
import { runResearchAgent } from "./agent/researchAgent.ts";
import { buildRepairMessage } from "./agent/prompt.ts";
import { verifyMemo, type ExpectedIdentity } from "./verification/verify.ts";
import { runDrafter } from "./drafting/draft.ts";
import { renderAnswer } from "./drafting/render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-smoke-mode",
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
  };
}

async function runPipeline(admin: SupabaseClient, intake: Intake) {
  const started = Date.now();
  const usage = newUsageLedger();
  const store = new EvidenceStore();
  const models = modelConfig();

  // ── Research ────────────────────────────────────────────────────────────
  let agent = await runResearchAgent({
    admin,
    intake,
    store,
    model: models.agent,
    usage,
  });

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
      model: models.agent,
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

  // ── Draft + deterministic render ────────────────────────────────────────
  const pack = verification?.pack ?? { claims: [], unsupported_claims: [] };
  const draft = await runDrafter({
    question: intake.question,
    pack,
    model: models.drafter,
    usage,
  });
  const rendered = renderAnswer(draft.blocks, pack);

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const question = String(body.question ?? "").trim();
  if (!question) return json({ error: "question_required" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return json({ error: "backend_not_configured" }, 500);

  // Internal / smoke invocation only — V2 carries no production traffic yet.
  const authHeader = req.headers.get("Authorization") ?? "";
  const isSmoke = req.headers.get("x-smoke-mode") === "1" &&
    authHeader === `Bearer ${serviceKey}`;
  if (!isSmoke) return json({ error: "v2_internal_only" }, 403);

  const admin = createClient(supabaseUrl, serviceKey) as unknown as SupabaseClient;
  const intake = buildIntake({
    run_id: String(body.run_id ?? crypto.randomUUID()),
    question,
    attachment_text: typeof body.attachment_text === "string" ? body.attachment_text : null,
    budgets: (body.budgets ?? undefined) as Partial<ToolBudgets> | undefined,
  });

  try {
    return json(await runPipeline(admin, intake));
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : String(e), run_id: intake.run_id },
      500,
    );
  }
});
