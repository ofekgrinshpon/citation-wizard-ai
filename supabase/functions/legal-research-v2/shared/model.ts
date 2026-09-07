/**
 * legal-research-v2 — minimal Lovable AI Gateway chat client.
 *
 * One client for all three model roles (agent / verifier / drafter). Model ids
 * are configuration, never architecture: every role reads an env override and
 * falls back to a documented default.
 */

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
}

export function newUsageLedger(): UsageLedger {
  return { model_calls: 0, prompt_tokens: 0, completion_tokens: 0 };
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
