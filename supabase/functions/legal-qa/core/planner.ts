// Research Core v1 — Deliverable 1: Planner.
// Thin wrapper around the Lovable AI Gateway that materializes PlanV1 JSON
// from PLANNER_SYSTEM / PLANNER_USER. No fallback to V3 planner — Core owns
// its own anchor source.

import type { PlanV1 } from "./types.ts";
import { PLANNER_SYSTEM, PLANNER_USER } from "./prompts.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "openai/gpt-5";
const TIMEOUT_MS = 90_000;

export interface PlanArgs {
  question: string;
  lovableApiKey: string;
  signal?: AbortSignal;
}

export interface PlanResult {
  ok: boolean;
  plan?: PlanV1;
  raw?: string;
  duration_ms: number;
  model: string;
  error?: string;
}

export async function planResearch(args: PlanArgs): Promise<PlanResult> {
  const t0 = Date.now();
  const { question, lovableApiKey, signal } = args;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });

  try {
    const r = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: "low",
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
        ok: false,
        duration_ms: Date.now() - t0,
        model: MODEL,
        error: `gateway_${r.status}:${body.slice(0, 200)}`,
      };
    }

    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content ?? "";
    let plan: PlanV1;
    try {
      plan = JSON.parse(raw) as PlanV1;
    } catch (e) {
      return {
        ok: false,
        raw,
        duration_ms: Date.now() - t0,
        model: MODEL,
        error: `plan_json_parse:${(e as Error).message}`,
      };
    }

    if (
      !plan?.claims || !Array.isArray(plan.claims) || plan.claims.length === 0 ||
      !plan?.expected_authorities || !Array.isArray(plan.expected_authorities)
    ) {
      return {
        ok: false,
        raw,
        duration_ms: Date.now() - t0,
        model: MODEL,
        error: "plan_shape_invalid",
      };
    }

    return { ok: true, plan, raw, duration_ms: Date.now() - t0, model: MODEL };
  } catch (e) {
    return {
      ok: false,
      duration_ms: Date.now() - t0,
      model: MODEL,
      error: `planner_threw:${(e as Error).message ?? String(e)}`,
    };
  } finally {
    clearTimeout(t);
  }
}
