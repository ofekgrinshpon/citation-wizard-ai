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
import { ENTITIES, FOREIGN_JURISDICTIONS_ED21, FOREIGN_JURISDICTIONS_ED22_ONLY, US_STATES_AND_DC, byLocator, getEntity, resolveEntityId, subdivisionGroupsOf, subdivisionsOf } from "@/data/bluebook/classification/entities";
import {
  applyOverride, axisContract, chatClassificationKey, computeEffective, createRecord, detectClassification, engineRouteFor, isOutputStale, markGenerated, planGeneration, sanitizeOverrides,
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

const UK = "t2:united-kingdom", CA = "t2:canada";
const UK1 = `${UK}/england-and-wales`, UK2 = `${UK}/northern-ireland-and-ireland-until-1924`, UK3 = `${UK}/scotland`;
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
    const uk = subdivisionsOf(UK).map((e) => e.id);
    expect(uk).toEqual(expect.arrayContaining([UK1, UK2, UK3]));
    expect(new Set(["T3.3", "T3.4", "T3.5"].map((l) => byLocator("ed22", l)?.id)).size).toBe(3);
    expect(FOREIGN_JURISDICTIONS_ED21.find((e) => e.name === "Canada")).toBeTruthy();
  });
});

describe("detection (JUR3/4/6, axes)", () => {
  it("JUR4: 'Example Act 2020, c. 7' alone is not confidently UK", () => {
    const d = detectClassification("Example Act 2020, c. 7");
    expect(d.scalars.jurisdiction?.value ?? null).toBeNull();
    expect(d.scalars.jurisdiction?.candidates[0]).toMatchObject({ value: UK, confidence: "low" });
  });
  it("JUR3: Canadian source hosted on ac.uk is not detected as UK", () => {
    const d = detectClassification("Jane Roe, Charter Rights in Canada, 12 Can. J.L. 1 (2019), https://repository.example.ac.uk/canada.pdf");
    expect(d.scalars.jurisdiction?.value ?? null).toBeNull();
    expect(d.multi.access_medium?.value).toEqual(["web"]);
  });
  it("German web-access book: nonperiodical + web, language/host never jurisdiction", () => {
    const d = detectClassification("Hans Mueller, Grundrechte im Wandel (2019), https://verlag.example.de/buch");
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
    let r = createRecord("x", "Some Act 2020");
    r = applyOverride(r, { flags: { manifestation_flags: { authenticated: true, official: true, exact_copy: true } } });
    expect(computeEffective(r.detected, r.overrides).flags.manifestation_flags).toEqual({ authenticated: true, official: true, exact_copy: true });
  });
  it("JUR6: family override never overwrites jurisdiction; generic family has no US default", () => {
    let r = createRecord("x", "Some Foreign Text");
    r = applyOverride(r, { scalars: { family: "decision" } });
    expect(computeEffective(r.detected, r.overrides).scalars.jurisdiction).toBeUndefined();
    r = applyOverride(r, { scalars: { jurisdiction: CA } });
    r = applyOverride(r, { scalars: { family: "normative_instrument" } });
    expect(computeEffective(r.detected, r.overrides).scalars.jurisdiction).toBe(CA);
  });
  it("JUR5: unsupported combination keeps data and never reports validity", () => {
    let r = createRecord("x", "Loi n° 2020-1 du 1 janvier 2020");
    r = applyOverride(r, { scalars: { family: "normative_instrument", subtype: "normative_instrument.statute", jurisdiction: "t2:france-republic-of" } });
    const s = supportFor(computeEffective(r.detected, r.overrides));
    expect(s.status).toBe("unsupported");
    expect(s.validity).toBe("not_assessed");
  });
});

describe("override lifecycle + persistence", () => {
  it("JUR1: Canada override survives same-input redetection/restore; changed input needs review, keep/reset", () => {
    const input = "Smith v Jones, 2019 SCC 5";
    let r = createRecord("bib:1", input);
    r = applyOverride(r, { scalars: { family: "decision", jurisdiction: CA } });
    saveRecord("acct-A", r);
    const restored = reconcileRecord(loadRecord("acct-A", "bib:1"), "bib:1", input);
    expect(computeEffective(restored.detected, restored.overrides).scalars.jurisdiction).toBe(CA);
    expect(restored.needsReview).toBe(false);
    const changed = reconcileRecord(restored, "bib:1", input + " (Ont.)");
    expect(changed.needsReview).toBe(true);
    expect(computeEffective(changed.detected, changed.overrides).scalars.jurisdiction).toBe(CA);
    expect(keepAfterInputChange(changed).needsReview).toBe(false);
    expect(computeEffective(resetOverrides(changed).detected, {}).scalars.jurisdiction).toBe(CA);
  });
  it("stale: only explicit generation with the exact effective key + input certifies; async old plan cannot clear newer choice", () => {
    let r = createRecord("k", "Example Act 2020, c. 7");
    expect(isOutputStale(r)).toBe(false);
    r = applyOverride(r, { scalars: { family: "normative_instrument", subtype: "normative_instrument.statute", jurisdiction: UK } });
    expect(isOutputStale(r)).toBe(true);
    const planA = planGeneration(r, "Example Act 2020, c. 7")!;
    expect(planA.sourceType).toBe("foreign_statute_uk");
    r = applyOverride(r, { scalars: { jurisdiction: CA } }); // newer choice before A resolves
    r = markGenerated(r, planA);
    expect(isOutputStale(r)).toBe(true);
    r = markGenerated(r, planGeneration(r, "Example Act 2020, c. 7")!);
    expect(isOutputStale(r)).toBe(false);
    // Input edit (no generation) makes it stale again; re-detection/restore never certifies.
    r = reconcileRecord(r, "k", "Example Act 2021, c. 8");
    expect(isOutputStale(r)).toBe(true);
  });
  it("old/corrupt storage is safe; records isolated per account and per item", () => {
    localStorage.setItem(storageKeyFor("acct-A"), "{not json");
    expect(loadAll("acct-A")).toEqual({});
    localStorage.setItem(storageKeyFor("acct-A"), JSON.stringify({ version: 0, records: { a: {} } }));
    expect(loadAll("acct-A")).toEqual({});
    localStorage.setItem(storageKeyFor("acct-A"), JSON.stringify({ version: 1, records: { a: { version: 1, itemKey: "b" }, c: 5 } }));
    expect(loadAll("acct-A")).toEqual({});
    let r = createRecord("bib:9", "X");
    r = applyOverride(r, { scalars: { jurisdiction: CA, family: "bogus" as never } });
    saveRecord("acct-A", r);
    expect(loadRecord("acct-B", "bib:9")).toBeUndefined();
    expect(loadRecord("acct-A", "bib:10")).toBeUndefined();
    expect(loadRecord("acct-A", "bib:9")?.overrides.scalars?.family).toBeUndefined();
  });
});

describe("picker UI — deterministic, local, zero network", () => {
  it("JUR2: England and Wales / Scotland / Northern Ireland are distinct selectable subdivisions", () => {
    render(<ForeignSourcePicker accountId="acct-A" itemKey="t:1" input="Donoghue v Stevenson [1932] AC 562 (HL)" />);
    fireEvent.click(screen.getByRole("button", { name: "שינוי סיווג" }));
    const subSelect = screen.getByRole("combobox", { name: "יחידת משנה" });
    const values = within(subSelect).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(expect.arrayContaining([UK1, UK2, UK3]));
    fireEvent.change(subSelect, { target: { value: UK3 } });
    expect(screen.getByTestId("foreign-effective").textContent).toContain("Scotland");
    fireEvent.change(subSelect, { target: { value: UK2 } });
    expect(screen.getByTestId("foreign-effective").textContent).toContain("Northern Ireland");
    expect(screen.queryByText(/T2\.|21\.5|BB21/)).toBeNull();
    noNetwork();
  });
  it("books do not require a country; other/unidentified always offered; no rule ids", () => {
    render(<ForeignSourcePicker accountId="acct-A" itemKey="t:2" input="Hans Mueller, Grundrechte im Wandel (2019)" />);
    expect(screen.getByTestId("foreign-effective").textContent).toContain("ספר ופרסום שאינו כתב עת");
    fireEvent.click(screen.getByRole("button", { name: "שינוי סיווג" }));
    expect(screen.queryByRole("combobox", { name: /תחום שיפוט/ })).toBeNull();
    expect(screen.getByRole("button", { name: "אחר / לא זוהה" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אחר / לא זוהה" }));
    expect(screen.getByTestId("foreign-support").dataset.status).toBe("unidentified");
    noNetwork();
  });
  it("searchable: query filters families/subtypes", () => {
    render(<ForeignSourcePicker accountId="acct-A" itemKey="t:3" input="Foo" />);
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
    fireEvent.change(screen.getByRole("combobox", { name: /תחום שיפוט/ }), { target: { value: CA } });
    expect(screen.getByTestId("foreign-effective").textContent).toContain("Canada");
    // An identical detected-country choice is not a changed effective plan.
    expect(screen.queryByTestId("foreign-stale")).toBeNull();
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
    expect(screen.getByTestId("foreign-effective").textContent).toContain("Canada");
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
      await act(async () => { fireEvent.click((await screen.findAllByRole("button", { name: new RegExp(`🌐\\s*${label}`) })).at(-1)!); });
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
    fireEvent.change(within(picker).getByRole("combobox", { name: /תחום שיפוט/ }), { target: { value: CA } });
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

describe("Stage C correction — edition-21 registry", () => {
  const V21 = ["Argentine Republic","Australia","Austria, Republic of","Belgium, Kingdom of","Brazil, Federative Republic of","Canada","Catholic Church","Chile, Republic of","China, People's Republic of","Colombia, Republic of","Czech Republic","Egypt, Arab Republic of","France, Republic of","Germany, Federal Republic of","Greece","Hong Kong","Hungary, Republic of","India","Iran, Islamic Republic of","Iraq, Republic of","Ireland (Éire), Republic of","Israel","Italy, Republic of","Japan","Kenya","Lebanon, Republic of","Mexico","Netherlands, Kingdom of the","New Zealand","Nicaragua","Nigeria","Pakistan, Islamic Republic of","Philippines","Portugal, Republic of","Roman Law","Russian Federation","South Africa","South Korea","Spain","Sweden","Switzerland","Taiwan, Republic of China","United Kingdom","Zambia, Republic of"];
  it("exact 44 edition-21 T2 locators and names; stable ids are not locators", () => {
    expect(FOREIGN_JURISDICTIONS_ED21).toHaveLength(44);
    V21.forEach((name, i) => expect(byLocator("ed21", `T2.${i + 1}`)?.name).toBe(name));
    expect(byLocator("ed21", "T2.43")?.id).toBe(UK);
    expect(getEntity(UK)?.locators).toEqual({ ed21: "T2.43", ed22: "T2.46" });
    expect(ENTITIES.every((e) => !/^T\d/.test(e.id))).toBe(true);
  });
  it("UK three legal systems T2.43.1–3; four groups not selectable; no invented Canada ed21 provinces", () => {
    expect(subdivisionsOf(UK).map((e) => e.locators.ed21)).toEqual(["T2.43.1", "T2.43.2", "T2.43.3"]);
    for (const [c, loc] of [["t2:australia", "T2.2.1"], ["t2:austria-republic-of", "T2.3.1"], ["t2:germany-federal-republic-of", "T2.14.1"], ["t2:switzerland", "T2.41.1"]]) {
      expect(subdivisionGroupsOf(c).map((g) => g.locators.ed21)).toEqual([loc]);
      expect(subdivisionGroupsOf(c)[0].selectable).toBe(false);
    }
    expect(ENTITIES.filter((e) => e.parent === CA).every((e) => !e.locators.ed21)).toBe(true);
  });
  it("edition-22 extras kept separately; legacy ed22 ids resolve; 50 states + DC; no T1.5", () => {
    expect(FOREIGN_JURISDICTIONS_ED22_ONLY.map((e) => e.name)).toEqual(expect.arrayContaining(["Czechia", "Türkiye, Republic of"]));
    expect(FOREIGN_JURISDICTIONS_ED22_ONLY.every((e) => e.locators.ed22 && !e.locators.ed21)).toBe(true);
    expect(resolveEntityId("T2.46")).toBe(UK);
    expect(US_STATES_AND_DC).toHaveLength(51);
    expect(ENTITIES.some((e) => e.locators.ed22 === "T1.5" || e.legacy_ids.some((l) => l.startsWith("T1.5")))).toBe(false);
  });
});

describe("Stage C correction — 12 axes contract", () => {
  it("structured/single/multi/boolean values survive sanitizer + storage round trip; unspecified stays null", () => {
    let r = createRecord("bib:ax", "Treaty of Example");
    r = applyOverride(r, {
      scalars: { family: "treaty", publication_status: "published", proceeding_status: "decided", court: "intl:european-court-of-human-rights", institution_profile: "21.5.3" },
      multi: { citation_scheme: ["document_number", "other"], access_medium: ["print", "web"], container: ["journal"] },
      flags: { manifestation_flags: { official: true }, edition_flags: { reprint: true, pre_1900: false } },
      structured: {
        authorship: { author_list: ["A. One", "B. Two"], student_author: true, signed: false },
        treaty_parties: { party_list: ["Israel", "Canada"], bilateral_or_multilateral: "bilateral", us_is_party: false },
        language_script: { source_language: "de", original_title: "Vertrag" },
        issuer_jurisdiction: { issuer_id: "Ministry X" },
        reproduction_archive: { archive_url: "https://web.archive.org/x", capture_date: "2020-01-01" },
      },
    });
    saveRecord("acct-A", r);
    const back = reconcileRecord(loadRecord("acct-A", "bib:ax"), "bib:ax", "Treaty of Example");
    const k = axisContract(computeEffective(back.detected, back.overrides));
    expect(Object.keys(k)).toHaveLength(12);
    expect(k.authorship).toEqual({ author_list: ["A. One", "B. Two"], institutional_author: null, editor_list: null, translator_list: null, student_author: true, signed: false });
    expect(k.treaty_parties).toEqual({ party_list: ["Israel", "Canada"], bilateral_or_multilateral: "bilateral", us_is_party: false });
    expect(k.issuer_jurisdiction).toEqual({ jurisdiction_id: null, subjurisdiction_id: null, issuer_id: "Ministry X", court_id: "intl:european-court-of-human-rights", institution_profile_id: "21.5.3" });
    expect(k.edition_flags).toEqual({ multi_volume: null, reprint: true, supplement: null, pre_1900: false });
    expect(k.citation_scheme).toEqual(["document_number", "other"]);
    expect(k.publication_status).toBe("published");
    expect(k.language_script.transliteration).toBeNull();
  });
  it("sanitizer drops wrong types/unknown fields", () => {
    const o = sanitizeOverrides({ structured: { authorship: { author_list: "x", signed: "yes", bogus: 1 }, nope: {} }, multi: { container: ["journal", "spaceship"] } });
    expect(o.structured).toEqual({});
    expect(o.multi?.container).toEqual(["journal"]);
  });
  const openPicker = (input: string, family: string) => {
    render(<ForeignSourcePicker accountId="acct-A" itemKey={`t:${family}`} input={input} />);
    fireEvent.click(screen.getByRole("button", { name: "שינוי סיווג" }));
    fireEvent.click(screen.getByRole("button", { name: family }));
  };
  it("conditional controls: treaty shows parties; book shows authorship+edition, not proceeding; decision shows proceeding+scheme+court", () => {
    openPicker("X", "אמנה או הסכם בין־לאומי");
    expect(screen.getByRole("group", { name: "צדדים לאמנה" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "פרטי היוצר" })).toBeNull();
    cleanup();
    openPicker("Y", "ספר ופרסום שאינו כתב עת");
    expect(screen.getByRole("group", { name: "פרטי היוצר" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "מאפייני מהדורה וכרך" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "מצב ההליך" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "הצג את כל השדות" }));
    expect(screen.getByRole("combobox", { name: "מצב ההליך" })).toBeInTheDocument();
    cleanup();
    openPicker("Z", "החלטה בהליך שיפוטי או מעין־שיפוטי");
    expect(screen.getByRole("combobox", { name: "מצב ההליך" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "שיטת אזכור" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "ערכאה או מוסד בין־לאומי" }), { target: { value: "intl:european-court-of-human-rights" } });
    fireEvent.change(screen.getByRole("textbox", { name: "גוף מנפיק" }), { target: { value: "Grand Chamber" } });
    fireEvent.change(screen.getByRole("textbox", { name: "שפת המקור" }), { target: { value: "fr" } });
    const rec = loadRecord("acct-A", "t:החלטה בהליך שיפוטי או מעין־שיפוטי")!;
    expect(rec.overrides.scalars?.court).toBe("intl:european-court-of-human-rights");
    expect(rec.overrides.structured?.issuer_jurisdiction?.issuer_id).toBe("Grand Chamber");
    expect(rec.overrides.structured?.language_script?.source_language).toBe("fr");
    noNetwork();
  });
});

describe("Stage C correction — explicit generation uses the effective choice", () => {
  it("engine routes: supported US/UK/literature; unsupported never US and carries a warning", () => {
    const route = (scalars: Record<string, string>) => engineRouteFor(computeEffective(detectClassification(""), { scalars }));
    expect(route({ family: "decision", subtype: "decision.judgment", jurisdiction: "us" })).toEqual({ sourceType: "foreign_case_us", supported: true });
    expect(route({ family: "decision", subtype: "decision.judgment", jurisdiction: UK, subjurisdiction: UK3 })).toEqual({ sourceType: "foreign_case_other", supported: true });
    expect(route({ family: "decision", subtype: "decision.judgment", jurisdiction: CA })).toEqual({ sourceType: "foreign_case_other", supported: false });
    expect(route({ family: "normative_instrument", subtype: "normative_instrument.statute", jurisdiction: CA }).sourceType).toBe("foreign");
    let r = applyOverride(createRecord("x", "Smith v Jones"), { scalars: { family: "decision", subtype: "decision.judgment", jurisdiction: CA } });
    expect(planGeneration(r, "Smith v Jones")?.warning).toBeTruthy();
    r = resetOverrides(r);
    expect(planGeneration(r, "Smith v Jones")).toBeNull();
  });

  it("chat: stable key independent of input; picker regenerate passes plan to the existing handler", () => {
    expect(chatClassificationKey("p1", 3)).toBe("chat:p1:3");
    const onChange = vi.fn();
    render(<TooltipProvider><MessageBubble msg={{ role: "assistant", content: "Smith v Jones, 2019 SCC 5." }} detectedType="foreign_case_other"
      onChangeSourceType={onChange} foreignScope={{ accountId: "acct-A", itemKey: "chat:p1:1", input: "Smith v Jones, 2019 SCC 5" }} /></TooltipProvider>);
    const picker = screen.getByTestId("foreign-source-picker");
    fireEvent.click(within(picker).getByRole("button", { name: "שינוי סיווג" }));
    fireEvent.click(within(picker).getByRole("button", { name: "החלטה בהליך שיפוטי או מעין־שיפוטי" }));
    fireEvent.click(within(picker).getByRole("button", { name: "פסק דין או החלטה שיפוטית" }));
    fireEvent.change(within(picker).getByRole("combobox", { name: /תחום שיפוט/ }), { target: { value: "us" } });
    noNetwork();
    fireEvent.click(within(picker).getByRole("button", { name: "הפקה מחדש לפי הסיווג" }));
    expect(onChange).toHaveBeenCalledWith("foreign_case_us", expect.objectContaining({ itemKey: "chat:p1:1", supported: true }));
    cleanup();
    // Changed input on the same message → previous choice kept, needs review.
    render(<ForeignSourcePicker accountId="acct-A" itemKey="chat:p1:1" input="Smith v Jones, 2020 SCC 9" />);
    expect(screen.getByTestId("foreign-needs-review")).toBeInTheDocument();
    expect(screen.getByTestId("foreign-effective").textContent).toContain("United States");
  });

  it("bibliography: Other → commit → back to review keeps the choice; explicit retry uses it and records provenance", async () => {
    const ART = "Ronald H. Coase, ##The Problem of Social Cost##, 3 ^^J.L. & Econ.^^ 1 (1960).";
    h.runCitation.mockResolvedValue({ reply: ART, citation: ART, status: "valid", sourceType: "foreign_journal_article", sourceLabel: "x", fromVerifiedStore: false });
    const ui = render(<TooltipProvider><BibliographyProvider><BibliographyGenerator /></BibliographyProvider></TooltipProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /שלח לבדיקה/ })); });
    let picker = await screen.findByTestId("foreign-source-picker");
    fireEvent.click(within(picker).getByRole("button", { name: "שינוי סיווג" }));
    fireEvent.click(within(picker).getByRole("button", { name: "אחר / לא זוהה" }));
    expect(within(picker).getByTestId("foreign-stale")).toBeInTheDocument();
    const calls = h.runCitation.mock.calls.length;
    noNetwork();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /הוסף הכל לביבליוגרפיה/ })); });
    ui.unmount();
    // Reload, then send the entry back to review.
    render(<TooltipProvider><BibliographyProvider><BibliographyGenerator /></BibliographyProvider></TooltipProvider>);
    const back = screen.getAllByRole("button").find((b) => /החזר|לעריכה/.test(b.getAttribute("title") ?? b.textContent ?? ""));
    expect(back).toBeTruthy();
    await act(async () => { fireEvent.click(back!); });
    picker = await screen.findByTestId("foreign-source-picker");
    expect(within(picker).getByTestId("foreign-effective").textContent).toBe("אחר / לא זוהה");
    expect(h.runCitation.mock.calls.length).toBe(calls);
    await act(async () => { fireEvent.click(within(picker).getByRole("button", { name: "הפקה מחדש לפי הסיווג" })); });
    await waitFor(() => expect(h.runCitation.mock.calls.length).toBe(calls + 1));
    expect(h.runCitation.mock.calls.at(-1)?.[0].overrideType).toBe("foreign");
    await waitFor(() => expect(screen.queryByTestId("foreign-stale")).toBeNull());
    expect(screen.getByText(/עדיין לא נתמך בעיצוב האוטומטי: האזכור הופק/)).toBeInTheDocument();
  });

  it("account isolation: another account sees no choice for the same item key", () => {
    saveRecord("acct-A", applyOverride(createRecord("bib:iso", "X"), { scalars: { jurisdiction: CA } }));
    h.user = { id: "acct-B" };
    render(<ForeignSourcePicker accountId="acct-B" itemKey="bib:iso" input="X" />);
    expect(screen.getByTestId("foreign-effective").textContent).not.toContain("Canada");
  });
});
