/**
 * Account-level concurrent-operation protection (shared by edge functions).
 *
 * One account may keep as many tabs/devices signed in as it likes; what it may
 * NOT do is run two expensive AI operations at the same time. Enforcement is
 * server-side and atomic: `acquire_operation_lock` is a single-statement
 * upsert guarded by a row lock, so two near-simultaneous requests can never
 * both win.
 *
 * The lock is always acquired BEFORE credits are charged, so a refused second
 * attempt costs the user nothing and never reaches a model provider.
 */

export type ProtectedOperationType =
  | "research_answer"
  | "source_search"
  | "case_summary"
  | "academic_chapter";

export const OPERATION_LABELS_HE: Record<ProtectedOperationType, string> = {
  research_answer: "מחקר משפטי",
  source_search: "חיפוש מקורות",
  case_summary: "סיכום פסק דין",
  academic_chapter: "כתיבה אקדמית",
};

/**
 * A run is considered abandoned only after this long without a heartbeat.
 * V2 research heartbeats every ~10s and its own stale-job reaper fires at 12
 * minutes, so this ceiling never kills a legitimate 3–5 minute run.
 */
export const LOCK_STALE_AFTER = "00:15:00";

export interface LockRpcClient {
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, params?: Record<string, unknown>): Promise<any> | any;
}

export interface AcquireResult {
  ok: boolean;
  /** Admin/internal account — no lock row was written. */
  bypass?: boolean;
  /** Same operation id re-acquiring (retry / resume), not hostile concurrency. */
  reused?: boolean;
  stale_recovered?: boolean;
  error?: string;
  active_operation_type?: ProtectedOperationType | string;
}

/**
 * Acquire account ownership for a protected operation.
 * Must be called with the *user-scoped* client (the RPC reads `auth.uid()`).
 */
export async function acquireOperationLock(
  userClient: LockRpcClient,
  operationType: ProtectedOperationType,
  operationId: string,
  projectId: string | null = null,
): Promise<AcquireResult> {
  try {
    const { data, error } = await userClient.rpc("acquire_operation_lock", {
      _operation_type: operationType,
      _operation_id: operationId,
      _project_id: projectId,
      _stale_after: LOCK_STALE_AFTER,
    });
    if (error) {
      // Fail CLOSED: if ownership cannot be established authoritatively we must
      // not let a second paid execution start.
      console.error("[lock] acquire rpc error (fail-closed):", error.message);
      return { ok: false, error: "lock_unavailable" };
    }
    const r = (data ?? {}) as AcquireResult;
    console.log(
      `[lock] acquire type=${operationType} ok=${r.ok === true} reused=${r.reused === true} ` +
        `stale_recovered=${r.stale_recovered === true} blocked_by=${r.active_operation_type ?? "none"}`,
    );
    return r;
  } catch (e) {
    console.error("[lock] acquire threw (fail-closed):", e);
    return { ok: false, error: "lock_unavailable" };
  }
}

/** Release with the service-role client (works for background workers too). */
export async function releaseOperationLock(
  admin: LockRpcClient,
  userId: string,
  operationId: string,
  reason = "completed",
): Promise<void> {
  try {
    await admin.rpc("release_operation_lock_for_user", {
      _user_id: userId,
      _operation_id: operationId,
      _reason: reason,
    });
    console.log(`[lock] released operation reason=${reason}`);
  } catch (e) {
    console.error("[lock] release failed (non-fatal):", e);
  }
}

export async function heartbeatOperationLock(
  admin: LockRpcClient,
  userId: string,
  operationId: string,
): Promise<void> {
  try {
    await admin.rpc("heartbeat_operation_lock_for_user", {
      _user_id: userId,
      _operation_id: operationId,
    });
  } catch {/* liveness is best-effort */}
}

/** Lock bookkeeping itself is unavailable — retryable, and nothing was charged. */
export function lockUnavailablePayload(): Record<string, unknown> {
  return {
    error: "LOCK_UNAVAILABLE",
    title: "השירות עמוס כרגע",
    message: "לא הצלחנו להתחיל את הפעולה כרגע ולא חויבתם. נסו שוב בעוד רגע.",
  };
}

/** Uniform, non-technical Hebrew payload for a refused concurrent attempt. */
export function operationInProgressPayload(activeType?: string): Record<string, unknown> {
  const label = OPERATION_LABELS_HE[activeType as ProtectedOperationType];
  return {
    error: "OPERATION_IN_PROGRESS",
    title: "כבר מתבצעת פעולה בחשבון",
    message: label
      ? `${label} מתבצע כעת בחשבון שלך. ניתן להתחיל פעולה חדשה לאחר שהפעולה הנוכחית תסתיים.`
      : "יש כרגע פעולה פעילה ב-ReLex. ניתן להתחיל פעולה חדשה לאחר שהיא תסתיים.",
    active_operation_type: activeType ?? null,
  };
}
