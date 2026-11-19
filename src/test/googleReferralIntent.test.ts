import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  claimGoogleReferralIntent, clearGoogleReferralIntent, clearStoredReferralCode,
  GOOGLE_REFERRAL_STORAGE_KEY, isGoogleReferralEnabled, prepareGoogleReferralIntent, readGoogleReferralIntent,
} from "@/lib/googleReferralIntent";
const { rpc, getSession } = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, auth: { getSession } } }));
const token = "signed.same-tab.referral-nonce";
const result = (data: unknown) => ({ data, error: null });
const google = (id = "oauth-account") => ({ data: { session: { user: { id, app_metadata: { provider: "google" } } } } });
beforeEach(() => { sessionStorage.clear(); rpc.mockReset(); getSession.mockReset().mockResolvedValue(google()); });
afterEach(() => vi.useRealTimers());

async function issue() {
  rpc.mockResolvedValueOnce(result({ ok: true, token }));
  expect(await prepareGoogleReferralIntent("ABCD2345")).toBe(true);
}

it("mints only for an explicit valid referral; keeps the token out of URL and OAuth metadata", async () => {
  expect(await prepareGoogleReferralIntent(null)).toBe(false);
  expect(await prepareGoogleReferralIntent("../checkout")).toBe(false);
  expect(rpc).not.toHaveBeenCalled();
  await issue();
  expect(rpc).toHaveBeenCalledWith("begin_google_referral_intent", { _referral_code: "ABCD2345" });
  expect(readGoogleReferralIntent()).toMatchObject({ token, referralCode: "ABCD2345" });
  expect(window.location.href).not.toContain(token);
  expect(await prepareGoogleReferralIntent(null)).toBe(false);
  expect(readGoogleReferralIntent()).toBeNull();
});
it("claims once for StrictMode/concurrent readers, sends no user-supplied identity or code", async () => {
  await issue();
  rpc.mockResolvedValueOnce(result({ ok: true, claimed: true }));
  const a = claimGoogleReferralIntent(token, "oauth-account");
  const b = claimGoogleReferralIntent(token, "oauth-account");
  expect(a).toBe(b);
  expect(await a).toBe("linked");
  expect(rpc).toHaveBeenLastCalledWith("claim_google_referral_intent", { _token: token });
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(readGoogleReferralIntent()?.boundAccountId).toBe("oauth-account");
  getSession.mockResolvedValue(google("different"));
  expect(await claimGoogleReferralIntent(token, "different")).toBe("not-linked");
  expect(rpc).toHaveBeenCalledTimes(2);
});
it("does not attempt a claim on a password account", async () => {
  await issue();
  getSession.mockResolvedValueOnce({ data: { session: { user: { id: "oauth-account", app_metadata: { provider: "email" } } } } });
  expect(await claimGoogleReferralIntent(token, "oauth-account")).toBe("unverified");
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("retries uncertain responses only with the same token and fails open on timeout", async () => {
  vi.useFakeTimers();
  await issue();
  rpc.mockImplementation(() => new Promise(() => {}));
  const claim = claimGoogleReferralIntent(token, "oauth-account");
  await vi.advanceTimersByTimeAsync(4800);
  expect(await claim).toBe("unverified");
  expect(rpc.mock.calls.slice(1)).toEqual([
    ["claim_google_referral_intent", { _token: token }],
    ["claim_google_referral_intent", { _token: token }],
  ]);
});
it("does not resurrect an expired or canceled marker and clears legacy storage independently", async () => {
  vi.useFakeTimers();
  await issue();
  await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
  expect(readGoogleReferralIntent()).toBeNull();
  expect(await claimGoogleReferralIntent(token, "oauth-account")).toBe("not-linked");
  clearGoogleReferralIntent(token);
  expect(sessionStorage.getItem(GOOGLE_REFERRAL_STORAGE_KEY)).toBeNull();
  sessionStorage.setItem("relex_ref_code", "ABCD2345");
  clearStoredReferralCode();
  expect(sessionStorage.getItem("relex_ref_code")).toBeNull();
});
it("requires explicitly enabled server status before new copy can show", async () => {
  rpc.mockResolvedValueOnce(result(true)).mockResolvedValueOnce(result(null)).mockRejectedValueOnce(new Error("offline"));
  expect(await isGoogleReferralEnabled()).toBe(true);
  expect(await isGoogleReferralEnabled()).toBe(false);
  expect(await isGoogleReferralEnabled()).toBe(false);
});
