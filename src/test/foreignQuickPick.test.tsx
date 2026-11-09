/**
 * Friendly foreign-source menu: everyday kinds + country map to exact
 * classification overrides; the full Bluebook form stays behind
 * "הגדרות מתקדמות". All controls are local (no network).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: h.invoke }, from: vi.fn() } }));

import { applyOverride, computeEffective, createRecord, detectClassification, engineRouteFor } from "@/lib/foreignClassification";
import { friendlySummary, quickOverride } from "@/lib/foreignQuickPick";
import { ForeignSourcePicker } from "@/components/ForeignSourcePicker";
import { MessageBubble } from "@/components/MessageBubble";

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  fetchSpy = vi.fn(() => { throw new Error("network forbidden"); });
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const noNetwork = () => { expect(fetchSpy).not.toHaveBeenCalled(); expect(h.invoke).not.toHaveBeenCalled(); };

const routeOf = (o: ReturnType<typeof quickOverride>) => engineRouteFor(computeEffective(detectClassification(""), o));

describe("friendly choices map to the existing engine routes", () => {
  it("U.S. case law → U.S. case route", () => {
    expect(routeOf(quickOverride("case", "us"))).toEqual({ sourceType: "foreign_case_us", supported: true });
  });
  it("U.K. case law → foreign case route (supported)", () => {
    expect(routeOf(quickOverride("case", "uk"))).toEqual({ sourceType: "foreign_case_other", supported: true });
  });
  it("U.K. legislation → U.K. statute route", () => {
    expect(routeOf(quickOverride("statute", "uk"))).toEqual({ sourceType: "foreign_statute_uk", supported: true });
  });
  it("Canadian case law is never routed as U.S. and is not marked fully supported", () => {
    expect(routeOf(quickOverride("case", "ca"))).toEqual({ sourceType: "foreign_case_other", supported: false });
  });
  it("other country leaves the jurisdiction empty and stays generic", () => {
    const o = quickOverride("case", "other");
    expect(o.scalars?.jurisdiction).toBeNull();
    expect(routeOf(o)).toEqual({ sourceType: "foreign_case_other", supported: false });
  });
  it("book / journal article / chapter need no country", () => {
    expect(routeOf(quickOverride("book")).sourceType).toBe("foreign_book");
    expect(routeOf(quickOverride("article")).sourceType).toBe("foreign_journal_article");
    expect(routeOf(quickOverride("chapter")).sourceType).toBe("foreign_book_chapter");
    expect(quickOverride("book").scalars).not.toHaveProperty("jurisdiction");
  });
  it("summary reads in everyday words", () => {
    const r = applyOverride(createRecord("k", "X"), quickOverride("case", "uk"));
    expect(friendlySummary(computeEffective(r.detected, r.overrides))).toBe("פסיקה · בריטניה");
  });
});

describe("picker shows the simple menu first", () => {
  it("case law asks for a country before saving; choosing U.K. saves it", () => {
    render(<ForeignSourcePicker accountId="acct-A" itemKey="q:1" input="Foo" />);
    fireEvent.click(screen.getByRole("button", { name: "שינוי סיווג" }));
    expect(screen.getByTestId("foreign-quick-menu")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText("אמצעי גישה")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "פסיקה" }));
    expect(screen.getByTestId("foreign-effective").textContent).toBe("אחר / לא זוהה");
    fireEvent.click(within(screen.getByRole("group", { name: "מדינה" })).getByRole("button", { name: "בריטניה" }));
    expect(screen.getByTestId("foreign-effective").textContent).toBe("פסיקה · בריטניה");
    noNetwork();
  });
  it("book saves at once with no country question", () => {
    render(<ForeignSourcePicker accountId="acct-A" itemKey="q:2" input="Foo" />);
    fireEvent.click(screen.getByRole("button", { name: "שינוי סיווג" }));
    fireEvent.click(screen.getByRole("button", { name: "ספר" }));
    expect(screen.getByTestId("foreign-effective").textContent).toBe("ספר");
    expect(screen.queryByRole("group", { name: "מדינה" })).toBeNull();
    noNetwork();
  });
  it("advanced settings open the full form and can go back", () => {
    render(<ForeignSourcePicker accountId="acct-A" itemKey="q:3" input="Foo" />);
    fireEvent.click(screen.getByRole("button", { name: "שינוי סיווג" }));
    fireEvent.click(screen.getByRole("button", { name: "הגדרות מתקדמות" }));
    expect(screen.getByText("אמצעי גישה")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /חזרה לתפריט הפשוט/ }));
    expect(screen.getByTestId("foreign-quick-menu")).toBeInTheDocument();
  });
});

describe("chat shows one source box for foreign results", () => {
  it("no second Israeli box; the Israeli list opens from the foreign menu", () => {
    const onChange = vi.fn();
    render(<TooltipProvider><MessageBubble msg={{ role: "assistant", content: "Smith v Jones, 2019 SCC 5." }} detectedType="foreign_case_other"
      onChangeSourceType={onChange} foreignScope={{ accountId: "acct-A", itemKey: "chat:p1:9", input: "Smith v Jones, 2019 SCC 5" }} /></TooltipProvider>);
    expect(screen.queryByText(/המערכת זיהתה כי מדובר/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "שינוי סיווג" }));
    fireEvent.click(screen.getByRole("button", { name: "זה בכלל מקור ישראלי" }));
    expect(screen.getByText("בחר סוג מקור")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^📕\s*ספר/ }));
    expect(onChange).toHaveBeenCalledWith("book");
    noNetwork();
  });
  it("Israeli results keep the existing box", () => {
    render(<TooltipProvider><MessageBubble msg={{ role: "assistant", content: "x" }} detectedType="book" onChangeSourceType={vi.fn()} /></TooltipProvider>);
    expect(screen.getByText(/המערכת זיהתה כי מדובר/)).toBeInTheDocument();
  });
});
