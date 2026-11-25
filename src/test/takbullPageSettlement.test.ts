import { describe, expect, it, vi } from "vitest";
import { createTakbullPageObserver } from "../../supabase/functions/takbull-page-observer/handler";
import { settleAuthenticatedPagePayment } from "../../supabase/functions/_shared/takbullPageSettlement";

// Synthetic signing material, never a merchant key.
export const TEST_KEY = "synthetic-local-test-key-not-a-real-secret";
export const TEST_NOW = 1700000000000;
export async function signedRequest(payload: unknown, overrides: { key?: string; timestamp?: number; body?: string } = {}) {
  const body = overrides.body ?? JSON.stringify(payload);
  const t = String(overrides.timestamp ?? TEST_NOW / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(overrides.key ?? TEST_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  const mac = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return new Request("https://synthetic.test/webhook", { method: "POST", headers: { "content-type": "application/json", "x-takbull-signature": `t=${t},v1=${mac}` }, body });
}
const payload = { ExternalCustomerId: `rlx_${"a".repeat(32)}`, TransactionId: 101, OrderNumber: 8, OrderTotalSum: 39, OrderStatus: 2, StatusCode: 0 };

describe("raw-body HMAC gates payment settlement", () => {
  it("each 401 logs exactly one fixed reason and keeps the empty 401 response", async () => {
    const reasons: string[] = [];
    let clock = TEST_NOW;
    const settle = vi.fn(async () => "accepted" as const);
    const observer = createTakbullPageObserver({ readActive: () => true, readPageKey: () => TEST_KEY, record: vi.fn(), now: () => clock, settle, reject: r => reasons.push(r) });
    const good = await signedRequest(payload);
    const noHeader = new Request(good.url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const badHeader = new Request(good.url, { method: "POST", headers: { "content-type": "application/json", "x-takbull-signature": "t=1,v1=zz" }, body: "{}" });
    const sig = good.headers.get("x-takbull-signature")!;
    const emptyBody = new Request(good.url, { method: "POST", headers: { "content-type": "application/json", "x-takbull-signature": sig } });
    const cases: [Request, string][] = [
      [noHeader, "header_missing"], [badHeader, "header_malformed"],
      [await signedRequest(payload, { timestamp: TEST_NOW / 1000 - 301 }), "timestamp_skew"],
      [emptyBody, "body_read_failed"],
      [await signedRequest(payload, { key: "different-synthetic-key" }), "signature_mismatch"],
    ];
    for (const [req, reason] of cases) {
      reasons.length = 0;
      const res = await observer(req);
      expect(res.status).toBe(401);
      expect(await res.text()).toBe("");
      expect([...res.headers.keys()].sort()).toEqual(["cache-control", "x-content-type-options"]);
      expect(reasons).toEqual([reason]);
    }
    // A throwing logger cannot change the response; valid requests log nothing.
    const throwing = createTakbullPageObserver({ readActive: () => true, readPageKey: () => TEST_KEY, record: vi.fn(), now: () => clock, settle, reject: () => { throw new Error("x"); } });
    expect((await throwing(noHeader.clone())).status).toBe(401);
    reasons.length = 0; clock = TEST_NOW;
    expect((await observer(await signedRequest(payload))).status).toBe(204);
    expect(reasons).toEqual([]);
    expect(settle).toHaveBeenCalledTimes(1);
  });
  it("valid signatures reach settlement and successful settlement acknowledges with 204", async () => {
    const settle = vi.fn(async () => "accepted" as const);
    const observer = createTakbullPageObserver({ readActive: () => true, readPageKey: () => TEST_KEY, record: vi.fn(), now: () => TEST_NOW, settle });
    expect((await observer(await signedRequest(payload))).status).toBe(204);
    expect(settle).toHaveBeenCalledWith(payload);
  });
  it("wrong-key and stale signatures never reach settlement", async () => {
    const settle = vi.fn(async () => "accepted" as const);
    const observer = createTakbullPageObserver({ readActive: () => true, readPageKey: () => TEST_KEY, record: vi.fn(), now: () => TEST_NOW, settle });
    expect((await observer(await signedRequest(payload, { key: "different-synthetic-key" }))).status).toBe(401);
    expect((await observer(await signedRequest(payload, { timestamp: TEST_NOW / 1000 - 301 }))).status).toBe(401);
    expect(settle).not.toHaveBeenCalled();
  });
  it("a changed body invalidates the signed payment", async () => {
    const settle = vi.fn(async () => "accepted" as const);
    const observer = createTakbullPageObserver({ readActive: () => true, readPageKey: () => TEST_KEY, record: vi.fn(), now: () => TEST_NOW, settle });
    const original = await signedRequest(payload);
    const changed = new Request(original.url, { method: "POST", headers: original.headers, body: JSON.stringify({ ...payload, OrderTotalSum: 65 }) });
    expect((await observer(changed)).status).toBe(401);
    expect(settle).not.toHaveBeenCalled();
  });
  it("missing key or inactive observer never processes a payment", async () => {
    const settle = vi.fn(async () => "accepted" as const);
    for (const active of [false, true]) {
      const observer = createTakbullPageObserver({ readActive: () => active, readPageKey: () => undefined, record: vi.fn(), now: () => TEST_NOW, settle });
      expect((await observer(await signedRequest(payload))).status).toBe(404);
    }
    expect(settle).not.toHaveBeenCalled();
  });
  it("authenticated rejected payments and unavailable settlement never get a success acknowledgement", async () => {
    for (const [outcome, status] of [["rejected", 422], ["unavailable", 503]] as const) {
      const observer = createTakbullPageObserver({ readActive: () => true, readPageKey: () => TEST_KEY, record: vi.fn(), now: () => TEST_NOW, settle: async () => outcome });
      expect((await observer(await signedRequest(payload))).status).toBe(status);
    }
  });
  it("disabled settlement preserves observation-only acknowledgement without granting access", async () => {
    const settle = vi.fn(async () => ({ ok: true }));
    expect(await settleAuthenticatedPagePayment(payload, { enabled: async () => false, settle })).toBe("disabled");
    expect(settle).not.toHaveBeenCalled();
  });
  it("failed status is never handed to the ledger", async () => {
    const settle = vi.fn(async () => ({ ok: true }));
    expect(await settleAuthenticatedPagePayment({ ...payload, OrderStatus: 3 }, { enabled: async () => true, settle })).toBe("rejected");
    expect(settle).not.toHaveBeenCalled();
  });
  it("a lost database response never triggers another settlement or claims success", async () => {
    const settle = vi.fn(async () => null);
    expect(await settleAuthenticatedPagePayment(payload, { enabled: async () => true, settle })).toBe("unavailable");
    expect(settle).toHaveBeenCalledTimes(1);
  });
});