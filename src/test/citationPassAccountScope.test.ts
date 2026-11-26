import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCitationCheckoutReady, useCitationPasses } from "@/hooks/useCitationPasses";
import { citationCheckoutReady, citationPassStatus } from "@/lib/citationPassClient";

vi.mock("@/lib/citationPassClient", () => ({ citationCheckoutReady: vi.fn(), citationPassStatus: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("purchase status stays isolated per signed-in account", () => {
  it("an old account's checkout readiness is immediately hidden after an account switch", async () => {
    vi.mocked(citationCheckoutReady).mockResolvedValueOnce(true).mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ accountId }) => useCitationCheckoutReady(accountId), { initialProps: { accountId: "account-A" } });
    await waitFor(() => expect(result.current).toBe(true));
    rerender({ accountId: "account-B" });
    expect(result.current).toBe(false);
  });
  it("an old account's paid packages are immediately hidden after an account switch", async () => {
    vi.mocked(citationPassStatus).mockResolvedValueOnce([{ id: "synthetic-pass-A", offerId: "citation_week_pass_v1", status: "active", activatedAt: "2026-11-24T12:00:00Z", expiresAt: "2026-12-01T12:00:00Z", usedRatio: 0 }]).mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ accountId }) => useCitationPasses(accountId), { initialProps: { accountId: "account-A" } });
    await waitFor(() => expect(result.current.passes.map(p => p.id)).toEqual(["synthetic-pass-A"]));
    rerender({ accountId: "account-B" });
    expect(result.current.passes).toEqual([]);
  });
});
describe("header pass count refreshes after usage", () => {
  it("re-reads the pass status when a source is used", async () => {
    const { CITATION_TRIAL_CHANGED } = await import("@/lib/citationTrialQuota");
    vi.mocked(citationPassStatus).mockResolvedValue([]);
    const { result } = renderHook(() => useCitationPasses("account-A"));
    await waitFor(() => expect(result.current.resolved).toBe(true));
    const calls = vi.mocked(citationPassStatus).mock.calls.length;
    window.dispatchEvent(new Event(CITATION_TRIAL_CHANGED));
    await waitFor(() => expect(vi.mocked(citationPassStatus).mock.calls.length).toBe(calls + 1));
  });
});


it("updates the paid label at expiry without an extra server request", async () => {
  const { sidebarCitationPassLabel } = await import("@/lib/citationPassHeader");
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-26T10:00:00Z"));
    vi.mocked(citationPassStatus).mockResolvedValueOnce([{ id: "expiring", offerId: "citation_week_pass_v1",
      status: "active", activatedAt: "2026-11-19T10:00:00Z", expiresAt: "2026-11-26T10:00:01Z", usedRatio: 0 }]);
    const { result } = renderHook(() => sidebarCitationPassLabel(useCitationPasses("account-A").passes));
    await act(async () => {});
    expect(result.current).toBe("חבילה שבועית פעילה");
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBeNull();
    expect(citationPassStatus).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});
