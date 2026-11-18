import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
const b = vi.hoisted(() => ({ runCitation: vi.fn(), account: "trial-user" }));
vi.mock("@/lib/runCitation", async original => ({ ...await original<typeof import("@/lib/runCitation")>(), runCitation: b.runCitation }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn(), auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })), getSession: vi.fn(async () => ({ data: { session: null } })), getUser: vi.fn(async () => ({ data: { user: null } })) } } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: b.account }, isAdmin: false, isAdminResolved: true }) }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ currentProject: { id: "quota-bib" } }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), info: vi.fn() } }));
import { CitationRunError } from "@/lib/runCitation";
import { BibliographyGenerator } from "@/components/BibliographyGenerator";
import { BibliographyProvider } from "@/hooks/useBibliography";
function App({ remaining, loading }: { remaining?: number; loading?: boolean }) { return <TooltipProvider><BibliographyProvider><BibliographyGenerator sourceQuota={remaining === undefined ? undefined : { remaining, loading }} /></BibliographyProvider></TooltipProvider>; }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); b.account = "trial-user";
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
  b.runCitation.mockImplementation(async ({ rawInput }: { rawInput: string }) => ({ citation: `Checked ${rawInput}`, reply: `Checked ${rawInput}`, status: "valid", fromVerifiedStore: false }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const paste = () => fireEvent.change(screen.getByRole("textbox"), { target: { value: "First\nSecond\nThird" } });
describe("bibliography source quota selection", () => {
  it("preselects within remainder; swaps sources; never processes or hides originals of unselected rows", async () => {
    render(<App remaining={1} />); paste();
    expect(screen.getByRole("checkbox", { name: "בחר מקור 1: First" })).toBeChecked();
    expect(screen.getByText("Second")).toBeVisible();
    expect(screen.getAllByText("לא נבדק במסגרת המכסה")).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox", { name: "בחר מקור 1: First" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "בחר מקור 3: Third" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /שלח לבדיקה/ })));
    await waitFor(() => expect(b.runCitation).toHaveBeenCalledTimes(1));
    expect(b.runCitation.mock.calls[0][0].rawInput).toBe("Third");
    expect(screen.getByRole("textbox")).toHaveValue("First\nSecond");
    expect(screen.getAllByRole("checkbox").every(box => !(box as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("button", { name: /שלח לבדיקה/ })).toBeDisabled();
  });
  it("blocks at zero/loading and preserves saved bibliography without engine work", () => {
    const app = render(<App remaining={0} />); paste();
    expect(screen.getByRole("button", { name: /שלח לבדיקה/ })).toBeDisabled();
    app.rerender(<App remaining={3} loading />);
    expect(screen.getByRole("button", { name: /שלח לבדיקה/ })).toBeDisabled();
    expect(b.runCitation).not.toHaveBeenCalled();
  });
  it("adapts selection to a lower server remainder and does not let stale selected indexes through", async () => {
    const app = render(<App remaining={3} />); paste();
    app.rerender(<App remaining={1} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /שלח לבדיקה/ })));
    expect(b.runCitation).toHaveBeenCalledTimes(1);
  });
  it("keeps a source in the unread batch when another tab consumes the last slot", async () => {
    b.runCitation.mockRejectedValueOnce(new CitationRunError({
      code: "TRIAL_EXHAUSTED", isInsufficientCredits: true, userMessage: "no slot",
    }));
    render(<App remaining={1} />); paste();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /שלח לבדיקה/ })));
    expect(b.runCitation).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox")).toHaveValue("First\nSecond\nThird");
    expect(screen.getAllByText("לא נבדק במסגרת המכסה")).toHaveLength(3);
  });
  it("leaves the paid/unlimited flow intact", async () => {
    render(<App />); paste();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /שלח לבדיקה/ })));
    expect(b.runCitation).toHaveBeenCalledTimes(3);
  });
  it("clears staging on account scope changes", () => {
    const app = render(<App remaining={2} />); paste();
    b.account = "other-user"; app.rerender(<App remaining={2} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(b.runCitation).not.toHaveBeenCalled();
  });
});
