import { supabase } from "@/integrations/supabase/client";

export interface EdgeErrorInfo {
  /** HTTP status when known. */
  status: number | null;
  /** Machine code returned by the function (e.g. INSUFFICIENT_CREDITS). */
  code: string | null;
  /** Hebrew, user-facing message. Always populated. */
  message: string;
  requestId: string | null;
  required?: number;
  isInsufficientCredits: boolean;
  /** Another protected operation is already running on this account. */
  isOperationInProgress: boolean;
  isAuthExpired: boolean;
  isInvalidInput: boolean;
  body: Record<string, unknown> | null;
}

const GENERIC = "שירות האזכורים אינו זמין כרגע. נסו שוב בעוד רגע.";

function extractStatus(error: unknown): number | null {
  const e = error as { context?: unknown; status?: number; message?: string };
  const ctx = e?.context as { status?: number } | undefined;
  if (typeof ctx?.status === "number") return ctx.status;
  if (typeof e?.status === "number") return e.status;
  const m = e?.message?.match(/\b(40\d|41\d|42\d|50\d)\b/);
  return m ? Number(m[1]) : null;
}

async function extractBody(error: unknown): Promise<Record<string, unknown> | null> {
  const ctx = (error as { context?: unknown })?.context as Response | undefined;
  if (!ctx || typeof (ctx as Response).clone !== "function") return null;
  try {
    const txt = await (ctx as Response).clone().text();
    if (!txt) return null;
    try {
      return JSON.parse(txt) as Record<string, unknown>;
    } catch {
      return { error: txt };
    }
  } catch {
    return null;
  }
}

function messageFor(status: number | null, code: string | null, body: Record<string, unknown> | null): string {
  const serverHe = (body?.messageHe ?? body?.message) as string | undefined;
  if (code === "AI_UNAVAILABLE") {
    return serverHe || "שירות ה-AI אינו זמין כרגע עקב מגבלת ספק. לא חויבתם — נסו שוב מאוחר יותר.";
  }
  if (code === "OPERATION_IN_PROGRESS") {
    return serverHe || "יש כרגע פעולה פעילה ב-ReLex. ניתן להתחיל פעולה חדשה לאחר שהיא תסתיים.";
  }
  if (code === "INSUFFICIENT_CREDITS") {
    const required = body?.required;
    return required
      ? "הגעת למכסת השימוש הזמינה כרגע."
      : "הגעת למכסת השימוש — אפשר לשדרג תוכנית או להוסיף שימוש.";
  }
  if (status === 402) {
    // 402 without our own credit code = upstream AI provider billing block, not the user's credits.
    return serverHe || "שירות ה-AI אינו זמין כרגע עקב מגבלת ספק. נסו שוב מאוחר יותר.";
  }
  if (code === "CREDIT_CHARGE_FAILED" || status === 503) {
    return serverHe || "לא ניתן היה לעדכן את מכסת השימוש כרגע. נסו שוב בעוד רגע.";
  }
  if (status === 401 || status === 403) {
    return "פג תוקף ההתחברות. התחברו מחדש ונסו שוב.";
  }
  if (status === 429) {
    return serverHe || "מגבלת קצב — נסו שוב בעוד רגע.";
  }
  if (code === "INVALID_INPUT" || status === 400) {
    return serverHe || "לא זוהה טקסט משפטי ברור לאזכור. נסחו מחדש ונסו שוב.";
  }
  if (status && status >= 500) {
    return serverHe || GENERIC;
  }
  return serverHe || "שגיאה בחיבור לשרת. אנא נסה שנית.";
}

/** Turn any functions.invoke() error (or in-body error payload) into a Hebrew, actionable message. */
export async function parseFunctionError(
  error: unknown,
  fallbackBody?: Record<string, unknown> | null,
): Promise<EdgeErrorInfo> {
  const status = extractStatus(error);
  const body = (await extractBody(error)) ?? fallbackBody ?? null;
  const code = (body?.error as string | undefined) ?? null;
  const requestId = (body?.request_id ?? body?.requestId) as string | null ?? null;

  const info: EdgeErrorInfo = {
    status,
    code,
    message: messageFor(status, code, body),
    requestId,
    required: typeof body?.required === "number" ? (body.required as number) : undefined,
    isInsufficientCredits: code === "INSUFFICIENT_CREDITS",
    isOperationInProgress: code === "OPERATION_IN_PROGRESS" || status === 409,
    isAuthExpired: status === 401 || status === 403,
    isInvalidInput: code === "INVALID_INPUT" || status === 400,
    body,
  };

  console.error("[edge-error]", {
    status: info.status,
    code: info.code,
    requestId: info.requestId,
    raw: error instanceof Error ? error.message : error,
  });

  return info;
}

/** Best-effort persistent trace so failures stay diagnosable after edge logs expire. */
async function logFailure(fn: string, info: EdgeErrorInfo, projectId?: string | null) {
  try {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    await supabase.from("activity_logs").insert({
      user_id: uid,
      project_id: projectId ?? null,
      action: "request_failed",
      details: {
        fn,
        status: info.status,
        code: info.code,
        request_id: info.requestId,
      },
    });
  } catch {
    /* never block the UI on telemetry */
  }
}

/** Refresh the session when the access token is expired or about to expire. */
async function ensureFreshSession() {
  try {
    const { data } = await supabase.auth.getSession();
    const exp = data.session?.expires_at;
    if (!data.session) return;
    if (typeof exp === "number" && exp * 1000 - Date.now() < 60_000) {
      await supabase.auth.refreshSession();
    }
  } catch {
    /* fall through — invoke will surface a 401 we can handle */
  }
}

export interface InvokeResult<T> {
  data: T | null;
  errorInfo: EdgeErrorInfo | null;
}

/**
 * Invoke an edge function with a fresh session, one automatic retry on 401,
 * parsed Hebrew errors, and persistent failure telemetry.
 */
export async function invokeFunction<T = unknown>(
  fn: string,
  body: Record<string, unknown>,
  opts?: { projectId?: string | null },
): Promise<InvokeResult<T>> {
  await ensureFreshSession();

  let { data, error } = await supabase.functions.invoke<T>(fn, { body });

  if (error) {
    const first = await parseFunctionError(error);
    if (first.isAuthExpired) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed.session) {
        ({ data, error } = await supabase.functions.invoke<T>(fn, { body }));
        if (!error) return { data: data ?? null, errorInfo: null };
      }
    }
    const info = error ? await parseFunctionError(error) : first;
    await logFailure(fn, info, opts?.projectId);
    return { data: null, errorInfo: info };
  }

  // Some functions return 200 with an error payload.
  const payload = (data ?? null) as Record<string, unknown> | null;
  if (payload && typeof payload.error === "string") {
    const info = await parseFunctionError(new Error(payload.error), payload);
    await logFailure(fn, info, opts?.projectId);
    return { data: null, errorInfo: info };
  }

  return { data: data ?? null, errorInfo: null };
}
