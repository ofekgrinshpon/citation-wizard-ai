import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCitationSourceQuota } from "@/hooks/useCitationSourceQuota";
import { CITATION_TRIAL_CHANGED } from "@/lib/citationTrialQuota";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
const trial = (rest = {}) => ({
  error: null,
  data: { ok: true, enabled: true, limited: true, limit: 15, remaining: 14, referral_sources_enabled: true, referrals_granted: 1, ...rest },
});
beforeEach(() => rpc.mockReset());
afterEach(cleanup);

it("propagates the server trial total and newly earned sources on refresh", async () => {
  rpc.mockResolvedValueOnce(trial({ limit: 5, remaining: 0, referrals_granted: 0 }));
  const { result } = renderHook(() => useCitationSourceQuota("trial-user"));
  await waitFor(() => expect(result.current.sourceQuota).toEqual({ limit: 5, remaining: 0 }));
  rpc.mockResolvedValueOnce(trial());
  await act(async () => window.dispatchEvent(new Event(CITATION_TRIAL_CHANGED)));
  expect(result.current.sourceQuota).toEqual({ limit: 15, remaining: 14 });
  expect(result.current.sourceReferralsGranted).toBe(1);
});

it("does not impose the free quota on a paid account or leak the previous account's allowance", async () => {
  rpc.mockResolvedValueOnce(trial());
  const { result, rerender } = renderHook(({ id }) => useCitationSourceQuota(id), { initialProps: { id: "trial-user" } });
  await waitFor(() => expect(result.current.sourceQuota?.remaining).toBe(14));
  rpc.mockResolvedValueOnce(trial({ limited: false, remaining: null, referrals_granted: 0 }));
  rerender({ id: "paid-user" });
  expect(result.current.sourceQuota).toMatchObject({ loading: true, remaining: 0 });
  expect(result.current.sourceReferralsGranted).toBeNull();
  await waitFor(() => expect(result.current.sourceQuota).toBeUndefined());
  expect(result.current.referralSourcesEnabled).toBe(true);
  expect(result.current.sourceReferralsGranted).toBe(0);
});
