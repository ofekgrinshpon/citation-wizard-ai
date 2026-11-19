import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AppSidebar } from "@/components/AppSidebar";
const mock = vi.hoisted(() => ({ isOfficeAddin: false, signedIn: true }));
vi.mock("@/hooks/useOffice", () => ({ useOffice: () => ({ isOfficeAddin: mock.isOfficeAddin }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({
  user: mock.signedIn ? { id: "test-user", user_metadata: { full_name: "Test User" } } : null, isAdmin: false,
}) }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ projects: [], currentProject: null, loading: false }) }));
vi.mock("@/hooks/useCredits", () => ({ useCredits: () => ({ planMeta: { label: "Test" }, isAdmin: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/guide/UserGuideModal", () => ({ UserGuideModal: () => null }));
afterEach(() => { cleanup(); mock.isOfficeAddin = false; mock.signedIn = true; });

function Destination() {
  const { pathname, search } = useLocation();
  return <p>{pathname + search}</p>;
}
function renderMenu() {
  render(<MemoryRouter initialEntries={["/app"]}><Routes>
    <Route path="/app" element={<AppSidebar />} />
    <Route path="/profile" element={<Destination />} />
  </Routes></MemoryRouter>);
}

it("adds the referral directly after help and unmounts the menu when routed", async () => {
  renderMenu();
  const help = screen.getByRole("button", { name: "איך זה עובד?" });
  const referral = screen.getByRole("button", { name: "קבל עוד אזכורים" });
  expect(help.nextElementSibling).toBe(referral);
  expect(referral.className).toBe(help.className);
  fireEvent.click(referral);
  expect(await screen.findByText("/profile?tab=referral")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "קבל עוד אזכורים" })).toBeNull();
});
it("does not expose the shortcut in Office or to signed-out visitors", () => {
  mock.isOfficeAddin = true;
  renderMenu();
  expect(screen.queryByRole("button", { name: "קבל עוד אזכורים" })).toBeNull();
  cleanup(); mock.isOfficeAddin = false; mock.signedIn = false;
  renderMenu();
  expect(screen.queryByRole("button", { name: "קבל עוד אזכורים" })).toBeNull();
});
