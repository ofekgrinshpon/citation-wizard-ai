import { bookEditionResult, editionRaw } from "./fixtures/bookEditionResult";
/**
 * Stage B corrective — BibliographyGenerator through the real component,
 * the real BibliographyProvider (localStorage) and real copy serializers.
 * Only the engine and clipboard boundaries are mocked. Offline only.
 */
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

const b = vi.hoisted(() => ({
  account: "u1", project: "bib-project",
  copyRichText: vi.fn(async (_html: string, _plain: string) => {}),
  runCitation: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/clipboard", () => ({ copyRichText: b.copyRichText, copyPlainText: vi.fn() }));
vi.mock("@/lib/runCitation", async (original) => {
  const actual = await original<typeof import("@/lib/runCitation")>();
  return { ...actual, runCitation: b.runCitation };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: vi.fn() }, from: vi.fn(),
  auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    getSession: vi.fn(async () => ({ data: { session: null } })), getUser: vi.fn(async () => ({ data: { user: null } })) },
} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: b.account }, isAdmin: false, isAdminResolved: true }) }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ currentProject: { id: b.project } }) }));
vi.mock("sonner", () => ({ toast: b.toast }));

import { BibliographyGenerator } from "@/components/BibliographyGenerator";
import { BibliographyProvider, useBibliography } from "@/hooks/useBibliography";
import { c1ServerPayload } from "./fixtures/c1ServerPayload";
import { buildPastedCitation } from "../../supabase/functions/_shared/pastedCitation";
import { acceptCitationCompletion } from "@/lib/citationCompletion";
import { renderForeignCitation } from "@/data/bluebook";

const ARTICLE = "Ronald H. Coase, ##The Problem of Social Cost##, 3 ^^J.L. & Econ.^^ 1 (1960).";
const WARNING = "לא אומתה התאמת ה־DOI או הקישור לפרטי המאמר שסיפקתם.";
const MARKERS = /##|\^\^|\*\*/;

const mount = () => render(<TooltipProvider><BibliographyProvider><BibliographyGenerator /></BibliographyProvider></TooltipProvider>);
const lastRich = () => {
  const call = b.copyRichText.mock.calls.at(-1)!;
  return { html: call[0] as string, plain: call[1] as string };
};

async function intakeAndCommit(raw: string) {
  mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: raw } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /שלח לבדיקה/ })); });
  await waitFor(() => expect(screen.getByRole("button", { name: /הוסף הכל לביבליוגרפיה \(1\)/ })).not.toBeDisabled());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /הוסף הכל לביבליוגרפיה/ })); });
}

beforeEach(() => {
  vi.clearAllMocks();
  b.account="u1"; b.project="bib-project";
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("BibliographyGenerator — fresh intake → commit → reload → copy", () => {
  it("retains completion in the real provider entry but strips it from storage and reload", async () => {
    const rawInput = "Brown v. Board of Education";
    const req = { kind: "case" as const, jurisdiction: "UNKNOWN" as const, rawInput, parsedFields: { caseName: rawInput } };
    const { response } = await c1ServerPayload(req);
    const completion = acceptCitationCompletion(req, rawInput, response);
    const pastedCitation = buildPastedCitation(rawInput);
    b.runCitation.mockResolvedValue({ reply: "Brown v. Board of Education, 347 U.S. 483 (1954).", citation: "Brown v. Board of Education, 347 U.S. 483 (1954).", status: "valid", sourceType: "foreign_case_us", sourceLabel: "x", fromVerifiedStore: false, completion, pastedCitation });
    const captured: unknown[] = [];
    function Probe() { captured.push(useBibliography().entries); return null; }
    render(<TooltipProvider><BibliographyProvider><Probe /><BibliographyGenerator /></BibliographyProvider></TooltipProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: rawInput } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /שלח לבדיקה/ })));
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: /הוסף הכל לביבליוגרפיה/ })));
    expect(captured.at(-1)).toEqual([expect.objectContaining({ completion, pastedCitation })]);
    const stored = JSON.parse(localStorage.getItem("bibliography_entries_bib-project") ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toHaveProperty("completion");
    expect(stored[0]).not.toHaveProperty("pastedCitation");
    cleanup();
    render(<BibliographyProvider><Probe /></BibliographyProvider>);
    expect(captured.at(-1)).toEqual([expect.not.objectContaining({ completion })]);
  });
  it("keeps italic/small caps and the reply-only warning through save, reload and export", async () => {
    // Real runCitation shape: warning only in reply/warningMsg, not in citation.
    b.runCitation.mockResolvedValue({
      reply: `${ARTICLE}\n⚠️ ${WARNING}`, citation: ARTICLE, status: "warning", warningMsg: WARNING,
      sourceType: "foreign_journal_article", sourceLabel: "x", fromVerifiedStore: false,
    });
    await intakeAndCommit("Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)");

    fireEvent.click(screen.getByRole("button", { name: /העתק הכל ל-Word/ }));
    let { html, plain } = lastRich();
    expect(html).toContain("<em>The Problem of Social Cost</em>");
    expect(html).toContain("font-variant:small-caps");
    expect(html).toContain(WARNING);
    expect(html).not.toMatch(MARKERS);
    expect(plain).toContain("Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)");
    expect(plain).toContain(WARNING);
    expect(plain).not.toMatch(MARKERS);

    // Reload: a fresh provider reads the persisted entry back.
    cleanup();
    mount();
    fireEvent.click(screen.getByRole("button", { name: /העתק הכל ל-Word/ }));
    ({ html, plain } = lastRich());
    expect(html).toContain("<em>The Problem of Social Cost</em>");
    expect(html).toContain("font-variant:small-caps");
    expect(plain).toContain(WARNING);
  });

  it("a literal source title with marker-like characters survives renderer → bibliography → copy", async () => {
    const rendered = renderForeignCitation("Jane Doe, C## Guide: x^^2 & A**B, 12 Yale L.J. 1 (2000)")!;
    b.runCitation.mockResolvedValue({
      reply: rendered.citation, citation: rendered.citation, status: "valid",
      sourceType: "foreign_journal_article", sourceLabel: "x", fromVerifiedStore: false,
    });
    await intakeAndCommit("Jane Doe, C## Guide: x^^2 & A**B, 12 Yale L.J. 1 (2000)");
    fireEvent.click(screen.getByRole("button", { name: /העתק הכל ל-Word/ }));
    const { html, plain } = lastRich();
    expect(plain).toContain("Jane Doe, C## Guide: x^^2 & A**B, 12 Yale L.J. 1 (2000)");
    expect(html).toContain("<em>C## Guide: x^^2 &amp; A**B</em>");
  });
});

describe("Bibliography category moves", () => {
  const seed = () => localStorage.setItem("bibliography_entries_bib-project", JSON.stringify([
    { id: "a", rawInput: "supplied raw", fullCitation: "Custom **case citation** (2020)", sourceType: "literature", language: "hebrew", subCategory: "ספרות", manualCategory: true, warnings: [WARNING], isVerified: false, addedFrom: "manual", addedAt: 1 },
    { id: "b", rawInput: "other raw", fullCitation: "Other **citation** (2021)", sourceType: "caselaw_district", language: "hebrew", subCategory: "מחוזי", manualCategory: true, addedFrom: "manual", addedAt: 2 },
  ]));
  it("moves with a keyboard/mobile select, preserving text, warning, identity and export across reload", () => {
    seed(); mount();
    const selector = screen.getByRole("combobox", { name: "העבר לקטגוריה: Custom **case citation** (2020)" });
    fireEvent.change(selector, { target: { value: "foreign_caselaw" } });
    const stored = JSON.parse(localStorage.getItem("bibliography_entries_bib-project")!);
    expect(stored.find((e: {id:string}) => e.id === "a")).toMatchObject({
      id: "a", rawInput: "supplied raw", fullCitation: "Custom **case citation** (2020)", sourceType: "foreign_caselaw", language: "english", manualCategory: true, warnings: [WARNING], isVerified: false,
    });
    expect(b.runCitation).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("המקור הועבר");
    cleanup(); mount();
    expect(screen.getByRole("combobox", { name: "העבר לקטגוריה: Custom **case citation** (2020)" })).toHaveValue("foreign_caselaw");
    fireEvent.click(screen.getByRole("button", { name: /העתק הכל ל-Word/ }));
    const { html, plain } = lastRich();
    expect(plain).toMatch(/מקורות באנגלית\s+פסיקה לועזית/);
    expect(plain).toContain(WARNING);
    expect(html).toContain("<strong>case citation</strong>");
    expect(b.runCitation).not.toHaveBeenCalled();
  });
  it("moves a dragged block into an existing category and ignores external drops", () => {
    seed(); mount();
    const target = screen.getByRole("region", { name: "קטגוריה: פסיקה – בית משפט מחוזי" });
    const dt = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    // A drop without a locally dragged entry must not mutate data.
    const before = localStorage.getItem("bibliography_entries_bib-project");
    fireEvent.drop(target, { dataTransfer: dt });
    expect(localStorage.getItem("bibliography_entries_bib-project")).toBe(before);
    fireEvent.dragStart(screen.getAllByTitle("גררו לקטגוריה אחרת")[1], { dataTransfer: dt });
    // Category sorting puts district first, literature second.
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });
    expect(screen.getByRole("combobox", { name: "העבר לקטגוריה: Custom **case citation** (2020)" })).toHaveValue("caselaw_district");
    expect(b.runCitation).not.toHaveBeenCalled();
  });
});

describe('bibliography edition selection from existing evidence',()=>{
  it('selects a year locally, preserves foreign book category and never persists the choice',async()=>{
    b.runCitation.mockResolvedValue(bookEditionResult());
    mount();fireEvent.change(screen.getByRole('textbox'),{target:{value:editionRaw}});
    fireEvent.click(screen.getByRole('button',{name:/שלח לבדיקה/}));
    const choose=await screen.findByRole('button',{name:'1993'});
    expect(screen.getByRole('button',{name:/הוסף הכל לביבליוגרפיה/})).toBeDisabled();
    fireEvent.click(choose);fireEvent.click(choose);
    await waitFor(()=>expect(screen.getByRole('button',{name:/הוסף הכל לביבליוגרפיה/})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:/הוסף הכל לביבליוגרפיה/}));
    expect(screen.getByRole('region',{name:'קטגוריה: ספרים לועזיים'})).toHaveTextContent('1993');
    expect(b.runCitation).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(localStorage)).not.toContain('bookEditionChoice');
  });
  it('can explicitly leave the year missing without another lookup',async()=>{
    b.runCitation.mockResolvedValue(bookEditionResult());mount();fireEvent.change(screen.getByRole('textbox'),{target:{value:editionRaw}});fireEvent.click(screen.getByRole('button',{name:/שלח לבדיקה/}));
    fireEvent.click(await screen.findByRole('button',{name:/להשאיר את השנה חסרה/}));
    await waitFor(()=>expect(screen.getByRole('button',{name:/הוסף הכל לביבליוגרפיה/})).toBeEnabled());
    expect(b.runCitation).toHaveBeenCalledTimes(1);expect(screen.queryByRole('group',{name:'בחירת מהדורת הספר'})).not.toBeInTheDocument();
  });
  for(const scope of ['account','project'] as const) it(`discards edition choices on ${scope} change`,async()=>{
    b.runCitation.mockResolvedValue(bookEditionResult());const view=mount();fireEvent.change(screen.getByRole('textbox'),{target:{value:editionRaw}});fireEvent.click(screen.getByRole('button',{name:/שלח לבדיקה/}));
    const stale=await screen.findByRole('button',{name:'1993'});b[scope]='other';
    view.rerender(<TooltipProvider><BibliographyProvider><BibliographyGenerator /></BibliographyProvider></TooltipProvider>);
    fireEvent.click(stale);expect(screen.queryByRole('group',{name:'בחירת מהדורת הספר'})).not.toBeInTheDocument();expect(b.runCitation).toHaveBeenCalledTimes(1);
  });
});

it('invalidates an edition choice when the citation is manually edited',async()=>{
  b.runCitation.mockResolvedValue(bookEditionResult());mount();fireEvent.change(screen.getByRole('textbox'),{target:{value:editionRaw}});fireEvent.click(screen.getByRole('button',{name:/שלח לבדיקה/}));
  const stale=await screen.findByRole('button',{name:'1993'});fireEvent.click(screen.getByRole('button',{name:/✏️ ערוך/}));
  fireEvent.change(screen.getByPlaceholderText('הקלד את האזכור המלא...'),{target:{value:'Manual book (2001)'}});fireEvent.click(screen.getByRole('button',{name:'שמור'}));fireEvent.click(stale);
  expect(screen.queryByRole('group',{name:'בחירת מהדורת הספר'})).not.toBeInTheDocument();expect(screen.getByText('Manual book (2001)')).toBeInTheDocument();expect(b.runCitation).toHaveBeenCalledTimes(1);
});
