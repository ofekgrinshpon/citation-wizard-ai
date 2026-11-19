import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getSession } = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, auth: { getSession } } }));

function reimport(enabled: boolean) {
  vi.stubEnv("VITE_CITATION_SOURCE_TRIAL", String(enabled));
  return import("@/lib/citationTrialQuota");
}

beforeEach(() => {
  vi.resetModules();
  rpc.mockReset();
  getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: "trial-account" } } } });
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("source quota client accounting", () => {
  it("enables the deployed integration by default; DB remains the activation authority", async () => {
    vi.stubEnv("VITE_CITATION_SOURCE_TRIAL", undefined);
    const { isCitationTrialConfigured } = await import("@/lib/citationTrialQuota");
    expect(isCitationTrialConfigured).toBe(true);
  });
  it("does not call billing for dormant clients", async () => {
    const { accountForLocalCitation } = await reimport(false);
    await accountForLocalCitation("id", "a local source");
    expect(rpc).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });
  it("reads a server-scoped allowance and rejects impossible or missing values", async () => {
    const { fetchCitationTrialStatus } = await reimport(true);
    rpc.mockResolvedValueOnce({ error: null, data: { ok: true, enabled: true, limited: true, remaining: 3 } });
    await expect(fetchCitationTrialStatus()).resolves.toMatchObject({ remaining: 3 });
    rpc.mockResolvedValue({ error: null, data: { ok: true, enabled: true, limited: true, remaining: 15 } });
    await expect(fetchCitationTrialStatus()).rejects.toThrow("TRIAL_QUOTA_UNAVAILABLE");
  });
  it("accepts earned referral limits, never more remaining than the server total, and keeps paid users unlimited", async () => {
    const { parseTrialStatus } = await reimport(true);
    const status = { ok: true, enabled: true, limited: true, limit: 25, remaining: 24, referral_sources_enabled: true, referrals_granted: 2 };
    expect(parseTrialStatus(status)).toMatchObject({ limited: true, limit: 25, remaining: 24, referralSourcesEnabled: true, referralsGranted: 2 });
    expect(parseTrialStatus({ ...status, remaining: 26 })).toBeNull();
    expect(parseTrialStatus({ ...status, limit: undefined })).toBeNull();
    expect(parseTrialStatus({ ...status, limit: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
    expect(parseTrialStatus({ ...status, limited: false, remaining: null })).toMatchObject({ limited: false, remaining: null, referralSourcesEnabled: true });
    expect(parseTrialStatus({ ...status, enabled: false, limited: false, remaining: null })).toMatchObject({ referralSourcesEnabled: false });
  });
  it("accepts a valid local debit above the old cap, but not above the returned limit", async () => {
    const { accountForLocalCitation } = await reimport(true);
    rpc.mockResolvedValueOnce({ error: null, data: { ok: true, limited: true, limit: 15, remaining: 14 } });
    await expect(accountForLocalCitation("referral-debit", "a valid citation")).resolves.toBeUndefined();
    rpc.mockResolvedValueOnce({ error: null, data: { ok: true, limited: true, limit: 15, remaining: 16 } });
    await expect(accountForLocalCitation("bad-debit", "a valid citation")).rejects.toMatchObject({ code: "TRIAL_QUOTA_UNAVAILABLE" });
    rpc.mockResolvedValueOnce({ error: null, data: { ok: true, limited: false } });
    await expect(accountForLocalCitation("paid", "a valid citation")).resolves.toBeUndefined();
  });
  it("uses a bound account and source fingerprint, never sends local source text", async () => {
    const { accountForLocalCitation } = await reimport(true);
    rpc.mockResolvedValueOnce({ error: null, data: { ok: true, limited: true, remaining: 4 } });
    await accountForLocalCitation("source-attempt-uuid", "User's private input");
    expect(rpc).toHaveBeenCalledWith("consume_local_citation_trial", {
      _request_id: "source-attempt-uuid", _expected_user: "trial-account", _fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("User's private input");
  });
  it("does not deliver on a last-slot race or unexpected account", async () => {
    const { accountForLocalCitation } = await reimport(true);
    rpc.mockResolvedValueOnce({ error: null, data: { ok: false, limited: true, error: "TRIAL_EXHAUSTED", remaining: 0 } });
    await expect(accountForLocalCitation("slot-race", "another source")).rejects.toMatchObject({ code: "TRIAL_EXHAUSTED" });
    rpc.mockResolvedValueOnce({ error: null, data: { ok: false, error: "CITATION_RETRY_STALE" } });
    await expect(accountForLocalCitation("account-race", "another source")).rejects.toMatchObject({ code: "CITATION_RETRY_STALE" });
  });
  it("reconciles a lost debit result once with the identical ID and hash", async () => {
    const { accountForLocalCitation } = await reimport(true);
    rpc.mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce({ error: null, data: { ok: true, limited: true, replayed: true, remaining: 0 } });
    await accountForLocalCitation("same-id", "another source");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  });
  it("does not make a stale debit", async () => {
    const { accountForLocalCitation } = await reimport(true);
    await expect(accountForLocalCitation("id", "a source", () => false)).rejects.toMatchObject({ code: "CITATION_RETRY_STALE" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
