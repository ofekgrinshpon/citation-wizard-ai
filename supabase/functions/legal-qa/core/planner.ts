// Research Core v1 — Deliverable 1: Planner.
// Thin wrapper around the Lovable AI Gateway that materializes PlanV1 JSON
// from PLANNER_SYSTEM / PLANNER_USER.
//
// Resilience: one automatic retry with a faster fallback model
// (openai/gpt-5-mini, reasoning_effort=minimal) when the primary attempt
// times out, hits 5xx/429 from the gateway, or returns unparseable /
// shape-invalid JSON. Each attempt has its own AbortController.

import type { PlanV1 } from "./types.ts";
import { PLANNER_SYSTEM, PLANNER_USER } from "./prompts.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const PRIMARY_MODEL = "openai/gpt-5";
const PRIMARY_TIMEOUT_MS = 120_000;
const PRIMARY_REASONING: "low" | "minimal" = "low";

const FALLBACK_MODEL = "openai/gpt-5-mini";
const FALLBACK_TIMEOUT_MS = 60_000;
const FALLBACK_REASONING: "low" | "minimal" = "minimal";

export interface PlanArgs {
  question: string;
  lovableApiKey: string;
  signal?: AbortSignal;
}

export interface PlanAttempt {
  model: string;
  reasoning_effort: string;
  timeout_ms: number;
  duration_ms: number;
  status: "ok" | "timeout" | "gateway_error" | "parse_error" | "shape_invalid" | "threw";
  http_status?: number;
  error?: string;
}

export interface PlanResult {
  ok: boolean;
  plan?: PlanV1;
  raw?: string;
  duration_ms: number;
  model: string;          // model that produced the (final) result
  model_used: string;     // alias of `model`, kept for telemetry consumers
  attempts: PlanAttempt[];
  error?: string;         // canonical code: planner_timeout | planner_gateway_<status> | plan_json_parse | plan_shape_invalid | planner_threw
}

interface SingleAttemptArgs {
  question: string;
  lovableApiKey: string;
  parentSignal?: AbortSignal;
  model: string;
  reasoningEffort: "low" | "minimal";
  timeoutMs: number;
}

interface SingleAttemptOutcome {
  attempt: PlanAttempt;
  plan?: PlanV1;
  raw?: string;
}

async function runSingleAttempt(args: SingleAttemptArgs): Promise<SingleAttemptOutcome> {
  const { question, lovableApiKey, parentSignal, model, reasoningEffort, timeoutMs } = args;
  const t0 = Date.now();

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onParentAbort = () => ctrl.abort();
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    const r = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        reasoning_effort: reasoningEffort,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PLANNER_SYSTEM },
          { role: "user", content: PLANNER_USER(question) },
        ],
      }),
      signal: ctrl.signal,
    });

    if (!r.ok) {
      const body = await r.text();
      return {
        attempt: {
          model, reasoning_effort: reasoningEffort, timeout_ms: timeoutMs,
          duration_ms: Date.now() - t0,
          status: "gateway_error",
          http_status: r.status,
          error: `planner_gateway_${r.status}:${body.slice(0, 200)}`,
        },
      };
    }

    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content ?? "";
    let plan: PlanV1;
    try {
      plan = JSON.parse(raw) as PlanV1;
    } catch (e) {
      return {
        attempt: {
          model, reasoning_effort: reasoningEffort, timeout_ms: timeoutMs,
          duration_ms: Date.now() - t0,
          status: "parse_error",
          error: `plan_json_parse:${(e as Error).message}`,
        },
        raw,
      };
    }

    if (
      !plan?.claims || !Array.isArray(plan.claims) || plan.claims.length === 0 ||
      !plan?.expected_authorities || !Array.isArray(plan.expected_authorities)
    ) {
      return {
        attempt: {
          model, reasoning_effort: reasoningEffort, timeout_ms: timeoutMs,
          duration_ms: Date.now() - t0,
          status: "shape_invalid",
          error: "plan_shape_invalid",
        },
        raw,
      };
    }

    return {
      attempt: {
        model, reasoning_effort: reasoningEffort, timeout_ms: timeoutMs,
        duration_ms: Date.now() - t0,
        status: "ok",
      },
      plan,
      raw,
    };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    // Parent abort (not our timer) → propagate as threw without retry.
    if (!timedOut && parentSignal?.aborted) {
      return {
        attempt: {
          model, reasoning_effort: reasoningEffort, timeout_ms: timeoutMs,
          duration_ms: Date.now() - t0,
          status: "threw",
          error: `planner_threw:${msg}`,
        },
      };
    }
    return {
      attempt: {
        model, reasoning_effort: reasoningEffort, timeout_ms: timeoutMs,
        duration_ms: Date.now() - t0,
        status: timedOut ? "timeout" : "threw",
        error: timedOut ? "planner_timeout" : `planner_threw:${msg}`,
      },
    };
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

function isRetryable(status: PlanAttempt["status"], httpStatus?: number): boolean {
  if (status === "timeout") return true;
  if (status === "parse_error" || status === "shape_invalid") return true;
  if (status === "gateway_error") {
    if (!httpStatus) return true;
    if (httpStatus === 429) return true;
    if (httpStatus >= 500) return true;
    return false;
  }
  return false;
}

export async function planResearch(args: PlanArgs): Promise<PlanResult> {
  const tStart = Date.now();
  const { question, lovableApiKey, signal } = args;

  const attempts: PlanAttempt[] = [];

  // Attempt 1 — primary model.
  const a1 = await runSingleAttempt({
    question,
    lovableApiKey,
    parentSignal: signal,
    model: PRIMARY_MODEL,
    reasoningEffort: PRIMARY_REASONING,
    timeoutMs: PRIMARY_TIMEOUT_MS,
  });
  attempts.push(a1.attempt);

  if (a1.attempt.status === "ok" && a1.plan) {
    return {
      ok: true,
      plan: a1.plan,
      raw: a1.raw,
      duration_ms: Date.now() - tStart,
      model: PRIMARY_MODEL,
      model_used: PRIMARY_MODEL,
      attempts,
    };
  }

  // Parent-aborted: don't retry.
  if (signal?.aborted) {
    return {
      ok: false,
      raw: a1.raw,
      duration_ms: Date.now() - tStart,
      model: PRIMARY_MODEL,
      model_used: PRIMARY_MODEL,
      attempts,
      error: a1.attempt.error ?? "planner_threw:parent_aborted",
    };
  }

  if (!isRetryable(a1.attempt.status, a1.attempt.http_status)) {
    return {
      ok: false,
      raw: a1.raw,
      duration_ms: Date.now() - tStart,
      model: PRIMARY_MODEL,
      model_used: PRIMARY_MODEL,
      attempts,
      error: a1.attempt.error ?? "planner_threw:unknown",
    };
  }

  console.warn(
    `[planner] attempt 1 (${PRIMARY_MODEL}) failed with status=${a1.attempt.status} err=${a1.attempt.error} — retrying with ${FALLBACK_MODEL}`,
  );

  // Attempt 2 — fallback model.
  const a2 = await runSingleAttempt({
    question,
    lovableApiKey,
    parentSignal: signal,
    model: FALLBACK_MODEL,
    reasoningEffort: FALLBACK_REASONING,
    timeoutMs: FALLBACK_TIMEOUT_MS,
  });
  attempts.push(a2.attempt);

  if (a2.attempt.status === "ok" && a2.plan) {
    return {
      ok: true,
      plan: a2.plan,
      raw: a2.raw,
      duration_ms: Date.now() - tStart,
      model: FALLBACK_MODEL,
      model_used: FALLBACK_MODEL,
      attempts,
    };
  }

  return {
    ok: false,
    raw: a2.raw ?? a1.raw,
    duration_ms: Date.now() - tStart,
    model: FALLBACK_MODEL,
    model_used: FALLBACK_MODEL,
    attempts,
    error: a2.attempt.error ?? a1.attempt.error ?? "planner_threw:unknown",
  };
}
