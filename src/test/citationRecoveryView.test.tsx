import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CitationRecovery from "@/pages/CitationRecovery";
import type { CitationRecoveryRecord } from "@/lib/citationRecoveryApi";

const mocks = vi.hoisted(() => ({
  user: { id: "account-a" } as { id: string } | null,
  sessionUser: "account-a" as string | null,
  loading: false,
  project: { id: "project-a", name: "פרויקט א" },
  projectsRead: vi.fn(), projectFilter: vi.fn(), ack: vi.fn(), list: vi.fn(), read: vi.fn(), prepare: vi.fn(), retry: vi.fn(), save: vi.fn(), clipboard: vi.fn(), getSession: vi.fn(),
  listeners: new Set<(event: string, session: { user: { id: string } } | null) => void>(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user, loading: mocks.loading }) }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({
  currentProject: mocks.project, loading: false,
  projects: [{ id: "project-a", name: "פרויקט א" }, { id: "project-b", name: "פרויקט ב" }],
}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {
  getSession: mocks.getSession,
  onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => {
    mocks.listeners.add(listener);
    return { data: { subscription: { unsubscribe: () => mocks.listeners.delete(listener) } } };
  },
}, from: (table: string) => {
  if (table !== "projects") throw new Error("Unexpected table access");
  return { select: () => ({ eq: (field: string, owner: string) => {
    mocks.projectFilter(field, owner);
    return { order: () => mocks.projectsRead(owner) };
  } }) };
} } }));
vi.mock("@/lib/citationRecoveryApi", () => ({
  acknowledgeRecoveredCitation: mocks.ack, listCitationRecovery: mocks.list, readCitationRecovery: mocks.read, prepareCitationRecoveryRetry: mocks.prepare,
}));
vi.mock("@/lib/functionError", () => ({ retryCitationFunction: mocks.retry }));
vi.mock("@/lib/citationHistorySave", () => ({ saveRecoveredCitationHistory: mocks.save }));

const ID = "11111111-1111-4111-8111-111111111111";
const CHILD = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const CONTENT = 'Recovered citation <img src=x onerror="alert(1)">';
function record(patch: Partial<CitationRecoveryRecord> = {}): CitationRecoveryRecord {
  return { requestId: ID, retryOfRequestId: null, status: "succeeded",
    createdAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 86_340_000).toISOString(), availability: "available",
    input: { messages: [{ role: "user", content: "Original legal source" }], rawInput: null, foreignLookup: null, batchId: null },
    result: { content: CONTENT }, refundReceipt: { status: "retained", refunded: false, units_refunded: 0, request_id: ID }, ...patch };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function view(path = "/citation-recovery", strict = false) {
  const page = <MemoryRouter initialEntries={[path]}><CitationRecovery /></MemoryRouter>;
  return render(strict ? <StrictMode>{page}</StrictMode> : page);
}
const ownProject = () => fireEvent.change(screen.getByLabelText("פרויקט לשמירה בהיסטוריה"), { target: { value: "project-a" } });
const saveButton = () => screen.getByRole("button", { name: "שמירה בהיסטוריה" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "account-a" }; mocks.sessionUser = "account-a"; mocks.loading = false;
  mocks.project = { id: "project-a", name: "פרויקט א" }; mocks.listeners.clear();
  mocks.getSession.mockImplementation(async () => ({ data: { session: mocks.sessionUser ? { user: { id: mocks.sessionUser } } : null }, error: null }));
  mocks.list.mockResolvedValue({ requests: [record()], nextCursor: null });
  mocks.read.mockResolvedValue(record());
  mocks.prepare.mockResolvedValue({ failedRequestId: ID, handle: "bound-failed-handle" });
  mocks.retry.mockResolvedValue({ data: { requestId: CHILD }, errorInfo: null });
  mocks.save.mockResolvedValue({ historyId: "history-a", alreadySaved: false });
  mocks.clipboard.mockResolvedValue(undefined);
  mocks.ack.mockResolvedValue(undefined);
  mocks.projectsRead.mockResolvedValue({ data: [{ id: "project-a", name: "פרויקט א" }, { id: "project-b", name: "פרויקט ב" }], error: null });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.clipboard } });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network forbidden in recovery UI tests"); }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("read-only citation recovery view", () => {
  it("requires auth and does not read anything while signed out or hydrating", async () => {
    mocks.user = null;
    const ui = view();
    expect(screen.getByRole("link", { name: "להתחברות" })).toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
    mocks.loading = true;
    ui.rerender(<MemoryRouter><CitationRecovery /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("בודקים את ההתחברות");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("loads once, renders hostile markup as text, and performs no paid/history work", async () => {
    const { container } = view();
    expect(await screen.findByText(CONTENT)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/לא אומתה מחדש/)).toBeInTheDocument();
    expect(screen.getByText(/פריטים שנשמרו בהיסטוריה אינם נמחקים/)).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(saveButton()).toBeDisabled();
    expect(screen.getByLabelText("פרויקט לשמירה בהיסטוריה")).toHaveValue("");
  });

  it("is safe under StrictMode's mount/cleanup/remount cycle", async () => {
    view("/citation-recovery", true);
    await screen.findByText(CONTENT);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("checks an exact handle from the URL and shows the canonical child returned by the read API", async () => {
    mocks.read.mockResolvedValue(record({ requestId: CHILD, retryOfRequestId: ID }));
    view(`/citation-recovery?requestId=${ID}`);
    await screen.findByText(CONTENT);
    expect(mocks.read).toHaveBeenCalledWith("account-a", ID, expect.any(Function));
    expect(screen.getByRole("article", { name: `בקשה ${CHILD}` })).toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("manually refreshes pending requests and never polls or launches a paid invocation", async () => {
    mocks.list.mockResolvedValueOnce({ requests: [record({ status: "in_progress", availability: "pending", result: null })], nextCursor: null });
    view();
    await screen.findByRole("heading", { name: "הבקשה בטיפול" });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "רענון מצב" }));
    await screen.findByText(CONTENT);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it("paginates server records with the returned cursor, without duplicating existing entries", async () => {
    mocks.list.mockResolvedValueOnce({ requests: [record()], nextCursor: ID });
    mocks.list.mockResolvedValueOnce({ requests: [record(), record({ requestId: OTHER, result: { content: "Another citation" } })], nextCursor: null });
    view(); await screen.findByText(CONTENT);
    fireEvent.click(screen.getByRole("button", { name: "טעינת בקשות נוספות" }));
    await screen.findByText("Another citation");
    expect(mocks.list).toHaveBeenLastCalledWith("account-a", { cursor: ID, limit: 20 }, expect.any(Function));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("separates not found, unavailable and expired result states without inferring a refund", async () => {
    mocks.read.mockResolvedValue(null);
    view(`/citation-recovery?requestId=${ID}`);
    await screen.findByText(/הבקשה לא נמצאה בחשבון הנוכחי/);
    expect(screen.getByText(/אין בכך אישור שלא בוצעה/)).toBeInTheDocument();
    mocks.read.mockResolvedValue(record({ availability: "unavailable", result: null, input: null }));
    fireEvent.click(screen.getByRole("button", { name: "רענון מצב" }));
    await screen.findByRole("heading", { name: "הושלמה · התוצאה אינה זמינה להצגה" });
    mocks.read.mockResolvedValue(record({ availability: "expired", result: null, input: null }));
    fireEvent.click(screen.getByRole("button", { name: "רענון מצב" }));
    await screen.findByRole("heading", { name: "הושלמה · עותק השחזור פג" });
    expect(screen.queryByRole("button", { name: "העתקת התוצאה" })).not.toBeInTheDocument();
    expect(screen.getByText(/תוצאה שנשמרה בהיסטוריה נשארת שם/)).toBeInTheDocument();
    expect(mocks.retry).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it("shows unknown as needs-review with no retry even if a refund flag is present", async () => {
    mocks.list.mockResolvedValue({ requests: [record({ status: "unknown", result: null, refundReceipt: { status: "refunded", refunded: true, units_refunded: 1, request_id: ID } })], nextCursor: null });
    view(); await screen.findByRole("heading", { name: "נדרש בירור" });
    expect(screen.getByText(/החזר שימוש לא אושר/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חדש שעשוי לצרוך שימוש" })).not.toBeInTheDocument();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("hides private output on transport auth change and drops the eventual response", async () => {
    const pending = deferred<{ requests: CitationRecoveryRecord[]; nextCursor: null }>();
    mocks.list.mockReturnValue(pending.promise);
    view();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    act(() => {
      mocks.sessionUser = "account-b";
      mocks.listeners.forEach((listener) => listener("SIGNED_IN", { user: { id: "account-b" } }));
    });
    await act(async () => { pending.resolve({ requests: [record()], nextCursor: null }); });
    expect(screen.queryByText(CONTENT)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("הנתונים הקודמים הוסתרו");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rechecks session after an awaited read even before an auth event arrives", async () => {
    const pending = deferred<{ requests: CitationRecoveryRecord[]; nextCursor: null }>();
    mocks.list.mockReturnValue(pending.promise);
    view(); await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    mocks.sessionUser = "account-b";
    await act(async () => pending.resolve({ requests: [record()], nextCursor: null }));
    expect(screen.queryByText(CONTENT)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("הנתונים הקודמים הוסתרו");
  });

  it("unmounts the old account view immediately and requires manual refresh for the new account", async () => {
    const ui = view(); await screen.findByText(CONTENT);
    mocks.user = { id: "account-b" }; mocks.sessionUser = "account-b";
    ui.rerender(<MemoryRouter><CitationRecovery /></MemoryRouter>);
    expect(screen.queryByText(CONTENT)).not.toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    mocks.list.mockResolvedValue({ requests: [record({ result: { content: "Account B citation" } })], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "רענון מצב" }));
    await screen.findByText("Account B citation");
    expect(mocks.list).toHaveBeenLastCalledWith("account-b", { limit: 20 }, expect.any(Function));
  });

  it("a project switch discards the old pending view before showing new context", async () => {
    const pending = deferred<{ requests: CitationRecoveryRecord[]; nextCursor: null }>();
    mocks.list.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ requests: [], nextCursor: null });
    const ui = view(); await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    mocks.project = { id: "project-b", name: "פרויקט ב" };
    ui.rerender(<MemoryRouter><CitationRecovery /></MemoryRouter>);
    await act(async () => pending.resolve({ requests: [record()], nextCursor: null }));
    expect(screen.queryByText(CONTENT)).not.toBeInTheDocument();
    await screen.findByText(/לא נמצאו בקשות לשחזור/);
  });

  it("Back discards a newer route's delayed response instead of restoring stale private content", async () => {
    const pending = deferred<CitationRecoveryRecord>();
    mocks.read.mockResolvedValueOnce(record({ result: { content: "First handle result" } }))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(record({ result: { content: "First handle result" } }));
    function NavigationHarness() {
      const navigate = useNavigate();
      return <><button onClick={() => navigate(`/citation-recovery?requestId=${CHILD}`)}>Open another handle</button>
        <button onClick={() => navigate(-1)}>Browser back</button><CitationRecovery /></>;
    }
    render(<MemoryRouter initialEntries={[`/citation-recovery?requestId=${ID}`]}><NavigationHarness /></MemoryRouter>);
    await screen.findByText("First handle result");
    fireEvent.click(screen.getByRole("button", { name: "Open another handle" }));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    await screen.findByText("First handle result");
    await act(async () => pending.resolve(record({ requestId: CHILD, result: { content: "Stale child output" } })));
    expect(screen.queryByText("Stale child output")).not.toBeInTheDocument();
    expect(mocks.retry).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it("surfaces an unavailable read and a manual retry only invokes the read endpoint", async () => {
    mocks.list.mockRejectedValueOnce(new Error("CITATION_RECOVERY_UNAVAILABLE"));
    view(); await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "רענון מצב" }));
    await screen.findByText(CONTENT);
    expect(mocks.retry).not.toHaveBeenCalled();
  });
});

describe("explicit copy and exactly-once history save", () => {
  it("copies request ID and plain output without invoking the provider or saving", async () => {
    view(); await screen.findByText(CONTENT);
    fireEvent.click(screen.getByRole("button", { name: `העתקת מזהה ${ID}` }));
    await screen.findByText("מזהה הבקשה הועתק.");
    expect(mocks.clipboard).toHaveBeenLastCalledWith(ID);
    fireEvent.click(screen.getByRole("button", { name: "העתקת התוצאה" }));
    await screen.findByText("התוצאה הועתקה.");
    expect(mocks.clipboard).toHaveBeenLastCalledWith(CONTENT);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.retry).not.toHaveBeenCalled();
  });

  it("requires selected project, blocks synchronous double clicks and uses the stable request identity", async () => {
    const pending = deferred<{ historyId: string; alreadySaved: boolean }>();
    mocks.save.mockReturnValue(pending.promise);
    view(); await screen.findByText(CONTENT); ownProject();
    const button = saveButton();
    act(() => { button.click(); button.click(); });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ requestId: ID, projectId: "project-a", expectedAccountId: "account-a", formattedOutput: CONTENT, isResultCurrent: expect.any(Function) }));
    await act(async () => pending.resolve({ historyId: "history-a", alreadySaved: false }));
    expect(await screen.findByRole("button", { name: "נשמר בהיסטוריה" })).toBeDisabled();
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it("honestly reports a lost save ack and retries with exactly the same key", async () => {
    mocks.save.mockRejectedValueOnce(new Error("CITATION_HISTORY_SAVE_UNCONFIRMED"))
      .mockResolvedValueOnce({ historyId: "history-a", alreadySaved: true });
    view(); await screen.findByText(CONTENT); ownProject();
    fireEvent.click(saveButton());
    await screen.findByText(/השמירה לא אושרה/);
    fireEvent.click(saveButton());
    await screen.findByText("התוצאה כבר שמורה בהיסטוריה. לא נוצר עותק נוסף.");
    expect(mocks.save.mock.calls.map(([input]) => input.requestId)).toEqual([ID, ID]);
    expect(mocks.save.mock.calls.map(([input]) => input.projectId)).toEqual(["project-a", "project-a"]);
  });

  it("changing selected destination during an auth await prevents dispatch of the old save", async () => {
    view(); await screen.findByText(CONTENT); ownProject();
    const gate = deferred<{ data: { session: { user: { id: string } } }; error: null }>();
    mocks.getSession.mockReturnValueOnce(gate.promise);
    fireEvent.click(saveButton());
    fireEvent.change(screen.getByLabelText("פרויקט לשמירה בהיסטוריה"), { target: { value: "project-b" } });
    await act(async () => gate.resolve({ data: { session: { user: { id: "account-a" } } }, error: null }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.queryByText(/נשמרה בהיסטוריה/)).not.toBeInTheDocument();
  });

  it("a pending save's completion cannot surface on a new account", async () => {
    const gate = deferred<{ historyId: string; alreadySaved: boolean }>();
    mocks.save.mockReturnValueOnce(gate.promise);
    const ui = view(); await screen.findByText(CONTENT); ownProject(); fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    const staleFence = mocks.save.mock.calls[0][0].isResultCurrent;
    mocks.user = { id: "account-b" }; mocks.sessionUser = "account-b";
    ui.rerender(<MemoryRouter><CitationRecovery /></MemoryRouter>);
    expect(staleFence()).toBe(false);
    await act(async () => gate.resolve({ historyId: "old-history", alreadySaved: false }));
    expect(screen.queryByText(CONTENT)).not.toBeInTheDocument();
    expect(screen.queryByText(/התוצאה נשמרה בהיסטוריה/)).not.toBeInTheDocument();
  });

  it("expires an open copy locally at the original claim deadline, without a network refresh", async () => {
    const now = Date.now();
    vi.useFakeTimers(); vi.setSystemTime(now);
    mocks.list.mockResolvedValueOnce({ requests: [record({ createdAt: new Date(now - 86_399_000).toISOString(), expiresAt: new Date(now + 60_000).toISOString() })], nextCursor: null });
    await act(async () => { view(); });
    expect(screen.getByText(CONTENT)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_005); });
    expect(screen.getByRole("heading", { name: "הושלמה · עותק השחזור פג" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "העתקת התוצאה" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "סיימתי לשחזר" })).not.toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.ack).not.toHaveBeenCalled();
  });
});

describe("owner-verified projects and explicit recovery acknowledgement", () => {
  it("does not expose stale provider project names, and queries only the current owner's projects", async () => {
    mocks.projectsRead.mockResolvedValueOnce({ data: [{ id: "owned-current", name: "הפרויקט המאומת" }], error: null });
    view(); await screen.findByText(CONTENT);
    expect(await screen.findByRole("option", { name: "הפרויקט המאומת" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "פרויקט א" })).not.toBeInTheDocument();
    expect(mocks.projectFilter).toHaveBeenCalledWith("user_id", "account-a");
    expect(saveButton()).toBeDisabled();
  });

  it("drops a previous owner's delayed project list after login changes", async () => {
    const pending = deferred<{ data: Array<{ id: string; name: string }>; error: null }>();
    mocks.projectsRead.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ data: [{ id: "b-owned", name: "הפרויקט של ב" }], error: null });
    const ui = view(); await screen.findByText(CONTENT);
    mocks.user = { id: "account-b" }; mocks.sessionUser = "account-b";
    ui.rerender(<MemoryRouter><CitationRecovery /></MemoryRouter>);
    await act(async () => pending.resolve({ data: [{ id: "secret-a", name: "שם פרויקט פרטי של א" }], error: null }));
    fireEvent.click(screen.getByRole("button", { name: "רענון מצב" }));
    await screen.findByText(CONTENT);
    expect(await screen.findByRole("option", { name: "הפרויקט של ב" })).toBeInTheDocument();
    expect(screen.queryByText("שם פרויקט פרטי של א")).not.toBeInTheDocument();
    expect(mocks.projectFilter).toHaveBeenCalledWith("user_id", "account-b");
  });

  it("a failed project read offers no stale destination while result copy still works", async () => {
    mocks.projectsRead.mockResolvedValueOnce({ data: null, error: new Error("unavailable") });
    view(); await screen.findByText(CONTENT);
    await screen.findByText(/לא ניתן לטעון את הפרויקטים/);
    expect(screen.queryByRole("option", { name: "פרויקט א" })).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "העתקת התוצאה" }));
    await screen.findByText("התוצאה הועתקה.");
  });

  it("only result copy or an explicit done gesture acknowledges; input/ID copies do not", async () => {
    view(); await screen.findByText(CONTENT);
    expect(mocks.ack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("הקלט שנשמר עם הבקשה"));
    fireEvent.click(screen.getByRole("button", { name: "העתקת הקלט" }));
    await screen.findByText("הקלט המוצג הועתק.");
    expect(mocks.clipboard).toHaveBeenLastCalledWith("Original legal source");
    expect(mocks.ack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "סיימתי לשחזר" }));
    await screen.findByRole("button", { name: "השחזור סומן כהושלם" });
    expect(mocks.ack).toHaveBeenCalledWith("account-a", ID, expect.any(Function));
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.retry).not.toHaveBeenCalled();
    expect(screen.getByText(CONTENT)).toBeInTheDocument();
  });

  it("does not misreport an acknowledgement failure as failed copy or failed save", async () => {
    mocks.ack.mockRejectedValue(new Error("journal unavailable"));
    view(); await screen.findByText(CONTENT);
    fireEvent.click(screen.getByRole("button", { name: "העתקת התוצאה" }));
    await screen.findByText(/התוצאה הועתקה, אך סימון השחזור לא אושר/);
    expect(screen.getByText("התוצאה הועתקה.")).toBeInTheDocument();
    ownProject(); fireEvent.click(saveButton());
    await screen.findByText(/התוצאה שמורה בהיסטוריה, אך סימון השחזור לא אושר/);
    expect(screen.getByRole("button", { name: "נשמר בהיסטוריה" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "סיימתי לשחזר" })).toBeEnabled();
    expect(mocks.save).toHaveBeenCalledTimes(1); expect(mocks.retry).not.toHaveBeenCalled();
  });

  it("renders structured-only article output in the UI and copies its original pinpoint without a provider call", async () => {
    mocks.list.mockResolvedValueOnce({ requests: [record({ input: { messages: [{ role: "user", content: "prepared prompt" }], rawInput: null, batchId: null,
      foreignLookup: { kind: "journal_article", jurisdiction: "OTHER", parsedFields: { authors: "Warren & Brandeis", articleTitle: "The Right to Privacy", pinpoint: "213–214" } } },
      result: { foreignLookup: { fields: { authors: "Samuel D. Warren and Louis D. Brandeis", volume: "4", journal: "Harvard Law Review", firstPage: "193", year: "1890" }, identity: { matched: true }, articleResolution: "resolved" } } })], nextCursor: null });
    view();
    const output = await screen.findByTestId("recovered-output");
    expect(output).toHaveTextContent("The Right to Privacy");
    expect(output).toHaveTextContent("193, 213–214 (1890)");
    fireEvent.click(screen.getByRole("button", { name: "העתקת התוצאה" }));
    await screen.findByText("התוצאה הועתקה.");
    expect(mocks.clipboard.mock.calls[0][0]).toContain("193, 213–214 (1890)");
    expect(mocks.clipboard.mock.calls[0][0]).not.toContain("##");
    expect(mocks.retry).not.toHaveBeenCalled();
  });
});

describe("explicit known-failed new attempt", () => {
  it("shows accurate refund disclosure then one explicit paid attempt and canonical child, with no automatic save", async () => {
    mocks.list.mockResolvedValueOnce({ requests: [record({ status: "failed", result: null, refundReceipt: { status: "refunded", refunded: true, units_refunded: 1, request_id: "batch-accounting-anchor" } })], nextCursor: null });
    mocks.read.mockResolvedValueOnce(record({ requestId: CHILD, retryOfRequestId: ID }));
    view(); await screen.findByRole("heading", { name: "הבקשה נכשלה" });
    expect(screen.getByText("החזר השימוש אושר: 1 יחידות הוחזרו.")).toBeInTheDocument();
    expect(screen.getByText(/המכסה הנוכחית תיבדק בשרת/)).toBeInTheDocument();
    expect(mocks.retry).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "ניסיון חדש שעשוי לצרוך שימוש" });
    act(() => { button.click(); button.click(); });
    await screen.findByRole("article", { name: `בקשה ${CHILD}` });
    expect(mocks.prepare).toHaveBeenCalledTimes(1); expect(mocks.retry).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.queryByRole("article", { name: `בקשה ${ID}` })).not.toBeInTheDocument();
  });

  it("never claims a refund from malformed receipt data", async () => {
    mocks.list.mockResolvedValueOnce({ requests: [record({ status: "failed", result: null, refundReceipt: { status: "refunded", refunded: true, units_refunded: 0, request_id: ID } })], nextCursor: null });
    view(); await screen.findByRole("heading", { name: "הבקשה נכשלה" });
    expect(screen.getByText("החזר השימוש טרם אושר.")).toBeInTheDocument();
  });

  it("a changed account during retry preparation prevents the paid dispatch", async () => {
    const pending = deferred<{ failedRequestId: string; handle: string }>();
    mocks.list.mockResolvedValueOnce({ requests: [record({ status: "failed", result: null })], nextCursor: null });
    mocks.prepare.mockReturnValueOnce(pending.promise);
    view();
    fireEvent.click(await screen.findByRole("button", { name: "ניסיון חדש שעשוי לצרוך שימוש" }));
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalled());
    mocks.sessionUser = "account-b";
    await act(async () => pending.resolve({ failedRequestId: ID, handle: "old-owner-handle" }));
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("an uncertain paid response does not report no work or refund and does not offer another new attempt", async () => {
    mocks.list.mockResolvedValueOnce({ requests: [record({ status: "failed", result: null })], nextCursor: null });
    mocks.retry.mockRejectedValueOnce(new Error("Lost response"));
    view();
    fireEvent.click(await screen.findByRole("button", { name: "ניסיון חדש שעשוי לצרוך שימוש" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ייתכן שכבר נוצל שימוש");
    expect(alert).not.toHaveTextContent("לא הופעלה בקשת אזכור נוספת");
    expect(screen.queryByRole("button", { name: "ניסיון חדש שעשוי לצרוך שימוש" })).not.toBeInTheDocument();
  });
});
