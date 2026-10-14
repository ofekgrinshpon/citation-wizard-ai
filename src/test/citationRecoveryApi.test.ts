import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CitationRequestIdentity, citationRequests } from "@/lib/citationRequestIdentity";
import { IndexedDbCitationRecoveryJournal } from "@/lib/citationRecoveryJournal";
import { MemoryCitationJournal } from "./fixtures/memoryCitationJournal";
import { CitationRecoveryApi, parseCitationRecoveryPage, type CitationRecoveryRecord } from "@/lib/citationRecoveryApi";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {}, functions: {} } }));
const account = "recovery-account";
const input = () => ({ messages: [{ role: "user", content: "Exact preserved citation input" }], rawInput: null, foreignLookup: null, batchId: null });
const record = (overrides: Partial<CitationRecoveryRecord> = {}): CitationRecoveryRecord => ({
  requestId: "original-request-0001", retryOfRequestId: null, status: "succeeded",
  createdAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
  availability: "available", input: input(), result: { content: "Recovered citation" },
  refundReceipt: { status: "retained", refunded: false, units_refunded: 0, request_id: "original-request-0001" }, ...overrides,
});
const page = (...requests: CitationRecoveryRecord[]) => ({ requests, nextCursor: null });
function setup() {
  const session = (id = account) => ({ user: { id }, access_token: `token-${id}`, expires_at: Date.now() / 1000 + 3600 });
  const client = { auth: { getSession: vi.fn(async () => ({ data: { session: session() }, error: null })),
    refreshSession: vi.fn(async () => ({ data: { session: session() }, error: null })) },
    functions: { invoke: vi.fn(async (_name: string, _options: { body: Record<string, unknown>; headers: Record<string, string> }) => ({ data: page(record()), error: null })) } };
  const journal = new MemoryCitationJournal();
  const identities = new CitationRequestIdentity(256, journal);
  const api = new CitationRecoveryApi(client as never, identities);
  return { client, journal, identities, api, session };
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network forbidden"); })); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("read-only account-bound recovery API", () => {
  it("uses only citation-recovery with bound JWT, validates and freezes the returned page", async () => {
    const { client, api } = setup();
    const value = await api.list(account, { limit: 20 });
    expect(client.functions.invoke).toHaveBeenCalledWith("citation-recovery", { body: { limit: 20 }, headers: { Authorization: `Bearer token-${account}` } });
    expect(Object.isFrozen(value.requests[0].input!.messages[0])).toBe(true);
    expect(client.auth.getSession).toHaveBeenCalledTimes(2);
  });
  it("does not dispatch for a different account or stale view", async () => {
    const { client, api } = setup();
    await expect(api.list("another-account")).rejects.toThrow("CITATION_RETRY_STALE");
    await expect(api.list(account, {}, () => false)).rejects.toThrow("CITATION_RETRY_STALE");
    expect(client.functions.invoke).not.toHaveBeenCalled();
  });
  it("discards results after account switch even without a view callback", async () => {
    const { client, api, session } = setup();
    client.functions.invoke.mockImplementationOnce(async () => {
      client.auth.getSession.mockResolvedValue({ data: { session: session("other-account") }, error: null });
      return { data: page(record()), error: null };
    });
    await expect(api.list(account)).rejects.toThrow("CITATION_RETRY_STALE");
    expect(client.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it("checks staleness after the transport await", async () => {
    const { client, api } = setup();
    let current = true;
    client.functions.invoke.mockImplementationOnce(async () => { current = false; return { data: page(record()), error: null }; });
    await expect(api.list(account, {}, () => current)).rejects.toThrow("CITATION_RETRY_STALE");
  });
  it("does not refresh into or transmit under another account", async () => {
    const { client, api, session } = setup();
    client.auth.getSession.mockResolvedValueOnce({ data: { session: { ...session(), expires_at: Date.now() / 1000 } }, error: null });
    client.auth.refreshSession.mockResolvedValueOnce({ data: { session: session("other-account") }, error: null });
    await expect(api.list(account)).rejects.toThrow("CITATION_RETRY_STALE");
    expect(client.functions.invoke).not.toHaveBeenCalled();
  });
  it("returns empty exact lookup as unknown absence, with no paid fallback", async () => {
    const { client, api } = setup(); client.functions.invoke.mockResolvedValue({ data: page(), error: null });
    expect(await api.read(account, "missing-request-0001")).toBeNull();
    expect(client.functions.invoke.mock.calls.map(([name]) => name)).toEqual(["citation-recovery"]);
  });
  it("discovers a missing proposed child through its immediate parent and durably adopts that child", async () => {
    const { client, api, identities, journal } = setup();
    const failed = await identities.invoke(account, input(), "project-scope", async (body) => ({ errorInfo: {
      code: "AI_REFUSED", body: { status: "failed", requestId: body.requestId }, citationRetry: undefined as import("@/lib/citationRequestIdentity").CitationRetryDescriptor | undefined,
    } }));
    const descriptor = failed.errorInfo.citationRetry!;
    let proposed = "";
    await identities.invoke(account, input(), "project-scope", async (body) => { proposed = String(body.requestId); return { errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN" } }; }, () => true, descriptor);
    const canonical = record({ requestId: "canonical-child-0001", retryOfRequestId: descriptor.failedRequestId, status: "failed", result: null });
    client.functions.invoke.mockResolvedValueOnce({ data: page(), error: null }).mockResolvedValueOnce({ data: page(canonical), error: null });
    expect((await api.read(account, proposed))?.requestId).toBe(canonical.requestId);
    expect(client.functions.invoke.mock.calls.map(([, options]) => options.body)).toEqual([
      { requestId: proposed }, { parentRequestId: descriptor.failedRequestId },
    ]);
    expect((await journal.find(account, canonical.requestId))?.projectId).toBe("project-scope");
    expect((await journal.find(account, proposed))?.parentRequestId).toBe(descriptor.failedRequestId);
    const dispatch = vi.fn(async (_body: Record<string, unknown>) => ({ errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN" } }));
    await new CitationRequestIdentity(256, journal).invoke(account, input(), "project-scope", dispatch);
    expect(dispatch.mock.calls[0][0].requestId).toBe(canonical.requestId);
  });
  it.each([{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { requestId: "short" },
    { requestId: "request-id-0001", parentRequestId: "parent-id-0001" }, { cursor: "x" }, { rogue: true }])("rejects invalid queries %# without any call", async (query) => {
    const { client, api } = setup();
    await expect(api.list(account, query as never)).rejects.toThrow("CITATION_RECOVERY_INVALID_RESPONSE");
    expect(client.functions.invoke).not.toHaveBeenCalled();
  });
  it("treats transport failure as unavailable without citation execution or silent retry", async () => {
    const { client, api } = setup(); client.functions.invoke.mockRejectedValueOnce(new Error("lost connection"));
    await expect(api.list(account)).rejects.toThrow("CITATION_RECOVERY_UNAVAILABLE");
    expect(client.functions.invoke).toHaveBeenCalledTimes(1);
  });
});

describe("bounded recovery response and receipt validation", () => {
  it.each([{}, { requests: [], nextCursor: "bad" }, { requests: Array(51).fill(record()), nextCursor: null },
    page(record({ requestId: "short" })), page(record({ status: "other" as never })),
    page(record({ input: { ...input(), authToken: "secret" } as never })),
    page(record({ result: { content: "x".repeat(256 * 1024 + 1) } })),
    page(record({ availability: "expired" })), page(record({ availability: "pending" })),
    page(record({ status: "failed" })), page(record(), record()),
  ])("rejects malformed/oversized schema %#", (value) => {
    expect(() => parseCitationRecoveryPage(value)).toThrow("CITATION_RECOVERY_INVALID_RESPONSE");
  });
  it("caps the transport page at 2 MiB", () => {
    const records = Array.from({ length: 12 }, (_, i) => record({ requestId: `long-request-${i}`, result: { content: "x".repeat(200_000) } }));
    expect(() => parseCitationRecoveryPage(page(...records))).toThrow("CITATION_RECOVERY_INVALID_RESPONSE");
  });
  it("validates exact request and immediate-parent filtering and cursor consistency", () => {
    expect(() => parseCitationRecoveryPage(page(record()), { requestId: "different-request" })).toThrow();
    expect(() => parseCitationRecoveryPage(page(record()), { parentRequestId: "different-parent" })).toThrow();
    expect(() => parseCitationRecoveryPage({ ...page(record()), nextCursor: "unreturned-cursor" })).toThrow();
    expect(parseCitationRecoveryPage({ ...page(record()), nextCursor: record().requestId }).nextCursor).toBe(record().requestId);
  });
  it("keeps batch-anchor receipt semantics, but malformed claimed refunds become unconfirmed", () => {
    const batch = record({ refundReceipt: { status: "refunded", refunded: true, units_refunded: 1, request_id: "batch-anchor-0001" } });
    expect(parseCitationRecoveryPage(page(batch)).requests[0].refundReceipt.refunded).toBe(true);
    batch.refundReceipt = { ...batch.refundReceipt, units_refunded: 0 };
    expect(parseCitationRecoveryPage(page(batch)).requests[0].refundReceipt.status).toBe("unconfirmed");
  });
  it("never reports a confirmed refund for an unknown operation", () => {
    const unknown = record({ status: "unknown", result: null,
      refundReceipt: { status: "refunded", refunded: true, units_refunded: 1, request_id: "batch-anchor-0001" } });
    expect(parseCitationRecoveryPage(page(unknown)).requests[0].refundReceipt).toMatchObject({ status: "unconfirmed", refunded: false });
  });
  it("requires retained input for structured foreign output and accepts typed partial article output", () => {
    const article = record({ result: { foreignLookup: { fields: {}, identity: { matched: false }, articleResolution: "incomplete" } },
      input: { ...input(), foreignLookup: { enabled: true, kind: "journal_article", articleResponseVersion: 1 } } });
    expect(parseCitationRecoveryPage(page(article)).requests[0].result).toEqual(article.result);
    expect(() => parseCitationRecoveryPage(page({ ...article, input: null }))).toThrow();
    expect(() => parseCitationRecoveryPage(page({ ...article, input: input() }))).toThrow();
  });
  it("redacts content that expires during transit and caps overlong expiry to 24h", () => {
    const old = record({ createdAt: new Date(Date.now() - 25 * 3600_000).toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    const read = parseCitationRecoveryPage(page(old)).requests[0];
    expect(read.availability).toBe("expired"); expect(read.input).toBeNull(); expect(read.result).toBeNull();
    expect(Date.parse(read.expiresAt) - Date.parse(read.createdAt)).toBe(24 * 3600_000);
  });
});

describe("authoritative recovery retry and explicit successful acknowledgement", () => {
  it("prepares no paid work; explicit retry preserves retained nulls, exact text, version and immediate ancestry", async () => {
    const { api, client, identities } = setup();
    const failed = record({ status: "failed", result: null });
    client.functions.invoke.mockResolvedValue({ data: page(failed), error: null });
    const descriptor = await api.prepareRetry(account, failed.requestId);
    expect(client.functions.invoke.mock.calls.every(([name]) => name === "citation-recovery")).toBe(true);
    const retained = identities.retryInput(descriptor);
    expect(retained.body).toEqual(failed.input);
    const execute = vi.fn(async (_body: Record<string, unknown>) => ({ errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN" } }));
    await identities.invoke(account, retained.body, retained.projectId, execute, () => true, descriptor);
    expect(execute.mock.calls[0][0]).toMatchObject({ ...input(), citationRequestVersion: 3, retryOfRequestId: failed.requestId });
    expect(execute.mock.calls[0][0].requestId).not.toBe(failed.requestId);
  });
  it.each(["unknown", "in_progress", "succeeded"])("never grants retry capability for %s", async (status) => {
    const { client, api } = setup();
    client.functions.invoke.mockResolvedValue({ data: page(record({ status: status as never, result: status === "succeeded" ? { content: "success" } : null,
      availability: status === "in_progress" ? "pending" : "available" })), error: null });
    await expect(api.prepareRetry(account, "original-request-0001")).rejects.toThrow("CITATION_RECOVERY_INPUT_UNAVAILABLE");
  });
  it.each(["expired", "unavailable"])("never grants retry for %s payload", async (availability) => {
    const { client, api } = setup();
    client.functions.invoke.mockResolvedValue({ data: page(record({ status: "failed", result: null, input: null, availability: availability as never })), error: null });
    await expect(api.prepareRetry(account, "original-request-0001")).rejects.toThrow("CITATION_RECOVERY_INPUT_UNAVAILABLE");
  });
  it("canonical failed-list recovery keeps original project scope and exact server input, without old telemetry extras", async () => {
    const { client, api, identities, journal } = setup();
    const failed = await identities.invoke(account, { ...input(), telemetryRequestId: "old-trace", citationDiagnostic: { secret: "not-recovery-input" } }, "original-project",
      async (body) => ({ errorInfo: { code: "AI_REFUSED", body: { status: "failed", requestId: body.requestId }, citationRetry: undefined as import("@/lib/citationRequestIdentity").CitationRetryDescriptor | undefined } }));
    const parent = failed.errorInfo.citationRetry!;
    let proposed = "";
    await identities.invoke(account, input(), "original-project", async (body) => { proposed = String(body.requestId); return { errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN" } }; }, () => true, parent);
    const canonical = record({ requestId: "canonical-listed-child", retryOfRequestId: parent.failedRequestId, status: "failed", result: null });
    client.functions.invoke.mockResolvedValue({ data: page(canonical), error: null });
    const descriptor = await api.prepareRetry(account, canonical.requestId);
    const retained = identities.retryInput(descriptor);
    expect(retained.projectId).toBe("original-project");
    expect(retained.body).toEqual(input());
    expect((await journal.find(account, proposed))?.parentRequestId).toBe(parent.failedRequestId);
    const execute = vi.fn(async (_body: Record<string, unknown>) => ({ errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN" } }));
    await identities.invoke(account, retained.body, retained.projectId, execute, () => true, descriptor);
    expect(execute.mock.calls[0][0].retryOfRequestId).toBe(canonical.requestId);
  });
  it("repeated parent restoration keeps one bounded handle while its canonical child is unresolved", async () => {
    const { client, api, identities } = setup();
    const failed = record({ status: "failed", result: null });
    client.functions.invoke.mockResolvedValue({ data: page(failed), error: null });
    const first = await api.prepareRetry(account, failed.requestId);
    await identities.invoke(account, input(), null, async () => ({ errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN" } }), () => true, first);
    for (let i = 0; i < 10; i++) expect((await api.prepareRetry(account, failed.requestId)).handle).toBe(first.handle);
    expect((identities as unknown as { retries: Map<string, unknown> }).retries.size).toBe(1);
  });
  it("recovered failure capabilities expire before a later paid gesture", async () => {
    const { client, api, identities } = setup();
    const expiry = Date.now() + 10_000;
    client.functions.invoke.mockResolvedValue({ data: page(record({ status: "failed", result: null, expiresAt: new Date(expiry).toISOString() })), error: null });
    const descriptor = await api.prepareRetry(account, "original-request-0001");
    vi.spyOn(Date, "now").mockReturnValue(expiry + 1);
    expect(() => identities.retryInput(descriptor)).toThrow("CITATION_RETRY_STALE");
    const execute = vi.fn(async (_body: Record<string, unknown>) => ({ errorInfo: null }));
    await expect(identities.invoke(account, input(), null, execute, () => true, descriptor)).rejects.toThrow("CITATION_RETRY_STALE");
    expect(execute).not.toHaveBeenCalled();
  });
  it("requires a fresh server read rather than taking a supplied failure record", async () => {
    const { client, api } = setup(); client.functions.invoke.mockResolvedValue({ data: page(), error: null });
    await expect(api.prepareRetry(account, "original-request-0001")).rejects.toThrow("CITATION_RECOVERY_INPUT_UNAVAILABLE");
    expect(client.functions.invoke).toHaveBeenCalledTimes(1);
  });
  it("fails closed on storage failure before a retry capability is returned", async () => {
    const { client, api, journal } = setup(); journal.fail = true;
    client.functions.invoke.mockResolvedValue({ data: page(record({ status: "failed", result: null })), error: null });
    await expect(api.prepareRetry(account, "original-request-0001")).rejects.toThrow("CITATION_RECOVERY_STORAGE_UNAVAILABLE");
  });
  it("releases only an explicitly acknowledged success slot, keeping attempt metadata and unrelated unknown slots", async () => {
    const { api, client, identities, journal } = setup();
    let id = "";
    await identities.invoke(account, input(), null, async (body) => { id = String(body.requestId); return { errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN" } }; });
    await identities.invoke(account, { messages: [{ role: "user", content: "Unrelated unknown" }] }, null, async () => ({ errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN" } }));
    client.functions.invoke.mockResolvedValue({ data: page(record({ requestId: id })), error: null });
    await api.list(account); expect(journal.slots.size).toBe(2);
    await api.acknowledge(account, id); expect(journal.slots.size).toBe(1);
    expect((await journal.find(account, id))?.requestId).toBe(id);
    const execute = vi.fn(async (_body: Record<string, unknown>) => ({ errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN" } }));
    await identities.invoke(account, input(), null, execute);
    expect(execute.mock.calls[0][0].requestId).not.toBe(id);
  });
  it("does not retire unknown or failed operations as delivered", async () => {
    const { api, client, identities, journal } = setup();
    let id = "";
    await identities.invoke(account, input(), null, async (body) => { id = String(body.requestId); return { errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN" } }; });
    for (const status of ["unknown", "failed"] as const) {
      client.functions.invoke.mockResolvedValue({ data: page(record({ requestId: id, status, result: null })), error: null });
      await expect(api.acknowledge(account, id)).rejects.toThrow("CITATION_RECOVERY_INPUT_UNAVAILABLE");
      expect(journal.slots.size).toBe(1);
    }
  });
});

describe("production durability is not silently replaced by test memory", () => {
  it("never replaces an explicitly replayed delivered ID or rebinds it to changed input", async () => {
    const journal = new MemoryCitationJournal(), identities = new CitationRequestIdentity(256, journal);
    const request = { ...input(), requestId: "immutable-request-0001" };
    const charged = new Set<string>();
    const execute = vi.fn(async (body: Record<string, unknown>) => {
      charged.add(String(body.requestId)); return { errorInfo: null };
    });
    await identities.invoke(account, request, null, execute);
    await new CitationRequestIdentity(256, journal).invoke(account, request, null, execute);
    expect(execute.mock.calls.map(([body]) => body.requestId)).toEqual([request.requestId, request.requestId]);
    expect(charged.size).toBe(1);
    await expect(identities.invoke(account, { ...request, rawInput: "different payload" }, null, execute)).rejects.toThrow("REQUEST_FINGERPRINT_MISMATCH");
    expect(execute).toHaveBeenCalledTimes(2);
    await identities.invoke(account, { ...request, requestId: "genuinely-fresh-id" }, null, execute);
    expect(charged.size).toBe(2);
  });
  it.each(["view", "account-memory"])("keeps durable identity if %s changes while successful delivery waits for its commit", async (interruption) => {
    const entered = deferred<void>(), resume = deferred<void>();
    class PausedDeliveryJournal extends MemoryCitationJournal {
      override async delivered(entry: import("@/lib/citationRecoveryJournal").CitationJournalEntry, canCommit?: () => boolean): Promise<void> {
        entered.resolve();
        await resume.promise;
        return super.delivered(entry, canCommit);
      }
    }
    const journal = new PausedDeliveryJournal();
    const identities = new CitationRequestIdentity(256, journal);
    let current = true;
    let originalId = "";
    const execute = vi.fn(async (body: Record<string, unknown>) => {
      originalId = String(body.requestId);
      return { errorInfo: null };
    });
    const pending = identities.invoke(account, input(), null, execute, () => current);
    await entered.promise;
    if (interruption === "view") current = false;
    else identities.clearMemory(account);
    resume.resolve();
    await expect(pending).rejects.toThrow("CITATION_RETRY_STALE");
    expect(journal.slots.size).toBe(1);
    expect([...journal.slots.values()][0].requestId).toBe(originalId);
    // A recreated UI/registry can only retry the same guarded request. It
    // cannot allocate a fresh paid ID for an unacknowledged successful result.
    const replay = vi.fn(async (_body: Record<string, unknown>) => ({ errorInfo: { code: "REQUEST_OUTCOME_UNKNOWN" } }));
    await new CitationRequestIdentity(256, journal).invoke(account, input(), null, replay);
    expect(replay.mock.calls[0][0].requestId).toBe(originalId);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("default constructor and global singleton block dispatch when IndexedDB is absent", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const execute = vi.fn(async (_body: Record<string, unknown>) => ({ errorInfo: null }));
    for (const identities of [new CitationRequestIdentity(), citationRequests]) {
      await expect(identities.invoke(account, input(), null, execute)).rejects.toThrow("CITATION_RECOVERY_STORAGE_UNAVAILABLE");
    }
    expect(execute).not.toHaveBeenCalled();
  });
  it("denied open and transaction failure have actionable fail-closed errors", async () => {
    const factory = { open: () => { throw new DOMException("blocked", "SecurityError"); } } as unknown as IDBFactory;
    const journal = new IndexedDbCitationRecoveryJournal("unit-test", factory);
    const identities = new CitationRequestIdentity(256, journal);
    const execute = vi.fn(async (_body: Record<string, unknown>) => ({ errorInfo: null }));
    await expect(identities.invoke(account, input(), null, execute)).rejects.toThrow("CITATION_RECOVERY_STORAGE_UNAVAILABLE");
    expect(execute).not.toHaveBeenCalled();
  });
  it("refuses a runtime that cannot honor strict durable transactions", async () => {
    const abort = vi.fn(), close = vi.fn();
    const factory = { open: () => {
      const request = { result: { close, transaction: () => ({ durability: "relaxed", abort }) }, onsuccess: null as null | (() => void) };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    } } as unknown as IDBFactory;
    const identities = new CitationRequestIdentity(256, new IndexedDbCitationRecoveryJournal("unit-test", factory));
    const execute = vi.fn(async (_body: Record<string, unknown>) => ({ errorInfo: null }));
    await expect(identities.invoke(account, input(), null, execute)).rejects.toThrow("CITATION_RECOVERY_STORAGE_UNAVAILABLE");
    expect(abort).toHaveBeenCalledOnce(); expect(execute).not.toHaveBeenCalled();
  });
  it("explicit shared-journal unit double preserves distinct-instance root and child identity beyond the content TTL", async () => {
    const journal = new MemoryCitationJournal();
    const a = new CitationRequestIdentity(256, journal), b = new CitationRequestIdentity(256, journal);
    const execute = vi.fn(async (body: Record<string, unknown>) => ({ errorInfo: { code: "AI_REFUSED", body: { requestId: body.requestId, status: "failed" }, citationRetry: undefined as import("@/lib/citationRequestIdentity").CitationRetryDescriptor | undefined } }));
    const roots = await Promise.all([a.invoke(account, input(), null, execute), b.invoke(account, input(), null, execute)]);
    expect(roots[0].errorInfo.citationRetry!.failedRequestId).toBe(roots[1].errorInfo.citationRetry!.failedRequestId);
    const children = await Promise.all([a.invoke(account, input(), null, execute, () => true, roots[0].errorInfo.citationRetry), b.invoke(account, input(), null, execute, () => true, roots[1].errorInfo.citationRetry)]);
    expect(children[0].errorInfo.citationRetry!.failedRequestId).toBe(children[1].errorInfo.citationRetry!.failedRequestId);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 7 * 24 * 3600_000);
    const restored = await new CitationRequestIdentity(256, journal).invoke(account, input(), null, execute);
    expect(restored.errorInfo.citationRetry!.failedRequestId).toBe(children[0].errorInfo.citationRetry!.failedRequestId);
    for (const entry of journal.requests.values()) expect(Object.keys(entry).sort()).toEqual(["accountId", "key", "keyVersion", "requestId", "parentRequestId", "projectId", "createdAt"].sort());
    vi.useRealTimers();
  });
});
