import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── mocked auth ──
const auth = { user: { id: "A", email: "a@x.com" } as { id: string; email: string } | null, loading: false, isAdmin: false };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ ...auth, isAdminResolved: true, session: null, signOut: vi.fn(), signIn: vi.fn(), signUp: vi.fn() }),
}));

// ── mocked backend ──
type Res = { data: unknown; error: unknown; count?: number };
const handlers: {
  rpc: () => Promise<Res>;
  profileSelect: (id: string) => Promise<Res>;
  profileUpdate: (id: string) => Promise<Res>;
  ledger: (id: string) => Promise<Res>;
} = {} as never;
let updateCalls = 0;

function chain(table: string) {
  let id = "";
  let mode: "select" | "update" = "select";
  const c: Record<string, unknown> = {};
  const run = (): Promise<Res> => {
    if (table === "profiles" && mode === "update") { updateCalls++; return handlers.profileUpdate(id); }
    if (table === "profiles") return handlers.profileSelect(id);
    if (table === "credit_ledger") return handlers.ledger(id);
    return Promise.resolve({ data: [], error: null, count: 0 });
  };
  Object.assign(c, {
    select: () => c, order: () => c, limit: () => c,
    update: () => { mode = "update"; return c; },
    eq: (col: string, v: string) => { if (col === "id" || col === "user_id") id = v; return c; },
    single: () => run(),
    then: (ok: (r: Res) => unknown, bad: (e: unknown) => unknown) => run().then(ok, bad),
  });
  return c;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => chain(t), rpc: () => handlers.rpc() },
}));

import { useUsage } from "@/hooks/useUsage";
import { useCreditLedger } from "@/hooks/useCreditLedger";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import Profile from "@/pages/Profile";

const okUsage = (over: Record<string, unknown> = {}) => ({
  data: { ok: true, plan: "month", is_paid: true, is_expired: false, server_now: new Date().toISOString(),
    window_used_ratio: 0.1, period_used_ratio: 0.2, plan_ends_at: "2030-01-01T00:00:00Z", ...over }, error: null,
});
function deferred<T>() { let resolve!: (v: T) => void; const p = new Promise<T>((r) => (resolve = r)); return { p, resolve }; }

beforeEach(() => {
  auth.user = { id: "A", email: "a@x.com" }; auth.loading = false; auth.isAdmin = false; updateCalls = 0;
  handlers.rpc = () => Promise.resolve(okUsage());
  handlers.profileSelect = (id) => Promise.resolve({ data: { full_name: `name-${id}`, email: `${id}@x.com` }, error: null });
  handlers.profileUpdate = (id) => Promise.resolve({ data: [{ id }], error: null });
  handlers.ledger = () => Promise.resolve({ data: [], error: null });
});

const renderProfile = (tab = "account") =>
  render(<MemoryRouter initialEntries={[`/profile?tab=${tab}`]}><Profile /></MemoryRouter>);

describe("usage loading", () => {
  it("failure shows error, never default low usage, and retry succeeds", async () => {
    handlers.rpc = () => Promise.resolve({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useUsage());
    await waitFor(() => expect(result.current.error).toBe("USAGE_LOAD_FAILED"));
    expect(result.current.status).toBeNull();
    handlers.rpc = () => Promise.resolve(okUsage());
    await act(() => result.current.refresh());
    expect(result.current.error).toBeNull();
    expect(result.current.status?.plan).toBe("month");
  });

  it("screen shows alert + retry instead of usage bars on failure", async () => {
    handlers.rpc = () => Promise.resolve({ data: null, error: { message: "x" } });
    renderProfile();
    expect(await screen.findByText("לא הצלחנו לטעון את נתוני המסלול והמכסה.")).toBeTruthy();
    expect(screen.queryByText("שימוש נמוך")).toBeNull();
    handlers.rpc = () => Promise.resolve(okUsage());
    fireEvent.click(screen.getAllByRole("button", { name: "נסה שוב" })[0]);
    expect(await screen.findByText("שימוש נמוך")).toBeTruthy();
  });

  it("does not request before auth finishes loading", async () => {
    auth.loading = true;
    const spy = vi.fn(() => Promise.resolve(okUsage()));
    handlers.rpc = spy;
    renderHook(() => useUsage());
    await new Promise((r) => setTimeout(r, 10));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("user switch and sign-out", () => {
  it("late response of user A cannot overwrite user B", async () => {
    const a = deferred<Res>();
    handlers.profileSelect = (id) => id === "A" ? a.p : Promise.resolve({ data: { full_name: "B-name", email: "b@x.com" }, error: null });
    const { result, rerender } = renderHook(() => useAccountProfile());
    auth.user = { id: "B", email: "b@x.com" };
    rerender();
    await waitFor(() => expect(result.current.fullName).toBe("B-name"));
    a.resolve({ data: { full_name: "A-name", email: "a@x.com" }, error: null });
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.fullName).toBe("B-name");
  });

  it("late usage/ledger responses are discarded after sign-out and state is cleared", async () => {
    const u = deferred<Res>(); const l = deferred<Res>();
    handlers.rpc = () => u.p; handlers.ledger = () => l.p;
    const usage = renderHook(() => useUsage());
    const ledger = renderHook(() => useCreditLedger());
    auth.user = null;
    usage.rerender(); ledger.rerender();
    u.resolve(okUsage()); l.resolve({ data: [{ id: "1", event_type: "consume", created_at: new Date().toISOString() }], error: null });
    await new Promise((r) => setTimeout(r, 10));
    expect(usage.result.current.status).toBeNull();
    expect(ledger.result.current.rows).toEqual([]);
  });
});

describe("saving the name", () => {
  it("success only when the current user's row was updated", async () => {
    const { result } = renderHook(() => useAccountProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok = false;
    await act(async () => { ok = await result.current.save(); });
    expect(ok).toBe(true);
    expect(result.current.saveState).toBe("saved");
  });

  it("zero updated rows is a failure and keeps the typed text", async () => {
    handlers.profileUpdate = () => Promise.resolve({ data: [], error: null });
    const { result } = renderHook(() => useAccountProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setFullName("חדש"));
    await act(async () => { await result.current.save(); });
    expect(result.current.saveState).toBe("error");
    expect(result.current.fullName).toBe("חדש");
  });

  it("error response is a failure; retry then succeeds", async () => {
    handlers.profileUpdate = () => Promise.resolve({ data: null, error: { message: "x" } });
    renderProfile("profile");
    const btn = await screen.findByRole("button", { name: "שמור שינויים" });
    fireEvent.click(btn);
    expect(await screen.findByRole("alert")).toBeTruthy();
    handlers.profileUpdate = (id) => Promise.resolve({ data: [{ id }], error: null });
    fireEvent.click(screen.getByRole("button", { name: "נסה לשמור שוב" }));
    expect(await screen.findByText("השם נשמר.")).toBeTruthy();
  });

  it("double click sends a single update", async () => {
    const d = deferred<Res>();
    handlers.profileUpdate = () => d.p;
    renderProfile("profile");
    const btn = await screen.findByRole("button", { name: "שמור שינויים" });
    fireEvent.click(btn); fireEvent.click(btn);
    expect(updateCalls).toBe(1);
    expect((screen.getByRole("button", { name: "שומר…" }) as HTMLButtonElement).disabled).toBe(true);
    d.resolve({ data: [{ id: "A" }], error: null });
    expect(await screen.findByText("השם נשמר.")).toBeTruthy();
  });
});

describe("expired plan and refunded usage", () => {
  it("expired plan is shown as expired without renewal", async () => {
    handlers.rpc = () => Promise.resolve(okUsage({ is_expired: true }));
    renderProfile();
    expect(await screen.findByText("פג תוקף")).toBeTruthy();
    expect(screen.getByText(/אינו מתחדש אוטומטית/)).toBeTruthy();
  });

  it("refund row is labeled as returned usage quota, not money", async () => {
    handlers.ledger = () => Promise.resolve({ data: [{ id: "r1", event_type: "refund", reason: null, created_at: new Date().toISOString() }], error: null });
    renderProfile();
    expect(await screen.findByText("מכסת שימוש שהוחזרה")).toBeTruthy();
    expect(screen.queryByText("החזר אוטומטי")).toBeNull();
  });
});

describe("accessibility", () => {
  it("labels are bound to inputs, email is read-only, plan buttons disabled with explanation", async () => {
    renderProfile("profile");
    const name = await screen.findByLabelText("שם מלא");
    expect(name.tagName).toBe("INPUT");
    expect((screen.getByLabelText("אימייל") as HTMLInputElement).readOnly).toBe(true);
    name.focus();
    expect(document.activeElement).toBe(name);
  });

  it("plan purchase buttons are disabled and described", async () => {
    renderProfile();
    await screen.findByText("שימוש נמוך");
    const note = screen.getByText(/רכישת מסלול עדיין לא זמינה/);
    const buttons = document.querySelectorAll(`[aria-describedby="${note.id}"]`);
    expect(buttons.length).toBe(3);
    buttons.forEach((b) => expect((b as HTMLButtonElement).disabled).toBe(true));
  });
});
