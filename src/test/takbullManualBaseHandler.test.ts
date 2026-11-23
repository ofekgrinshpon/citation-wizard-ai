import { describe, expect, it, vi } from "vitest";
import { handleTakbullManualBase } from "../../supabase/functions/takbull-manual-base/handler";

const actor = "10000000-0000-4000-a000-000000000000";
const order = "20000000-0000-4000-a000-000000000000";
const at = "2026-11-23T14:30:00+02:00";
function run(body: unknown, options: { enabled?: boolean; forbidden?: boolean; unauth?: boolean } = {}) {
  const rpc = vi.fn(async (_name: string, _args: unknown) => ({
    data: options.forbidden ? null : { ok: true }, error: options.forbidden ? { code: "42501" } : null,
  }));
  const getUser = vi.fn(async () => options.unauth ? null : actor);
  const req = new Request("https://test.invalid", { method: "POST", headers: { Authorization: "Bearer synthetic" }, body: JSON.stringify(body) });
  return { rpc, getUser, response: handleTakbullManualBase(req, { enabled: options.enabled ?? true, getUser, rpc }) };
}
describe("gated Takbull manual pilot front door", () => {
  it("is inert while disabled", async () => {
    const r = run({ action: "queue" }, { enabled: false });
    expect((await r.response).status).toBe(503);
    expect(r.getUser).not.toHaveBeenCalled(); expect(r.rpc).not.toHaveBeenCalled();
  });
  it("requires a verified token", async () => {
    const r = run({ action: "queue", actor: order }, { unauth: true });
    expect((await r.response).status).toBe(401);
    expect(r.rpc).not.toHaveBeenCalled();
  });
  it("ignores injected owner and price for owner request", async () => {
    const r = run({ action: "request", offer: "citation_week_pass_v1", owner: order, amountMinor: 1 });
    expect((await r.response).status).toBe(200);
    expect(r.rpc).toHaveBeenCalledWith("takbull_manual_base_intent", { _owner: actor, _offer: "citation_week_pass_v1" });
  });
  it("rejects top-ups", async () => {
    const r = run({ action: "request", offer: "citation_source_topup_50_v1" });
    expect((await r.response).status).toBe(400); expect(r.rpc).not.toHaveBeenCalled();
  });
  it("uses only server identity for admin queue and reports database denial", async () => {
    const r = run({ action: "queue", actor: order }, { forbidden: true });
    expect((await r.response).status).toBe(403);
    expect(r.rpc).toHaveBeenCalledWith("takbull_manual_base_queue", { _actor: actor });
  });
  const proof = { action: "settle", at, attest: true, order, merchant: "merchant", demand: "demand", transaction: "tx", document: "doc", amountMinor: 3900, currency: "ILS" };
  it.each([{ at: "2026-11-23T14:30:00" }, { attest: false }, { demand: "" }, { amountMinor: 1500 }])("rejects invalid evidence %j", async (bad) => {
    const r = run({ ...proof, ...bad });
    expect((await r.response).status).toBe(400); expect(r.rpc).not.toHaveBeenCalled();
  });
  it("passes verified actor and independently entered proof but no client entitlement fields", async () => {
    const r = run({ ...proof, actor: order, expiresAt: "never", quota: 9999 });
    expect((await r.response).status).toBe(200);
    expect(r.rpc).toHaveBeenCalledWith("takbull_manual_base_settle", {
      _actor: actor, _observed_order: order, _observed_demand: "demand", _merchant: "merchant", _transaction: "tx", _document: "doc",
      _amount_minor: 3900, _currency: "ILS", _outcome: "confirmed_one_time_charge", _paid_at: at,
    });
  });
});
