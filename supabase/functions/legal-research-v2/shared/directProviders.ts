/** Native, internal-only provider boundary. No retry, fallback, or content logging. */
import type { ChatMessage, ChatResult, ChatToolCall, ToolSpec, UsageLedger } from "./model.ts";
import { DIRECT_LIMITS, DIRECT_MODELS, directProviderConfigError, type DirectProviderConfig } from "./directProviderPolicy.ts";
import { emptyDirectUsage, nativeUsage, object, safeProviderId, type DirectAttempt } from "./directProviderUsage.ts";

declare const Deno: { env: { get(key: string): string | undefined } };
type Json = Record<string, unknown>;
export interface NativeReplay {
  provider: "anthropic";
  model: "claude-opus-5-5";
  /** Native blocks stay only in the protected checkpoint, never telemetry/UI. */
  blocks: Json[];
  prefix_hash: string;
}
interface DirectOptions {
  config: DirectProviderConfig;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: "auto" | "required" | { name: string };
  /** When policy permits memo OR confirm, validate all before any tool executes. */
  allowedToolNames?: string[];
  usage?: UsageLedger;
  /** Persists the pending attempt and current state BEFORE any paid dispatch. */
  beforeDirectDispatch?: () => Promise<boolean>;
  signal?: AbortSignal;
  reasoningEffort?: unknown;
  responsesInput: (messages: ChatMessage[], replay: boolean) => Json[];
}
const fail = (status: number, error: string): ChatResult => ({
  ok: false, http_status: status, error, terminal: true, content: "", tool_calls: [],
  finish_reason: null, prompt_tokens: 0, completion_tokens: 0,
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function bad(code: string): never { throw new Error(code); }
const safeError = (e: unknown) => e instanceof Error && /^direct_[a-z_]+$/.test(e.message) ? e.message : "direct_invalid_output";
function requireString(value: unknown, code = "direct_invalid_output"): string {
  if (typeof value !== "string") bad(code);
  return value as string;
}
async function digest(value: unknown): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(result)].map(x => x.toString(16).padStart(2, "0")).join("");
}

/** Verify complete call/result groups before sending or replaying a history. */
export function validateToolHistory(messages: ChatMessage[]): void {
  const pending = new Set<string>();
  for (const m of messages) {
    if (m.role === "tool") {
      if (!m.tool_call_id || !pending.delete(m.tool_call_id)) bad("direct_orphan_tool_result");
      continue;
    }
    if (pending.size) bad("direct_missing_tool_result");
    if (m.role === "assistant") {
      for (const c of m.tool_calls ?? []) {
        if (!safeProviderId(c.id) || pending.has(c.id)) bad("direct_duplicate_tool_id");
        pending.add(c.id);
      }
    }
  }
  if (pending.size) bad("direct_missing_tool_result");
}

/** Validate the concrete JSON-schema subset used by V2 tools, without coercion. */
export function matchesToolSchema(value: unknown, raw: unknown): boolean {
  const s = object(raw);
  if (Array.isArray(s.enum) && !s.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) return false;
  if (Array.isArray(s.anyOf) && !s.anyOf.some(x => matchesToolSchema(value, x))) return false;
  if (Array.isArray(s.allOf) && !s.allOf.every(x => matchesToolSchema(value, x))) return false;
  const type = s.type;
  if (Array.isArray(type)) return type.some(t => matchesToolSchema(value, { ...s, type: t }));
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const v = value as Json, props = object(s.properties);
    if (Array.isArray(s.required) && !s.required.every(k => typeof k === "string" && Object.prototype.hasOwnProperty.call(v, k))) return false;
    return Object.entries(v).every(([k, x]) => Object.prototype.hasOwnProperty.call(props, k)
      ? matchesToolSchema(x, props[k]) : s.additionalProperties !== false);
  }
  if (type === "array") return Array.isArray(value) &&
    (typeof s.minItems !== "number" || value.length >= s.minItems) &&
    (typeof s.maxItems !== "number" || value.length <= s.maxItems) && value.every(x => matchesToolSchema(x, s.items));
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "null") return value === null;
  if (type === "integer" || type === "number") return typeof value === "number" && Number.isFinite(value) &&
    (type !== "integer" || Number.isSafeInteger(value)) &&
    (typeof s.minimum !== "number" || value >= s.minimum) && (typeof s.maximum !== "number" || value <= s.maximum);
  return type === undefined;
}
function validateCalls(calls: ChatToolCall[], opts: DirectOptions): void {
  const ids = new Set<string>();
  const allowed = opts.allowedToolNames ?? (typeof opts.toolChoice === "object" ? [opts.toolChoice.name] : undefined);
  if (opts.toolChoice && opts.toolChoice !== "auto" && !calls.length) bad("direct_required_memo_missing");
  for (const call of calls) {
    if (!safeProviderId(call.id) || ids.has(call.id)) bad("direct_duplicate_tool_id");
    ids.add(call.id);
    const tool = opts.tools?.find(t => t.name === call.name);
    if (!tool || (allowed && !allowed.includes(call.name))) bad("direct_disallowed_tool");
    let args: unknown;
    try { args = JSON.parse(call.arguments); } catch { bad("direct_invalid_tool_arguments"); }
    if (!matchesToolSchema(args, tool!.parameters)) bad("direct_invalid_tool_arguments");
  }
}

/** Direct Responses never uses the gateway's optional replay fallback. */
export function directResponsesInput(messages: ChatMessage[], fallback: DirectOptions["responsesInput"]): Json[] {
  const input: Json[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") { input.push(...fallback([message], false)); continue; }
    const items = message.reasoning_items ?? [], calls = message.tool_calls ?? [], seq = message.replay_seq;
    if (!seq) {
      if (items.length || calls.length) bad("direct_missing_native_replay");
      input.push(...fallback([message], false)); continue;
    }
    let ri = 0, texts = 0; const seen = new Set<string>();
    for (const token of seq) {
      if (token === "r") {
        const r = items[ri++];
        if (!r || r.type !== "reasoning" || typeof r.encrypted_content !== "string" || !r.encrypted_content ||
          r.encrypted_content.length > 512_000 || (r.id !== undefined && !safeProviderId(r.id))) bad("direct_invalid_reasoning_replay");
        input.push({ ...r, summary: [] });
      } else if (token === "t") {
        if (++texts !== 1 || !message.content) bad("direct_invalid_reasoning_replay");
        input.push({ role: "assistant", content: [{ type: "output_text", text: message.content }] });
      } else if (typeof token === "string" && token.startsWith("c:")) {
        const id = token.slice(2), call = calls.find(c => c.id === id);
        if (!call || seen.has(id)) bad("direct_invalid_reasoning_replay");
        seen.add(id); input.push({ type: "function_call", call_id: id, name: call.function.name, arguments: call.function.arguments });
      } else bad("direct_invalid_reasoning_replay");
    }
    if (ri !== items.length || texts !== (message.content ? 1 : 0) || seen.size !== calls.length) bad("direct_invalid_reasoning_replay");
  }
  return input;
}

/** Anthropic content is replayed exactly; never converted to OpenAI reasoning. */
function validateAnthropicBlocks(blocks: unknown): { blocks: Json[]; calls: ChatToolCall[]; text: string } {
  if (!Array.isArray(blocks)) bad("direct_invalid_blocks");
  let text = ""; const calls: ChatToolCall[] = [];
  for (const raw of blocks as unknown[]) {
    const b = object(raw);
    if (b.type === "text") text += requireString(b.text);
    else if (b.type === "thinking") { requireString(b.thinking); if (!requireString(b.signature)) bad("direct_missing_signature"); }
    else if (b.type === "redacted_thinking") { if (!requireString(b.data)) bad("direct_missing_signature"); }
    else if (b.type === "tool_use") {
      if (!b.input || typeof b.input !== "object" || Array.isArray(b.input)) bad("direct_invalid_tool_arguments");
      calls.push({ id: requireString(b.id), name: requireString(b.name), arguments: JSON.stringify(b.input) });
    } else bad("direct_unsupported_block");
  }
  return { blocks: clone(blocks as Json[]), calls, text };
}
function callsEqual(a: ChatToolCall[], m: ChatMessage): boolean {
  const b = m.tool_calls ?? [];
  return a.length === b.length && a.every((c, i) => {
    let args: unknown; try { args = JSON.parse(b[i].function.arguments); } catch { return false; }
    return c.id === b[i].id && c.name === b[i].function.name && JSON.stringify(JSON.parse(c.arguments)) === JSON.stringify(args);
  });
}
export async function anthropicBody(opts: DirectOptions): Promise<{ body: Json; prefixHash: string }> {
  validateToolHistory(opts.messages);
  const system = opts.messages.filter(m => m.role === "system").map(m => ({ type: "text", text: m.content }));
  if (system.length) Object.assign(system[system.length - 1], { cache_control: { type: "ephemeral", ttl: "5m" } });
  const tools = (opts.tools ?? []).map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const messages: Array<{ role: "user" | "assistant"; content: Json[] }> = [];
  let started = false;
  const envelope = () => ({ model: DIRECT_MODELS.anthropic, system, tools, messages });
  const append = (role: "user" | "assistant", content: Json[]) => {
    if (messages.at(-1)?.role === role) messages.at(-1)!.content.push(...content);
    else messages.push({ role, content });
  };
  for (const m of opts.messages) {
    if (m.reasoning_items?.length) bad("direct_cross_provider_replay");
    if (m.role === "system") { if (started) bad("direct_late_system_message"); continue; }
    started = true;
    if (m.role === "user") append("user", [{ type: "text", text: m.content }]);
    else if (m.role === "tool") append("user", [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content }]);
    else {
      if (m.native_replay) {
        const r = m.native_replay;
        if (r.provider !== "anthropic" || r.model !== DIRECT_MODELS.anthropic) bad("direct_cross_provider_replay");
        const parsed = validateAnthropicBlocks(r.blocks);
        if (parsed.text !== m.content || !callsEqual(parsed.calls, m)) bad("direct_replay_changed");
        if (r.prefix_hash !== await digest(envelope())) bad("direct_replay_prefix_changed");
        append("assistant", parsed.blocks);
      } else {
        // A prior native tool turn without its signed blocks is a broken checkpoint.
        if (m.tool_calls?.length) bad("direct_missing_native_replay");
        append("assistant", [{ type: "text", text: m.content }]);
      }
    }
  }
  if (!messages.length || messages[0].role !== "user" || messages.at(-1)!.role !== "user") bad("direct_invalid_history");
  return { prefixHash: await digest(envelope()), body: {
    ...envelope(), max_tokens: opts.config.max_output_tokens, stream: true,
    service_tier: "standard_only", thinking: { type: "adaptive" }, output_config: { effort: "medium" },
    // Opus 5.5 rejects any/tool. Local policy validation is mandatory instead.
    ...(tools.length ? { tool_choice: { type: "auto" } } : {}),
  } };
}

/** Framed SSE, bounded by bytes/time, cancels on terminal or error, never returns partial tools. */
async function readEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal, handle: (event: Json) => boolean): Promise<void> {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = "", lines: string[] = [], bytes = 0, terminal = false;
  const onAbort = () => { try { void reader.cancel().catch(() => {}); } catch { /* cleanup only */ } };
  signal.addEventListener("abort", onAbort, { once: true });
  const dispatch = () => {
    if (!lines.length) return;
    const payload = lines.join("\n"); lines = [];
    if (payload === "[DONE]") return;
    let event: unknown; try { event = JSON.parse(payload); } catch { bad("direct_malformed_sse"); }
    terminal = handle(object(event));
  };
  const line = (raw: string) => {
    raw = raw.replace(/\r$/, "");
    if (raw === "") dispatch();
    else if (raw.startsWith("data:")) lines.push(raw.slice(5).replace(/^ /, ""));
  };
  try {
    while (!terminal) {
      if (signal.aborted) bad("direct_aborted");
      const next = await reader.read();
      if (signal.aborted) bad("direct_aborted");
      if (next.done) { buffer += decoder.decode(); if (buffer) line(buffer); dispatch(); break; }
      bytes += next.value.byteLength;
      if (bytes > DIRECT_LIMITS.maxResponseBytes) bad("direct_response_limit");
      buffer += decoder.decode(next.value, { stream: true });
      let nl: number;
      while (!terminal && (nl = buffer.indexOf("\n")) !== -1) { line(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
    }
    if (!terminal) bad("direct_eof_without_terminal");
  } finally {
    signal.removeEventListener("abort", onAbort);
    try { void reader.cancel().catch(() => {}); } catch { /* cleanup only */ }
    try { reader.releaseLock(); } catch { /* cleanup only */ }
  }
}

export async function directChat(opts: DirectOptions): Promise<ChatResult> {
  const { provider } = opts.config;
  const configError = directProviderConfigError(opts.config, opts.model, opts.reasoningEffort);
  if (configError) return fail(400, configError);
  // This gate remains unset in production. Enabling it requires separate rollout/budget approval.
  if (Deno.env.get("V2_DIRECT_PROVIDER_PILOT") !== provider) return fail(403, "direct_provider_pilot_disabled");
  if (!opts.usage) return fail(400, "direct_usage_ledger_required");
  if (!opts.beforeDirectDispatch) return fail(400, "direct_checkpoint_required");
  if (opts.usage.direct_provider_failed) return fail(409, "direct_pilot_already_failed");
  if (opts.usage.direct_provider_attempts?.some(a => ["pending", "network_unknown", "stream_unknown", "aborted_unknown"].includes(a.outcome))) {
    return fail(409, "direct_attempt_reconciliation_required");
  }
  if (opts.usage.direct_provider_attempts?.some(a => a.provider !== provider)) return fail(400, "direct_provider_route_changed");
  if ((opts.usage.direct_provider_attempts?.length ?? 0) >= DIRECT_LIMITS.maxAttempts) return fail(400, "direct_attempt_limit");
  let body: Json, prefixHash = "";
  try {
    validateToolHistory(opts.messages);
    if (provider === "anthropic") ({ body, prefixHash } = await anthropicBody(opts));
    else {
      if (opts.messages.some(m => m.native_replay)) bad("direct_cross_provider_replay");
      const input = directResponsesInput(opts.messages, opts.responsesInput);
      body = {
        model: "gpt-6-astra", input, stream: true, store: false,
        include: ["reasoning.encrypted_content"], reasoning: { effort: "medium", summary: "auto" },
        max_output_tokens: opts.config.max_output_tokens, service_tier: "default",
        ...(opts.tools?.length ? {
          tools: opts.tools.map(t => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false })),
          tool_choice: typeof opts.toolChoice === "object" ? { type: "function", name: opts.toolChoice.name } : (opts.toolChoice ?? "auto"),
        } : {}),
      };
    }
  } catch (e) { return fail(400, safeError(e)); }
  const payload = JSON.stringify(body!);
  if (new TextEncoder().encode(payload).length > DIRECT_LIMITS.maxRequestBytes) return fail(400, "direct_request_limit");
  const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const apiKey = Deno.env.get(keyName);
  if (!apiKey) return fail(401, "direct_provider_key_missing");
  if (opts.signal?.aborted) return fail(499, "direct_aborted_before_dispatch");
  const wireModel = provider === "anthropic" ? DIRECT_MODELS.anthropic : "gpt-6-astra";
  const attempt: DirectAttempt = {
    ...emptyDirectUsage(), attempt_id: crypto.randomUUID(), provider, endpoint: provider === "anthropic" ? "messages" : "responses",
    requested_model: wireModel, response_model: null, provider_request_id: null, provider_response_id: null,
    http_status: 0, duration_ms: 0, outcome: "pending", price_version: "direct-standard-2026-10-03", effort: "medium", usage_complete: false,
  };
  (opts.usage.direct_provider_attempts ??= []).push(attempt);
  let checkpointed = false;
  try { checkpointed = await opts.beforeDirectDispatch(); } catch { /* fail before dispatch */ }
  if (!checkpointed) { attempt.outcome = "not_sent"; return fail(503, "direct_checkpoint_failed"); }
  if (opts.signal?.aborted) { attempt.outcome = "not_sent"; return fail(499, "direct_aborted_before_dispatch"); }
  opts.usage.model_calls += 1;
  const started = Date.now(), controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), DIRECT_LIMITS.timeoutMs);
  let result = fail(502, "direct_unknown_failure");
  let responseStarted = false;
  const recordUsage = (usage: unknown) => {
    Object.assign(attempt, nativeUsage(provider, usage));
    attempt.usage_complete = attempt.input_tokens !== null && attempt.output_tokens !== null;
  };
  try {
    const resp = await fetch(provider === "anthropic" ? "https://api.anthropic.com/v1/messages" : "https://api.openai.com/v1/responses", {
      method: "POST", headers: provider === "anthropic" ? {
        "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json",
      } : { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: payload, signal: controller.signal,
    });
    responseStarted = true;
    attempt.http_status = resp.status;
    attempt.provider_request_id = safeProviderId(resp.headers.get(provider === "anthropic" ? "request-id" : "x-request-id"));
    if (!resp.ok || !resp.body) {
      attempt.outcome = "http_error";
      // Error bodies can contain prompts or secrets: do not read, persist, or return them.
      try { void resp.body?.cancel().catch(() => {}); } catch { /* cleanup only */ }
      result = fail(resp.status, "direct_http_error");
    } else if (provider === "anthropic") {
      const blocks: Json[] = [], open = new Set<number>(), jsonParts = new Map<number, string>();
      let seenStart = false, seenStop = false, stop: unknown = null, rawUsage: Json = {};
      await readEvents(resp.body, controller.signal, event => {
        if (event.type === "ping") return false;
        if (event.type === "error") bad("direct_provider_stream_error");
        if (event.type === "message_start") {
          if (seenStart) bad("direct_invalid_stream_order");
          seenStart = true; const m = object(event.message);
          attempt.response_model = safeProviderId(m.model);
          if (m.model !== wireModel) { attempt.outcome = "model_mismatch"; bad("direct_model_mismatch"); }
          attempt.provider_response_id = safeProviderId(m.id);
          rawUsage = object(m.usage);
        } else if (!seenStart) bad("direct_invalid_stream_order");
        else if (event.type === "content_block_start") {
          const i = event.index;
          if (!Number.isSafeInteger(i) || i !== blocks.length) bad("direct_invalid_stream_order");
          blocks.push(clone(object(event.content_block))); open.add(i as number);
        } else if (event.type === "content_block_delta") {
          const i = event.index as number; if (!open.has(i)) bad("direct_invalid_stream_order");
          const d = object(event.delta), b = blocks[i];
          if (d.type === "text_delta" && b.type === "text") b.text = requireString(b.text) + requireString(d.text);
          else if (d.type === "thinking_delta" && b.type === "thinking") b.thinking = requireString(b.thinking) + requireString(d.thinking);
          else if (d.type === "signature_delta" && b.type === "thinking") b.signature = (typeof b.signature === "string" ? b.signature : "") + requireString(d.signature);
          else if (d.type === "input_json_delta" && b.type === "tool_use") jsonParts.set(i, (jsonParts.get(i) ?? "") + requireString(d.partial_json));
          else bad("direct_unsupported_delta");
        } else if (event.type === "content_block_stop") {
          const i = event.index as number; if (!open.delete(i)) bad("direct_invalid_stream_order");
          if (jsonParts.has(i)) { try { blocks[i].input = JSON.parse(jsonParts.get(i)!); } catch { bad("direct_invalid_tool_arguments"); } }
        } else if (event.type === "message_delta") {
          // message_start.output_tokens is provisional; only terminal delta is final.
          const finalUsage = object(event.usage);
          rawUsage = { ...rawUsage, ...finalUsage, output_tokens: finalUsage.output_tokens };
          stop = object(event.delta).stop_reason; seenStop = true;
        } else if (event.type === "message_stop") {
          if (!seenStop || open.size) bad("direct_invalid_stream_order");
          recordUsage(rawUsage); return true;
        } else bad("direct_unsupported_event");
        return false;
      });
      if (stop === "max_tokens") { attempt.outcome = "incomplete"; result = fail(502, "direct_truncated_output"); }
      else if (stop === "refusal") { attempt.outcome = "refusal"; result = fail(422, "direct_provider_refusal"); }
      else if (stop !== "tool_use" && stop !== "end_turn") { attempt.outcome = "invalid_output"; result = fail(502, "direct_unsupported_stop"); }
      else {
        const parsed = validateAnthropicBlocks(blocks);
        validateCalls(parsed.calls, opts);
        if ((stop === "tool_use") !== (parsed.calls.length > 0)) bad("direct_invalid_stop");
        attempt.outcome = "ok";
        result = { ok: true, http_status: resp.status, terminal: false, content: parsed.text, tool_calls: parsed.calls,
          finish_reason: parsed.calls.length ? "tool_calls" : "stop", prompt_tokens: attempt.input_tokens ?? 0,
          completion_tokens: attempt.output_tokens ?? 0,
          native_replay: { provider: "anthropic", model: DIRECT_MODELS.anthropic, blocks: parsed.blocks, prefix_hash: prefixHash },
        };
      }
    } else {
      let terminal: Json = {}, terminalType = "";
      await readEvents(resp.body, controller.signal, event => {
        if (["response.completed", "response.incomplete", "response.failed"].includes(String(event.type))) {
          terminal = object(event.response); terminalType = String(event.type); return true;
        }
        if (event.type === "error") bad("direct_provider_stream_error");
        return false;
      });
      attempt.response_model = safeProviderId(terminal.model);
      attempt.provider_response_id = safeProviderId(terminal.id);
      recordUsage({ ...object(terminal.usage), ...(terminal.service_tier ? { service_tier: terminal.service_tier } : {}) });
      if (terminal.model !== wireModel) { attempt.outcome = "model_mismatch"; result = fail(502, "direct_model_mismatch"); }
      else if (terminalType !== "response.completed" || terminal.status !== "completed") {
        attempt.outcome = terminalType === "response.incomplete" ? "incomplete" : "invalid_output";
        result = fail(502, "direct_incomplete_response");
      } else {
        if (!Array.isArray(terminal.output)) bad("direct_invalid_output");
        const calls: ChatToolCall[] = [], reasoning: NonNullable<ChatResult["reasoning_items"]> = [], seq: string[] = [];
        let text = "";
        for (const raw of terminal.output) {
          const b = object(raw);
          if (b.type === "function_call") {
            const id = requireString(b.call_id); calls.push({ id, name: requireString(b.name), arguments: requireString(b.arguments) }); seq.push(`c:${id}`);
          } else if (b.type === "reasoning") {
            const encrypted = requireString(b.encrypted_content);
            if (!encrypted || encrypted.length > 512_000) bad("direct_invalid_reasoning_item");
            reasoning.push({ type: "reasoning", encrypted_content: encrypted, ...(safeProviderId(b.id) ? { id: b.id as string } : {}) }); seq.push("r");
          } else if (b.type === "message") {
            if (seq.includes("t") || !Array.isArray(b.content)) bad("direct_invalid_output");
            for (const part of b.content) {
              const p = object(part); if (p.type === "refusal") { attempt.outcome = "refusal"; bad("direct_provider_refusal"); }
              if (p.type !== "output_text") bad("direct_unsupported_block");
              text += requireString(p.text);
            }
            if (text) seq.push("t");
          } else bad("direct_unsupported_block");
        }
        const effort = object(terminal.reasoning).effort;
        if (effort !== undefined && effort !== "medium") bad("direct_reasoning_effort_mismatch");
        validateCalls(calls, opts); attempt.outcome = "ok";
        result = { ok: true, http_status: resp.status, terminal: false, content: text, tool_calls: calls,
          finish_reason: calls.length ? "tool_calls" : "stop", prompt_tokens: attempt.input_tokens ?? 0,
          completion_tokens: attempt.output_tokens ?? 0, reasoning_items: reasoning, replay_seq: seq,
          reasoning_items_forwarded: (body!.input as Json[]).filter(x => x.type === "reasoning").length,
        };
      }
    }
    if (result.ok && !attempt.usage_complete) { attempt.outcome = "usage_missing"; result = fail(502, "direct_usage_missing"); }
  } catch (e) {
    if (attempt.outcome === "pending") attempt.outcome = controller.signal.aborted ? "aborted_unknown" : responseStarted ? "stream_unknown" : "network_unknown";
    result = fail(controller.signal.aborted ? 499 : 502, controller.signal.aborted ? "direct_aborted" : safeError(e));
  } finally {
    clearTimeout(timeout); opts.signal?.removeEventListener("abort", onAbort);
    attempt.duration_ms = Math.max(0, Date.now() - started);
    if (attempt.response_model !== wireModel) {
      attempt.estimated_usd = null;
      attempt.estimate_complete = false;
    }
    if (attempt.input_tokens !== null) {
      opts.usage.prompt_tokens += attempt.input_tokens;
      opts.usage.prompt_tokens_per_call.push(attempt.input_tokens);
      opts.usage.max_prompt_tokens_single_call = Math.max(opts.usage.max_prompt_tokens_single_call, attempt.input_tokens);
    }
    if (attempt.output_tokens !== null) opts.usage.completion_tokens += attempt.output_tokens;
    // Fixed fields only. No prompts, tool args, response bodies, secrets, or replay blobs.
    console.info(JSON.stringify({ event: "v2_direct_provider_attempt", ...attempt }));
  }
  return { ...result, prompt_tokens: attempt.input_tokens ?? 0, completion_tokens: attempt.output_tokens ?? 0, direct_attempt: attempt };
}
