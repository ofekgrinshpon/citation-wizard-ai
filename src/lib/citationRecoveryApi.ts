import { supabase } from "@/integrations/supabase/client";
import { citationRefundReceipt, citationRequests, type CitationRefundReceipt,
  type CitationRequestIdentity, type CitationRetryDescriptor } from "@/lib/citationRequestIdentity";

export interface CitationRecoveryInput {
  messages: Array<{ role: string; content: string }>;
  rawInput: string | null;
  foreignLookup: Record<string, unknown> | null;
  batchId: string | null;
}
export interface CitationRecoveryResult { content?: string; foreignLookup?: Record<string, unknown> }
export interface CitationRecoveryRecord {
  requestId: string;
  retryOfRequestId: string | null;
  status: "in_progress" | "succeeded" | "failed" | "unknown";
  createdAt: string;
  expiresAt: string;
  availability: "available" | "pending" | "expired" | "unavailable";
  input: CitationRecoveryInput | null;
  result: CitationRecoveryResult | null;
  refundReceipt: Readonly<CitationRefundReceipt>;
}
export interface CitationRecoveryQuery { requestId?: string; parentRequestId?: string; cursor?: string; limit?: number }
export interface CitationRecoveryPage { requests: CitationRecoveryRecord[]; nextCursor: string | null }
export class CitationRecoveryError extends Error {
  constructor(readonly code: "CITATION_RETRY_STALE" | "CITATION_RECOVERY_UNAVAILABLE" | "CITATION_RECOVERY_INVALID_RESPONSE" | "CITATION_RECOVERY_INPUT_UNAVAILABLE") {
    super(code); this.name = "CitationRecoveryError";
  }
}
const fail = (code: CitationRecoveryError["code"]): never => { throw new CitationRecoveryError(code); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === "string" && value.length >= 8 && value.length <= 200;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
function jsonSafe(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 1000 && value.every((v) => jsonSafe(v, depth + 1));
  return object(value) && Object.keys(value).length <= 1000 && Object.entries(value).every(([key, v]) =>
    !["__proto__", "constructor", "prototype"].includes(key) && jsonSafe(v, depth + 1));
}
function validInput(value: unknown): value is CitationRecoveryInput {
  if (!object(value) || !exactKeys(value, ["messages", "rawInput", "foreignLookup", "batchId"]) || bytes(value) > 128 * 1024 ||
      !Array.isArray(value.messages) || !value.messages.length || value.messages.length > 100 ||
      !value.messages.every((message) => object(message) && exactKeys(message, ["role", "content"]) &&
        typeof message.role === "string" && ["system", "user", "assistant"].includes(message.role) && typeof message.content === "string") ||
      !(value.rawInput === null || typeof value.rawInput === "string") ||
      !(value.batchId === null || validId(value.batchId))) return false;
  if (value.foreignLookup === null) return true;
  const foreign = value.foreignLookup;
  return object(foreign) && exactKeys(foreign, ["enabled", "kind", "jurisdiction", "rawInput", "parsedFields", "articleResponseVersion"]) &&
    jsonSafe(foreign) && (foreign.enabled === undefined || typeof foreign.enabled === "boolean") &&
    [foreign.kind, foreign.jurisdiction, foreign.rawInput].every((v) => v === undefined || typeof v === "string") &&
    (foreign.articleResponseVersion === undefined || foreign.articleResponseVersion === 1) &&
    (foreign.parsedFields === undefined || object(foreign.parsedFields) && Object.values(foreign.parsedFields).every((v) => typeof v === "string"));
}
/** Typed foreign output is meaningful only together with the retained input. */
export function isUsableRecoveredCitation(result: CitationRecoveryResult, input: CitationRecoveryInput | null): boolean {
  if (typeof result.content === "string" && result.content.trim()) return true;
  const foreign = result.foreignLookup;
  if (!input?.foreignLookup || !object(foreign)) return false;
  const identity = foreign.identity;
  const fields = foreign.fields;
  const typedFields = object(fields) && Object.values(fields).every((v) => typeof v === "string");
  if (input.foreignLookup.kind === "journal_article" && typedFields && object(identity) && typeof identity.matched === "boolean" &&
      ["resolved", "incomplete", "conflict"].includes(String(foreign.articleResolution))) return true;
  if (typedFields && object(identity) && identity.matched === true && Object.values(fields).some((v) => String(v).trim())) return true;
  return Array.isArray(foreign.disambiguation) && foreign.disambiguation.length > 1 && foreign.disambiguation.every((choice) =>
    object(choice) && ["US", "UK"].includes(String(choice.jurisdiction)) && typeof choice.label === "string" && choice.label.trim() &&
    typeof choice.url === "string" && choice.url.trim());
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function parseCitationRecoveryPage(value: unknown, query: CitationRecoveryQuery = {}): CitationRecoveryPage {
  if (!object(value) || !jsonSafe(value) || bytes(value) > 2 * 1024 * 1024 || !exactKeys(value, ["requests", "nextCursor"]) ||
      !Array.isArray(value.requests) || value.requests.length > (query.limit ?? 50) ||
      !(value.nextCursor === null || validId(value.nextCursor))) return fail("CITATION_RECOVERY_INVALID_RESPONSE");
  const ids = new Set<string>();
  const requests = value.requests.map((item): CitationRecoveryRecord => {
    if (!object(item) || !exactKeys(item, ["requestId", "retryOfRequestId", "status", "createdAt", "expiresAt", "availability", "input", "result", "refundReceipt"]) ||
        !validId(item.requestId) || ids.has(item.requestId) || !(item.retryOfRequestId === null || validId(item.retryOfRequestId)) ||
        item.retryOfRequestId === item.requestId || !["in_progress", "succeeded", "failed", "unknown"].includes(String(item.status)) ||
        typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt)) ||
        typeof item.expiresAt !== "string" || !Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt) < Date.parse(item.createdAt) ||
        !["available", "pending", "expired", "unavailable"].includes(String(item.availability)) ||
        !(item.input === null || validInput(item.input)) ||
        !(item.result === null || object(item.result) && exactKeys(item.result, ["content", "foreignLookup"]) && bytes(item.result) <= 256 * 1024 &&
          (item.result.content === undefined || typeof item.result.content === "string") &&
          (item.result.foreignLookup === undefined || object(item.result.foreignLookup))) ||
        query.requestId && item.requestId !== query.requestId || query.parentRequestId && item.retryOfRequestId !== query.parentRequestId) return fail("CITATION_RECOVERY_INVALID_RESPONSE");
    ids.add(item.requestId);
    const record = { ...item, expiresAt: new Date(Math.min(Date.parse(item.expiresAt), Date.parse(item.createdAt) + 24 * 60 * 60 * 1000)).toISOString(), refundReceipt: citationRefundReceipt(item.status === "unknown" ? null : { refund_receipt: item.refundReceipt }, item.requestId) } as unknown as CitationRecoveryRecord;
    if (["expired", "unavailable"].includes(record.availability) && (record.input !== null || record.result !== null) ||
        record.status !== "succeeded" && record.result !== null || record.availability === "pending" && record.status !== "in_progress" ||
        record.availability === "available" && (!record.input || record.status === "in_progress" ||
          record.status === "succeeded" && (!record.result || !isUsableRecoveredCitation(record.result, record.input)))) return fail("CITATION_RECOVERY_INVALID_RESPONSE");
    // A response that crosses its expiry in transit cannot expose expired text.
    if (Date.parse(record.expiresAt) <= Date.now()) return { ...record, availability: "expired", input: null, result: null };
    return record;
  });
  if ((query.requestId || query.parentRequestId) && (requests.length > 1 || value.nextCursor !== null)) return fail("CITATION_RECOVERY_INVALID_RESPONSE");
  if (value.nextCursor !== null && (!requests.length || value.nextCursor !== requests[requests.length - 1].requestId)) return fail("CITATION_RECOVERY_INVALID_RESPONSE");
  return freeze({ requests, nextCursor: value.nextCursor as string | null });
}

type RecoveryClient = Pick<typeof supabase, "auth" | "functions">;
/** A read-only transport. It deliberately does not use invokeFunction: reads
 * cannot gain a paid identity, replay success callbacks or write failure logs. */
export class CitationRecoveryApi {
  constructor(private readonly client: RecoveryClient, private readonly identities: CitationRequestIdentity = citationRequests) {}

  private async session(accountId: string, isCurrent: () => boolean) {
    if (!accountId || !isCurrent()) return fail("CITATION_RETRY_STALE");
    const { data, error } = await this.client.auth.getSession();
    if (error || !isCurrent() || data.session?.user.id !== accountId) return fail("CITATION_RETRY_STALE");
    return data.session;
  }

  async list(accountId: string, query: CitationRecoveryQuery = {}, isCurrent: () => boolean = () => true): Promise<CitationRecoveryPage> {
    if (!object(query) || !exactKeys(query, ["requestId", "parentRequestId", "cursor", "limit"]) || bytes(query) > 4096 ||
        [query.requestId, query.parentRequestId, query.cursor].some((id) => id !== undefined && !validId(id)) ||
        [query.requestId, query.parentRequestId, query.cursor].filter((id) => id !== undefined).length > 1 ||
        query.limit !== undefined && (typeof query.limit !== "number" || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50)) return fail("CITATION_RECOVERY_INVALID_RESPONSE");
    const snapshot = { ...query };
    let session = await this.session(accountId, isCurrent);
    if (session.expires_at && session.expires_at * 1000 - Date.now() < 60_000) {
      const refreshed = await this.client.auth.refreshSession();
      if (refreshed.error || !isCurrent() || refreshed.data.session?.user.id !== accountId) return fail("CITATION_RETRY_STALE");
      session = await this.session(accountId, isCurrent);
    }
    let response;
    try {
      response = await this.client.functions.invoke("citation-recovery", { body: snapshot, headers: { Authorization: `Bearer ${session.access_token}` } });
    } catch { await this.session(accountId, isCurrent); return fail("CITATION_RECOVERY_UNAVAILABLE"); }
    await this.session(accountId, isCurrent);
    if (response.error) return fail("CITATION_RECOVERY_UNAVAILABLE");
    return parseCitationRecoveryPage(response.data, snapshot);
  }

  async read(accountId: string, requestId: string, isCurrent: () => boolean = () => true): Promise<CitationRecoveryRecord | null> {
    const page = await this.list(accountId, { requestId }, isCurrent);
    if (page.requests[0]) return page.requests[0];
    const metadata = await this.identities.findMetadata(accountId, requestId);
    await this.session(accountId, isCurrent);
    if (!metadata?.parentRequestId) return null;
    // A proposed child may lose the race before acquiring a server row. Query
    // its IMMEDIATE parent, never use the proposed ID as a parent (grandchild).
    const canonical = await this.list(accountId, { parentRequestId: metadata.parentRequestId }, isCurrent);
    const record = canonical.requests[0] ?? null;
    if (record) {
      await this.identities.adoptRecoveredChild(accountId, requestId, record.requestId);
      await this.session(accountId, isCurrent);
    }
    return record;
  }

  /** Explicit copy/save/finished-recovering acknowledgement only. Clears just
   * the delivered success slot; unresolved operations and all tombstones stay. */
  async acknowledge(accountId: string, requestId: string, isCurrent: () => boolean = () => true): Promise<void> {
    const record = await this.read(accountId, requestId, isCurrent);
    if (!record || record.status !== "succeeded" || record.availability !== "available" || !record.input || !record.result ||
        !isUsableRecoveredCitation(record.result, record.input) || Date.parse(record.expiresAt) <= Date.now()) {
      return fail("CITATION_RECOVERY_INPUT_UNAVAILABLE");
    }
    await this.session(accountId, isCurrent);
    await this.identities.acknowledgeRecoveredSuccess(accountId, record.requestId,
      () => isCurrent() && Date.parse(record.expiresAt) > Date.now());
    await this.session(accountId, isCurrent);
  }

  async prepareRetry(accountId: string, requestId: string, isCurrent: () => boolean = () => true): Promise<CitationRetryDescriptor> {
    const record = await this.read(accountId, requestId, isCurrent);
    if (!record || record.status !== "failed" || record.availability !== "available" || !record.input || Date.parse(record.expiresAt) <= Date.now()) {
      return fail("CITATION_RECOVERY_INPUT_UNAVAILABLE");
    }
    await this.session(accountId, isCurrent);
    const descriptor = await this.identities.restoreFailed(accountId, { ...record.input }, record, isCurrent);
    await this.session(accountId, isCurrent);
    if (Date.parse(record.expiresAt) <= Date.now()) return fail("CITATION_RECOVERY_INPUT_UNAVAILABLE");
    return descriptor;
  }
}
export const citationRecoveryApi = new CitationRecoveryApi(supabase);
export const listCitationRecovery = (accountId: string, query?: CitationRecoveryQuery, isCurrent?: () => boolean) => citationRecoveryApi.list(accountId, query, isCurrent);
export const readCitationRecovery = (accountId: string, requestId: string, isCurrent?: () => boolean) => citationRecoveryApi.read(accountId, requestId, isCurrent);
export const prepareCitationRecoveryRetry = (accountId: string, requestId: string, isCurrent?: () => boolean) => citationRecoveryApi.prepareRetry(accountId, requestId, isCurrent);

export const acknowledgeRecoveredCitation = (accountId: string, requestId: string, isCurrent?: () => boolean) => citationRecoveryApi.acknowledge(accountId, requestId, isCurrent);
