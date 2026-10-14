import { supabase } from "@/integrations/supabase/client";
import { citationRequests, citationRefundReceipt, type CitationRetryDescriptor } from "@/lib/citationRequestIdentity";
export { citationRetryDisclosure, type CitationRetryDescriptor } from "@/lib/citationRequestIdentity";

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
  /** Present only for an account/payload-bound, server-confirmed failed request. */
  citationRetry?: CitationRetryDescriptor;
}

// Content and retry capabilities are account-session memory only. Durable
// identity metadata stays account-scoped through logout and history clearing.
let observedCitationAccount: string | null | undefined;
if (typeof supabase.auth.onAuthStateChange === "function") {
  supabase.auth.onAuthStateChange((_event, session) => {
    const next = session?.user.id ?? null;
    if (observedCitationAccount !== undefined && next !== observedCitationAccount) citationRequests.clearMemory();
    observedCitationAccount = next;
  });
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
      const body = JSON.parse(txt);
      return body && typeof body === "object" && !Array.isArray(body) ? body : null;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

function messageFor(status: number | null, code: string | null, body: Record<string, unknown> | null): string {
  const serverHe = (body?.messageHe ?? body?.message) as string | undefined;
  if (body?.status === "unknown" && code !== "REQUEST_OUTCOME_UNKNOWN") return messageFor(status, "REQUEST_OUTCOME_UNKNOWN", null);
  if (code === "CITATION_RETRY_STALE" || code?.startsWith("RETRY_") || code === "INVALID_RETRY_REQUEST" || code === "REQUEST_ANCESTRY_MISMATCH") {
    return "לא ניתן להתחיל ניסיון חדש באמצעות הפעולה הזו. החשבון, פרטי המקור או מצב הבקשה השתנו. לא נפתח ניסיון נוסף.";
  }
  if (code === "INPUT_TOO_LARGE") {
    return "הקלט גדול מדי לעיבוד בטוח. צמצמו את הבקשה לעד 100 הודעות ועד 128 KiB של קלט (הבקשה המלאה מוגבלת ל־256 KiB). הבקשה נדחתה לפני העיבוד ולא נצרכו יחידות שימוש חדשות.";
  }
  if (code === "INVALID_RECOVERY_INPUT") {
    return "מבנה הקלט אינו נתמך לשחזור בטוח. נסו להזין את המקור מחדש בטופס העדכני; עד 100 הודעות ו־128 KiB של קלט. הבקשה נדחתה לפני העיבוד ולא נצרכו יחידות שימוש חדשות.";
  }
  if (code === "CLIENT_UPDATE_REQUIRED") {
    return "גרסת היישום אינה תומכת בזיהוי בטוח של בקשות. לא נשלחה בקשה לעיבוד. רעננו את היישום כדי לעדכן לגרסה החדשה.";
  }
  if (code === "RESEARCH_VERSION_RETIRED") {
    return serverHe || "גרסת המחקר הישנה הוצאה משימוש. יש לרענן את העמוד כדי להשתמש בגרסה העדכנית. הבקשה הזו לא התחילה מחקר ולא צרכה יחידות שימוש.";
  }
  if (code === "AI_RESPONSE_UNVERIFIED") {
    return "לא התקבל אזכור שניתן לאמת ותוצאת הבקשה עדיין אינה ודאית. החזר שימוש לא אושר. אל תפתחו בקשה חדשה לאותו מקור; שמרו את מזהה הבקשה לבירור.";
  }
  if (code === "AI_REFUSED") {
    return citationRefundReceipt(body, "").refunded
      ? "הספק לא הפיק אזכור והשימוש הוחזר. הבקשה הסתיימה ללא תוצאה."
      : "הספק לא הפיק אזכור. החזר השימוש טרם אושר; שמרו את מזהה הבקשה לבירור.";
  }
  // Recovery errors must never suggest changing the ID or resubmitting as a
  // fresh paid operation, even when the transport returned a generic 503.
  if (code === "REQUEST_OUTCOME_UNKNOWN") {
    return "תוצאת הבקשה עדיין אינה ידועה. ייתכן שכבר בוצעה ונוצל שימוש. החזר שימוש לא אושר. אל תפתחו בקשה חדשה לאותו מקור; שמרו את מזהה הבקשה לבירור.";
  }
  if (code === "REQUEST_ALREADY_STARTED") {
    if (body?.status === "succeeded") return "הבקשה כבר הושלמה, אך התוצאה לא התקבלה כאן. לא הופעלה בקשה נוספת. שמרו את מזהה הבקשה לבירור.";
    if (body?.status === "failed") return "הבקשה הקודמת הסתיימה בכשל. לא הופעלה בקשה נוספת. שמרו את מזהה הבקשה לבירור החיוב והתוצאה.";
    if (body?.status === "unknown") return messageFor(null, "REQUEST_OUTCOME_UNKNOWN", null);
    return "הבקשה כבר התחילה ועדיין בטיפול. לא הופעלה בקשה נוספת. המתינו לסיום ושמרו את מזהה הבקשה לבירור.";
  }
  if (code === "REQUEST_FINGERPRINT_MISMATCH" || code === "REQUEST_ID_ALREADY_USED") {
    return "מזהה הבקשה כבר משויך לבקשה אחרת. הבקשה נעצרה ללא הפעלה נוספת; שמרו את המזהה לבירור.";
  }
  if (code === "REQUEST_ID_REQUIRED" || code === "INVALID_REQUEST_ID") {
    return "גרסת היישום אינה תומכת בזיהוי בטוח של הבקשה. עדכנו את היישום לפני בקשה חדשה.";
  }
  if (code === "CITATION_RECOVERY_STORAGE_UNAVAILABLE") {
    return "לא ניתן לשמור או לעדכן בדפדפן את מזהה הבקשה בבטחה. אין להתחיל ניסיון נוסף. בדקו שאחסון הדפדפן זמין, רעננו את העמוד ופתחו שחזור בקשות לבדיקת פעולות קודמות. אל תמחקו נתוני אתר כדי לנסות שוב.";
  }
  if (code === "REQUEST_RECOVERY_LIMIT") {
    return "קיימות בקשות רבות שתוצאתן טרם אושרה. לא נשלחה בקשה חדשה; יש לברר את הבקשות הקודמות לפני המשך העבודה.";
  }
  if (code === "AI_UNAVAILABLE") {
    return citationRefundReceipt(body, "").refunded
      ? "שירות ה-AI אינו זמין כרגע עקב מגבלת ספק. השימוש הוחזר."
      : "שירות ה-AI אינו זמין כרגע עקב מגבלת ספק. החזר שימוש לא אושר; שמרו את מזהה הבקשה לבירור.";
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
  const code = typeof body?.error === "string" ? body.error : null;
  const requestId = (body?.request_id ?? body?.requestId) as string | null ?? null;

  const info: EdgeErrorInfo = {
    status,
    code,
    message: messageFor(status, code, body) + (requestId && (body?.status === "unknown" || code?.startsWith("REQUEST_") || code === "AI_RESPONSE_UNVERIFIED" || code === "AI_REFUSED")
      ? ` מזהה בקשה: ${requestId}` : ""),
    requestId,
    required: typeof body?.required === "number" ? (body.required as number) : undefined,
    isInsufficientCredits: code === "INSUFFICIENT_CREDITS",
    isOperationInProgress: code === "OPERATION_IN_PROGRESS" ||
      (code === "REQUEST_ALREADY_STARTED" && body?.status === "in_progress"),
    isAuthExpired: status === 401 || status === 403,
    isInvalidInput: ["INVALID_INPUT", "INVALID_RECOVERY_INPUT", "INPUT_TOO_LARGE"].includes(code ?? "") || (status === 400 && !code?.startsWith("REQUEST_") && !code?.startsWith("RETRY_") && code !== "INVALID_REQUEST_ID" && code !== "INVALID_RETRY_REQUEST"),
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
async function logFailure(fn: string, info: EdgeErrorInfo, projectId?: string | null, accountId?: string) {
  try {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid || (accountId && uid !== accountId)) return;
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
    if (!data.session) return null;
    if (typeof exp === "number" && exp * 1000 - Date.now() < 60_000) {
      const refreshed = await supabase.auth.refreshSession();
      return refreshed.data.session;
    }
    return data.session;
  } catch {
    /* fall through — invoke will surface a 401 we can handle */
    return null;
  }
}

export interface InvokeResult<T> {
  data: T | null;
  errorInfo: EdgeErrorInfo | null;
}

function withRequestId(info: EdgeErrorInfo, requestId: unknown): EdgeErrorInfo {
  if (!info.requestId && typeof requestId === "string") {
    info.requestId = requestId;
    if (info.body?.status === "unknown" || info.code?.startsWith("REQUEST_") || ["AI_RESPONSE_UNVERIFIED", "AI_REFUSED", "AI_UNAVAILABLE"].includes(info.code ?? "")) {
      info.message += ` מזהה בקשה: ${requestId}`;
    }
  }
  return info;
}

/**
 * Invoke an edge function with a fresh session, one automatic retry on 401,
 * parsed Hebrew errors, and persistent failure telemetry.
 */
export async function invokeFunction<T = unknown>(
  fn: string,
  body: Record<string, unknown>,
  opts?: { projectId?: string | null; isCitationResultCurrent?: () => boolean; citationRetry?: CitationRetryDescriptor },
): Promise<InvokeResult<T>> {
  const session = await ensureFreshSession();
  const isCitation = fn === "citation-chat";
  const viewIsCurrent = () => !opts?.isCitationResultCurrent || opts.isCitationResultCurrent();
  const accountIsCurrent = async (requireCurrentView = true) => {
    if (requireCurrentView && !viewIsCurrent()) return false;
    const { data } = await supabase.auth.getSession();
    return (!requireCurrentView || viewIsCurrent()) && !!session?.user.id && data.session?.user.id === session.user.id;
  };

  const execute = async (requestBody: Record<string, unknown>): Promise<InvokeResult<T>> => {
    try {
      if (isCitation && !await accountIsCurrent()) {
        return { data: null, errorInfo: await parseFunctionError(null, { error: "CITATION_RETRY_STALE" }) };
      }
      // Bind both attempts to the same account, even if the user signs out or
      // switches accounts while a request is pending.
      const headers = isCitation && session ? { Authorization: `Bearer ${session.access_token}` } : undefined;
      let { data, error } = await supabase.functions.invoke<T>(fn, { body: requestBody, ...(headers ? { headers } : {}) });
      if (error) {
        const first = await parseFunctionError(error);
        if (first.status === 401) {
          const { data: refreshed } = await supabase.auth.refreshSession();
          if (refreshed.session && (!isCitation || (refreshed.session.user.id === session?.user.id &&
              (!opts?.isCitationResultCurrent || opts.isCitationResultCurrent())))) {
            ({ data, error } = await supabase.functions.invoke<T>(fn, { body: requestBody,
              ...(isCitation ? { headers: { Authorization: `Bearer ${refreshed.session.access_token}` } } : {}),
            }));
          }
        }
        if (error) {
          let info = await parseFunctionError(error);
          if (isCitation && !info.code && (info.status === null || info.status >= 500)) {
            info = await parseFunctionError({ status: info.status }, { error: "REQUEST_OUTCOME_UNKNOWN", requestId: requestBody.requestId });
          }
          withRequestId(info, requestBody.requestId);
          await logFailure(fn, info, opts?.projectId, isCitation ? session?.user.id : undefined);
          return { data: null, errorInfo: info };
        }
      }

      // Check in-body errors after the auth retry as well as the first call.
      const payload = (data ?? null) as Record<string, unknown> | null;
      if (payload && typeof payload.error === "string") {
        const info = await parseFunctionError(new Error(payload.error), payload);
        withRequestId(info, requestBody.requestId);
        await logFailure(fn, info, opts?.projectId, isCitation ? session?.user.id : undefined);
        return { data: null, errorInfo: info };
      }
      const foreign = payload?.foreignLookup as Record<string, unknown> | undefined;
      const identity = foreign?.identity as Record<string, unknown> | undefined;
      const fields = foreign?.fields;
      const typedFields = !!fields && typeof fields === "object" && !Array.isArray(fields) &&
        Object.values(fields).every((value) => typeof value === "string");
      const requestedForeign = requestBody.foreignLookup as Record<string, unknown> | undefined;
      const articleResult = requestedForeign?.kind === "journal_article" && typedFields &&
        typeof identity?.matched === "boolean" &&
        ["resolved", "incomplete", "conflict"].includes(String(foreign?.articleResolution));
      const matchedResult = identity?.matched === true && typedFields &&
        Object.values(fields).some((value) => typeof value === "string" && value.trim());
      const choices = foreign?.disambiguation;
      const disambiguationResult = Array.isArray(choices) && choices.length > 1 && choices.every((choice) =>
        choice && ["US", "UK"].includes(choice.jurisdiction) && typeof choice.label === "string" &&
        !!choice.label.trim() && typeof choice.url === "string" && !!choice.url.trim());
      const structuredForeign = requestedForeign && (articleResult || matchedResult || disambiguationResult);
      if (isCitation && (!payload || (!(typeof payload.content === "string" && payload.content.trim()) && !structuredForeign))) {
        throw new Error("Empty citation response");
      }
      if (isCitation && !await accountIsCurrent(false)) {
        return { data: null, errorInfo: await parseFunctionError(null, { error: "CITATION_RETRY_STALE", requestId: requestBody.requestId }) };
      }
      return { data: data ?? null, errorInfo: null };
    } catch (error) {
      // A lost transport response does not prove the server did no paid work.
      // Never automatically retry this branch or rotate its operation ID.
      const info = await parseFunctionError(error, isCitation ? {
        error: "REQUEST_OUTCOME_UNKNOWN", requestId: requestBody.requestId,
      } : null);
      await logFailure(fn, info, opts?.projectId, isCitation ? session?.user.id : undefined);
      return { data: null, errorInfo: info };
    }
  };

  if (!isCitation) return execute(body);
  if (!session?.user.id) {
    return { data: null, errorInfo: await parseFunctionError({ status: 401 }) };
  }
  try {
    const result = await citationRequests.invoke(session.user.id, body, opts?.projectId, execute, viewIsCurrent, opts?.citationRetry);
    if (!await accountIsCurrent()) return { data: null, errorInfo: await parseFunctionError(null, { error: "CITATION_RETRY_STALE" }) };
    return result;
  } catch (error) {
    // Hashing/identity setup failure is fail-closed; nothing is dispatched.
    const code = error instanceof Error && ["REQUEST_RECOVERY_LIMIT", "CITATION_RETRY_STALE", "CITATION_RECOVERY_STORAGE_UNAVAILABLE", "REQUEST_FINGERPRINT_MISMATCH", "REQUEST_ID_ALREADY_USED"].includes(error.message)
      ? error.message : "REQUEST_OUTCOME_UNKNOWN";
    return { data: null, errorInfo: await parseFunctionError(error, { error: code }) };
  }
}

/** Explicit user gesture only. Reuse the failed operation's exact retained body;
 * never rebuild a request from mutable form state or classify the source again. */
export async function retryCitationFunction<T = unknown>(
  descriptor: CitationRetryDescriptor,
  opts?: { isCitationResultCurrent?: () => boolean },
): Promise<InvokeResult<T>> {
  try {
    const retained = citationRequests.retryInput(descriptor);
    return await invokeFunction<T>("citation-chat", retained.body, {
      projectId: retained.projectId, citationRetry: descriptor,
      isCitationResultCurrent: opts?.isCitationResultCurrent,
    });
  } catch (error) {
    return { data: null, errorInfo: await parseFunctionError(error, { error: "CITATION_RETRY_STALE" }) };
  }
}
