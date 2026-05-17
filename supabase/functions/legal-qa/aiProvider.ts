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

// Helpers — extract the openai-side and gemini-side model names from a stage
// config that lists primary/fallback. We can't assume `primary` is OpenAI
// anymore (decomposition v7 pinned primary to Gemini), so pick the first
// entry that matches each provider, falling back to the other if absent.
function pickByProvider(
  stage: { primary: string; fallback: string },
  provider: "openai" | "gemini",
): string {
  const isOpenAI = (m: string) => m.startsWith("openai/");
  const isGemini = (m: string) => m.startsWith("google/");
  const want = provider === "openai" ? isOpenAI : isGemini;
  const candidate = want(stage.primary) ? stage.primary : want(stage.fallback) ? stage.fallback : stage.primary;
  return provider === "openai" ? candidate.replace(/^openai\//, "") : candidate;
}

export const MODEL_CONFIG = {
  // Each stage exposes a provider-specific model. The actual stage routing
  // (which provider runs) is decided in callPlannerJSON by `forceProvider`
  // and OPENAI_API_KEY availability — these constants only resolve the
  // model name once the provider is chosen.
  DECOMPOSER_OPENAI: pickByProvider(LEGAL_RESEARCH_MODELS.decomposition, "openai"),
  DECOMPOSER_GEMINI: pickByProvider(LEGAL_RESEARCH_MODELS.decomposition, "gemini"),
  CLAIM_MAP_OPENAI: pickByProvider(LEGAL_RESEARCH_MODELS.claimMap, "openai"),
  CLAIM_MAP_GEMINI: pickByProvider(LEGAL_RESEARCH_MODELS.claimMap, "gemini"),
  // Legacy aliases retained for any external readers — point at decomposition.
  PLANNER_OPENAI: pickByProvider(LEGAL_RESEARCH_MODELS.decomposition, "openai"),
  PLANNER_GEMINI: pickByProvider(LEGAL_RESEARCH_MODELS.decomposition, "gemini"),
  // Drafter: final memo. Heavier reasoning preferred. Used by legacy / fallback path.
  DRAFTER_OPENAI: pickByProvider(LEGAL_RESEARCH_MODELS.drafting, "openai"),
  DRAFTER_GEMINI: pickByProvider(LEGAL_RESEARCH_MODELS.drafting, "gemini"),
  // Structured drafter (with claim map): lighter model since reasoning is pre-baked.
  STRUCTURED_DRAFTER_OPENAI: pickByProvider(LEGAL_RESEARCH_MODELS.structuredDrafting, "openai"),
  STRUCTURED_DRAFTER_GEMINI: pickByProvider(LEGAL_RESEARCH_MODELS.structuredDrafting, "gemini"),
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
  provider: "openai" | "gemini" | "perplexity";
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
  // Provider selection: respect explicit per-call override (e.g. claim_map
  // pinned to Gemini), otherwise prefer OpenAI when its key is available.
  const useOpenAI = opts.forceProvider
    ? opts.forceProvider === "openai" && Boolean(OPENAI_API_KEY)
    : Boolean(OPENAI_API_KEY);
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

  // Pilot v7.3/v7.4: maximize determinism for planner stages.
  // OpenAI gpt-5* on Chat Completions REJECTS temperature/top_p with anything
  // other than the default 1 ("Unsupported value: 'temperature' does not
  // support 0 with this model"). Only `seed` is honored. Gemini accepts all
  // three and ignores `seed` gracefully — so we send temp/top_p only when
  // we're NOT routing to OpenAI.
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
    seed: 7,
  };
  if (!useOpenAI) {
    body.temperature = 0;
    body.top_p = 1;
  }
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
 * Streaming drafter call. Tries OpenAI first (if key + supported), falls back
 * to Gemini via Lovable AI Gateway. Calls `onDelta(chunk)` for each token
 * batch as it arrives. Accumulates full text and returns the same
 * DrafterResult shape as `callDrafter`. On any stream-level failure (parse,
 * empty, network), returns `null` so the caller can fall back to the
 * non-streaming `callDrafter`.
 */
export async function callDrafterStreaming(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  timeoutMs: number,
  variant: "legacy" | "structured",
  onDelta: (chunk: string) => void,
): Promise<DrafterResult | null> {
  const openaiModel = variant === "structured" ? MODEL_CONFIG.STRUCTURED_DRAFTER_OPENAI : MODEL_CONFIG.DRAFTER_OPENAI;
  const geminiModel = variant === "structured" ? MODEL_CONFIG.STRUCTURED_DRAFTER_GEMINI : MODEL_CONFIG.DRAFTER_GEMINI;
  const promptChars = systemPrompt.length + userPrompt.length;

  if (OPENAI_API_KEY) {
    const r = await streamOnce({
      url: OPENAI_URL,
      apiKey: OPENAI_API_KEY,
      model: openaiModel,
      systemPrompt,
      userPrompt,
      maxTokens,
      timeoutMs,
      provider: "openai",
      variant,
      promptChars,
      onDelta,
    });
    if (r) return { text: r, modelUsed: openaiModel };
    console.warn(`[drafter:stream-fallback] openai_model=${openaiModel} variant=${variant} → trying gemini=${geminiModel}`);
  }

  if (!LOVABLE_API_KEY) {
    console.error(`[drafter:stream:${variant}] No LOVABLE_API_KEY — cannot fall back`);
    return null;
  }
  const g = await streamOnce({
    url: LOVABLE_URL,
    apiKey: LOVABLE_API_KEY,
    model: geminiModel,
    systemPrompt,
    userPrompt,
    maxTokens,
    timeoutMs,
    provider: "gemini",
    variant,
    promptChars,
    onDelta,
  });
  if (g) return { text: g, modelUsed: geminiModel };
  return null;
}

async function streamOnce(opts: {
  url: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  timeoutMs: number;
  provider: "openai" | "gemini";
  variant: "legacy" | "structured";
  promptChars: number;
  onDelta: (chunk: string) => void;
}): Promise<string | null> {
  const t0 = Date.now();
  try {
    const tokenParam = opts.provider === "openai" ? "max_completion_tokens" : "max_tokens";
    const body: Record<string, unknown> = {
      model: opts.model,
      [tokenParam]: opts.maxTokens,
      stream: true,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
    };
    if (opts.provider === "openai" && /^gpt-5/.test(opts.model)) {
      // Chat Completions accepts only the top-level snake_case
      // `reasoning_effort` field; the `reasoning: { effort }` block is
      // Responses-API only and is rejected here with HTTP 400.
      body.reasoning_effort = "medium";
    }
    console.log(
      `[drafter:stream:call] provider=${opts.provider} model=${opts.model} variant=${opts.variant} prompt_chars=${opts.promptChars} max_tokens=${opts.maxTokens} timeout_ms=${opts.timeoutMs}`,
    );

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await fetch(opts.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      console.error(`[drafter:stream:http_error] provider=${opts.provider} model=${opts.model} status=${res.status} duration_ms=${Date.now() - t0} body=${txt.slice(0, 200)}`);
      return null;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accum = "";
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let nlIdx: number;
      while ((nlIdx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") { done = true; break; }
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed?.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content.length > 0) {
            accum += content;
            try { opts.onDelta(content); } catch { /* swallow consumer errors */ }
          }
        } catch {
          // Partial JSON across chunks — re-buffer and wait.
          buffer = line + "\n" + buffer;
          break;
        }
      }
    }
    // Final flush
    if (buffer.trim()) {
      for (let raw of buffer.split("\n")) {
        if (!raw) continue;
        if (raw.endsWith("\r")) raw = raw.slice(0, -1);
        if (raw.startsWith(":") || raw.trim() === "") continue;
        if (!raw.startsWith("data: ")) continue;
        const jsonStr = raw.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed?.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content.length > 0) {
            accum += content;
            try { opts.onDelta(content); } catch { /* noop */ }
          }
        } catch { /* ignore leftover */ }
      }
    }

    if (accum.length < 50) {
      console.error(`[drafter:stream:empty] provider=${opts.provider} model=${opts.model} duration_ms=${Date.now() - t0} text_len=${accum.length}`);
      return null;
    }
    console.log(`[drafter:stream:ok] provider=${opts.provider} model=${opts.model} duration_ms=${Date.now() - t0} text_len=${accum.length}`);
    return accum;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    const isAbort = /aborted|abort/i.test(msg);
    console.error(`[drafter:stream:${isAbort ? "timeout" : "error"}] provider=${opts.provider} model=${opts.model} duration_ms=${Date.now() - t0} error=${msg}`);
    return null;
  }
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

  const promptChars = systemPrompt.length + userPrompt.length;

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
      variant,
      promptChars,
    });
    if (openaiResult) return { text: openaiResult, modelUsed: openaiModel };
    // Pass C: gpt-5 sometimes consumes the full max_tokens budget on
    // reasoning alone and returns empty content (finish_reason=length,
    // text_len=0). Retry ONCE with a larger budget (cap 8192) before
    // falling back to Gemini, which is producing under-cited drafts.
    const retryTokens = Math.min(8192, Math.max(maxTokens + 2048, Math.floor(maxTokens * 1.5)));
    if (retryTokens > maxTokens && /^gpt-5/.test(openaiModel)) {
      console.warn(
        `[drafter:retry] openai_model=${openaiModel} variant=${variant} prompt_chars=${promptChars} max_tokens=${maxTokens}→${retryTokens} (empty completion, retrying before fallback)`,
      );
      const retryResult = await callOnce({
        url: OPENAI_URL,
        apiKey: OPENAI_API_KEY,
        model: openaiModel,
        systemPrompt,
        userPrompt,
        maxTokens: retryTokens,
        timeoutMs,
        provider: "openai",
        variant,
        promptChars,
      });
      if (retryResult) return { text: retryResult, modelUsed: openaiModel };
    }
    // Explicit, structured fallback log so admins can grep for it. Keeps
    // the earlier `[drafter:variant]` line for backward compatibility.
    console.warn(
      `[drafter:fallback] openai_model=${openaiModel} variant=${variant} prompt_chars=${promptChars} → falling back to gemini=${geminiModel}`,
    );
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
    variant,
    promptChars,
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
  variant: "legacy" | "structured";
  promptChars: number;
}): Promise<string | null> {
  const t0 = Date.now();
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
    // Drafter hardening (2026-04-24): nudge gpt-5* to spend a moderate
    // reasoning budget. The empty-content failures we were seeing on
    // long Deep prompts (~21KB+) coincided with the model defaulting to
    // a low reasoning level and emitting `finish_reason: "length"` with
    // zero content. `medium` keeps latency reasonable while preventing
    // the silent-empty failure mode. Gemini ignores this field.
    // NOTE: Chat Completions accepts only the top-level snake_case
    // `reasoning_effort` field — the `reasoning: { effort }` block is
    // Responses-API only and is rejected here with HTTP 400.
    if (opts.provider === "openai" && /^gpt-5/.test(opts.model)) {
      body.reasoning_effort = "medium";
    }
    console.log(
      `[drafter:call] provider=${opts.provider} model=${opts.model} variant=${opts.variant} prompt_chars=${opts.promptChars} max_tokens=${opts.maxTokens} timeout_ms=${opts.timeoutMs}`,
    );
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
      console.error(`[drafter:http_error] provider=${opts.provider} model=${opts.model} status=${res.status} duration_ms=${Date.now() - t0} body=${txt.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const choice = data?.choices?.[0];
    const text = choice?.message?.content;
    const finishReason = choice?.finish_reason ?? "unknown";
    const usage = data?.usage ?? {};
    if (!text || typeof text !== "string" || text.length < 50) {
      console.error(
        `[drafter:empty] provider=${opts.provider} model=${opts.model} finish_reason=${finishReason} duration_ms=${Date.now() - t0} prompt_chars=${opts.promptChars} prompt_tokens=${usage.prompt_tokens ?? "?"} completion_tokens=${usage.completion_tokens ?? "?"} text_len=${text?.length ?? 0}`,
      );
      return null;
    }
    console.log(
      `[drafter:ok] provider=${opts.provider} model=${opts.model} finish_reason=${finishReason} duration_ms=${Date.now() - t0} text_len=${text.length} completion_tokens=${usage.completion_tokens ?? "?"}`,
    );
    return text;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    const isAbort = /aborted|abort/i.test(msg);
    console.error(`[drafter:${isAbort ? "timeout" : "error"}] provider=${opts.provider} model=${opts.model} duration_ms=${Date.now() - t0} error=${msg}`);
    return null;
  }
}

export function plannerProviderLabel(): string {
  return OPENAI_API_KEY ? MODEL_CONFIG.PLANNER_OPENAI : MODEL_CONFIG.PLANNER_GEMINI;
}
