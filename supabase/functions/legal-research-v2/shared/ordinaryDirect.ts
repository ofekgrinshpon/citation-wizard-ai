/**
 * Ordinary public research → native OpenAI Responses (gpt-6.1-sol, medium).
 *
 * Separate from the internal pilot: never reads V2_DIRECT_PROVIDER_PILOT*,
 * never touches v2_eval_runs pause/review state, never uses the pilot budget.
 * Reuses only the pilot's pure helpers (replay builder, SSE reader, tool-call
 * validation, usage parser, upper-bound pricing).
 *
 * Fail-closed rules:
 *   - No configured run AND day cap => no OpenAI call of any kind (incl. input count).
 *   - Every dispatch needs a fresh, durable reservation that passes BOTH caps.
 *     A reused attempt id never authorizes a dispatch.
 *   - Any uncertain outcome holds its full reservation, blocks further calls in
 *     the run, and is never resent or automatically refunded.
 *   - No retry of any status (5xx, 429, timeout, interrupted stream).
 *   - Never falls back to the Lovable gateway.
 */
import type { ChatMessage, ChatResult, ToolSpec, UsageLedger } from "./model.ts";
import { DIRECT_LIMITS } from "./directProviderPolicy.ts";
import { directResponsesInput, readEvents, sol61UpperUsd, validateCalls, validateToolHistory } from "./directProviders.ts";
import { emptyDirectUsage, nativeUsage, object, safeProviderId, safeProviderModelId, tokenCount, type DirectAttempt } from "./directProviderUsage.ts";
import { ORDINARY_RESEARCH_MODEL } from "./ordinaryResearchPolicy.ts";

declare const Deno: { env: { get(key: string): string | undefined } };
type Json = Record<string, unknown>;

export const ORDINARY_DIRECT_WIRE_MODEL = "gpt-6.1-sol" as const;
/** Proposed initial value only. Not a spend authorization. */
export const ORDINARY_PROPOSED_MAX_OUTPUT_TOKENS = 16_384;
/** ai_cost_events writes for this route stay off until live schema/consumer compatibility is verified. */
export const ORDINARY_COST_EVENTS_ENABLED = false as const;
/** Sanity bound on an operator-entered cap, not a recommended value. */
const CAP_SANITY_MAX_USD = 1000;
const LONG_CONTEXT_LIMIT = 272_000;

const UNCERTAIN: ReadonlyArray<DirectAttempt["outcome"]> = ["pending", "network_unknown", "stream_unknown", "aborted_unknown", "http_error", "model_mismatch"];

/** Strict decimal string, > 0, <= sanity bound. Anything else is "unset". */
export function parseUsdCap(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{1,4}(\.\d{1,4})?$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 && n <= CAP_SANITY_MAX_USD ? n : null;
}

export function ordinarySpendCaps(get: (k: string) => string | undefined = k => Deno.env.get(k)):
  { run_usd: number; day_usd: number } | null {
  const run = parseUsdCap(get("V2_ORDINARY_RUN_CAP_USD"));
  const day = parseUsdCap(get("V2_ORDINARY_DAY_CAP_USD"));
  return run !== null && day !== null && run <= day ? { run_usd: run, day_usd: day } : null;
}

export function ordinaryOutputCap(get: (k: string) => string | undefined = k => Deno.env.get(k)): number {
  const raw = get("V2_ORDINARY_MAX_OUTPUT_TOKENS");
  if (raw === undefined) return ORDINARY_PROPOSED_MAX_OUTPUT_TOKENS;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1024 && n <= DIRECT_LIMITS.maxOutputTokens ? n : -1;
}

// ---------------------------------------------------------------------------
// Durable spend ledger (backed by draft SQL; see supabase/migration-drafts).
// ---------------------------------------------------------------------------
export interface ReserveRequest { attempt_id: string; run_id: string; usd: number; run_cap_usd: number; day_cap_usd: number }
/** Only "reserved" (a freshly inserted row) authorizes a dispatch. */
export type ReserveResult = "reserved" | "duplicate" | "run_cap" | "day_cap" | "error";
export interface OrdinarySpendLedger {
  reserve(r: ReserveRequest): Promise<ReserveResult>;
  /** reserved -> settled. usd must be <= reserved. */
  settle(attemptId: string, usd: number): Promise<boolean>;
  /** reserved -> uncertain. Full reservation stays counted (all days) until owner reconciliation. */
  markUncertain(attemptId: string): Promise<boolean>;
  /** reserved -> released. Only for attempts proven never dispatched. Never from any other state. */
  release(attemptId: string): Promise<boolean>;
}

function rpcLedger(): OrdinarySpendLedger {
  const call = async (fn: string, args: Json): Promise<unknown> => {
    const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("ledger_unconfigured");
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* cleanup */ } throw new Error("ledger_http"); }
    return await r.json();
  };
  const bool = async (fn: string, args: Json) => { try { return (await call(fn, args)) === true; } catch { return false; } };
  return {
    async reserve(q) {
      try {
        const v = await call("reserve_ordinary_native_spend", {
          p_attempt_id: q.attempt_id, p_run_id: q.run_id, p_usd: q.usd, p_run_cap: q.run_cap_usd, p_day_cap: q.day_cap_usd,
        });
        return v === "reserved" || v === "duplicate" || v === "run_cap" || v === "day_cap" ? v : "error";
      } catch { return "error"; }
    },
    settle: (id, usd) => bool("settle_ordinary_native_spend", { p_attempt_id: id, p_usd: usd }),
    markUncertain: id => bool("mark_ordinary_native_spend_uncertain", { p_attempt_id: id }),
    release: id => bool("release_ordinary_native_spend", { p_attempt_id: id }),
  };
}

let ledgerOverride: OrdinarySpendLedger | null = null;
/** Test seam only. */
export function setOrdinarySpendLedgerForTests(l: OrdinarySpendLedger | null): void { ledgerOverride = l; }

/**
 * In-memory reference model of the draft SQL semantics (tests only). Each
 * call is atomic, like the advisory-locked SQL function.
 */
export function createMemorySpendLedger(now: () => Date = () => new Date()) {
  type Row = { run_id: string; reserved: number; settled: number | null; state: "reserved" | "settled" | "uncertain" | "released"; day: string };
  const rows = new Map<string, Row>();
  const day = () => now().toISOString().slice(0, 10);
  const liability = (r: Row) => r.state === "reserved" || r.state === "uncertain" ? r.reserved : r.state === "settled" ? r.settled! : 0;
  const ledger: OrdinarySpendLedger = {
    async reserve(q) {
      if (rows.has(q.attempt_id)) return "duplicate";
      if (!(q.usd > 0)) return "error";
      let run = 0, today = 0;
      for (const r of rows.values()) {
        if (r.run_id === q.run_id) run += liability(r);
        // Open liability counts on every day; settled counts on its own UTC day.
        if (r.state === "reserved" || r.state === "uncertain") today += r.reserved;
        else if (r.state === "settled" && r.day === day()) today += r.settled!;
      }
      if (run + q.usd > q.run_cap_usd + 1e-10) return "run_cap";
      if (today + q.usd > q.day_cap_usd + 1e-10) return "day_cap";
      rows.set(q.attempt_id, { run_id: q.run_id, reserved: q.usd, settled: null, state: "reserved", day: day() });
      return "reserved";
    },
    async settle(id, usd) {
      const r = rows.get(id);
      if (!r || r.state !== "reserved" || !(usd >= 0) || usd > r.reserved + 1e-10) return false;
      r.state = "settled"; r.settled = usd; r.day = day(); return true;
    },
    async markUncertain(id) { const r = rows.get(id); if (!r || r.state !== "reserved") return false; r.state = "uncertain"; return true; },
    async release(id) { const r = rows.get(id); if (!r || r.state !== "reserved") return false; r.state = "released"; return true; },
  };
  return { ledger, rows };
}

// ---------------------------------------------------------------------------
export interface OrdinaryOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: "auto" | "required" | { name: string };
  allowedToolNames?: string[];
  usage?: UsageLedger;
  beforeDirectDispatch?: () => Promise<boolean>;
  signal?: AbortSignal;
  reasoningEffort?: unknown;
  /** Run that owns the spend; required. */
  runId?: string;
  responsesInput: (messages: ChatMessage[], replay: boolean) => Json[];
}

export type OrdinaryDispatch = "not_sent" | "settled" | "uncertain";

const fail = (status: number, error: string, dispatch: OrdinaryDispatch): ChatResult => ({
  ok: false, http_status: status, error, terminal: true, content: "", tool_calls: [],
  finish_reason: null, prompt_tokens: 0, completion_tokens: 0, ordinary_dispatch: dispatch,
});
function bad(code: string): never { throw new Error(code); }
const safeError = (e: unknown) => e instanceof Error && /^(direct|ordinary)_[a-z_]+$/.test(e.message) ? e.message : "ordinary_invalid_output";
const str = (v: unknown): string => typeof v === "string" ? v : bad("ordinary_invalid_output");

/** True when the run's ledger already holds an unreconciled attempt. */
export function hasUncertainOrdinaryAttempt(usage: UsageLedger | undefined): boolean {
  return !!usage?.ordinary_direct_attempts?.some(a => UNCERTAIN.includes(a.outcome));
}

/**
 * Refund eligibility for a failed ordinary-direct job: only when the failing
 * call was proven not sent AND no earlier attempt in the run is uncertain.
 */
export function ordinaryFailureIsDefinitive(usage: UsageLedger | undefined, res: Pick<ChatResult, "ordinary_dispatch">): boolean {
  return res.ordinary_dispatch === "not_sent" && !hasUncertainOrdinaryAttempt(usage);
}

export async function ordinaryDirectChat(opts: OrdinaryOptions): Promise<ChatResult> {
  // ---- Pre-dispatch gates: nothing below reaches the network until caps exist.
  if (opts.model !== ORDINARY_RESEARCH_MODEL) return fail(400, "ordinary_model_mismatch", "not_sent");
  if (opts.reasoningEffort !== undefined && opts.reasoningEffort !== "medium") return fail(400, "ordinary_effort_mismatch", "not_sent");
  if (!opts.usage) return fail(400, "ordinary_usage_ledger_required", "not_sent");
  if (!opts.beforeDirectDispatch) return fail(400, "ordinary_checkpoint_required", "not_sent");
  if (!opts.runId) return fail(400, "ordinary_run_id_required", "not_sent");
  if (opts.usage.direct_provider_attempts?.length || opts.messages.some(m => m.native_replay)) {
    return fail(400, "ordinary_pilot_state_conflict", "not_sent");
  }
  if (opts.usage.ordinary_direct_failed) return fail(409, "ordinary_run_already_failed", "not_sent");
  if (hasUncertainOrdinaryAttempt(opts.usage)) return fail(409, "ordinary_reconciliation_required", "not_sent");
  if ((opts.usage.ordinary_direct_attempts?.length ?? 0) >= DIRECT_LIMITS.maxAttempts) return fail(400, "ordinary_attempt_limit", "not_sent");
  const caps = ordinarySpendCaps();
  if (!caps) return fail(503, "ordinary_spend_caps_unset", "not_sent");
  const outputLimit = ordinaryOutputCap();
  if (outputLimit < 0) return fail(503, "ordinary_output_cap_invalid", "not_sent");

  let body: Json;
  try {
    validateToolHistory(opts.messages);
    body = {
      model: ORDINARY_DIRECT_WIRE_MODEL, input: directResponsesInput(opts.messages, opts.responsesInput),
      stream: true, store: false, include: ["reasoning.encrypted_content"],
      reasoning: { effort: "medium", summary: "auto" }, max_output_tokens: outputLimit, service_tier: "default",
      ...(opts.tools?.length ? {
        tools: opts.tools.map(t => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false })),
        tool_choice: typeof opts.toolChoice === "object" ? { type: "function", name: opts.toolChoice.name } : (opts.toolChoice ?? "auto"),
      } : {}),
    };
  } catch (e) { return fail(400, safeError(e), "not_sent"); }
  const payload = JSON.stringify(body);
  if (new TextEncoder().encode(payload).length > DIRECT_LIMITS.maxRequestBytes) return fail(400, "ordinary_request_limit", "not_sent");
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return fail(401, "ordinary_key_missing", "not_sent");
  const ledger = ledgerOverride ?? rpcLedger();
  if (opts.signal?.aborted) return fail(499, "ordinary_aborted_before_dispatch", "not_sent");

  // ---- Exact input count (an OpenAI call, permitted only after caps exist).
  let counted: number, countMs = 0;
  {
    const controller = new AbortController(), abort = () => controller.abort();
    opts.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 30_000), t0 = performance.now();
    try {
      const r = await fetch("https://api.openai.com/v1/responses/input_tokens", {
        method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: body.model, input: body.input, reasoning: body.reasoning,
          ...(body.tools ? { tools: body.tools, tool_choice: body.tool_choice } : {}), truncation: "disabled" }),
        signal: controller.signal,
      });
      if (!r.ok) { try { await r.body?.cancel(); } catch { /* cleanup */ } return fail(r.status, "ordinary_input_count_unavailable", "not_sent"); }
      const text = await r.text();
      if (text.length > 16_384) return fail(502, "ordinary_input_count_invalid", "not_sent");
      const c = object(JSON.parse(text)), n = tokenCount(c.input_tokens);
      if (c.object !== "response.input_tokens" || n === null) return fail(502, "ordinary_input_count_invalid", "not_sent");
      counted = n;
    } catch { return fail(502, "ordinary_input_count_unavailable", "not_sent"); }
    finally { countMs = Math.max(0, Math.round(performance.now() - t0)); clearTimeout(timer); opts.signal?.removeEventListener("abort", abort); }
  }
  if (counted > LONG_CONTEXT_LIMIT) return fail(400, "ordinary_input_count_limit", "not_sent");
  const reservation = sol61UpperUsd(counted, outputLimit);

  const attempt: DirectAttempt = {
    ...emptyDirectUsage(), attempt_id: crypto.randomUUID(), provider: "openai", endpoint: "responses",
    requested_model: ORDINARY_DIRECT_WIRE_MODEL, response_model: null, provider_request_id: null, provider_response_id: null,
    http_status: 0, duration_ms: 0, outcome: "pending", price_version: "sol61-standard-2026-10-03",
    counted_input_tokens: counted, reserved_usd: reservation, input_count_ms: countMs, effort: "medium", usage_complete: false,
  };
  // ---- Durable reservation: both caps, atomically. Only a fresh row authorizes.
  const reserved = await ledger.reserve({ attempt_id: attempt.attempt_id, run_id: opts.runId, usd: reservation,
    run_cap_usd: caps.run_usd, day_cap_usd: caps.day_usd });
  if (reserved !== "reserved") {
    return fail(reserved === "error" ? 503 : 402, reserved === "error" ? "ordinary_spend_ledger_unavailable" : `ordinary_spend_${reserved}`, "not_sent");
  }
  attempt.outcome = "pending";
  (opts.usage.ordinary_direct_attempts ??= []).push(attempt);
  let checkpointed = false;
  const c0 = performance.now();
  try { checkpointed = await opts.beforeDirectDispatch(); } catch { /* not dispatched */ }
  attempt.checkpoint_ms = Math.max(0, Math.round(performance.now() - c0));
  if (!checkpointed || opts.signal?.aborted) {
    attempt.outcome = "not_sent";
    await ledger.release(attempt.attempt_id);
    return fail(checkpointed ? 499 : 503, checkpointed ? "ordinary_aborted_before_dispatch" : "ordinary_checkpoint_failed", "not_sent");
  }

  // ---- Single dispatch. No retry of any kind.
  opts.usage.model_calls += 1;
  const started = Date.now(), controller = new AbortController(), onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), DIRECT_LIMITS.timeoutMs);
  let result: ChatResult = fail(502, "ordinary_unknown_failure", "uncertain");
  let responseStarted = false, priceCompatible = true;
  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: payload, signal: controller.signal,
    });
    responseStarted = true;
    attempt.http_status = resp.status;
    attempt.provider_request_id = safeProviderId(resp.headers.get("x-request-id"));
    if (!resp.ok || !resp.body) {
      // A clean error status does not prove no execution or charge: hold liability.
      attempt.outcome = "http_error";
      try { void resp.body?.cancel().catch(() => {}); } catch { /* cleanup */ }
      result = fail(resp.status, "ordinary_http_error", "uncertain");
    } else {
      let terminal: Json = {}, terminalType = "";
      await readEvents(resp.body, controller.signal, event => {
        if (["response.completed", "response.incomplete", "response.failed"].includes(String(event.type))) {
          terminal = object(event.response); terminalType = String(event.type); return true;
        }
        if (event.type === "error") bad("ordinary_provider_stream_error");
        return false;
      });
      attempt.response_model = safeProviderModelId(terminal.model);
      attempt.provider_response_id = safeProviderId(terminal.id);
      Object.assign(attempt, nativeUsage("openai", { ...object(terminal.usage),
        ...(terminal.service_tier ? { service_tier: terminal.service_tier } : {}),
        ...(terminal.inference_geo ? { inference_geo: terminal.inference_geo } : {}) }, ORDINARY_DIRECT_WIRE_MODEL));
      attempt.usage_complete = attempt.input_tokens !== null && attempt.output_tokens !== null;
      const returnedEffort = object(terminal.reasoning).effort;
      attempt.effort_returned = returnedEffort === undefined ? null : returnedEffort === "medium" || returnedEffort === "high" ? returnedEffort : "other";
      attempt.effort_status = returnedEffort === undefined ? "not_reported" : returnedEffort === "medium" ? "matched" : "mismatch";
      priceCompatible = ["default", "standard"].includes(String(terminal.service_tier)) &&
        (terminal.inference_geo === undefined || terminal.inference_geo === "global");
      // Wrong/missing model: SOL price cannot bound it. Hold full reservation as uncertain.
      if (terminal.model !== ORDINARY_DIRECT_WIRE_MODEL) { attempt.outcome = "model_mismatch"; result = fail(502, "ordinary_model_mismatch", "uncertain"); }
      else if (terminalType !== "response.completed" || terminal.status !== "completed") {
        attempt.outcome = terminalType === "response.incomplete" ? "incomplete" : "invalid_output";
        result = fail(502, "ordinary_incomplete_response", "settled");
      } else if (attempt.effort_status === "mismatch") {
        attempt.outcome = "invalid_output"; result = fail(502, "ordinary_reasoning_effort_mismatch", "settled");
      } else {
        if (!Array.isArray(terminal.output)) bad("ordinary_invalid_output");
        const calls: ChatResult["tool_calls"] = [], reasoning: NonNullable<ChatResult["reasoning_items"]> = [], seq: string[] = [];
        let text = "";
        for (const raw of terminal.output) {
          const b = object(raw);
          if (b.type === "function_call") {
            const id = str(b.call_id); calls.push({ id, name: str(b.name), arguments: str(b.arguments) }); seq.push(`c:${id}`);
          } else if (b.type === "reasoning") {
            const enc = str(b.encrypted_content);
            if (!enc || enc.length > 512_000) bad("ordinary_invalid_reasoning_item");
            reasoning.push({ type: "reasoning", encrypted_content: enc, ...(safeProviderId(b.id) ? { id: b.id as string } : {}) }); seq.push("r");
          } else if (b.type === "message") {
            if (seq.includes("t") || !Array.isArray(b.content)) bad("ordinary_invalid_output");
            for (const part of b.content) {
              const p = object(part);
              if (p.type === "refusal") { attempt.outcome = "refusal"; bad("ordinary_provider_refusal"); }
              if (p.type !== "output_text") bad("ordinary_unsupported_block");
              text += str(p.text);
            }
            if (text) seq.push("t");
          } else bad("ordinary_unsupported_block");
        }
        validateCalls(calls, opts);
        attempt.outcome = "ok";
        result = { ok: true, http_status: resp.status, terminal: false, content: text, tool_calls: calls,
          finish_reason: calls.length ? "tool_calls" : "stop", prompt_tokens: attempt.input_tokens ?? 0,
          completion_tokens: attempt.output_tokens ?? 0, reasoning_items: reasoning, replay_seq: seq,
          reasoning_items_forwarded: (body.input as Json[]).filter(x => x.type === "reasoning").length,
          ordinary_dispatch: "settled",
        };
      }
    }
  } catch (e) {
    if (attempt.outcome === "pending") attempt.outcome = controller.signal.aborted ? "aborted_unknown" : responseStarted ? "stream_unknown" : "network_unknown";
    else if (attempt.outcome === "ok") attempt.outcome = "invalid_output";
    const uncertain = UNCERTAIN.includes(attempt.outcome);
    result = fail(controller.signal.aborted ? 499 : 502, controller.signal.aborted ? "ordinary_aborted" : safeError(e), uncertain ? "uncertain" : "settled");
  } finally {
    clearTimeout(timeout); opts.signal?.removeEventListener("abort", onAbort);
    attempt.duration_ms = Math.max(0, Date.now() - started);
  }

  // ---- Settle against the reservation; anything unprovable stays held.
  let settleUsd: number | null = null;
  if (attempt.usage_complete && attempt.input_tokens !== null && attempt.output_tokens !== null) {
    const upper = sol61UpperUsd(attempt.input_tokens, attempt.output_tokens);
    if (attempt.input_tokens <= counted && attempt.output_tokens <= outputLimit && upper <= reservation + 1e-10 && priceCompatible &&
      attempt.response_model === ORDINARY_DIRECT_WIRE_MODEL) settleUsd = upper;
  }
  if (result.ordinary_dispatch === "settled" && settleUsd === null) {
    // Sent, but the receipt cannot be bounded: treat as uncertain liability.
    if (result.ok) result = fail(502, priceCompatible ? "ordinary_usage_missing" : "ordinary_price_tier_or_geo_mismatch", "uncertain");
    else result = { ...result, ordinary_dispatch: "uncertain" };
    attempt.outcome = attempt.usage_complete ? "invalid_output" : "usage_missing";
  }
  if (result.ordinary_dispatch === "settled" && settleUsd !== null) {
    attempt.settled_upper_usd = settleUsd;
    // A failed settle write leaves the full reservation held (safe direction).
    await ledger.settle(attempt.attempt_id, settleUsd);
  } else {
    await ledger.markUncertain(attempt.attempt_id);
  }
  // Ledger blocks follow-up calls after uncertainty via the outcome set; keep
  // a sent-but-unbounded attempt in that set explicitly.
  if (result.ordinary_dispatch === "uncertain" && !UNCERTAIN.includes(attempt.outcome)) attempt.outcome = "stream_unknown";
  if (attempt.response_model !== ORDINARY_DIRECT_WIRE_MODEL) { attempt.estimated_usd = null; attempt.estimate_complete = false; }
  if (attempt.input_tokens !== null) {
    opts.usage.prompt_tokens += attempt.input_tokens;
    opts.usage.prompt_tokens_per_call.push(attempt.input_tokens);
    opts.usage.max_prompt_tokens_single_call = Math.max(opts.usage.max_prompt_tokens_single_call, attempt.input_tokens);
  }
  if (attempt.output_tokens !== null) opts.usage.completion_tokens += attempt.output_tokens;
  // Fixed scalar fields only. No prompts, tool args, bodies, secrets, or replay blobs.
  console.info(JSON.stringify({ event: "v2_ordinary_direct_attempt", ...attempt }));
  return { ...result, prompt_tokens: attempt.input_tokens ?? 0, completion_tokens: attempt.output_tokens ?? 0, direct_attempt: attempt };
}
