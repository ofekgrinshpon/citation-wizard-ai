/**
 * legal-research-v2 — Sol/Astra model router (chat answer path).
 *
 * One short, cheap classification before research starts. It chooses ONLY
 * which Research Agent model runs the turn. It never picks a deliverable,
 * budget, source quota or mode — the agent itself infers the deliverable.
 * Verification, EvidenceStore, quote ids, the answer-block gate and the
 * citation renderer are identical for both models.
 *
 * Fail-safe: any router error keeps the production default (Astra).
 */

import { chat, type ChatMessage } from "../shared/model.ts";

export const ROUTER_MODEL = "openai/gpt-6-luna";
export const ROUTE_MODELS = {
  sol: "openai/gpt-6-sol",
  astra: "openai/gpt-6-astra",
} as const;
export type RouteChoice = keyof typeof ROUTE_MODELS;

export interface ModelRoute {
  model: RouteChoice;
  model_id: string;
  reason: string;
  source: "router" | "fallback" | "academic_context";
  router_model: string | null;
  router_ms: number;
  router_prompt_tokens: number;
  router_completion_tokens: number;
  router_error: string | null;
}

export const ROUTER_SYSTEM = `אתה נתב קטן במערכת מחקר משפטי. תפקידך היחיד: לבחור איזה מודל יטפל בהודעה האחרונה של המשתמש.
אל תסווג את סוג התוצר; הסוכן עצמו יבין מה המשתמש רוצה. שקול משמעות והקשר, לא מילות מפתח.

בחר "sol" כאשר מדובר למשל ב: שיחה והבהרות; הצעת רעיונות או שאלות מחקר; שאלת המשך פשוטה; איתור ממוקד של מקורות; סיכום ממוקד של מסמך או פסק דין; משימה משפטית יחסית נקודתית.
בחר "astra" כאשר מדובר למשל ב: מחקר משפטי עמוק; סינתזה של פסיקה וספרות; משפט משווה; שאלה רחבה או עמומה שדורשת מחקר משמעותי; כתיבה אקדמית; כתיבת פרק, מבוא או ניתוח מורכב; משימה שדורשת חיבור בין כמה מקורות ודוקטרינות.

החזר JSON בלבד, בלי טקסט נוסף: {"model":"sol"|"astra","reason":"נימוק קצר"}`;

export function buildRouterUserMessage(input: {
  question: string;
  conversation_context?: string | null;
  has_attachments: boolean;
}): string {
  const ctx = (input.conversation_context ?? "").slice(-4000);
  return [
    ctx ? `הודעות אחרונות בשיחה:\n${ctx}` : "אין הודעות קודמות בשיחה.",
    `קבצים מצורפים: ${input.has_attachments ? "כן" : "לא"}`,
    `ההודעה האחרונה של המשתמש:\n${input.question.slice(0, 3000)}`,
  ].join("\n\n");
}

/** Strict parse; null on anything unexpected. */
export function parseRouterOutput(text: string): { model: RouteChoice; reason: string } | null {
  const m = (text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { model?: unknown; reason?: unknown };
    const model = typeof o.model === "string" ? o.model.trim().toLowerCase() : "";
    if (model !== "sol" && model !== "astra") return null;
    const reason = typeof o.reason === "string" ? o.reason.trim().slice(0, 300) : "";
    return { model, reason };
  } catch {
    return null;
  }
}

function fallback(reason: string, extra: Partial<ModelRoute> = {}): ModelRoute {
  return {
    model: "astra",
    model_id: ROUTE_MODELS.astra,
    reason,
    source: "fallback",
    router_model: ROUTER_MODEL,
    router_ms: 0,
    router_prompt_tokens: 0,
    router_completion_tokens: 0,
    router_error: null,
    ...extra,
  };
}

export async function routeModel(
  input: { question: string; conversation_context?: string | null; has_attachments: boolean; academic?: boolean },
  deps: { chat?: typeof chat } = {},
): Promise<ModelRoute> {
  if (input.academic) {
    return { ...fallback("academic_context"), source: "academic_context", router_model: null };
  }
  const call = deps.chat ?? chat;
  const t0 = Date.now();
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: ROUTER_SYSTEM },
      { role: "user", content: buildRouterUserMessage(input) },
    ];
    const res = await call({ model: ROUTER_MODEL, messages });
    const ms = Date.now() - t0;
    const tokens = { router_prompt_tokens: res.prompt_tokens ?? 0, router_completion_tokens: res.completion_tokens ?? 0 };
    if (!res.ok) {
      return fallback("router_error_default_astra", { router_ms: ms, ...tokens, router_error: `${res.http_status}: ${res.error ?? ""}`.slice(0, 200) });
    }
    const parsed = parseRouterOutput(res.content);
    if (!parsed) {
      return fallback("router_unparseable_default_astra", { router_ms: ms, ...tokens, router_error: "unparseable" });
    }
    return {
      model: parsed.model,
      model_id: ROUTE_MODELS[parsed.model],
      reason: parsed.reason,
      source: "router",
      router_model: ROUTER_MODEL,
      router_ms: ms,
      ...tokens,
      router_error: null,
    };
  } catch (e) {
    return fallback("router_exception_default_astra", {
      router_ms: Date.now() - t0,
      router_error: (e instanceof Error ? e.message : String(e)).slice(0, 200),
    });
  }
}
