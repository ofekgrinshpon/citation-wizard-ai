import { afterEach, describe, expect, it, vi } from "vitest";
import {
  afterSignIn, hasOAuthReferralDestination, isReferralDestination,
  REFERRAL_PROFILE, REFERRAL_SIGN_IN, setOAuthReferralDestination,
} from "@/lib/referralDestination";

afterEach(() => { setOAuthReferralDestination(false); vi.restoreAllMocks(); });

describe("fixed referral destination", () => {
  it("reaches the referral tab from the one approved target only", () => {
    const url = new URL(REFERRAL_SIGN_IN, "https://relexlm.com");
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("mode")).toBe("login");
    expect(afterSignIn(false, isReferralDestination(url.searchParams))).toBe(REFERRAL_PROFILE);
    for (const external of ["https://example.com", "//example.com", "/profile?tab=referral", "Referral"]) {
      expect(afterSignIn(false, isReferralDestination(new URLSearchParams({ next: external })))).toBe("/app");
    }
    expect(afterSignIn(true, true)).toBe("/app?addin=1");
  });
  it("carries the fixed marker in same-tab OAuth and clears it for ordinary login", () => {
    setOAuthReferralDestination(true);
    expect(hasOAuthReferralDestination()).toBe(true);
    setOAuthReferralDestination(false);
    expect(hasOAuthReferralDestination()).toBe(false);
  });
  it("does not reuse an expired OAuth marker", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    setOAuthReferralDestination(true);
    now.mockReturnValue(611_000);
    expect(hasOAuthReferralDestination()).toBe(false);
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import Auth from "@/pages/Auth";

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null, loading: false, signIn, signUp: vi.fn() }) }));
vi.mock("@/hooks/useOffice", () => ({ useOffice: () => ({ isOfficeAddin: false }) }));
vi.mock("@/lib/officeAuth", () => ({ signInWithOfficeDialog: vi.fn() }));
vi.mock("@/integrations/lovable/index", () => ({ lovable: { auth: { signInWithOAuth: vi.fn() } } }));
afterEach(cleanup);

function Result() {
  const location = useLocation();
  return <p>{location.pathname + location.search}</p>;
}

it("completes password sign-in at the friend referral tab", async () => {
  signIn.mockResolvedValueOnce({ error: null });
  render(<MemoryRouter initialEntries={[REFERRAL_SIGN_IN]}><Routes>
    <Route path="/auth" element={<Auth />} />
    <Route path="/profile" element={<Result />} />
  </Routes></MemoryRouter>);
  fireEvent.change(screen.getByPlaceholderText("your@email.com"), { target: { value: "test@example.test" } });
  const password = screen.getByPlaceholderText("••••••••");
  fireEvent.change(password, { target: { value: "not-a-real-password" } });
  fireEvent.submit((password as HTMLInputElement).form!);
  expect(await screen.findByText(REFERRAL_PROFILE)).toBeTruthy();
  expect(signIn).toHaveBeenCalledTimes(1);
});
