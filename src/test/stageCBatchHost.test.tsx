/**
 * Stage C correction — batch host uses the effective foreign classification. These drive the REAL component
 * callbacks (batch copy, chat copy, uniform-citation copy/Word) with only the
 * clipboard, Word host, engine and backend boundaries mocked. Offline only.
 */
import { webcrypto } from "node:crypto";
import { MemoryRouter } from "react-router-dom";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { parseCitationSegments } from "@/lib/citationSegments";

const b = vi.hoisted(() => ({
  copyRichText: vi.fn(async (_html: string, _plain: string) => {}),
  copyPlainText: vi.fn(async (_plain: string) => {}),
  insert: vi.fn(async (_text: string) => ({ mode: "footnote" as const })),
  runCitation: vi.fn(),
  sync: vi.fn((_items: unknown[]) => 0),
  office: { isOfficeAddin: false, hasDocumentAccess: false },
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/clipboard", () => ({ copyRichText: b.copyRichText, copyPlainText: b.copyPlainText }));
vi.mock("@/lib/wordInsertion", async (original) => {
  const actual = await original<typeof import("@/lib/wordInsertion")>();
  return { ...actual, insertCitationAsFootnote: b.insert };
});
vi.mock("@/lib/runCitation", async (original) => {
  const actual = await original<typeof import("@/lib/runCitation")>();
  return { ...actual, runCitation: b.runCitation };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: vi.fn() },
  auth: { getSession: vi.fn(async () => ({ data: { session: null } })), getUser: vi.fn(async () => ({ data: { user: null } })) },
  from: () => ({
    insert: () => Promise.resolve({ data: null, error: null }),
    select: () => ({ or: () => ({ limit: async () => ({ data: [] }) }) }),
  }),
} }));
vi.mock("@/lib/verifiedSources", () => ({
  findVerifiedSourceMatch: vi.fn(async () => null), classifyVerifiedSource: vi.fn(),
  getVerifiedCategoryLabel: vi.fn(), ensureVerifiedSources: vi.fn(async () => {}),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" }, isAdmin: false, isAdminResolved: true }) }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ currentProject: { id: "row-project" } }) }));
vi.mock("@/hooks/useOffice", () => ({ useOffice: () => b.office }));
vi.mock("@/hooks/useBibliography", () => ({
  useBibliography: () => ({ sortedEntries: [], addEntries: vi.fn(), removeEntry: vi.fn(), clearAll: vi.fn(), syncFootnoteEntries: b.sync }),
  CATEGORY_LABELS: {}, classifyCitation: () => ({ sourceType: "unknown", language: "hebrew" }),
}));
vi.mock("sonner", () => ({ toast: b.toast }));
vi.mock("@/components/VerifiedAutocomplete", () => ({ VerifiedAutocomplete: ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
  <input aria-label="מקור" value={value} onChange={(e) => onChange(e.target.value)} /> }));

import { BatchFootnoteBuilder } from "@/components/BatchFootnoteBuilder";
import { applyOverride, createRecord } from "@/lib/foreignClassification";
import { saveRecord } from "@/lib/foreignClassificationStore";
import { supabase } from "@/integrations/supabase/client";

const render = (ui: React.ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>, { wrapper: MemoryRouter });
const INPUT = "Smith v Jones, 2019 SCC 5";
let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", webcrypto);
  fetchSpy = vi.fn(() => { throw new Error("Live network forbidden"); });
  vi.stubGlobal("fetch", fetchSpy);
  localStorage.clear();
  localStorage.setItem("footnote_cells_row-project", JSON.stringify([
    { id: 1, key: "k1", input: INPUT, output: "Smith v Jones, 2019 SCC 5.", status: "valid", detectedType: "foreign_case_other" },
  ]));
  localStorage.setItem("footnote_phase_row-project", "review");
  b.runCitation.mockResolvedValue({ reply: "Smith v. Jones, 2019 SCC 5.", citation: "Smith v. Jones, 2019 SCC 5.", status: "valid",
    sourceType: "foreign_case_other", sourceLabel: "x", fromVerifiedStore: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const choose = (jurisdiction: string) => saveRecord("u1", applyOverride(createRecord("batch:k1", INPUT),
  { scalars: { family: "decision", subtype: "decision.judgment", jurisdiction } }));

describe("BatchFootnoteBuilder — explicit regeneration", () => {
  it("D1a real shared engine renders an actual batch regeneration locally and preserves copies", async () => {
    const input = "Alpha v. Beta, No. 24-CV-017-A, 2024 WL 123456, at *3, *7–9 (D. Mass. Mar. 2, 2024)";
    localStorage.setItem("footnote_cells_row-project", JSON.stringify([
      { id: 1, key: "k1", input, output: "old output", status: "valid", detectedType: "foreign_case_us" },
    ]));
    saveRecord("u1", applyOverride(createRecord("batch:k1", input), { scalars: { family: "decision", subtype: "decision.judgment", jurisdiction: "us", publication_status: "unpublished" } }));
    const actual = await vi.importActual<typeof import("@/lib/runCitation")>("@/lib/runCitation");
    b.runCitation.mockImplementation(actual.runCitation);
    render(<BatchFootnoteBuilder />);
    expect(screen.getByTestId("foreign-stale")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "הפקה מחדש לפי הסיווג" })); });
    await waitFor(() => expect(screen.queryByTestId("foreign-stale")).toBeNull());
    const result = await b.runCitation.mock.results[0].value;
    expect(result.citation).toBe(`${input}.`);
    expect(result.status).toBe("warning");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.mocked(supabase.functions.invoke).mock.calls.every(([name]) => name === "cost-telemetry-event")).toBe(true);
    // Exercise the actual batch copy callback, not just the formatting helper.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /אשר הכל/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /בנה רשימה סופית/ })); });
    await waitFor(() => expect(screen.getByRole("button", { name: /העתק הכל/ })).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /העתק הכל/ })); });
    await waitFor(() => expect(b.copyRichText).toHaveBeenCalled());
    expect(b.copyRichText.mock.calls[0][1]).toContain("at *3, *7–9");
    expect(b.copyRichText.mock.calls[0][0]).not.toContain("##");
  });

  it("R17.2 manual manuscript choice reaches actual batch regeneration locally; copy stays roman and safe", async () => {
    const input = "Maya Cohen, Courts <b>and</b> Memory 12, 15 (2024)";
    localStorage.setItem("footnote_cells_row-project", JSON.stringify([
      { id: 1, key: "k1", input, output: "old output", status: "valid", detectedType: "foreign_book" },
    ]));
    saveRecord("u1", applyOverride(createRecord("batch:k1", input), { scalars: { family: "unpublished_communication", subtype: "unpublished_communication.manuscript" } }));
    const actual = await vi.importActual<typeof import("@/lib/runCitation")>("@/lib/runCitation");
    b.runCitation.mockImplementation(actual.runCitation);
    render(<BatchFootnoteBuilder />);
    expect(screen.getByTestId("foreign-stale")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "הפקה מחדש לפי הסיווג" })); });
    await waitFor(() => expect(screen.queryByTestId("foreign-stale")).toBeNull());
    expect(b.runCitation.mock.calls[0][0].overrideType).toBe("foreign_unpublished_manuscript");
    const result = await b.runCitation.mock.results[0].value;
    expect(result.citation).toBe(`${input} (unpublished manuscript).`);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.mocked(supabase.functions.invoke).mock.calls.every(([name]) => name === "cost-telemetry-event")).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /אשר הכל/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /בנה רשימה סופית/ })); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /העתק הכל/ })); });
    await waitFor(() => expect(b.copyRichText).toHaveBeenCalled());
    const [html, plain] = b.copyRichText.mock.calls[0];
    expect(plain).toContain(`${input} (unpublished manuscript).`);
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toMatch(/<i>|small-caps|##|\^\^/);
  });
  it("R16.6 manual newspaper choice reaches actual batch regeneration locally; copy keeps escaping", async () => {
    const input = "Local <b>Vote</b> Delayed, Daily Synthetic, June 25, 1990, at A1, A4";
    localStorage.setItem("footnote_cells_row-project", JSON.stringify([
      { id: 1, key: "k1", input, output: "old output", status: "valid", detectedType: "foreign" },
    ]));
    saveRecord("u1", applyOverride(createRecord("batch:k1", input), { scalars: { family: "periodical", subtype: "periodical.newspaper" } }));
    const actual = await vi.importActual<typeof import("@/lib/runCitation")>("@/lib/runCitation");
    b.runCitation.mockImplementation(actual.runCitation);
    render(<BatchFootnoteBuilder />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "הפקה מחדש לפי הסיווג" })); });
    await waitFor(() => expect(b.runCitation).toHaveBeenCalledTimes(1));
    expect(b.runCitation.mock.calls[0][0].overrideType).toBe("foreign_newspaper");
    const result = await b.runCitation.mock.results[0].value;
    expect(result.citation).toBe("##Local <b>Vote</b> Delayed##, ^^Daily Synthetic^^, June 25, 1990, at A1.");
    expect(result.reply).toContain("A4");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.mocked(supabase.functions.invoke).mock.calls.every(([name]) => name === "cost-telemetry-event")).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /אשר הכל/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /בנה רשימה סופית/ })); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /העתק הכל/ })); });
    await waitFor(() => expect(b.copyRichText).toHaveBeenCalled());
    const [html, plain] = b.copyRichText.mock.calls[0];
    expect(plain).toContain("Local <b>Vote</b> Delayed, Daily Synthetic, June 25, 1990, at A1.");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toMatch(/##|\^\^/);
  });
  it("R17.2 unsupported sibling (letter) choice is generic and flagged, never the manuscript renderer", async () => {
    const input = "Maya Cohen, Courts and Memory (2024) (unpublished manuscript)";
    localStorage.setItem("footnote_cells_row-project", JSON.stringify([
      { id: 1, key: "k1", input, output: "x", status: "valid", detectedType: "foreign_unpublished_manuscript" },
    ]));
    saveRecord("u1", applyOverride(createRecord("batch:k1", input), { scalars: { family: "unpublished_communication", subtype: "unpublished_communication.letter" } }));
    render(<BatchFootnoteBuilder />);
    expect(screen.getByTestId("foreign-support").dataset.status).toBe("unsupported");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /הפק מחדש$/ })); });
    await waitFor(() => expect(b.runCitation).toHaveBeenCalledTimes(1));
    expect(b.runCitation.mock.calls[0][0].overrideType).toBe("foreign");
  });

  it("supported US decision choice reaches the engine; stale clears only after that generation", async () => {
    choose("us");
    render(<BatchFootnoteBuilder />);
    expect(screen.getByTestId("foreign-stale")).toBeInTheDocument();
    expect(b.runCitation).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "הפקה מחדש לפי הסיווג" })); });
    await waitFor(() => expect(b.runCitation).toHaveBeenCalledTimes(1));
    expect(b.runCitation.mock.calls[0][0].overrideType).toBe("foreign_case_us");
    await waitFor(() => expect(screen.queryByTestId("foreign-stale")).toBeNull());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
  it("unsupported Canada choice is generated generically (not US) and flagged", async () => {
    choose("t2:canada");
    render(<BatchFootnoteBuilder />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /הפק מחדש$/ })); });
    await waitFor(() => expect(b.runCitation).toHaveBeenCalledTimes(1));
    expect(b.runCitation.mock.calls[0][0].overrideType).toBe("foreign_case_other");
    await waitFor(() => expect(screen.getByText(/עדיין לא נתמך בעיצוב האוטומטי: האזכור הופק/)).toBeInTheDocument());
    expect(screen.getByTestId("foreign-support").dataset.status).toBe("unsupported");
  });
  it("editing the output by hand never certifies the classification", async () => {
    choose("us");
    render(<BatchFootnoteBuilder />);
    fireEvent.change(screen.getAllByRole("textbox").find((t) => t.tagName === "TEXTAREA")!, { target: { value: "hand edit" } });
    expect(screen.getByTestId("foreign-stale")).toBeInTheDocument();
    expect(b.runCitation).not.toHaveBeenCalled();
  });
});
