// Anthropic Messages API client with JSON tool-call helper.
// Mirrors callOpenAIJsonTool's return shape so drafterV2 can swap providers
// transparently. Harness-only at the time of writing — used by the
// gpt-5-mini vs gpt-5 vs Claude Sonnet vs Claude Opus comparison.

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
}

export interface AnthropicJsonToolSchema {
  name: string;
  description: string;
  // Same JSON-Schema object used for OpenAI tool.parameters.
  input_schema: Record<string, unknown>;
}

export async function callAnthropicJsonTool<T>(opts: {
  model: string;
  system: string;
  user: string;
  tool: AnthropicJsonToolSchema;
  max_tokens?: number;
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
    return {
      data: null,
      raw_text: txt,
      http_status: resp.status,
      http_error: txt.slice(0, 500),
    };
  }

  const json = (await resp.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  const usageRaw = (json?.usage ?? {}) as Record<string, unknown>;
  const usage = {
    input_tokens: typeof usageRaw.input_tokens === "number" ? usageRaw.input_tokens : undefined,
    output_tokens: typeof usageRaw.output_tokens === "number" ? usageRaw.output_tokens : undefined,
  };

  const content = (json?.content ?? []) as Array<Record<string, unknown>>;
  const toolUse = content.find((b) => b?.type === "tool_use" && b?.name === opts.tool.name);

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
  try {
    // Anthropic returns the tool input as a parsed object (not a JSON string).
    return {
      data: input as T,
      raw_text: JSON.stringify(input),
      http_status: resp.status,
      usage,
    };
  } catch (e) {
    return {
      data: null,
      raw_text: "",
      http_status: resp.status,
      parse_error: `tool_use input serialize failed: ${e instanceof Error ? e.message : String(e)}`,
      usage,
    };
  }
}
