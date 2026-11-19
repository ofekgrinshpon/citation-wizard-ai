import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import Auth from "@/pages/Auth";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null, loading: false, signIn: vi.fn(), signUp: vi.fn() }) }));
vi.mock("@/hooks/useOffice", () => ({ useOffice: () => ({ isOfficeAddin: false }) }));
vi.mock("@/lib/officeAuth", () => ({ signInWithOfficeDialog: vi.fn() }));
vi.mock("@/integrations/lovable/index", () => ({ lovable: { auth: { signInWithOAuth: vi.fn() } } }));
afterEach(() => { cleanup(); sessionStorage.clear(); });

function open(url: string) {
  render(<MemoryRouter initialEntries={[url]}><Auth /></MemoryRouter>);
}

it("explains the email-only invitation bonus without disabling Google on a fresh invited signup", () => {
  open("/auth?mode=signup&ref=abcd1234");
  expect(screen.getByText(/כדי לקבל את בונוס ההזמנה, יש להירשם עם אימייל וסיסמה, לא דרך Google/)).toBeTruthy();
  expect(screen.getByText("ABCD1234")).toBeTruthy();
  expect((screen.getByRole("button", { name: /התחברו עם Google/ }) as HTMLButtonElement).disabled).toBe(false);
});

it.each(["/auth?mode=signup", "/auth?mode=login&ref=ABCD1234"])("does not show the notice for %s", url => {
  open(url);
  expect(screen.queryByText(/כדי לקבל את בונוס ההזמנה/)).toBeNull();
  expect(screen.getByRole("button", { name: /התחברו עם Google/ })).toBeTruthy();
});
