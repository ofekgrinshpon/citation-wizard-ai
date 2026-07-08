// Lovable AI Gateway client with JSON tool-call helper.
// All OpenAI calls in legal-research-v1 go through here.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface ToolCallResult<T> {
  data: T | null;
  raw_text: string;
  parse_error?: string;
  http_status: number;
  http_error?: string;
}

export interface JsonToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export async function callOpenAIJsonTool<T>(opts: {
  model: string;
  system: string;
  user: string;
  tool: JsonToolSchema;
  // optional: reasoning effort, defaults to none for mini, "medium" for full
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  // optional: cap the completion token budget (reasoning + visible output).
  // Passed through as `max_completion_tokens` — correct field for the gpt-5
  // family on the Lovable AI Gateway.
  maxCompletionTokens?: number;
}): Promise<ToolCallResult<T>> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return { data: null, raw_text: "", parse_error: "LOVABLE_API_KEY missing", http_status: 0 };
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: opts.tool.name,
          description: opts.tool.description,
          parameters: opts.tool.parameters,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: opts.tool.name } },
  };
  // NOTE: `reasoning` parameter is intentionally NOT sent. The Lovable AI
  // Gateway returns 400 "Unknown parameter: 'reasoning'" for the gpt-5
  // family on /v1/chat/completions. The `reasoningEffort` option is kept
  // on the interface for future compatibility but currently a no-op.
  void opts.reasoningEffort;

  let resp: Response;
  try {
    resp = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
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

  const json = await resp.json().catch(() => null) as Record<string, unknown> | null;
  const choice = (json?.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const message = (choice?.message ?? {}) as Record<string, unknown>;
  const toolCalls = (message.tool_calls ?? []) as Array<{
    function?: { name?: string; arguments?: string };
  }>;
  const argStr =
    toolCalls.find((tc) => tc.function?.name === opts.tool.name)?.function?.arguments ?? "";

  if (!argStr) {
    const content = typeof message.content === "string" ? message.content : "";
    return {
      data: null,
      raw_text: content,
      http_status: resp.status,
      parse_error: "no tool_call arguments returned",
    };
  }

  try {
    const parsed = JSON.parse(argStr) as T;
    return { data: parsed, raw_text: argStr, http_status: resp.status };
  } catch (e) {
    return {
      data: null,
      raw_text: argStr,
      http_status: resp.status,
      parse_error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
