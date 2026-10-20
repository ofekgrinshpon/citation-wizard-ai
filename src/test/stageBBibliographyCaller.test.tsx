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
  copyRichText: vi.fn(async (_html: string, _plain: string) => {}),
  runCitation: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/clipboard", () => ({ copyRichText: b.copyRichText, copyPlainText: vi.fn() }));
vi.mock("@/lib/runCitation", async (original) => {
  const actual = await original<typeof import("@/lib/runCitation")>();
  return { ...actual, runCitation: b.runCitation };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" }, isAdmin: false, isAdminResolved: true }) }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ currentProject: { id: "bib-project" } }) }));
vi.mock("sonner", () => ({ toast: b.toast }));

import { BibliographyGenerator } from "@/components/BibliographyGenerator";
import { BibliographyProvider } from "@/hooks/useBibliography";
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
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("BibliographyGenerator — fresh intake → commit → reload → copy", () => {
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
