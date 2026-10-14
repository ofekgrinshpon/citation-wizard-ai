import { CITATION_CLIENT_KEY_VERSION, CITATION_REQUEST_VERSION, IndexedDbCitationRecoveryJournal,
  type CitationJournalEntry, type CitationRecoveryJournal } from "@/lib/citationRecoveryJournal";

/** Bodies and results are memory-only. The injected journal persists metadata
 * before dispatch, and arbitrates request identity across tabs and reloads. */
export interface CitationRetryDescriptor {
  readonly failedRequestId: string;
  readonly refundConfirmed: boolean;
  readonly refundStatus: string;
  readonly refundReceipt: Readonly<CitationRefundReceipt>;
  /** Opaque in-memory handle bound to the account, fingerprint and failed ID. */
  readonly handle: string;
}

export interface CitationRefundReceipt {
  status: "refunded" | "retained" | "deferred" | "review_required" | "not_charged" | "not_applicable" | "unconfirmed";
  refunded: boolean;
  units_refunded: number;
  request_id: string;
}

export function citationRefundReceipt(body: Record<string, unknown> | null | undefined, requestId: string): Readonly<CitationRefundReceipt> {
  const receipt = body?.refund_receipt as Record<string, unknown> | undefined;
  const valid = typeof receipt?.status === "string" &&
    ["refunded", "retained", "deferred", "review_required", "not_charged", "not_applicable", "unconfirmed"].includes(receipt.status) &&
    typeof receipt.request_id === "string" && receipt.request_id.length >= 8 && receipt.request_id.length <= 200 &&
    typeof receipt.refunded === "boolean" && Number.isSafeInteger(receipt.units_refunded) &&
    (receipt.status === "refunded" ? receipt.refunded === true && Number(receipt.units_refunded) > 0
      : receipt.refunded === false && receipt.units_refunded === 0);
  return Object.freeze(valid ? {
    status: receipt.status as CitationRefundReceipt["status"], refunded: receipt.refunded as boolean,
    units_refunded: receipt.units_refunded as number, request_id: receipt.request_id as string,
  } : { status: "unconfirmed", refunded: false, units_refunded: 0, request_id: requestId });
}

interface AttemptError {
  code?: string | null;
  requestId?: string | null;
  body?: Record<string, unknown> | null;
  citationRetry?: CitationRetryDescriptor;
}
interface AttemptResult { errorInfo: AttemptError | null }
interface Attempt<T> {
  metadata: CitationJournalEntry;
  body: Record<string, unknown>;
  active?: Promise<T>;
  undelivered?: T;
  failure?: CitationRetryDescriptor;
}
interface RetryRecord {
  descriptor: CitationRetryDescriptor;
  accountId: string;
  key: string;
  projectId: string | null;
  parent: Attempt<AttemptResult>;
  recoveryExpiresAt?: string;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export async function citationClientKey(body: Record<string, unknown>, projectId: string | null): Promise<string> {
  const payload = canonicalJson({ projectId, messages: body.messages, rawInput: body.rawInput ?? null,
    foreignLookup: body.foreignLookup ?? null, batchId: body.batchId ?? null });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const stale = () => new Error("CITATION_RETRY_STALE");

export function citationRetryDisclosure(retry: CitationRetryDescriptor): string {
  const refund = retry.refundConfirmed ? "החזר השימוש הקודם אושר."
    : retry.refundStatus === "retained" ? "השימוש הקודם לא הוחזר."
      : retry.refundStatus === "not_charged" ? "לא נרשם חיוב לבקשה הקודמת."
        : retry.refundStatus === "review_required" ? "החזר השימוש הקודם דורש בירור."
        : "החזר השימוש הקודם טרם אושר.";
  return `הבקשה ${retry.failedRequestId} הסתיימה בכשל. ${refund} ניסיון חדש הוא בקשה נפרדת ועשוי לצרוך שימוש נוסף.`;
}

export class CitationRequestIdentity {
  private accounts = new Map<string, Map<string, Attempt<AttemptResult>>>();
  private retries = new Map<string, RetryRecord>();

  constructor(private readonly capacity = 256,
    private readonly journal: CitationRecoveryJournal = new IndexedDbCitationRecoveryJournal()) {}

  /** Logout/account changes discard content, never unresolved identity metadata. */
  clearMemory(accountId?: string): void {
    if (accountId === undefined) { this.accounts.clear(); this.retries.clear(); return; }
    this.accounts.delete(accountId);
    for (const [handle, retry] of this.retries) if (retry.accountId === accountId) this.retries.delete(handle);
  }

  findMetadata(accountId: string, requestId: string): Promise<CitationJournalEntry | null> {
    return this.journal.find(accountId, requestId);
  }

  /** API adapter calls only after freshly validating an owned usable success. */
  async acknowledgeRecoveredSuccess(accountId: string, requestId: string, canCommit: () => boolean = () => true): Promise<void> {
    const entry = await this.journal.find(accountId, requestId);
    if (!entry) return;
    if (!canCommit()) throw stale();
    await this.journal.delivered(entry, canCommit);
    const attempts = this.accounts.get(accountId);
    if (attempts?.get(entry.key)?.metadata.requestId === requestId) attempts.delete(entry.key);
    for (const [handle, retry] of this.retries) {
      if (retry.accountId === accountId && retry.key === entry.key && retry.parent.metadata.requestId === requestId) this.retries.delete(handle);
    }
  }

  /** Adopt read-only server evidence of an immediate canonical child. */
  async adoptRecoveredChild(accountId: string, proposedId: string, canonicalId: string): Promise<void> {
    const proposed = await this.journal.find(accountId, proposedId);
    if (!proposed?.parentRequestId) throw stale();
    const metadata = await this.journal.adopt(proposed, canonicalId);
    const retained = this.accounts.get(accountId)?.get(proposed.key);
    if (retained?.metadata.requestId === proposedId) {
      retained.metadata = metadata;
      retained.failure = undefined;
      for (const [handle, retry] of this.retries) {
        if (retry.accountId === accountId && retry.parent === retained) this.retries.delete(handle);
      }
    }
  }

  retryInput(descriptor: CitationRetryDescriptor): { accountId: string; body: Record<string, unknown>; projectId: string | null } {
    const record = this.retries.get(descriptor.handle);
    if (!record || record.descriptor.failedRequestId !== descriptor.failedRequestId ||
        record.recoveryExpiresAt && Date.parse(record.recoveryExpiresAt) <= Date.now()) throw stale();
    return { accountId: record.accountId, body: copy(record.parent.body), projectId: record.projectId };
  }

  private failure(accountId: string, key: string, current: Attempt<AttemptResult>, receipt: Readonly<CitationRefundReceipt>): CitationRetryDescriptor {
    const existing = [...this.retries.values()].find((retry) => retry.accountId === accountId && retry.key === key &&
      retry.parent.metadata.requestId === current.metadata.requestId);
    const descriptor: CitationRetryDescriptor = Object.freeze({
      failedRequestId: current.metadata.requestId, refundConfirmed: receipt.refunded,
      refundStatus: receipt.status, refundReceipt: receipt,
      handle: current.failure?.handle ?? existing?.descriptor.handle ?? crypto.randomUUID(),
    });
    current.failure = descriptor;
    this.retries.set(descriptor.handle, { descriptor, accountId, key,
      projectId: current.metadata.projectId, parent: current, recoveryExpiresAt: existing?.recoveryExpiresAt });
    return descriptor;
  }

  /** API adapter only: caller must freshly read and validate the authoritative
   * account-owned failed record and retained input. This never dispatches work. */
  async restoreFailed(accountId: string, body: Record<string, unknown>, record: {
    requestId: string; retryOfRequestId: string | null; createdAt: string; expiresAt: string; refundReceipt: Readonly<CitationRefundReceipt>;
  }, isCurrent: () => boolean): Promise<CitationRetryDescriptor> {
    const snapshot = copy(body);
    const known = await this.journal.find(accountId, record.requestId);
    if (!isCurrent()) throw stale();
    const parent = !known && record.retryOfRequestId ? await this.journal.find(accountId, record.retryOfRequestId) : null;
    if (!isCurrent()) throw stale();
    const projectId = known?.projectId ?? parent?.projectId ?? null;
    const key = await citationClientKey(snapshot, projectId);
    if (!isCurrent() || known && known.key !== key || parent && parent.key !== key) throw stale();
    let attempts = this.accounts.get(accountId);
    if (!attempts) { attempts = new Map(); this.accounts.set(accountId, attempts); }
    if (!attempts.has(key) && attempts.size >= this.capacity) throw new Error("REQUEST_RECOVERY_LIMIT");
    const metadata = await this.journal.restore({ accountId, key, keyVersion: CITATION_CLIENT_KEY_VERSION,
      requestId: record.requestId, parentRequestId: record.retryOfRequestId, projectId, createdAt: record.createdAt }, this.capacity);
    if (!isCurrent()) throw stale();
    const retained = attempts.get(key);
    const attempt: Attempt<AttemptResult> = retained?.metadata.requestId === metadata.requestId
      ? retained : { metadata, body: snapshot };
    // Recovery retries use precisely the server-retained execution input, not
    // old diagnostic/telemetry extras from a live invocation snapshot.
    attempt.body = snapshot;
    // Do not overwrite an already-running canonical child with its parent.
    if (!retained || retained.metadata.requestId === metadata.requestId ||
        metadata.parentRequestId && retained.metadata.parentRequestId === metadata.parentRequestId) attempts.set(key, attempt);
    const descriptor = this.failure(accountId, key, attempt, citationRefundReceipt({ refund_receipt: record.refundReceipt }, record.requestId));
    this.retries.get(descriptor.handle)!.recoveryExpiresAt = record.expiresAt;
    return descriptor;
  }

  async invoke<T extends AttemptResult>(
    accountId: string,
    body: Record<string, unknown>,
    projectId: string | null | undefined,
    execute: (body: Record<string, unknown>) => Promise<T>,
    isResultCurrent: () => boolean = () => true,
    explicitRetry?: CitationRetryDescriptor,
  ): Promise<T> {
    // Snapshot before the first await; callers cannot mutate our exact input.
    const snapshot = copy(body);
    const key = await citationClientKey(snapshot, projectId ?? null);
    if (!isResultCurrent()) throw stale();
    let attempts = this.accounts.get(accountId);
    if (!attempts) { attempts = new Map(); this.accounts.set(accountId, attempts); }
    const retry = explicitRetry ? this.retries.get(explicitRetry.handle) : undefined;
    if (explicitRetry && (!retry || retry.accountId !== accountId || retry.key !== key ||
        retry.descriptor.failedRequestId !== explicitRetry.failedRequestId ||
        retry.recoveryExpiresAt && Date.parse(retry.recoveryExpiresAt) <= Date.now())) throw stale();
    if (!attempts.has(key) && attempts.size >= this.capacity) throw new Error("REQUEST_RECOVERY_LIMIT");
    const supplied = snapshot.requestId;
    const metadata = await this.journal.claim({ accountId, key, keyVersion: CITATION_CLIENT_KEY_VERSION,
      requestId: !retry && typeof supplied === "string" && supplied.length >= 8 && supplied.length <= 200 ? supplied : crypto.randomUUID(),
      parentRequestId: retry?.descriptor.failedRequestId ?? null, projectId: projectId ?? null,
      createdAt: new Date().toISOString(), capacity: this.capacity });
    if (!isResultCurrent()) throw stale();
    // Re-read memory AFTER the durable transaction. Concurrent invocations in
    // this realm now coalesce; other realms send the same server-guarded ID.
    let attempt = attempts.get(key) as Attempt<T> | undefined;
    if (attempt?.metadata.requestId !== metadata.requestId) {
      attempt = { metadata, body: retry ? copy(retry.parent.body) : snapshot };
      attempts.set(key, attempt);
    }
    if (retry) {
      for (const [handle, ancestor] of this.retries) {
        if (ancestor.accountId === accountId && ancestor.key === key &&
            ancestor.parent.metadata.requestId !== retry.parent.metadata.requestId &&
            retry.parent.metadata.parentRequestId === ancestor.parent.metadata.requestId) this.retries.delete(handle);
      }
    }
    const current = attempt;
    const deliver = async (result: T): Promise<T> => {
      // Recheck at the durable transaction's commit decision, not only before
      // opening IndexedDB. Navigation/logout may invalidate delivery meanwhile.
      const canCommit = () => isResultCurrent() && this.accounts.get(accountId) === attempts && attempts.get(key) === current;
      if (!result.errorInfo && canCommit()) {
        await this.journal.delivered(current.metadata, canCommit);
        if (canCommit()) {
          attempts.delete(key);
          for (const [handle, r] of this.retries) if (r.accountId === accountId && r.key === key) this.retries.delete(handle);
        }
      }
      return result;
    };
    if (current.undelivered) return deliver(current.undelivered);
    if (current.active) return current.active.then(deliver);
    const requestBody: Record<string, unknown> = { ...copy(current.body), requestId: current.metadata.requestId,
      citationRequestVersion: CITATION_REQUEST_VERSION };
    delete requestBody.retryOfRequestId;
    if (current.metadata.parentRequestId) requestBody.retryOfRequestId = current.metadata.parentRequestId;
    current.active = Promise.resolve().then(() => {
      if (!isResultCurrent()) throw stale();
      return execute(requestBody);
    }).then(async (result) => {
      const info = result.errorInfo;
      if (!info) current.undelivered = result;
      else {
        const serverId = info.body?.requestId ?? info.body?.request_id;
        const status = info.body?.status;
        if (current.metadata.parentRequestId && info.code === "REQUEST_ALREADY_STARTED" &&
            typeof serverId === "string" && serverId.length >= 8 && serverId.length <= 200 &&
            ["in_progress", "failed", "succeeded", "unknown"].includes(String(status))) {
          // Persist canonical adoption before it is exposed or retried.
          current.metadata = await this.journal.adopt(current.metadata, serverId);
          info.requestId = serverId;
        }
        if (status === "failed" && serverId === current.metadata.requestId &&
            this.accounts.get(accountId) === attempts && !info.code?.startsWith("RETRY_") &&
            !["INVALID_RETRY_REQUEST", "REQUEST_FINGERPRINT_MISMATCH", "REQUEST_ANCESTRY_MISMATCH", "REQUEST_ID_ALREADY_USED"].includes(info.code ?? "")) {
          info.citationRetry = this.failure(accountId, key, current, citationRefundReceipt(info.body, current.metadata.requestId));
        }
      }
      return result;
    }).finally(() => { current.active = undefined; });
    return current.active.then(deliver);
  }
}

// No in-memory or localStorage fallback: unavailable IndexedDB blocks dispatch.
export const citationRequests = new CitationRequestIdentity();
