/**
 * legal-research-v2 — public gateway client plus explicit internal native pilots.
 *
 * Public gateway behavior is unchanged. Direct pilots are opt-in and isolated.
 * One client for all three model roles (agent / verifier / drafter). Model ids
 * are configuration, never architecture: every role reads an env override and
 * falls back to a documented default.
 */

declare const Deno: { env: { get(key: string): string | undefined } };

import {
  beginAttempt, isAbortError, parseUsage, parseResponsesUsage,
  type AttemptRecorder, type CostStage, type ParsedUsage,
} from "../../_shared/costTelemetry.ts";
import { guardProviderCall } from "./providerLiveness.ts";
import { reasoningEffortError, type EvaluationReasoningEffort } from "./evaluationReasoning.ts";

import { directChat, type NativeReplay } from "./directProviders.ts";
import type { DirectProviderConfig } from "./directProviderPolicy.ts";
import type { DirectAttempt } from "./directProviderUsage.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface ModelConfig {
  agent: string;
  verifier: string;
  drafter: string;
}

/** Production default Research Agent (agent-authored answer architecture). */
export const DEFAULT_AGENT_MODEL = "openai/gpt-6-astra";

export function modelConfig(): ModelConfig {
  return {
    agent: Deno.env.get("V2_AGENT_MODEL") || DEFAULT_AGENT_MODEL,
    verifier: Deno.env.get("V2_VERIFIER_MODEL") || "google/gemini-3.7-flash",
    // Used only by the emergency rollback path (V2_USE_SEPARATE_DRAFTER=true).
    drafter: Deno.env.get("V2_DRAFTER_MODEL") || "google/gemini-3.1-pro-preview",
  };
}

/**
 * Emergency rollback only. When "true", answer mode returns to the legacy
 * Research Agent → separate Drafter path. Default (unset/anything else): the
 * Research Agent writes the answer itself. There is no automatic routing.
 */
export function separateDrafterEnabled(env?: (k: string) => string | undefined): boolean {
  const get = env ?? ((k: string) => (typeof Deno !== "undefined" ? Deno.env.get(k) : undefined));
  return (get("V2_USE_SEPARATE_DRAFTER") ?? "").trim().toLowerCase() === "true";
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMessage {
  /** Internal native Anthropic checkpoint data; never sent to another provider. */
  native_replay?: NativeReplay;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  /**
   * Local-only one-line replacement used when this message is compacted out of
   * the active context. Never sent to a model provider.
   */
  digest?: string;
  /**
   * Opaque provider-returned encrypted reasoning items for this assistant turn
   * (Responses API only). Never decoded, logged, or sent to chat-completions.
   */
  reasoning_items?: ReasoningItem[];
  /**
   * Provider output order for this turn: "r" = next reasoning item, "t" = the
   * assistant text message, "c:<call_id>" = that function call. Replay uses it
   * verbatim; if missing or inconsistent, reasoning is omitted for the turn.
   */
  replay_seq?: string[];
}

/** Minimal opaque reasoning item kept for stateless replay (no summary text). */
export interface ReasoningItem {
  type: "reasoning";
  id?: string;
  encrypted_content: string;
}

/** Per-item cap; larger items are skipped whole (never truncated). */
const MAX_ENCRYPTED_CHARS = 512_000;
/**
 * Whole-history replay budget: at most 2,000,000 encrypted chars and 64 items
 * carried across all assistant turns. Older turns lose their (optional) replay
 * state first; visible text, tool calls and tool results are never touched.
 */
export const REPLAY_BUDGET = { maxChars: 2_000_000, maxItems: 64 } as const;

export function enforceReplayBudget(messages: ChatMessage[]): { dropped_items: number } {
  let chars = 0, items = 0, dropped = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m.reasoning_items?.length) continue;
    const c = m.reasoning_items.reduce((n, r) => n + (r.encrypted_content?.length ?? 0), 0);
    if (chars + c > REPLAY_BUDGET.maxChars || items + m.reasoning_items.length > REPLAY_BUDGET.maxItems) {
      dropped += m.reasoning_items.length;
      const { reasoning_items: _r, replay_seq: _s, ...rest } = m;
      messages[i] = rest;
    } else { chars += c; items += m.reasoning_items.length; }
  }
  return { dropped_items: dropped };
}

/** Validate a turn's sequence against its stored items, text and calls. */
function validSeq(m: ChatMessage): boolean {
  const seq = m.replay_seq;
  if (!Array.isArray(seq) || !m.reasoning_items?.length) return false;
  const calls = (m.tool_calls ?? []).map((c) => c.id);
  const seen = new Set<string>();
  let r = 0, t = 0;
  for (const tok of seq) {
    if (tok === "r") r++;
    else if (tok === "t") t++;
    else if (typeof tok === "string" && tok.startsWith("c:")) {
      const id = tok.slice(2);
      if (!calls.includes(id) || seen.has(id)) return false;
      seen.add(id);
    } else return false;
  }
  return r === m.reasoning_items.length && seen.size === calls.length && t === (m.content ? 1 : 0);
}

/**
 * Accept a provider output item only if it is a reasoning item carrying a
 * non-empty encrypted_content string. Plaintext summary is intentionally dropped.
 */
export function toReasoningItem(item: Record<string, unknown>): ReasoningItem | null {
  if (item?.type !== "reasoning") return null;
  const enc = item.encrypted_content;
  if (typeof enc !== "string" || !enc || enc.length > MAX_ENCRYPTED_CHARS) return null;
  const out: ReasoningItem = { type: "reasoning", encrypted_content: enc };
  if (typeof item.id === "string" && item.id.length > 0 && item.id.length <= 256) out.id = item.id;
  return out;
}

/** Internal switch for research-agent replay. Default ON; V2_REASONING_REPLAY=off disables. */
export function reasoningReplayEnabled(): boolean {
  try { return (Deno.env.get("V2_REASONING_REPLAY") ?? "").toLowerCase() !== "off"; } catch { return true; }
}

/** Strip local-only fields before a message reaches a provider. */
export function wireMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    const wire: Record<string, unknown> = { role: m.role, content: m.content ?? "" };
    if (m.tool_calls) wire.tool_calls = m.tool_calls;
    if (m.tool_call_id) wire.tool_call_id = m.tool_call_id;
    return wire;
  });
}

export interface ChatResult {
  native_replay?: NativeReplay;
  direct_attempt?: DirectAttempt;
  ok: boolean;
  http_status: number;
  error?: string;
  /** Terminal (non-retryable) gateway status: 400/401/402/403. */
  terminal: boolean;
  content: string;
  tool_calls: ChatToolCall[];
  finish_reason: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  /** Valid encrypted reasoning items returned on this call (replay enabled only). */
  reasoning_items?: ReasoningItem[];
  /** Count of reasoning items replayed in this request (metadata only). */
  reasoning_items_forwarded?: number;
  /** Provider output order for this call (see ChatMessage.replay_seq). */
  replay_seq?: string[];
  /** True when returned reasoning could not be kept in a safe order. */
  replay_fallback?: boolean;
  /** Metadata only; absence is never proof that the provider used the request. */
  reasoning_effort_requested?: EvaluationReasoningEffort;
  reasoning_effort_returned?: string | null;
  reasoning_effort_status?: "matched" | "not_reported" | "mismatch";
}

export interface UsageLedger {
  /** Native pilot costs, checkpointed per attempt. No content or secrets. */
  direct_provider_attempts?: DirectAttempt[];
  /** A failed pilot never resumes or falls back without explicit reconciliation. */
  direct_provider_failed?: boolean;
  /** Evaluation-only transport audit, preserved across all chunks and repairs. */
  reasoning_max_requested_calls?: number;
  reasoning_max_confirmed_calls?: number;
  reasoning_max_unreported_calls?: number;
  reasoning_max_mismatch_calls?: number;
  model_calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  /** Per-call prompt sizes — the context-growth signal for long runs. */
  prompt_tokens_per_call: number[];
  max_prompt_tokens_single_call: number;
}

export function newUsageLedger(): UsageLedger {
  return {
    model_calls: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    prompt_tokens_per_call: [],
    max_prompt_tokens_single_call: 0,
  };
}

const RESPONSES_URL = "https://ai.gateway.lovable.dev/v1/responses";

/**
 * OpenAI models on the gateway reject function tools on /v1/chat/completions
 * unless reasoning is disabled. To compare them fairly against a thinking
 * Gemini agent, their calls go through /v1/responses with reasoning enabled.
 * Same messages, same tools, same budgets — only the transport differs.
 */
function usesResponsesApi(model: string): boolean {
  return model.startsWith("openai/");
}

/** Translate the chat-shaped conversation into Responses `input[]` items. */
export function toResponsesInput(messages: ChatMessage[], replayReasoning = false): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "user") {
      input.push({ role: m.role, content: [{ type: "input_text", text: m.content ?? "" }] });
    } else if (m.role === "assistant") {
      // Reasoning precedes the turn's output text/function calls, matching the
      // provider's output order, so it lands before the matching tool outputs.
      const items = replayReasoning && validSeq(m)
        ? m.reasoning_items!.map((r) => toReasoningItem(r as unknown as Record<string, unknown>))
        : null;
      if (items && items.every(Boolean)) {
        // Replay in the exact provider order recorded for this turn.
        let ri = 0;
        for (const tok of m.replay_seq!) {
          if (tok === "r") {
            const ok = items[ri++]!;
            input.push(ok.id
              ? { type: "reasoning", id: ok.id, encrypted_content: ok.encrypted_content, summary: [] }
              : { type: "reasoning", encrypted_content: ok.encrypted_content, summary: [] });
          } else if (tok === "t") {
            input.push({ role: "assistant", content: [{ type: "output_text", text: m.content }] });
          } else {
            const c = m.tool_calls!.find((x) => x.id === tok.slice(2))!;
            input.push({ type: "function_call", call_id: c.id, name: c.function.name, arguments: c.function.arguments });
          }
        }
        continue;
      }
      // No valid replay state: original transport order, no reasoning.
      if (m.content) {
        input.push({ role: "assistant", content: [{ type: "output_text", text: m.content }] });
      }
      for (const c of m.tool_calls ?? []) {
        input.push({
          type: "function_call",
          call_id: c.id,
          name: c.function.name,
          arguments: c.function.arguments,
        });
      }
    } else if (m.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: m.tool_call_id ?? "",
        output: m.content ?? "",
      });
    }
  }
  return input;
}

async function responsesChatGuarded(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: "auto" | "required" | { name: string };
  usage?: UsageLedger;
  signal?: AbortSignal;
  fail: (status: number, error: string, terminal?: boolean) => ChatResult;
  reasoningEffort?: EvaluationReasoningEffort;
  costStage?: CostStage;
  replayReasoning?: boolean;
}): Promise<ChatResult> {
  const requestedEffort = opts.reasoningEffort ?? "medium";
  let returnedEffort: string | null = null;
  const effortMetadata = () => ({
    reasoning_effort_requested: requestedEffort,
    reasoning_effort_returned: returnedEffort,
    reasoning_effort_status: returnedEffort === null ? "not_reported" as const
      : returnedEffort === requestedEffort ? "matched" as const : "mismatch" as const,
  });
  let effortResultRecorded = false;
  const logEffort = (httpStatus: number, status: string) => {
    if (requestedEffort !== "max") return;
    if (opts.usage) {
      if (status === "requested") {
        opts.usage.reasoning_max_requested_calls = (opts.usage.reasoning_max_requested_calls ?? 0) + 1;
      } else if (!effortResultRecorded) {
        effortResultRecorded = true;
        const key = returnedEffort === null ? "reasoning_max_unreported_calls"
          : returnedEffort === requestedEffort ? "reasoning_max_confirmed_calls" : "reasoning_max_mismatch_calls";
        opts.usage[key] = (opts.usage[key] ?? 0) + 1;
      }
    }
    console.info(JSON.stringify({
      event: "v2_reasoning_effort", stage: opts.costStage ?? null,
      model: opts.model, http_status: httpStatus, status, ...effortMetadata(),
    }));
  };
  const replay = !!opts.replayReasoning;
  const input = toResponsesInput(opts.messages, replay);
  const reasoning_items_forwarded = replay ? input.filter((i) => i.type === "reasoning").length : 0;
  const body: Record<string, unknown> = {
    model: opts.model,
    input,
    stream: true,
    store: false,
    reasoning: { effort: requestedEffort, summary: "auto" },
  };
  if (replay) body.include = ["reasoning.encrypted_content"];
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      // The V2 tool schemas carry optional properties by design; strict mode
      // is therefore explicitly off rather than rewriting shared schemas.
      strict: false,
    }));
    if (opts.toolChoice === "required") body.tool_choice = "required";
    else if (opts.toolChoice && typeof opts.toolChoice === "object") {
      body.tool_choice = { type: "function", name: opts.toolChoice.name };
    } else body.tool_choice = "auto";
  }

  // Metadata-only telemetry; never alters the request or the stream handling.
  const rec: AttemptRecorder | null = beginAttempt({
    provider: "lovable_gateway", endpoint: "responses", requestedModel: opts.model, stage: opts.costStage,
  });
  logEffort(0, "requested");
  let resp: Response;
  try {
    resp = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    finishFetchError(rec, e);
    logEffort(0, "network_error");
    return opts.fail(0, `network_error: ${e instanceof Error ? e.message : String(e)}`, false);
  }
  rec?.headers(resp.status, resp.headers);
  if (!resp.ok || !resp.body) {
    rec?.finish({ outcome: "http_error", capture_status: "error_body_unread" });
    const txt = await resp.text().catch(() => "");
    logEffort(resp.status, "http_error");
    return opts.fail(resp.status, txt.slice(0, 600), resp.status < 429);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const pending: string[] = [];
  let text = "";
  const tool_calls: ChatToolCall[] = [];
  const reasoning_items: ReasoningItem[] = [];
  const replay_seq: string[] = [];
  let seqBroken = false;
  let prompt_tokens = 0;
  let completion_tokens = 0;
  let finish_reason: string | null = null;
  let streamError: string | null = null;
  let terminalUsage: ParsedUsage | undefined;
  let terminalType: string | null = null;

  const handle = (evt: Record<string, unknown>) => {
    const type = String(evt.type ?? "");
    if (["response.completed", "response.incomplete", "response.failed"].includes(type)) {
      const r = (evt.response ?? {}) as Record<string, unknown>;
      const providerEffort = (r.reasoning as Record<string, unknown> | undefined)?.effort;
      // A bounded enum avoids logging arbitrary provider content.
      if (providerEffort !== undefined && providerEffort !== null) {
        returnedEffort = typeof providerEffort === "string" &&
          ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(providerEffort)
          ? providerEffort : "unrecognized";
      }
    }
    if (type === "response.output_text.delta") {
      text += String(evt.delta ?? "");
    } else if (type === "response.output_item.done") {
      const item = (evt.item ?? {}) as Record<string, unknown>;
      if (replay && item.type === "reasoning") {
        const r = toReasoningItem(item);
        if (r) { reasoning_items.push(r); replay_seq.push("r"); }
        else seqBroken = true; // unusable item: replaying around it would alter order
      } else if (replay && item.type === "message") {
        if (replay_seq.includes("t")) seqBroken = true; // text is merged; can't split
        else replay_seq.push("t");
      } else if (item.type === "function_call") {
        if (replay) replay_seq.push(`c:${String(item.call_id ?? item.id ?? `call_${tool_calls.length}`)}`);
        tool_calls.push({
          id: String(item.call_id ?? item.id ?? `call_${tool_calls.length}`),
          name: String(item.name ?? ""),
          arguments: String(item.arguments ?? "{}"),
        });
      }
    } else if (type === "response.completed" || type === "response.incomplete") {
      const r = (evt.response ?? {}) as Record<string, unknown>;
      const usage = (r.usage ?? {}) as Record<string, unknown>;
      terminalType = type;
      try { terminalUsage = parseResponsesUsage(r); } catch { /* telemetry only */ }
      prompt_tokens = Number(usage.input_tokens ?? 0) || 0;
      completion_tokens = Number(usage.output_tokens ?? 0) || 0;
      finish_reason = type === "response.completed"
        ? (tool_calls.length ? "tool_calls" : "stop")
        : "length";
    } else if (type === "error" || type === "response.failed") {
      const r = (evt.response ?? evt) as Record<string, unknown>;
      if (type === "response.failed") {
        try { terminalUsage = parseResponsesUsage(r); } catch { /* telemetry only */ }
      }
      streamError = JSON.stringify(r).slice(0, 600);
    }
  };

  // SSE framing: an event is one or more `data:` lines ended by a blank line.
  // Frames may be split across network chunks and may use CRLF.
  let dataLines: string[] = [];
  const dispatch = () => {
    if (!dataLines.length) return;
    const payload = dataLines.join("\n").trim();
    dataLines = [];
    if (!payload || payload === "[DONE]") return;
    try { handle(JSON.parse(payload) as Record<string, unknown>); } catch { /* non-JSON frame */ }
  };
  const feedLine = (raw: string) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "") { dispatch(); return; }
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  };
  const isTerminal = () => !!streamError || terminalType !== null;

  let sawEof = false;
  try {
    while (!isTerminal()) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        logEffort(resp.status, "read_error");
        rec?.finish({
          outcome: isAbortError(e) ? "aborted" : "stream_error",
          capture_status: isAbortError(e) ? "aborted" : "read_error", usage: terminalUsage,
        });
        throw e;
      }
      const { done, value } = chunk;
      if (done) {
        pending.push(decoder.decode());
        const tail = pending.join("");
        pending.length = 0;
        if (tail) feedLine(tail);
        dispatch();
        sawEof = true;
        break;
      }
      // Incremental framing: scan only the new chunk; an unfinished line is kept
      // as fragments and joined once at its newline (linear in received data).
      const piece = decoder.decode(value, { stream: true });
      let start = 0;
      let nl = piece.indexOf("\n");
      while (nl !== -1) {
        pending.push(piece.slice(start, nl));
        const line = pending.length === 1 ? pending[0] : pending.join("");
        pending.length = 0;
        feedLine(line);
        if (isTerminal()) break;
        start = nl + 1;
        nl = piece.indexOf("\n", start);
      }
      if (!isTerminal() && start < piece.length) pending.push(piece.slice(start));
    }
  } finally {
    // Cleanup never blocks result settlement and never masks the original
    // error: cancel is fire-and-forget with its rejection swallowed.
    if (!sawEof) {
      try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* ignore */ }
    }
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  if (streamError) rec?.finish({ outcome: "stream_error", capture_status: "complete", usage: terminalUsage, complete: true });
  else if (terminalType === "response.completed") rec?.finish({ outcome: "ok", capture_status: "complete", usage: terminalUsage, complete: true });
  else if (terminalType === "response.incomplete") rec?.finish({ outcome: "incomplete", capture_status: "complete", usage: terminalUsage, complete: true });
  else rec?.finish({ outcome: "capture_incomplete", capture_status: "read_error" });

  logEffort(resp.status, streamError ? "stream_error" : terminalType ?? "eof_without_terminal_event");
  if (streamError) return opts.fail(502, `responses_stream_error: ${streamError}`, false);
  // EOF without a terminal event: never report success or expose partial
  // tool calls for execution.
  if (terminalType === null) return opts.fail(502, "responses_stream_incomplete: eof_without_terminal_event", false);
  // response.incomplete: billed tokens are real, but the output is truncated.
  // Not a success; no executable tool calls and no usable partial answer.
  if (terminalType === "response.incomplete") {
    if (opts.usage) {
      opts.usage.model_calls += 1;
      opts.usage.prompt_tokens += prompt_tokens;
      opts.usage.completion_tokens += completion_tokens;
      opts.usage.prompt_tokens_per_call.push(prompt_tokens);
      opts.usage.max_prompt_tokens_single_call = Math.max(opts.usage.max_prompt_tokens_single_call, prompt_tokens);
    }
    return {
      ...opts.fail(502, "responses_incomplete: truncated_output", true),
      ...(requestedEffort === "max" ? effortMetadata() : {}),
      content: "",
      tool_calls: [],
      finish_reason: "length",
      prompt_tokens,
      completion_tokens,
    };
  }

  if (opts.usage) {
    opts.usage.model_calls += 1;
    opts.usage.prompt_tokens += prompt_tokens;
    opts.usage.completion_tokens += completion_tokens;
    opts.usage.prompt_tokens_per_call.push(prompt_tokens);
    opts.usage.max_prompt_tokens_single_call = Math.max(
      opts.usage.max_prompt_tokens_single_call,
      prompt_tokens,
    );
  }

  if (requestedEffort === "max" && returnedEffort !== null && returnedEffort !== "max") {
    return {
      ...opts.fail(502, "reasoning_effort_mismatch", true),
      prompt_tokens, completion_tokens, ...effortMetadata(),
    };
  }

  return {
    ok: true,
    ...(requestedEffort === "max" ? effortMetadata() : {}),
    http_status: resp.status,
    terminal: false,
    content: text,
    tool_calls,
    finish_reason,
    prompt_tokens,
    completion_tokens,
    ...(replay
      ? seqBroken
        ? { reasoning_items: [], reasoning_items_forwarded, replay_fallback: true }
        : { reasoning_items, replay_seq, reasoning_items_forwarded }
      : {}),
  };
}

export async function chat(opts: Parameters<typeof chatGuarded>[0]): Promise<ChatResult> {
  const guard = guardProviderCall(opts.signal);
  // One heartbeat-only guard per paid model attempt (Responses or chat path).
  // It never cancels the provider call; the caller's signal is forwarded unchanged.
  try { return await chatGuarded(opts); } finally { guard.done(); }
}

async function chatGuarded(opts: {
  /** Set only by the authenticated internal pilot intake. */
  directProvider?: DirectProviderConfig;
  allowedToolNames?: string[];
  beforeDirectDispatch?: () => Promise<boolean>;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: "auto" | "required" | { name: string };
  usage?: UsageLedger;
  signal?: AbortSignal;
  /** Evaluation-only; Responses API calls only. Default "medium". */
  reasoningEffort?: EvaluationReasoningEffort;
  /** Telemetry-only role tag; never sent to the provider. */
  costStage?: CostStage;
  /** Responses API only: request + replay opaque encrypted reasoning. Ignored elsewhere. */
  replayReasoning?: boolean;
}): Promise<ChatResult> {
  const fail = (status: number, error: string, terminal = true): ChatResult => ({
    ok: false,
    http_status: status,
    error,
    terminal,
    content: "",
    tool_calls: [],
    finish_reason: null,
    prompt_tokens: 0,
    completion_tokens: 0,
  });
  if (opts.directProvider) return await directChat({ ...opts, config: opts.directProvider, responsesInput: toResponsesInput });
  // A checkpoint cannot switch provider by simply omitting its route.
  if (opts.messages.some(m => m.native_replay) ||
    (opts.costStage === "v2_research_agent" && opts.usage?.direct_provider_attempts?.length)) {
    return fail(400, "direct_provider_route_missing");
  }
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  // Defense in depth for restored checkpoints and direct internal callers.
  // Never downgrade an invalid or incompatible max request to medium.
  const effortError = reasoningEffortError(opts.model, opts.reasoningEffort);
  if (effortError) return fail(400, effortError);
  if (!apiKey) return fail(401, "LOVABLE_API_KEY missing");

  if (usesResponsesApi(opts.model)) {
    return await responsesChatGuarded({ ...opts, apiKey, fail });
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: wireMessages(opts.messages),
  };
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    if (opts.toolChoice === "required") body.tool_choice = "required";
    else if (opts.toolChoice && typeof opts.toolChoice === "object") {
      body.tool_choice = { type: "function", function: { name: opts.toolChoice.name } };
    } else body.tool_choice = "auto";
  }

  const rec: AttemptRecorder | null = beginAttempt({
    provider: "lovable_gateway", endpoint: "chat_completions", requestedModel: opts.model, stage: opts.costStage,
  });
  let resp: Response;
  try {
    resp = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    finishFetchError(rec, e);
    return fail(0, `network_error: ${e instanceof Error ? e.message : String(e)}`, false);
  }

  rec?.headers(resp.status, resp.headers);
  if (!resp.ok) {
    rec?.finish({ outcome: "http_error", capture_status: "error_body_unread" });
    const txt = await resp.text().catch(() => "");
    // Only 429/5xx are retryable; 400/401/402/403 are terminal.
    const terminal = resp.status < 429;
    return fail(resp.status, txt.slice(0, 600), terminal);
  }

  const json = await resp.json().catch(() => null) as Record<string, unknown> | null;
  if (json) {
    let u: ParsedUsage | undefined;
    try { u = parseUsage(json); } catch { /* telemetry only */ }
    rec?.finish({ outcome: "ok", capture_status: "complete", usage: u, complete: true });
  } else rec?.finish({ outcome: "parse_error", capture_status: "parse_error", complete: true });
  const choice = (json?.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const message = (choice?.message ?? {}) as Record<string, unknown>;
  const usage = (json?.usage ?? {}) as Record<string, unknown>;
  const prompt_tokens = Number(usage.prompt_tokens ?? 0) || 0;
  const completion_tokens = Number(usage.completion_tokens ?? 0) || 0;
  if (opts.usage) {
    opts.usage.model_calls += 1;
    opts.usage.prompt_tokens += prompt_tokens;
    opts.usage.completion_tokens += completion_tokens;
    opts.usage.prompt_tokens_per_call.push(prompt_tokens);
    opts.usage.max_prompt_tokens_single_call = Math.max(
      opts.usage.max_prompt_tokens_single_call,
      prompt_tokens,
    );
  }

  const rawCalls = (message.tool_calls ?? []) as Array<
    { id?: string; function?: { name?: string; arguments?: string } }
  >;
  return {
    ok: true,
    http_status: resp.status,
    terminal: false,
    content: typeof message.content === "string" ? message.content : "",
    tool_calls: rawCalls
      .filter((c) => typeof c.function?.name === "string")
      .map((c, i) => ({
        id: c.id || `call_${i}`,
        name: c.function!.name!,
        arguments: c.function?.arguments ?? "{}",
      })),
    finish_reason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
    prompt_tokens,
    completion_tokens,
  };
}

function finishFetchError(rec: AttemptRecorder | null, e: unknown) {
  const aborted = isAbortError(e);
  rec?.finish({ outcome: aborted ? "aborted" : "network_error", capture_status: aborted ? "aborted" : "not_applicable" });
}

/** Parse a JSON object out of a model message (tool args or fenced content). */
export function parseJsonLoose<T>(raw: string): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch { /* try to salvage */ }
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}
