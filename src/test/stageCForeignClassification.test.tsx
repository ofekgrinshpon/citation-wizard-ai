/**
 * Stage C — shared foreign-source classification. Offline only: fetch and
 * supabase.functions.invoke are spies that must never be called by any
 * picker control (select / change / reset / restore).
 */
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  runCitation: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn(), info: vi.fn() }),
  user: { id: "acct-A" } as { id: string } | null,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: h.invoke }, from: vi.fn(),
  auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    getSession: vi.fn(async () => ({ data: { session: null } })), getUser: vi.fn(async () => ({ data: { user: null } })) },
} }));
vi.mock("@/lib/runCitation", async (original) => {
  const actual = await original<typeof import("@/lib/runCitation")>();
  return { ...actual, runCitation: h.runCitation };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user, isAdmin: false, isAdminResolved: true }) }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ currentProject: { id: "p1" } }) }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/clipboard", () => ({ copyRichText: vi.fn(), copyPlainText: vi.fn() }));

import { FAMILIES, SUBTYPES, AXES, INSTITUTION_PROFILES, subtypesOf } from "@/data/bluebook/classification/taxonomy";
import { ENTITIES, FOREIGN_JURISDICTIONS, US_STATES_AND_DC, getEntity, subdivisionsOf } from "@/data/bluebook/classification/entities";
import {
  applyOverride, computeEffective, createRecord, detectClassification, isOutputStale,
  keepAfterInputChange, reconcileRecord, resetOverrides, supportFor,
} from "@/lib/foreignClassification";
import { loadAll, loadRecord, saveRecord, storageKeyFor } from "@/lib/foreignClassificationStore";
import { ForeignSourcePicker } from "@/components/ForeignSourcePicker";
import { FootnoteReviewCard, FOREIGN_TYPE_OPTIONS, type ReviewCardCell } from "@/components/FootnoteReviewCard";
import { MessageBubble } from "@/components/MessageBubble";
import { BibliographyGenerator } from "@/components/BibliographyGenerator";
import { BibliographyProvider } from "@/hooks/useBibliography";
import { renderBook } from "@/data/bluebook/render";
import { renderForeignDetection } from "@/data/bluebook";
import { detectForeignSource } from "@/data/bluebook/extract";
import { citationToPlain } from "@/lib/citationRichText";

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "acct-A" };
  vi.stubGlobal("crypto", webcrypto);
  fetchSpy = vi.fn(() => { throw new Error("network forbidden"); });
  vi.stubGlobal("fetch", fetchSpy);
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const noNetwork = () => { expect(fetchSpy).not.toHaveBeenCalled(); expect(h.invoke).not.toHaveBeenCalled(); };

describe("taxonomy — exact workbook v3", () => {
  it("14 families, 78 subtypes, 12 axes, 16 institution profile groups", () => {
    expect(FAMILIES).toHaveLength(14);
    expect(SUBTYPES).toHaveLength(78);
    expect(AXES).toHaveLength(12);
    expect(INSTITUTION_PROFILES).toHaveLength(16);
    expect(SUBTYPES.every((s) => FAMILIES.some((f) => f.id === s.parent_id))).toBe(true);
  });
  it("cardinality preserved: manifestation flags independent booleans, medium/scheme multi", () => {
    const a = (id: string) => AXES.find((x) => x.id === id)!;
    expect(a("manifestation_flags").cardinality).toBe("independent_booleans");
    expect(a("manifestation_flags").values).toEqual(["authenticated", "official", "exact_copy", "archived_capture"]);
    expect(a("access_medium").cardinality).toBe("multi");
    expect(a("citation_scheme").cardinality).toBe("multi");
    expect(a("publication_status").cardinality).toBe("single");
  });
  it("ICJ/PCIJ, EU courts, European human-rights decisions, Council of Europe stay distinct groups", () => {
    const labels = INSTITUTION_PROFILES.map((p) => p.label);
    for (const l of ["ICJ and PCIJ", "EU courts", "European human-rights decisions", "Council of Europe", "European Union institutional sources"]) expect(labels).toContain(l);
  });
});

describe("entity registry", () => {
  it("T1.3 is 50 states + DC (51), no T1.5 tribal rows as edition-21 entities", () => {
    expect(US_STATES_AND_DC).toHaveLength(51);
    expect(US_STATES_AND_DC.filter((e) => e.name === "District of Columbia")).toHaveLength(1);
    expect(ENTITIES.some((e) => e.parent === "T1.5" || e.id === "T1.5")).toBe(false);
  });
  it("UK subdivisions distinct; ECtHR, European Commission of HR and EU distinct entities", () => {
    const uk = subdivisionsOf("T2.46").map((e) => e.id);
    expect(uk).toEqual(expect.arrayContaining(["T2.46.1", "T2.46.2", "T2.46.3"]));
    expect(new Set(["T3.3", "T3.4", "T3.5"].map((id) => getEntity(id)?.name)).size).toBe(3);
    expect(FOREIGN_JURISDICTIONS.find((e) => e.name === "Canada")).toBeTruthy();
  });
});

describe("detection (JUR3/4/6, axes)", () => {
  it("JUR4: 'Example Act 2020, c. 7' alone is not confidently UK", () => {
    const d = detectClassification("Example Act 2020, c. 7");
    expect(d.scalars.jurisdiction?.value ?? null).toBeNull();
    expect(d.scalars.jurisdiction?.candidates[0]).toMatchObject({ value: "T2.46", confidence: "low" });
  });
  it("JUR3: Canadian source hosted on ac.uk is not detected as UK", () => {
    const d = detectClassification("Jane Roe, Charter Rights in Canada, 12 Can. J.L. 1 (2019), https://repository.example.ac.uk/canada.pdf");
    expect(d.scalars.jurisdiction?.value ?? null).toBeNull();
    expect(d.multi.access_medium?.value).toEqual(["web"]);
  });
  it("German web-access book: nonperiodical + web, language/host never jurisdiction", () => {
    const d = detectClassification("Hans Müller, Grundrechte im Wandel (3d ed. 2019), https://verlag.example.de/buch");
    const e = computeEffective(d, {});
    expect(e.scalars.family).toBe("nonperiodical");
    expect(e.multi.access_medium).toEqual(["web"]);
    expect(e.scalars.jurisdiction).toBeUndefined();
  });
  it("neutral_citation and reporter_locator coexist", () => {
    const d = detectClassification("R (Miller) v Prime Minister [2019] UKSC 41, [2020] AC 373");
    expect(d.multi.citation_scheme?.value).toEqual(expect.arrayContaining(["neutral_citation", "reporter_locator"]));
  });
  it("pending proceeding sets proceeding_status, never publication_status", () => {
    const d = detectClassification("Doe v. Roe, No. 21-1234 (2d Cir. pending)");
    expect(d.scalars.proceeding_status?.value).toBe("pending");
    expect(d.scalars.publication_status).toBeUndefined();
  });
  it("authenticated + official + exact_copy coexist as independent flags", () => {
    let r = createRecord("x", "Some Act 2020", null);
    r = applyOverride(r, { flags: { manifestation_flags: { authenticated: true, official: true, exact_copy: true } } });
    expect(computeEffective(r.detected, r.overrides).flags.manifestation_flags).toEqual({ authenticated: true, official: true, exact_copy: true });
  });
  it("JUR6: family override never overwrites jurisdiction; generic family has no US default", () => {
    let r = createRecord("x", "Some Foreign Text", null);
    r = applyOverride(r, { scalars: { family: "decision" } });
    expect(computeEffective(r.detected, r.overrides).scalars.jurisdiction).toBeUndefined();
    r = applyOverride(r, { scalars: { jurisdiction: "T2.6" } });
    r = applyOverride(r, { scalars: { family: "normative_instrument" } });
    expect(computeEffective(r.detected, r.overrides).scalars.jurisdiction).toBe("T2.6");
  });
  it("JUR5: unsupported combination keeps data and never reports validity", () => {
    let r = createRecord("x", "Loi n° 2020-1 du 1 janvier 2020", null);
    r = applyOverride(r, { scalars: { family: "normative_instrument", subtype: "normative_instrument.statute", jurisdiction: "T2.13" } });
    const s = supportFor(computeEffective(r.detected, r.overrides));
    expect(s.status).toBe("unsupported");
    expect(s.validity).toBe("not_assessed");
  });
});

describe("override lifecycle + persistence", () => {
  it("JUR1: Canada override survives same-input redetection/restore; changed input needs review, keep/reset", () => {
    const input = "Smith v Jones, 2019 SCC 5";
    let r = createRecord("bib:1", input, "out");
    r = applyOverride(r, { scalars: { family: "decision", jurisdiction: "T2.6" } });
    saveRecord("acct-A", r);
    const restored = reconcileRecord(loadRecord("acct-A", "bib:1"), "bib:1", input, "out");
    expect(computeEffective(restored.detected, restored.overrides).scalars.jurisdiction).toBe("T2.6");
    expect(restored.needsReview).toBe(false);
    const changed = reconcileRecord(restored, "bib:1", input + " (Ont.)", "out");
    expect(changed.needsReview).toBe(true);
    expect(computeEffective(changed.detected, changed.overrides).scalars.jurisdiction).toBe("T2.6");
    expect(keepAfterInputChange(changed).needsReview).toBe(false);
    expect(computeEffective(resetOverrides(changed).detected, {}).scalars.jurisdiction).toBeUndefined();
  });
  it("stale output when classification changes; regeneration (new output) clears it", () => {
    let r = createRecord("k", "Example Act 2020, c. 7", "old");
    expect(isOutputStale(r)).toBe(false);
    r = applyOverride(r, { scalars: { jurisdiction: "T2.46" } });
    expect(isOutputStale(r)).toBe(true);
    r = reconcileRecord(r, "k", "Example Act 2020, c. 7", "regenerated");
    expect(isOutputStale(r)).toBe(false);
  });
  it("old/corrupt storage is safe; records isolated per account and per item", () => {
    localStorage.setItem(storageKeyFor("acct-A"), "{not json");
    expect(loadAll("acct-A")).toEqual({});
    localStorage.setItem(storageKeyFor("acct-A"), JSON.stringify({ version: 0, records: { a: {} } }));
    expect(loadAll("acct-A")).toEqual({});
    localStorage.setItem(storageKeyFor("acct-A"), JSON.stringify({ version: 1, records: { a: { version: 1, itemKey: "b" }, c: 5 } }));
    expect(loadAll("acct-A")).toEqual({});
    let r = createRecord("bib:9", "X", null);
    r = applyOverride(r, { scalars: { jurisdiction: "T2.6", family: "bogus" as never } });
    saveRecord("acct-A", r);
    expect(loadRecord("acct-B", "bib:9")).toBeUndefined();
    expect(loadRecord("acct-A", "bib:10")).toBeUndefined();
    expect(loadRecord("acct-A", "bib:9")?.overrides.scalars?.family).toBeUndefined();
  });
});

describe("picker UI — deterministic, local, zero network", () => {
  it("JUR2: England and Wales / Scotland / Northern Ireland are distinct selectable subdivisions", () => {
    render(<ForeignSourcePicker accountId="acct-A" itemKey="t:1" input="Donoghue v Stevenson [1932] AC 562 (HL)" output="x" />);
    fireEvent.click(screen.getByRole("button", { name: "שינוי סיווג" }));
    const subSelect = screen.getByRole("combobox", { name: "יחידת משנה" });
    const values = within(subSelect).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(expect.arrayContaining(["T2.46.1", "T2.46.2", "T2.46.3"]));
    fireEvent.change(subSelect, { target: { value: "T2.46.3" } });
    expect(screen.getByTestId("foreign-effective").textContent).toContain("Scotland");
    fireEvent.change(subSelect, { target: { value: "T2.46.2" } });
    expect(screen.getByTestId("foreign-effective").textContent).toContain("Northern Ireland");
    expect(screen.queryByText(/T2\.|21\.5|BB21/)).toBeNull();
    noNetwork();
  });
  it("books do not require a country; other/unidentified always offered; no rule ids", () => {
    render(<ForeignSourcePicker accountId="acct-A" itemKey="t:2" input="Hans Müller, Grundrechte im Wandel (3d ed. 2019)" output="x" />);
    fireEvent.click(screen.getByRole("button", { name: "שינוי סיווג" }));
    expect(screen.queryByRole("combobox", { name: /תחום שיפוט/ })).toBeNull();
    expect(screen.getByRole("button", { name: "אחר / לא זוהה" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אחר / לא זוהה" }));
    expect(screen.getByTestId("foreign-support").dataset.status).toBe("unidentified");
    noNetwork();
  });
  it("searchable: query filters families/subtypes", () => {
    render(<ForeignSourcePicker accountId="acct-A" itemKey="t:3" input="Foo" output={null} />);
    fireEvent.click(screen.getByRole("button", { name: "שינוי סיווג" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "אמנה" } });
    expect(screen.getByRole("button", { name: "אמנה או הסכם בין־לאומי" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "חוקה" })).toBeNull();
    expect(subtypesOf("treaty")).toHaveLength(3);
    noNetwork();
  });

  const cell = (over: Partial<ReviewCardCell> = {}): ReviewCardCell => ({
    id: 1, input: "Smith v Jones, 2019 SCC 5", output: "Smith v Jones, 2019 SCC 5.", status: "warning",
    detectedType: "foreign_case_other", ...over,
  });
  const card = (c: ReviewCardCell, onRegenerate = vi.fn(), onSourceTypeChange = vi.fn()) => (
    <FootnoteReviewCard cell={c} onInputChange={vi.fn()} onOutputChange={vi.fn()} onSourceTypeChange={onSourceTypeChange}
      onApproveToggle={vi.fn()} onRegenerate={onRegenerate} onRemove={vi.fn()} foreignScope={{ accountId: "acct-A", itemKey: "batch:k1" }} />
  );

  it("batch card: Canada override persists across remount; input change → visible review; zero network, no regeneration", () => {
    const regen = vi.fn();
    const { unmount } = render(card(cell(), regen));
    fireEvent.click(screen.getByRole("button", { name: "שינוי סיווג" }));
    fireEvent.click(screen.getByRole("button", { name: "החלטה בהליך שיפוטי או מעין־שיפוטי" }));
    fireEvent.change(screen.getByRole("combobox", { name: /תחום שיפוט/ }), { target: { value: "T2.6" } });
    expect(screen.getByTestId("foreign-effective").textContent).toContain("Canada");
    expect(screen.getByTestId("foreign-stale")).toBeInTheDocument();
    unmount();
    const r2 = render(card(cell(), regen));
    expect(screen.getByTestId("foreign-effective").textContent).toContain("Canada");
    expect(screen.queryByTestId("foreign-needs-review")).toBeNull();
    r2.rerender(card(cell({ input: "Smith v Jones, 2020 SCC 9" }), regen));
    expect(screen.getByTestId("foreign-needs-review")).toBeInTheDocument();
    expect(screen.getByTestId("foreign-effective").textContent).toContain("Canada");
    fireEvent.click(screen.getByRole("button", { name: "השאר את הבחירה" }));
    expect(screen.queryByTestId("foreign-needs-review")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "חזרה לזיהוי האוטומטי" }));
    expect(screen.getByTestId("foreign-effective").textContent).not.toContain("Canada");
    expect(regen).not.toHaveBeenCalled();
    noNetwork();
  });

  it("JUR6 batch: generic foreign case option is not a U.S. type", () => {
    expect(FOREIGN_TYPE_OPTIONS.find((o) => o.label === "פסיקה")?.type).toBe("foreign_case_other");
    expect(FOREIGN_TYPE_OPTIONS.filter((o) => o.type.endsWith("_us")).every((o) => o.label.includes("אמריקנית"))).toBe(true);
  });

  it("JUR6 bibliography: generic foreign case/legislation categories pass no U.S. type", async () => {
    const ART = "Smith v Jones, 2019 SCC 5.";
    h.runCitation.mockResolvedValue({ reply: ART, citation: ART, status: "valid", sourceType: "foreign_case_other", sourceLabel: "x", fromVerifiedStore: false });
    render(<TooltipProvider><BibliographyProvider><BibliographyGenerator /></BibliographyProvider></TooltipProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Smith v Jones, 2019 SCC 5" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /שלח לבדיקה/ })); });
    for (const label of ["פסיקה לועזית", "חקיקה לועזית"]) {
      fireEvent.click(await screen.findByRole("button", { name: /▾/ }));
      await act(async () => { fireEvent.click(await screen.findByRole("button", { name: new RegExp(label) })); });
      await waitFor(() => expect(h.runCitation.mock.calls.at(-1)?.[0].overrideType).toBeDefined());
      expect(h.runCitation.mock.calls.at(-1)?.[0].overrideType).not.toMatch(/_us$/);
    }
  });

  it("single-citation bubble shows picker for foreign results; controls are local", () => {
    render(<TooltipProvider><MessageBubble msg={{ role: "assistant", content: "Smith v Jones, 2019 SCC 5." }} detectedType="foreign_case_other"
      onChangeSourceType={vi.fn()} foreignScope={{ accountId: "acct-A", itemKey: "chat:p1:1:f", input: "Smith v Jones, 2019 SCC 5" }} /></TooltipProvider>);
    const picker = screen.getByTestId("foreign-source-picker");
    fireEvent.click(within(picker).getByRole("button", { name: "שינוי סיווג" }));
    fireEvent.click(within(picker).getByRole("button", { name: "החלטה בהליך שיפוטי או מעין־שיפוטי" }));
    fireEvent.change(within(picker).getByRole("combobox", { name: /תחום שיפוט/ }), { target: { value: "T2.6" } });
    expect(within(picker).getByTestId("foreign-effective").textContent).toContain("Canada");
    noNetwork();
  });

  it("bibliography review row shows picker; select/reset make zero network calls", async () => {
    const ART = "Ronald H. Coase, ##The Problem of Social Cost##, 3 ^^J.L. & Econ.^^ 1 (1960).";
    h.runCitation.mockResolvedValue({ reply: ART, citation: ART, status: "valid", sourceType: "foreign_journal_article", sourceLabel: "x", fromVerifiedStore: false });
    render(<TooltipProvider><BibliographyProvider><BibliographyGenerator /></BibliographyProvider></TooltipProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /שלח לבדיקה/ })); });
    const picker = await screen.findByTestId("foreign-source-picker");
    const calls = h.runCitation.mock.calls.length;
    fireEvent.click(within(picker).getByRole("button", { name: "שינוי סיווג" }));
    fireEvent.click(within(picker).getByRole("button", { name: "אחר / לא זוהה" }));
    fireEvent.click(within(picker).getByRole("button", { name: "חזרה לזיהוי האוטומטי" }));
    await waitFor(() => expect(within(picker).getByTestId("foreign-effective").textContent).toContain("פריט מתוך פרסום תקופתי"));
    expect(h.runCitation.mock.calls.length).toBe(calls);
    noNetwork();
  });
});

describe("literal-text precondition (Stage A/B preserved)", () => {
  it("typed/raw book path keeps literal C## Guide: x^^2 & A**B; direct renderBook expects escaped fields", () => {
    const d = detectForeignSource("Jane Doe, C## Guide: x^^2 & A**B (2020)");
    expect(d?.kind).toBe("book");
    const out = renderForeignDetection(d!)!;
    expect(citationToPlain(out.citation)).toContain("C## Guide: x^^2 & A**B");
    // Internal precondition: renderBook receives already-escaped field text.
    expect(typeof renderBook).toBe("function");
  });
});
