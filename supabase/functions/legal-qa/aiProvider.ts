// Centralized AI provider abstraction for the new Legal Research pipeline.
// Exposes callPlanner (decomposition + claim-map) and callDrafter (final draft).
//
// Strategy:
//   - If OPENAI_API_KEY is configured → use OpenAI directly.
//   - Otherwise → fall back to Lovable AI Gateway (Gemini).
// All callers must handle a `null` return as "graceful fallback to legacy path".

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

// ─── Centralized model configuration ────────────────────────────
// Swap models in one place. Names must match the actual provider catalogue.
export const MODEL_CONFIG = {
  // Planner: decomposition+plan, claim-map. Light-to-medium reasoning.
  PLANNER_OPENAI: "gpt-5-mini",
  PLANNER_GEMINI: "google/gemini-2.5-flash-lite",
  // Drafter: final memo. Heavier reasoning preferred.
  DRAFTER_OPENAI: "gpt-5",
  DRAFTER_GEMINI: "google/gemini-2.5-flash",
} as const;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface PlannerToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Calls the planner model with a forced tool-call to extract structured JSON.
 * Returns the parsed tool arguments or `null` on any failure.
 */
export async function callPlannerJSON<T = unknown>(
  systemPrompt: string,
  userPrompt: string,
  tool: PlannerToolDef,
  timeoutMs = 12000,
): Promise<T | null> {
  const useOpenAI = Boolean(OPENAI_API_KEY);
  const url = useOpenAI ? OPENAI_URL : LOVABLE_URL;
  const apiKey = useOpenAI ? OPENAI_API_KEY : LOVABLE_API_KEY;
  const model = useOpenAI ? MODEL_CONFIG.PLANNER_OPENAI : MODEL_CONFIG.PLANNER_GEMINI;

  if (!apiKey) {
    console.log("[planner] No API key available — skipping");
    return null;
  }

  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: tool.name } },
  };

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[planner] HTTP ${res.status} (${useOpenAI ? "openai" : "gemini"}):`, txt.slice(0, 200));
      return null;
    }
    const data = await res.json();
    const argsRaw = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsRaw || typeof argsRaw !== "string") {
      console.error("[planner] No tool_call arguments returned");
      return null;
    }
    try {
      return JSON.parse(argsRaw) as T;
    } catch (parseErr) {
      console.error("[planner] JSON parse failed:", (parseErr as Error).message);
      return null;
    }
  } catch (err) {
    console.error("[planner] call failed:", (err as Error).message);
    return null;
  }
}

export interface DrafterResult {
  text: string;
  modelUsed: string;
}

/**
 * Drafter call. Tries OpenAI first; on any failure, retries with Gemini.
 * Returns `null` only if both providers fail.
 */
export async function callDrafter(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  timeoutMs = 90000,
): Promise<DrafterResult | null> {
  // Try OpenAI first if available.
  if (OPENAI_API_KEY) {
    const openaiResult = await callOnce({
      url: OPENAI_URL,
      apiKey: OPENAI_API_KEY,
      model: MODEL_CONFIG.DRAFTER_OPENAI,
      systemPrompt,
      userPrompt,
      maxTokens,
      timeoutMs,
    });
    if (openaiResult) return { text: openaiResult, modelUsed: MODEL_CONFIG.DRAFTER_OPENAI };
    console.log("[drafter] OpenAI failed — falling back to Gemini");
  }

  if (!LOVABLE_API_KEY) {
    console.error("[drafter] No LOVABLE_API_KEY — cannot fall back");
    return null;
  }
  const geminiResult = await callOnce({
    url: LOVABLE_URL,
    apiKey: LOVABLE_API_KEY,
    model: MODEL_CONFIG.DRAFTER_GEMINI,
    systemPrompt,
    userPrompt,
    maxTokens,
    timeoutMs,
  });
  if (geminiResult) return { text: geminiResult, modelUsed: MODEL_CONFIG.DRAFTER_GEMINI };
  return null;
}

async function callOnce(opts: {
  url: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  timeoutMs: number;
}): Promise<string | null> {
  try {
    const body: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
    };
    const res = await fetchWithTimeout(
      opts.url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      opts.timeoutMs,
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[drafter] HTTP ${res.status} (${opts.model}):`, txt.slice(0, 200));
      return null;
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text || typeof text !== "string" || text.length < 50) {
      console.error(`[drafter] empty response from ${opts.model}`);
      return null;
    }
    return text;
  } catch (err) {
    console.error(`[drafter] ${opts.model} call failed:`, (err as Error).message);
    return null;
  }
}

export function plannerProviderLabel(): string {
  return OPENAI_API_KEY ? MODEL_CONFIG.PLANNER_OPENAI : MODEL_CONFIG.PLANNER_GEMINI;
}
