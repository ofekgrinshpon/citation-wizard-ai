/**
 * Stage B corrective — caller-level fixtures. These drive the REAL component
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
import { MessageBubble } from "@/components/MessageBubble";
import { UniformCitationPanel } from "@/components/legal-research/UniformCitationPanel";
import { citationToOoxml } from "@/lib/wordInsertion";

const render = (ui: React.ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>, { wrapper: MemoryRouter });

const BOOK = "^^H.L.A. Hart, The Concept of Law^^ 100 (2d ed. 1994).";
const ARTICLE = "Ronald H. Coase, ##The Problem of Social Cost##, 3 ^^J.L. & Econ.^^ 1 (1960).";
const WARNING = "פרטים שסופקו נשמרו כפי שהוזנו, בלי עיצוב או אימות אוטומטי: \"(Taylor, J., dissenting)\".";
const MARKERS = /##|\^\^|\*\*/;

const lastRich = () => {
  const call = b.copyRichText.mock.calls.at(-1)!;
  return { html: call[0] as string, plain: call[1] as string };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
  localStorage.clear();
  b.office.isOfficeAddin = false;
  b.office.hasDocumentAccess = false;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function seedBatch(phase: "final" | "review") {
  localStorage.setItem("footnote_cells_row-project", JSON.stringify([
    { id: 1, key: "k1", input: "Hart, The Concept of Law", output: `${BOOK}\n⚠️ ${WARNING}`, status: "warning", approved: true },
    { id: 2, key: "k2", input: "Coase, The Problem of Social Cost", output: ARTICLE, status: "valid", approved: true },
  ]));
  localStorage.setItem("footnote_phase_row-project", phase);
}

describe("BatchFootnoteBuilder — actual copy callbacks keep styles", () => {
  it("copyAll keeps small caps and italics in rich output, warnings in both channels", () => {
    seedBatch("final");
    render(<BatchFootnoteBuilder />);
    fireEvent.click(screen.getByRole("button", { name: /העתק הכל/ }));
    const { html, plain } = lastRich();
    expect(html).toContain('<span style="font-variant:small-caps;font-variant-caps:small-caps">H.L.A. Hart, The Concept of Law</span>');
    expect(html).toContain("<em>The Problem of Social Cost</em>");
    expect(html).not.toMatch(MARKERS);
    expect(plain).not.toMatch(MARKERS);
    expect(plain).toContain("[1] H.L.A. Hart, The Concept of Law 100 (2d ed. 1994).");
    expect(plain).toContain("(Taylor, J., dissenting)");
  });

  it("copySingle keeps small caps for the selected footnote", () => {
    seedBatch("final");
    render(<BatchFootnoteBuilder />);
    fireEvent.click(screen.getAllByRole("button", { name: "📋" })[0]);
    const { html, plain } = lastRich();
    expect(html).toContain("font-variant:small-caps");
    expect(html).toContain("H.L.A. Hart, The Concept of Law");
    expect(plain).toBe(`H.L.A. Hart, The Concept of Law 100 (2d ed. 1994).\n⚠️ ${WARNING}`);
  });

  it("finalize syncs bibliography entries with styles and warnings, not stripped text", async () => {
    seedBatch("review");
    render(<BatchFootnoteBuilder />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /בנה רשימה סופית/ })); });
    await waitFor(() => expect(b.sync).toHaveBeenCalled());
    const items = b.sync.mock.calls[0][0] as { fullCitation: string; warnings?: string[] }[];
    expect(items[0].fullCitation).toBe(BOOK);
    expect(items[0].warnings).toEqual([WARNING]);
    expect(items[1].fullCitation).toBe(ARTICLE);
  });
});

describe("MessageBubble — chat copy uses safe shared formatting", () => {
  const content = "##<img src=x onerror=alert(1)>## v. Roe, 1 ^^U.S.^^ 1 (2000) https://example.org/a?q=1&x=2\n⚠️ " + WARNING;

  it("escapes HTML-looking source text, converts small caps, keeps link and warning", async () => {
    render(<MessageBubble msg={{ role: "assistant", content }} />);
    await act(async () => { fireEvent.click(screen.getByTitle("העתק")); });
    const { html, plain } = lastRich();
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("font-variant:small-caps");
    expect(html).toContain('<a href="https://example.org/a?q=1&amp;x=2">');
    expect(html).not.toMatch(MARKERS);
    expect(plain).toContain("<img src=x onerror=alert(1)> v. Roe, 1 U.S. 1 (2000) https://example.org/a?q=1&x=2");
    expect(plain).toContain(WARNING);
    expect(plain).not.toMatch(MARKERS);
  });
});

describe("UniformCitationPanel — copy and Word keep styles, warnings and the source URL", () => {
  const footnotes = [{ number: 7, title: "Original foreign citation", url: "https://example.org/article?q=1&x=2" }];
  async function startPanel() {
    b.runCitation.mockResolvedValue({
      reply: `${ARTICLE}\n⚠️ ${WARNING}`, citation: ARTICLE, status: "warning", warningMsg: WARNING,
      sourceType: "foreign_journal_article", sourceLabel: "x", fromVerifiedStore: false,
    });
    render(<UniformCitationPanel footnotes={footnotes} />);
    fireEvent.click(screen.getByRole("button", { name: /יצירת הערות שוליים/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "המשך" })); });
    await waitFor(() => expect(screen.getByTitle("העתק הערה")).not.toBeDisabled());
  }

  it("copySingle keeps italics/small caps, the separate source link and the warning", async () => {
    await startPanel();
    await act(async () => { fireEvent.click(screen.getByTitle("העתק הערה")); });
    const { html, plain } = lastRich();
    expect(html).toContain("<em>The Problem of Social Cost</em>");
    expect(html).toContain("font-variant:small-caps");
    expect(html).toContain('<a href="https://example.org/article?q=1&amp;x=2">');
    expect(html).toContain("(Taylor, J., dissenting)");
    expect(plain).toContain("https://example.org/article?q=1&x=2");
    expect(plain).toContain(WARNING);
    expect(plain).not.toMatch(MARKERS);
  });

  it("Word insertion receives native styles, the URL and the warning", async () => {
    b.office.isOfficeAddin = true;
    b.office.hasDocumentAccess = true;
    await startPanel();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /הכנס הכל ל-Word/ })); });
    const ooxml = citationToOoxml(b.insert.mock.calls[0][0] as string);
    expect(ooxml).toContain("<w:smallCaps/>");
    expect(ooxml).toContain("<w:i/>");
    expect(ooxml).toContain("https://example.org/article?q=1&amp;x=2");
    expect(ooxml).toContain("(Taylor, J., dissenting)");
    expect(ooxml).not.toMatch(MARKERS);
  });

  it("an edited output still carries the source URL and warning", async () => {
    await startPanel();
    const box = screen.getAllByRole("textbox").find((el) => (el as HTMLTextAreaElement).value.includes("Coase"))!;
    fireEvent.change(box, { target: { value: "Ronald H. Coase, ##The Problem of Social Cost##, 3 ^^J.L. & Econ.^^ 1, 15 (1960)." } });
    await act(async () => { fireEvent.click(screen.getByTitle("העתק הערה")); });
    const { html, plain } = lastRich();
    const italic = parseCitationSegments("Ronald H. Coase, ##The Problem of Social Cost##").find((s) => s.italic)!;
    expect(html).toContain(`<em>${italic.text}</em>`);
    expect(plain).toContain("1, 15 (1960).");
    expect(plain).toContain("https://example.org/article?q=1&x=2");
    expect(plain).toContain(WARNING);
  });
});
