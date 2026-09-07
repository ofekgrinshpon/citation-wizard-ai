/**
 * legal-research-v2 — minimal Lovable AI Gateway chat client.
 *
 * One client for all three model roles (agent / verifier / drafter). Model ids
 * are configuration, never architecture: every role reads an env override and
 * falls back to a documented default.
 */

declare const Deno: { env: { get(key: string): string | undefined } };

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface ModelConfig {
  agent: string;
  verifier: string;
  drafter: string;
}

export function modelConfig(): ModelConfig {
  return {
    agent: Deno.env.get("V2_AGENT_MODEL") || "google/gemini-3.1-pro-preview",
    verifier: Deno.env.get("V2_VERIFIER_MODEL") || "google/gemini-3.7-flash",
    drafter: Deno.env.get("V2_DRAFTER_MODEL") || "google/gemini-3.1-pro-preview",
  };
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
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface ChatResult {
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
}

export interface UsageLedger {
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
function toResponsesInput(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "user") {
      input.push({ role: m.role, content: [{ type: "input_text", text: m.content ?? "" }] });
    } else if (m.role === "assistant") {
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

async function responsesChat(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: "auto" | "required" | { name: string };
  usage?: UsageLedger;
  signal?: AbortSignal;
  fail: (status: number, error: string, terminal?: boolean) => ChatResult;
}): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    input: toResponsesInput(opts.messages),
    stream: true,
    store: false,
    reasoning: { effort: "medium", summary: "auto" },
  };
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
    return opts.fail(0, `network_error: ${e instanceof Error ? e.message : String(e)}`, false);
  }
  if (!resp.ok || !resp.body) {
    const txt = await resp.text().catch(() => "");
    return opts.fail(resp.status, txt.slice(0, 600), resp.status < 429);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  const tool_calls: ChatToolCall[] = [];
  let prompt_tokens = 0;
  let completion_tokens = 0;
  let finish_reason: string | null = null;
  let streamError: string | null = null;

  const handle = (evt: Record<string, unknown>) => {
    const type = String(evt.type ?? "");
    if (type === "response.output_text.delta") {
      text += String(evt.delta ?? "");
    } else if (type === "response.output_item.done") {
      const item = (evt.item ?? {}) as Record<string, unknown>;
      if (item.type === "function_call") {
        tool_calls.push({
          id: String(item.call_id ?? item.id ?? `call_${tool_calls.length}`),
          name: String(item.name ?? ""),
          arguments: String(item.arguments ?? "{}"),
        });
      }
    } else if (type === "response.completed" || type === "response.incomplete") {
      const r = (evt.response ?? {}) as Record<string, unknown>;
      const usage = (r.usage ?? {}) as Record<string, unknown>;
      prompt_tokens = Number(usage.input_tokens ?? 0) || 0;
      completion_tokens = Number(usage.output_tokens ?? 0) || 0;
      finish_reason = type === "response.completed"
        ? (tool_calls.length ? "tool_calls" : "stop")
        : "length";
    } else if (type === "error" || type === "response.failed") {
      const r = (evt.response ?? evt) as Record<string, unknown>;
      streamError = JSON.stringify(r).slice(0, 600);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        handle(JSON.parse(payload) as Record<string, unknown>);
      } catch { /* ignore partial/non-JSON frames */ }
    }
  }

  if (streamError) return opts.fail(502, `responses_stream_error: ${streamError}`, false);

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

  return {
    ok: true,
    http_status: resp.status,
    terminal: false,
    content: text,
    tool_calls,
    finish_reason,
    prompt_tokens,
    completion_tokens,
  };
}

export async function chat(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: "auto" | "required" | { name: string };
  usage?: UsageLedger;
  signal?: AbortSignal;
}): Promise<ChatResult> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
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
  if (!apiKey) return fail(401, "LOVABLE_API_KEY missing");

  if (usesResponsesApi(opts.model)) {
    return await responsesChat({ ...opts, apiKey, fail });
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
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

  let resp: Response;
  try {
    resp = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    return fail(0, `network_error: ${e instanceof Error ? e.message : String(e)}`, false);
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    // Only 429/5xx are retryable; 400/401/402/403 are terminal.
    const terminal = resp.status < 429;
    return fail(resp.status, txt.slice(0, 600), terminal);
  }

  const json = await resp.json().catch(() => null) as Record<string, unknown> | null;
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
