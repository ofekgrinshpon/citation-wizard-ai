// Lovable AI Gateway client with JSON tool-call helper.
// All OpenAI calls in legal-research-v1 go through here.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface ToolCallResult<T> {
  data: T | null;
  raw_text: string;
  parse_error?: string;
  http_status: number;
  http_error?: string;
  /** "stop" | "tool_calls" | "length" | null — "length" means the completion
   *  budget was exhausted (usually by reasoning tokens) before any output. */
  finish_reason?: string | null;
  reasoning_tokens?: number;
  completion_tokens?: number;
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
  // NOTE: the nested `reasoning` object is intentionally NOT sent — the
  // gateway returns 400 "Unknown parameter: 'reasoning'" for the gpt-5 family
  // on /v1/chat/completions. The flat chat-completions field
  // `reasoning_effort` IS accepted and verified against the gateway; it caps
  // the reasoning spend so the tool call actually fits in the token budget.
  if (opts.reasoningEffort) {
    body.reasoning_effort = opts.reasoningEffort;
  }

  if (typeof opts.maxCompletionTokens === "number" && opts.maxCompletionTokens > 0) {
    body.max_completion_tokens = Math.floor(opts.maxCompletionTokens);
  }



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
  const finish_reason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
  const usage = (json?.usage ?? {}) as Record<string, unknown>;
  const reasoning_tokens = Number(
    (usage.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens ?? 0,
  ) || 0;
  const completion_tokens = Number(usage.completion_tokens ?? 0) || 0;

  const toolCalls = (message.tool_calls ?? []) as Array<{
    function?: { name?: string; arguments?: string };
  }>;
  // Accept the named tool first; fall back to any single returned tool call
  // (reasoning models occasionally echo a slightly different name).
  const argStr =
    toolCalls.find((tc) => tc.function?.name === opts.tool.name)?.function?.arguments ??
      (toolCalls.length === 1 ? toolCalls[0]?.function?.arguments ?? "" : "");

  const content = typeof message.content === "string" ? message.content : "";

  if (!argStr) {
    // Some responses put the JSON in content instead of in a tool call.
    const fenced = content.match(/\{[\s\S]*\}/);
    if (fenced) {
      try {
        const parsed = JSON.parse(fenced[0]) as T;
        return {
          data: parsed,
          raw_text: content,
          http_status: resp.status,
          finish_reason,
          reasoning_tokens,
          completion_tokens,
        };
      } catch { /* fall through to the error below */ }
    }
    return {
      data: null,
      raw_text: content,
      http_status: resp.status,
      finish_reason,
      reasoning_tokens,
      completion_tokens,
      parse_error: finish_reason === "length"
        // The whole completion budget was spent on reasoning tokens before the
        // model emitted the tool call — a budget bug, not a model refusal.
        ? "tool_call_truncated_by_token_budget"
        : "no tool_call arguments returned",
    };
  }

  try {
    const parsed = JSON.parse(argStr) as T;
    return {
      data: parsed,
      raw_text: argStr,
      http_status: resp.status,
      finish_reason,
      reasoning_tokens,
      completion_tokens,
    };
  } catch (e) {
    return {
      data: null,
      raw_text: argStr,
      http_status: resp.status,
      finish_reason,
      reasoning_tokens,
      completion_tokens,
      parse_error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
