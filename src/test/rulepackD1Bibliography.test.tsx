/** D1 correction: actual BibliographyGenerator regeneration carries the effective manual choice. Offline. */
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

const b = vi.hoisted(() => ({ run: vi.fn(), invoke: vi.fn(), cache: vi.fn(), plan: vi.fn(), toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/lib/runCitation", async (original) => {
  const actual = await original<typeof import("@/lib/runCitation")>();
  b.run.mockImplementation((o: Parameters<typeof actual.runCitation>[0]) => actual.runCitation(o));
  return { ...actual, runCitation: b.run };
});
vi.mock("@/lib/functionError", async (original) => ({ ...(await original<object>()), invokeFunction: b.invoke }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: b.cache }));
vi.mock("@/lib/foreignClassificationStore", () => ({ planForItem: b.plan, recordGeneration: vi.fn(), clearItemsWithPrefix: vi.fn() }));
vi.mock("@/components/ForeignSourcePicker", () => ({ ForeignSourcePicker: ({ onRegenerate }: { onRegenerate: () => void }) => <button type="button" onClick={onRegenerate}>regen-picker</button> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: vi.fn() }, from: vi.fn(),
  auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    getSession: vi.fn(async () => ({ data: { session: null } })), getUser: vi.fn(async () => ({ data: { user: null } })) },
} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" }, isAdmin: false, isAdminResolved: true }) }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ currentProject: { id: "bib-project" } }) }));
vi.mock("sonner", () => ({ toast: b.toast }));

import { BibliographyGenerator } from "@/components/BibliographyGenerator";
import { BibliographyProvider } from "@/hooks/useBibliography";
import { citationManualChoice } from "@/lib/pastedCitationAdapter";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
  localStorage.clear();
  b.invoke.mockReset(); b.cache.mockReset(); b.plan.mockReset();
  b.invoke.mockResolvedValue({ data: { content: "UNSAFE MODEL OUTPUT" }, errorInfo: null });
  b.cache.mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const RAW = "Brown v. Board of Education";
const CASES = (["t2:australia", "t2:canada", "t2:germany-federal-republic-of", "t2:france-republic-of"] as const)
  .flatMap(id => (["foreign_case_other", "foreign_statute_us"] as const).map(type => ({ id, type })));

describe("actual BibliographyGenerator regeneration with a disabled-country manual choice", () => {
  it.each(CASES)("$id $type: manual choice reaches runCitation; raw preserved; zero cache/provider", async ({ id, type }) => {
    // Initial intake result only (real host state); regeneration then runs the actual runCitation.
    b.run.mockImplementationOnce(async () => ({ reply: RAW, citation: RAW, status: "warning", sourceType: "foreign_case_us", sourceLabel: "x", fromVerifiedStore: false }));
    render(<TooltipProvider><BibliographyProvider><BibliographyGenerator /></BibliographyProvider></TooltipProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: RAW } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /שלח לבדיקה/ })); });
    const regen = await screen.findByRole("button", { name: "regen-picker" });
    const manualChoice = citationManualChoice(type, id);
    b.plan.mockImplementation((_a: string, itemKey: string) => ({ itemKey, sourceType: type, manualChoice, supported: true, effectiveKey: "e", inputFingerprint: "f" }));
    b.invoke.mockClear(); b.cache.mockClear();
    const before = b.run.mock.calls.length;
    await act(async () => { fireEvent.click(regen); });
    await waitFor(() => expect(b.run.mock.calls.length).toBe(before + 1));
    expect(b.run.mock.calls.at(-1)![0]).toMatchObject({ rawInput: RAW, overrideType: type, manualChoice });
    const result = await b.run.mock.results.at(-1)!.value;
    expect(result.citation).toBe(RAW); expect(result.status).toBe("warning");
    expect(b.invoke).not.toHaveBeenCalled(); expect(b.cache).not.toHaveBeenCalled();
  });
});
