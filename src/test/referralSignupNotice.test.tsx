import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Auth from "@/pages/Auth";

const { rpc, oauth, info } = vi.hoisted(() => ({ rpc: vi.fn(), oauth: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info, error: vi.fn(), success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null, loading: false, signIn: vi.fn(), signUp: vi.fn() }) }));
vi.mock("@/hooks/useOffice", () => ({ useOffice: () => ({ isOfficeAddin: false }) }));
vi.mock("@/lib/officeAuth", () => ({ signInWithOfficeDialog: vi.fn() }));
vi.mock("@/lib/publicUrl", () => ({
  isCanonicalHost: () => true, PUBLIC_SITE_URL: "https://relexlm.com", shouldRedirectOAuthToCanonicalHost: () => false,
}));
vi.mock("@/integrations/lovable/index", () => ({ lovable: { auth: { signInWithOAuth: oauth } } }));
beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: false, error: null });
  info.mockClear();
  oauth.mockReset().mockResolvedValue({ redirected: true, error: null });
});
afterEach(() => { cleanup(); sessionStorage.clear(); });

function open(url: string) {
  render(<MemoryRouter initialEntries={[url]}><Auth /></MemoryRouter>);
}

it("explains the email-only invitation bonus before activation without disabling Google", () => {
  open("/auth?mode=signup&ref=abcd2345");
  expect(screen.getByText(/כדי לקבל את בונוס ההזמנה, יש להירשם עם אימייל וסיסמה, לא דרך Google/)).toBeTruthy();
  expect(screen.getByText("ABCD2345")).toBeTruthy();
  expect((screen.getByRole("button", { name: /התחברו עם Google/ }) as HTMLButtonElement).disabled).toBe(false);
});

it.each(["/auth?mode=signup", "/auth?mode=login&ref=ABCD2345"])("does not show or prepare the signup bonus for %s", url => {
  open(url);
  expect(screen.queryByText(/כדי לקבל את בונוס ההזמנה/)).toBeNull();
  expect(screen.getByRole("button", { name: /התחברו עם Google/ })).toBeTruthy();
  expect(rpc).not.toHaveBeenCalled();
});

it("prepares the opaque intent before invited Google signup with the existing legal-consent and callback flow", async () => {
  rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({
    data: { ok: true, token: "long-opaque-test-intent" }, error: null,
  });
  open("/auth?mode=signup&ref=abcd2345");
  expect(await screen.findByText(/אפשר להירשם עם אימייל וסיסמה או עם Google/)).toBeTruthy();
  const button = screen.getByRole("button", { name: /התחברו עם Google/ });
  fireEvent.click(button);
  expect(oauth).not.toHaveBeenCalled();
  expect(rpc.mock.calls).toEqual([["get_google_referral_enabled", undefined]]);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(button);
  await waitFor(() => expect(oauth).toHaveBeenCalledTimes(1));
  expect(rpc).toHaveBeenLastCalledWith("begin_google_referral_intent", { _referral_code: "ABCD2345" });
  expect(oauth).toHaveBeenCalledWith("google", {
    redirect_uri: `${window.location.origin}/auth-redirect`, extraParams: { prompt: "select_account" },
  });
});

it("carries the explicit signup code when arriving from the canonical preview handoff", async () => {
  rpc.mockImplementation(async name => ({ data: name === "get_google_referral_enabled" ? true : { ok: true, token: "long-opaque-test-intent" }, error: null }));
  open("/auth?mode=signup&ref=abcd2345&oauth=google");
  await waitFor(() => expect(oauth).toHaveBeenCalledTimes(1));
  expect(rpc).toHaveBeenCalledWith("begin_google_referral_intent", { _referral_code: "ABCD2345" });
  expect(oauth).toHaveBeenCalledWith("google", expect.objectContaining({ redirect_uri: `${window.location.origin}/auth-redirect` }));
});

it("silently keeps OAuth working when invitation minting is disabled during rollout", async () => {
  open("/auth?mode=signup&ref=abcd2345");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /התחברו עם Google/ }));
  await waitFor(() => expect(oauth).toHaveBeenCalledTimes(1));
  expect(rpc).toHaveBeenCalledWith("begin_google_referral_intent", { _referral_code: "ABCD2345" });
  expect(info).not.toHaveBeenCalled();
});
it("starts ordinary Google sign-in without a feature or mint request", async () => {
  open("/auth?mode=login&ref=ABCD2345");
  fireEvent.click(screen.getByRole("button", { name: /התחברו עם Google/ }));
  await waitFor(() => expect(oauth).toHaveBeenCalledTimes(1));
  expect(rpc).not.toHaveBeenCalled();
});
