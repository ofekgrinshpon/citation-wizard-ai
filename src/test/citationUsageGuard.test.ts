import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CitationUsageGuard, citationFingerprint, citationRefundReceipt, withCitationProviderOutcome, observeCitationProviderFetch } from "../../supabase/functions/_shared/citationUsageGuard";

beforeAll(() => { vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("TextEncoder", TextEncoder); });
afterAll(() => vi.unstubAllGlobals());

const payload = { messages: [{ role: "user", content: "Source citation" }], rawInput: "Source", foreignLookup: { enabled: true, kind: "journal_article", parsedFields: { title: "Work", author: "Author" } }, batchId: null };

describe("canonical citation request fingerprints", () => {
  it("does not change with JSON object key order", async () => {
    const a = await citationFingerprint(payload);
    const b = await citationFingerprint({ batchId: null, foreignLookup: { parsedFields: { author: "Author", title: "Work" }, kind: "journal_article", enabled: true }, rawInput: "Source", messages: [{ content: "Source citation", role: "user" }] });
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(b);
  });
  it.each([
    { messages: [{ role: "system", content: "Source citation" }] },
    { messages: [{ role: "user", content: "Different source" }] },
    { messages: [{ role: "assistant", content: "Prior answer" }, ...payload.messages] },
    { rawInput: "Different raw input" },
    { foreignLookup: { ...payload.foreignLookup, articleResponseVersion: 1 } },
    { foreignLookup: { ...payload.foreignLookup, parsedFields: { title: "Different work" } } },
    { batchId: "another-batch" },
  ])("binds each paid-work input %#", async (change) => {
    expect(await citationFingerprint({ ...payload, ...change })).not.toBe(await citationFingerprint(payload));
  });
});

describe("execution capability and terminal write handling", () => {
  it("does not expose a terminal decision without an execution token", async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true, execute: false, status: "succeeded" }, error: null }));
    const guard = new CitationUsageGuard({ rpc }, "user", "request-1");
    await guard.begin(await citationFingerprint(payload), null, null, payload);
    expect(await guard.finish("failed", "caller_wants_refund")).toEqual({ confirmed: false, refunded: false });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("never changes its terminal decision after an RPC throws", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { ok: true, execute: true, status: "in_progress", request_id: "request-1", retry_of_request_id: null, attempt_token: "token" }, error: null }).mockRejectedValueOnce(new Error("write result lost"));
    const guard = new CitationUsageGuard({ rpc }, "user", "request-1");
    await guard.begin(await citationFingerprint(payload), null, null, payload);
    expect(await guard.finish("succeeded", "delivered", { content: "Delivered citation" })).toEqual({ confirmed: false, refunded: false });
    expect(await guard.finish("failed", "late_error")).toEqual({ confirmed: false, refunded: false });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it.each([
    { ok: false, status: "failed", refunded: true },
    { ok: true, status: "succeeded", refunded: true },
    { ok: true, status: "failed", refunded: false },
    { ok: true, status: "failed", refunded: true },
    { ok: true, status: "failed", refunded: false, refund_receipt: { status: "refunded", refunded: true, units_refunded: 1, request_id: "request-1" } },
  ])("only confirms a refund with matching terminal state and exact success flag %#", async (terminal) => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { ok: true, execute: true, status: "in_progress", request_id: "request-1", retry_of_request_id: null, attempt_token: "token" }, error: null }).mockResolvedValueOnce({ data: terminal, error: null });
    const guard = new CitationUsageGuard({ rpc }, "user", "request-1");
    await guard.begin(await citationFingerprint(payload), null, null, payload);
    expect((await guard.finish("failed", "provider_rejected")).refunded).toBe(false);
  });
});

describe("explicit successor and refund receipt protocol", () => {
  it("binds a new execution capability to the exact requested successor and parent", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, execute: true, status: "in_progress", request_id: "child-id", retry_of_request_id: "parent-id", attempt_token: "child-token" }, error: null });
    const guard = new CitationUsageGuard({ rpc }, "user", "child-id");
    expect((await guard.begin(await citationFingerprint({ ...payload, batchId: "batch-id" }), "batch-id", "parent-id", { ...payload, batchId: "batch-id" })).execute).toBe(true);
    expect(rpc).toHaveBeenCalledWith("begin_citation_request", { _user_id: "user", _request_id: "child-id", _fingerprint: await citationFingerprint({ ...payload, batchId: "batch-id" }), _batch_id: "batch-id", _retry_of_request_id: "parent-id", _recovery_input: { ...payload, batchId: "batch-id" } });
  });
  it.each([
    { request_id: "other-id", retry_of_request_id: "parent-id" },
    { request_id: "child-id", retry_of_request_id: "other-parent" },
    { request_id: "child-id" },
  ])("rejects an execution capability with mismatched or missing ancestry %#", async (identity) => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, execute: true, status: "in_progress", attempt_token: "token", ...identity }, error: null });
    const guard = new CitationUsageGuard({ rpc }, "user", "child-id");
    expect((await guard.begin(await citationFingerprint(payload), null, "parent-id", payload)).execute).toBe(false);
    expect((await guard.finish("failed", "no-capability")).confirmed).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("preserves canonical existing child metadata without granting execution or terminal authority", async () => {
    const reply = { ok: true, execute: false, request_id: "canonical-child", retry_of_request_id: "parent-id", status: "failed" };
    const rpc = vi.fn().mockResolvedValue({ data: reply, error: null });
    const guard = new CitationUsageGuard({ rpc }, "user", "losing-child-id");
    expect(await guard.begin(await citationFingerprint(payload), null, "parent-id", payload)).toEqual(reply);
    expect(await guard.finish("failed", "duplicate")).toEqual({ confirmed: false, refunded: false });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["retained", "deferred", "review_required", "not_charged", "not_applicable", "unconfirmed"])("preserves %s without claiming a refund", (status) => {
    expect(citationRefundReceipt({ status, refunded: false, units_refunded: 0, request_id: "anchor" })).toEqual({ status, refunded: false, units_refunded: 0, request_id: "anchor" });
  });
  it.each([
    null, {}, { status: "refunded", refunded: false, units_refunded: 1, request_id: "anchor" },
    { status: "refunded", refunded: true, units_refunded: 0, request_id: "anchor" },
    { status: "deferred", refunded: true, units_refunded: 1, request_id: "anchor" },
    { status: "refunded", refunded: true, units_refunded: 1.5, request_id: "anchor" },
  ])("ignores contradictory or malformed receipts %#", (receipt) => {
    expect(citationRefundReceipt(receipt)).toBeUndefined();
  });
  it("confirms a refunded unit only with matching terminal and ledger receipt", async () => {
    const receipt = { status: "refunded", refunded: true, units_refunded: 1, request_id: "request-1" };
    const rpc = vi.fn().mockResolvedValueOnce({ data: { ok: true, execute: true, status: "in_progress", request_id: "request-1", retry_of_request_id: null, attempt_token: "token" }, error: null }).mockResolvedValueOnce({ data: { ok: true, status: "failed", refunded: true, refund_receipt: receipt }, error: null });
    const guard = new CitationUsageGuard({ rpc }, "user", "request-1");
    await guard.begin(await citationFingerprint(payload), null, null, payload);
    expect(await guard.finish("failed", "rejected")).toEqual({ confirmed: true, refunded: true, refundReceipt: receipt });
  });
});


it("treats a status-zero response as an unknown outcome without refund authority", async () => {
  await withCitationProviderOutcome(async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { ok: true, execute: true, status: "in_progress", request_id: "request-1", retry_of_request_id: null, attempt_token: "token" }, error: null }).mockResolvedValueOnce({ data: { ok: true, status: "unknown", refunded: false }, error: null });
    const guard = new CitationUsageGuard({ rpc }, "user", "request-1");
    await guard.begin(await citationFingerprint(payload), null, null, payload);
    await observeCitationProviderFetch(async () => ({ status: 0 }) as Response);
    expect(await guard.finish("failed", "non-ok-response")).toEqual({ confirmed: false, refunded: false });
    expect(rpc.mock.calls[1][1]).toMatchObject({ _outcome: "unknown", _reason: "upstream_provider_outcome_unknown" });
  });
});
