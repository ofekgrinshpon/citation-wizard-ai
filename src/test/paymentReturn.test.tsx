import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PaymentReturn from "@/pages/PaymentReturn";
import { citationPassStatus, startCitationPassCheckout } from "@/lib/citationPassClient";
import { useAuth } from "@/hooks/useAuth";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/citationPassClient", () => ({ citationPassStatus: vi.fn(), startCitationPassCheckout: vi.fn(), citationCheckoutReady: vi.fn() }));
beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({ user: { id: "test-account" } } as ReturnType<typeof useAuth>);
  vi.mocked(citationPassStatus).mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderAt(url: string) {
  return render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/payment/return" element={<PaymentReturn />} /></Routes></MemoryRouter>);
}
describe("payment return trusts only authenticated account status", () => {
  it("success-looking URL parameters do not create a checkout or select another account/order", async () => {
    renderAt("/payment/return?paid=1&event=20&order=8&user_id=other-user&amount=39&redirect=https://evil.test");
    await waitFor(() => expect(citationPassStatus).toHaveBeenCalledTimes(1));
    expect(citationPassStatus).toHaveBeenCalledWith();
    expect(startCitationPassCheckout).not.toHaveBeenCalled();
  });
  it("signed-out visitors cannot read an account's purchase status", async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<typeof useAuth>);
    renderAt("/payment/return?status=success&order=8");
    expect(citationPassStatus).not.toHaveBeenCalled();
    expect(startCitationPassCheckout).not.toHaveBeenCalled();
  });
});