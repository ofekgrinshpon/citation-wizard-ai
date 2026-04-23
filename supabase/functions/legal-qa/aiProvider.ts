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
// Authoritative config now lives in `legalResearchModels.ts`. We re-derive
// the legacy MODEL_CONFIG shape from it to preserve backward compatibility
// with the rest of this file.
import { LEGAL_RESEARCH_MODELS } from "./legalResearchModels.ts";

export const MODEL_CONFIG = {
  // Tier-1.5 split: decomposition and claim_map use DIFFERENT models. Previously
  // the shared PLANNER_OPENAI constant accidentally moved claim_map to nano when
  // we tuned decomposition; now each stage picks its own.
  DECOMPOSER_OPENAI: LEGAL_RESEARCH_MODELS.decomposition.primary.replace(/^openai\//, ""),
  DECOMPOSER_GEMINI: LEGAL_RESEARCH_MODELS.decomposition.fallback,
  CLAIM_MAP_OPENAI: LEGAL_RESEARCH_MODELS.claimMap.primary.replace(/^openai\//, ""),
  CLAIM_MAP_GEMINI: LEGAL_RESEARCH_MODELS.claimMap.fallback,
  // Legacy aliases retained for any external readers — point at decomposition.
  PLANNER_OPENAI: LEGAL_RESEARCH_MODELS.decomposition.primary.replace(/^openai\//, ""),
  PLANNER_GEMINI: LEGAL_RESEARCH_MODELS.decomposition.fallback,
  // Drafter: final memo. Heavier reasoning preferred. Used by legacy / fallback path.
  DRAFTER_OPENAI: LEGAL_RESEARCH_MODELS.drafting.primary.replace(/^openai\//, ""),
  DRAFTER_GEMINI: LEGAL_RESEARCH_MODELS.drafting.fallback,
  // Structured drafter (with claim map): lighter model since reasoning is pre-baked.
  STRUCTURED_DRAFTER_OPENAI: LEGAL_RESEARCH_MODELS.structuredDrafting.primary.replace(/^openai\//, ""),
  STRUCTURED_DRAFTER_GEMINI: LEGAL_RESEARCH_MODELS.structuredDrafting.fallback,
} as const;

export { LEGAL_RESEARCH_MODELS };

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
 * Per-stage telemetry recorded for every planner call so we can distinguish
 * "model ran successfully" from "model timed out / errored". Consumed by
 * index.ts when assembling qa_logs.metadata.stage_runs.
 */
export interface StageRun {
  stage: string;
  provider: "openai" | "gemini";
  model: string;
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
  started_at: string;
  completed_at: string;
  duration_ms: number;
  status: "success" | "timeout" | "http_error" | "parse_error" | "no_tool_call" | "no_api_key" | "error";
  http_status?: number;
  error_message?: string;
}

export interface PlannerCallResult<T> {
  data: T | null;
  run: StageRun;
}

export interface PlannerCallOptions {
  /** Logical stage name, e.g. "decomposition" / "claim_map". */
  stage: string;
  /** Hard timeout for the HTTP call. Bumped per-stage by callers. */
  timeoutMs?: number;
  /** OpenAI reasoning effort (gpt-5* family). Ignored on Gemini. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /**
   * Optional per-call OpenAI model override. When set AND OPENAI_API_KEY is
   * available, this replaces the stage-derived default. Used by the
   * decomposition retry path to escalate from nano → mini on parse_error
   * without permanently changing the stage's primary model.
   */
  openaiModelOverride?: string;
  /**
   * Pin this call to a specific provider regardless of which API keys are
   * available. Used by claim_map (Pilot v6) to force Gemini routing because
   * gpt-5-mini was the dominant latency cost (~33s) on that stage, and
   * Gemini 2.5 Flash returns the same JSON tool-call shape in ~5-10s.
   */
  forceProvider?: "openai" | "gemini";
}

/**
 * Calls the planner model with a forced tool-call to extract structured JSON.
 * Returns `{ data, run }`. `data` is null on any failure; `run` always
 * carries telemetry so the caller can log accurate per-stage state.
 */
export async function callPlannerJSON<T = unknown>(
  systemPrompt: string,
  userPrompt: string,
  tool: PlannerToolDef,
  opts: PlannerCallOptions,
): Promise<PlannerCallResult<T>> {
  const useOpenAI = Boolean(OPENAI_API_KEY);
  const url = useOpenAI ? OPENAI_URL : LOVABLE_URL;
  const apiKey = useOpenAI ? OPENAI_API_KEY : LOVABLE_API_KEY;
  // Tier-1.5: select model per stage. claim_map → mini; everything else → decomposer (nano).
  // Allow per-call override (used by decomposition retry to escalate nano → mini).
  const stageDefaultModel = opts.stage === "claim_map"
    ? (useOpenAI ? MODEL_CONFIG.CLAIM_MAP_OPENAI : MODEL_CONFIG.CLAIM_MAP_GEMINI)
    : (useOpenAI ? MODEL_CONFIG.DECOMPOSER_OPENAI : MODEL_CONFIG.DECOMPOSER_GEMINI);
  const model = (useOpenAI && opts.openaiModelOverride) ? opts.openaiModelOverride : stageDefaultModel;
  const provider: "openai" | "gemini" = useOpenAI ? "openai" : "gemini";
  const timeoutMs = opts.timeoutMs ?? 30000;
  const reasoningEffort = opts.reasoningEffort;

  const startedAt = new Date();
  const startMs = Date.now();
  const baseRun: Omit<StageRun, "status" | "completed_at" | "duration_ms"> = {
    stage: opts.stage,
    provider,
    model,
    ...(reasoningEffort && useOpenAI ? { reasoning_effort: reasoningEffort } : {}),
    started_at: startedAt.toISOString(),
  };
  const finish = (
    extra: Partial<StageRun> & { status: StageRun["status"] },
  ): StageRun => ({
    ...baseRun,
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - startMs,
    ...extra,
  });

  if (!apiKey) {
    console.log(`[${opts.stage}] No API key available — skipping`);
    return { data: null, run: finish({ status: "no_api_key" }) };
  }

  const body: Record<string, unknown> = {
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
  // NOTE: `reasoning` block intentionally NOT sent — OpenAI Chat Completions
  // for gpt-5-mini rejects it with HTTP 400 ("Unknown parameter: 'reasoning'").
  // The `reasoningEffort` field is still recorded in StageRun telemetry for
  // future use (e.g. switching to the Responses API). Gemini ignores it either way.

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
      console.error(`[${opts.stage}] HTTP ${res.status} (${provider}/${model}):`, txt.slice(0, 200));
      return { data: null, run: finish({ status: "http_error", http_status: res.status, error_message: txt.slice(0, 300) }) };
    }
    const data = await res.json();
    const argsRaw = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsRaw || typeof argsRaw !== "string") {
      console.error(`[${opts.stage}] No tool_call arguments returned`);
      return { data: null, run: finish({ status: "no_tool_call" }) };
    }
    try {
      const parsed = JSON.parse(argsRaw) as T;
      console.log(`[${opts.stage}] success in ${Date.now() - startMs}ms (${provider}/${model})`);
      return { data: parsed, run: finish({ status: "success" }) };
    } catch (parseErr) {
      const msg = (parseErr as Error).message;
      console.error(`[${opts.stage}] JSON parse failed:`, msg);
      return { data: null, run: finish({ status: "parse_error", error_message: msg }) };
    }
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    const isAbort = /aborted|abort/i.test(msg);
    console.error(`[${opts.stage}] call failed (${isAbort ? "timeout" : "error"} after ${Date.now() - startMs}ms):`, msg);
    return {
      data: null,
      run: finish({ status: isAbort ? "timeout" : "error", error_message: msg }),
    };
  }
}

export interface DrafterResult {
  text: string;
  modelUsed: string;
}

/**
 * Drafter call. Tries OpenAI first; on any failure, retries with Gemini.
 * Returns `null` only if both providers fail.
 *
 * @param variant - "legacy" (gpt-5, heavier) or "structured" (gpt-5-mini, faster).
 *                  Defaults to "legacy" for backward compatibility.
 */
export async function callDrafter(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  timeoutMs = 90000,
  variant: "legacy" | "structured" = "legacy",
): Promise<DrafterResult | null> {
  const openaiModel = variant === "structured" ? MODEL_CONFIG.STRUCTURED_DRAFTER_OPENAI : MODEL_CONFIG.DRAFTER_OPENAI;
  const geminiModel = variant === "structured" ? MODEL_CONFIG.STRUCTURED_DRAFTER_GEMINI : MODEL_CONFIG.DRAFTER_GEMINI;

  // Try OpenAI first if available.
  if (OPENAI_API_KEY) {
    const openaiResult = await callOnce({
      url: OPENAI_URL,
      apiKey: OPENAI_API_KEY,
      model: openaiModel,
      systemPrompt,
      userPrompt,
      maxTokens,
      timeoutMs,
      provider: "openai",
    });
    if (openaiResult) return { text: openaiResult, modelUsed: openaiModel };
    console.log(`[drafter:${variant}] OpenAI failed — falling back to Gemini`);
  }

  if (!LOVABLE_API_KEY) {
    console.error(`[drafter:${variant}] No LOVABLE_API_KEY — cannot fall back`);
    return null;
  }
  const geminiResult = await callOnce({
    url: LOVABLE_URL,
    apiKey: LOVABLE_API_KEY,
    model: geminiModel,
    systemPrompt,
    userPrompt,
    maxTokens,
    timeoutMs,
    provider: "gemini",
  });
  if (geminiResult) return { text: geminiResult, modelUsed: geminiModel };
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
  provider: "openai" | "gemini";
}): Promise<string | null> {
  try {
    // OpenAI's gpt-5* family on Chat Completions rejects `max_tokens`
    // ("Unsupported parameter: 'max_tokens' ... Use 'max_completion_tokens' instead").
    // Gemini (via Lovable Gateway) uses the classic `max_tokens`.
    const tokenParam = opts.provider === "openai" ? "max_completion_tokens" : "max_tokens";
    const body: Record<string, unknown> = {
      model: opts.model,
      [tokenParam]: opts.maxTokens,
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
