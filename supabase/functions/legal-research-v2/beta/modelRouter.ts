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
export type RouteAction = "out_of_scope" | "chat" | "research";

export const OUT_OF_SCOPE_REPLY_HE =
  "אני עוזר משפטי ומתמקד במחקר משפטי, פסיקה, חקיקה וכתיבה משפטית. אשמח לעזור בנושא משפטי.";

export interface ModelRoute {
  action: RouteAction;
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

export const ROUTER_SYSTEM = `אתה נתב קטן במערכת מחקר משפטי. תפקידך: להחליט איזה סוג עבודה נדרש עבור ההודעה האחרונה של המשתמש, ואיזה מודל יטפל בה.
אל תחליט לפי מילות מפתח. החלט לפי המשמעות, הקשר השיחה והשאלה: האם אפשר לתת תשובה איכותית ואמינה רק מתוך השיחה והידע הכללי, או שחיפוש וקריאת מקורות ישפרו מהותית את האיכות, הדיוק או האמינות?

action:
- "out_of_scope": הבקשה אינה משפטית ואינה קשורה לעבודה משפטית או אקדמית-משפטית (למשל מתכון, טיול, כושר, שאלה כללית שאינה קשורה למשפט).
- "chat": אין צורך בחיפוש מקורות חדש — הבהרת תשובה קודמת, ניסוח מחדש, קיצור טקסט, סיעור מוחות פשוט, שאלת המשך שמבוססת על מה שכבר נמצא בשיחה, הסבר פשוט של נקודה שכבר נידונה.
- "research": איכות התשובה תלויה בחיפוש, קריאה או אימות של מקורות — איתור פסיקה או ספרות, בדיקת הדין הקיים או עדכניותו, תשובה משפטית מבוססת, משפט משווה, כתיבה אקדמית, בדיקת מקוריות של שאלת מחקר, הצעת שאלת מחקר רצינית שמחייבת להבין מה כבר נכתב, וכל מצב שבו בלי מקורות יש סיכון ממשי לתשובה שטחית או לא מבוססת.
אם יש ספק סביר האם חיפוש מקורות ישפר מהותית את התשובה — בחר "research".
לדוגמה: "תציע לי 3 נושאים כלליים בדיני חוזים" עשוי להיות chat, אבל "תציע לי שאלת מחקר טובה ומקורית לסמינריון בדיני חוזים" הוא בדרך כלל research, כי צריך להבין את הספרות והפסיקה הקיימת.

model (רלוונטי ל-research; עבור chat ו-out_of_scope החזר "sol"):
- "sol": מחקר ממוקד ופשוט יחסית.
- "astra": מחקר רחב, כתיבה אקדמית, סינתזה של כמה מקורות, משפט משווה, ניתוח דוקטרינרי מורכב, או משימה שדורשת עומק משמעותי.

החזר JSON בלבד, בלי טקסט נוסף: {"action":"out_of_scope"|"chat"|"research","model":"sol"|"astra","reason":"נימוק קצר"}`;

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

/** Strict parse; null on anything unexpected. Chat/out_of_scope always run on Sol. */
export function parseRouterOutput(text: string): { action: RouteAction; model: RouteChoice; reason: string } | null {
  const m = (text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { action?: unknown; model?: unknown; reason?: unknown };
    const rawAction = typeof o.action === "string" ? o.action.trim().toLowerCase() : "research";
    if (rawAction !== "out_of_scope" && rawAction !== "chat" && rawAction !== "research") return null;
    const action = rawAction as RouteAction;
    const rawModel = typeof o.model === "string" ? o.model.trim().toLowerCase() : "";
    if (action === "research" && rawModel !== "sol" && rawModel !== "astra") return null;
    const model: RouteChoice = action === "research" ? (rawModel as RouteChoice) : "sol";
    const reason = typeof o.reason === "string" ? o.reason.trim().slice(0, 300) : "";
    return { action, model, reason };
  } catch {
    return null;
  }
}

function fallback(reason: string, extra: Partial<ModelRoute> = {}): ModelRoute {
  return {
    action: "research",
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
  input: {
    question: string;
    conversation_context?: string | null;
    has_attachments: boolean;
    academic?: boolean;
    /** false outside the chat (no conversation): only research is possible. */
    allow_direct?: boolean;
  },
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
    // Attached files can only be read by the research pipeline; outside the
    // chat there is no place to post a direct reply.
    const action: RouteAction = parsed.action !== "research" && (input.has_attachments || input.allow_direct === false)
      ? "research"
      : parsed.action;
    const model: RouteChoice = action === "research" && parsed.action !== "research" ? "sol" : parsed.model;
    return {
      action,
      model,
      model_id: ROUTE_MODELS[model],
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

export const DIRECT_CHAT_SYSTEM = `אתה ReLex, עוזר משפטי בשיחה. ענה בעברית, בקצרה ובבהירות, על סמך השיחה והידע הכללי שלך בלבד.
לא ביצעת כעת חיפוש מקורות: אל תמציא ציטוטים, מספרי תיקים, סעיפים או מראי מקום, ואל תציג הערות שוליים.
אם תשובה אמינה מחייבת בדיקת מקורות, אמור זאת והצע למשתמש לבקש מחקר.`;

export interface DirectChatResult {
  ok: boolean;
  content: string;
  model_id: string;
  ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  error: string | null;
}

/** Sol answers from the conversation only: no search, EvidenceStore, verifier or footnotes. */
export async function answerDirectChat(
  input: { question: string; conversation_context?: string | null },
  deps: { chat?: typeof chat } = {},
): Promise<DirectChatResult> {
  const call = deps.chat ?? chat;
  const t0 = Date.now();
  const model_id = ROUTE_MODELS.sol;
  try {
    const ctx = (input.conversation_context ?? "").slice(-9000);
    const messages: ChatMessage[] = [
      { role: "system", content: DIRECT_CHAT_SYSTEM },
      { role: "user", content: [ctx ? `הקשר השיחה:\n${ctx}` : "", `ההודעה של המשתמש:\n${input.question}`].filter(Boolean).join("\n\n") },
    ];
    const res = await call({ model: model_id, messages });
    const content = (res.content ?? "").trim();
    return {
      ok: !!res.ok && !!content,
      content,
      model_id,
      ms: Date.now() - t0,
      prompt_tokens: res.prompt_tokens ?? 0,
      completion_tokens: res.completion_tokens ?? 0,
      error: res.ok ? (content ? null : "empty") : `${res.http_status}: ${res.error ?? ""}`.slice(0, 200),
    };
  } catch (e) {
    return { ok: false, content: "", model_id, ms: Date.now() - t0, prompt_tokens: 0, completion_tokens: 0, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}
