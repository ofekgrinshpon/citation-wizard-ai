// Anthropic Messages API client with JSON tool-call helper.
// Mirrors callOpenAIJsonTool's return shape so drafterV2 can swap providers
// transparently. Harness-only at the time of writing.
//
// Includes harness-only retry for transient errors (429, 5xx, overload_error,
// network failures). Schema-level failures from a completed model call are
// NOT retried.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicToolCallResult<T> {
  data: T | null;
  raw_text: string;
  parse_error?: string;
  http_status: number;
  http_error?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  retry_attempts?: number;
  retry_reasons?: string[];
  anthropic_error_type?: string;
}

export interface AnthropicJsonToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status === 408 || status === 409 || (status >= 500 && status < 600);
}

async function singleCall<T>(
  apiKey: string,
  body: Record<string, unknown>,
  toolName: string,
): Promise<AnthropicToolCallResult<T>> {
  let resp: Response;
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      data: null,
      raw_text: "",
      parse_error: `network error: ${e instanceof Error ? e.message : String(e)}`,
      http_status: 0,
    };
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    let errType: string | undefined;
    try {
      const j = JSON.parse(txt);
      errType = j?.error?.type;
    } catch { /* ignore */ }
    return {
      data: null,
      raw_text: txt,
      http_status: resp.status,
      http_error: txt.slice(0, 500),
      anthropic_error_type: errType,
    };
  }

  const json = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
  const usageRaw = (json?.usage ?? {}) as Record<string, unknown>;
  const usage = {
    input_tokens: typeof usageRaw.input_tokens === "number" ? usageRaw.input_tokens : undefined,
    output_tokens: typeof usageRaw.output_tokens === "number" ? usageRaw.output_tokens : undefined,
  };

  const content = (json?.content ?? []) as Array<Record<string, unknown>>;
  const toolUse = content.find((b) => b?.type === "tool_use" && b?.name === toolName);

  if (!toolUse) {
    const textBlock = content.find((b) => b?.type === "text");
    const txt = typeof textBlock?.text === "string" ? (textBlock.text as string) : "";
    return {
      data: null,
      raw_text: txt,
      http_status: resp.status,
      parse_error: "no tool_use block returned",
      usage,
    };
  }

  const input = (toolUse as { input?: unknown }).input;
  return {
    data: input as T,
    raw_text: JSON.stringify(input),
    http_status: resp.status,
    usage,
  };
}

export async function callAnthropicJsonTool<T>(opts: {
  model: string;
  system: string;
  user: string;
  tool: AnthropicJsonToolSchema;
  max_tokens?: number;
  max_retries?: number;
}): Promise<AnthropicToolCallResult<T>> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return { data: null, raw_text: "", parse_error: "ANTHROPIC_API_KEY missing", http_status: 0 };
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.max_tokens ?? 8192,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    tools: [
      {
        name: opts.tool.name,
        description: opts.tool.description,
        input_schema: opts.tool.input_schema,
      },
    ],
    tool_choice: { type: "tool", name: opts.tool.name },
  };

  const maxRetries = opts.max_retries ?? 3;
  const retryReasons: string[] = [];
  let attempt = 0;
  let last: AnthropicToolCallResult<T> | null = null;

  while (attempt <= maxRetries) {
    const res = await singleCall<T>(apiKey, body, opts.tool.name);
    last = res;
    const transientHttp = res.http_status === 0 || isTransientStatus(res.http_status);
    const overload = res.anthropic_error_type === "overloaded_error" ||
      res.anthropic_error_type === "rate_limit_error" ||
      res.anthropic_error_type === "api_error";
    const shouldRetry = (transientHttp || overload) && attempt < maxRetries;
    if (!shouldRetry) {
      return { ...res, retry_attempts: attempt, retry_reasons: retryReasons };
    }
    const reason = res.http_status === 0
      ? `network:${res.parse_error ?? "unknown"}`
      : `${res.http_status}:${res.anthropic_error_type ?? "transient"}`;
    retryReasons.push(reason);
    attempt++;
    // Exponential backoff with jitter: 2s, 5s, 12s
    const backoffMs = Math.min(15000, 2000 * Math.pow(2.2, attempt - 1)) + Math.floor(Math.random() * 1000);
    await new Promise((r) => setTimeout(r, backoffMs));
  }

  return { ...(last as AnthropicToolCallResult<T>), retry_attempts: attempt, retry_reasons: retryReasons };
}
