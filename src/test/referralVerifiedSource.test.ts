import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { accountForReferralVerifiedSource } from "@/lib/referralVerifiedSource";
import { CITATION_TRIAL_CHANGED } from "@/lib/citationTrialQuota";
const { invoke, getSession } = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke }, auth: { getSession } } }));

const key = "4d126c80-b3a1-4cb0-8479-28423f99cb92";
const source = "29bfc029-9b8a-46d5-8e65-a166efb66cff";
const account = "test-user";
const scoped = () => accountForReferralVerifiedSource(key, source, account, () => true);
const statusError = (status: number, error: string) => ({ error: { context: new Response(JSON.stringify({ error }), { status }) } });
beforeEach(() => {
  invoke.mockReset();
  getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: account }, access_token: "test-token" } } });
});
afterEach(() => vi.restoreAllMocks());

it("sends canonical ID only, binds the account, returns canonical output, and refreshes after success", async () => {
  const refresh = vi.spyOn(window, "dispatchEvent");
  invoke.mockResolvedValueOnce({ error: null, data: { content: "verified formatted output", requestId: key, referralBonusGranted: true } });
  await expect(scoped()).resolves.toBe("verified formatted output");
  expect(invoke).toHaveBeenCalledWith("citation-chat", {
    body: { citationRequestVersion: 3, referralVerifiedSource: { sourceId: source }, requestId: key },
    headers: { Authorization: "Bearer test-token" },
  });
  expect(refresh.mock.calls.some(([event]) => event.type === CITATION_TRIAL_CHANGED)).toBe(true);
});

it("only allows fallback on the explicit pre-debit absence code", async () => {
  invoke.mockResolvedValueOnce(statusError(404, "REFERRAL_VERIFIED_SOURCE_UNAVAILABLE"));
  await expect(scoped()).resolves.toBeNull();
  invoke.mockResolvedValueOnce(statusError(404, "UNEXPECTED_404"));
  await expect(scoped()).rejects.toMatchObject({ code: "REQUEST_OUTCOME_UNKNOWN" });
  invoke.mockRejectedValueOnce(new Error("lost response"));
  await expect(scoped()).rejects.toMatchObject({ code: "REQUEST_OUTCOME_UNKNOWN" });
  invoke.mockResolvedValueOnce(statusError(402, "TRIAL_EXHAUSTED"));
  await expect(scoped()).rejects.toMatchObject({ code: "TRIAL_EXHAUSTED" });
});

it("never dispatches for a stale user or invalid source ID", async () => {
  getSession.mockResolvedValueOnce({ data: { session: { user: { id: "changed" }, access_token: "other-token" } } });
  await expect(scoped()).rejects.toMatchObject({ code: "CITATION_RETRY_STALE" });
  await expect(accountForReferralVerifiedSource(key, "invalid", account, () => true)).resolves.toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});
