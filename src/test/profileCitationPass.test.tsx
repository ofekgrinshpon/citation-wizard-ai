import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Profile from "@/pages/Profile";
import { citationPassStatus, type CitationPassStatus } from "@/lib/citationPassClient";

const { user, row } = vi.hoisted(() => ({
  user: { id: "test-user" },
  row: { ok: true },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user }) }));
vi.mock("@/hooks/useCredits", () => ({ useCredits: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useAccountProfile", () => ({ useAccountProfile: () => row }));
vi.mock("@/hooks/useCitationSourceQuota", () => ({ useCitationSourceQuota: () => row }));
vi.mock("@/hooks/useCreditLedger", () => ({ useCreditLedger: () => ({ rows: [] }) }));
vi.mock("@/hooks/useUsage", async importOriginal => ({
  ...await importOriginal<typeof import("@/hooks/useUsage")>(),
  useUsage: () => ({ status: { windowRatio: 0.9, periodRatio: .9 }, planMeta: { label: "התנסות חינם" } }),
}));
vi.mock("@/lib/citationPassClient", () => ({
  citationPassStatus: vi.fn(), startCitationPassCheckout: vi.fn(), citationCheckoutReady: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => {
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => Promise.resolve({ data: [] }) };
    return query;
  } },
}));

const accountPage = () => render(<MemoryRouter initialEntries={["/profile?tab=account"]}><Profile /></MemoryRouter>);
const weekly = (override: Partial<CitationPassStatus> = {}): CitationPassStatus => ({
  id: "week", offerId: "citation_week_pass_v1", status: "active",
  activatedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
  usedRatio: 0, ...override,
});
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("replaces the trial card with the actual purchased allowance and uses one pass lookup", async () => {
  vi.mocked(citationPassStatus).mockResolvedValueOnce([weekly()]);
  accountPage();
  expect(await screen.findByText("חבילה שבועית פעילה")).toBeInTheDocument();
  expect(screen.getByText(/נותרו 100 מתוך 100 מקורות בחבילות בתשלום/)).toBeInTheDocument();
  expect(screen.queryByText("התנסות חינם")).not.toBeInTheDocument();
  expect(screen.queryByText("מכסת שימוש נוכחית")).not.toBeInTheDocument();
  expect(citationPassStatus).toHaveBeenCalledTimes(1);
});

it("shows an exhausted purchased allowance without mislabeling it as a trial", async () => {
  vi.mocked(citationPassStatus).mockResolvedValueOnce([weekly({ status: "exhausted", usedRatio: 1 })]);
  accountPage();
  expect(await screen.findByText("חבילה שבועית · המכסה נוצלה")).toBeInTheDocument();
  expect(screen.getByText(/נותרו 0 מתוך 100 מקורות בחבילות בתשלום/)).toBeInTheDocument();
  expect(screen.queryByText("התנסות חינם")).not.toBeInTheDocument();
});

it("falls back to the baseline usage once the last pass expires", async () => {
  vi.mocked(citationPassStatus).mockResolvedValueOnce([weekly({ expiresAt: new Date(Date.now() - 1000).toISOString() })]);
  accountPage();
  expect(await screen.findByText("התנסות חינם")).toBeInTheDocument();
  expect(screen.getByText("תוקף החבילה הסתיים")).toBeInTheDocument();
  expect(screen.queryByText(/מקורות בחבילות בתשלום/)).not.toBeInTheDocument();
});
