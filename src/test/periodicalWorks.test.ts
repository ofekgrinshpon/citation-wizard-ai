import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectForeignSource, renderForeignCitation, renderNewspaper, renderNonconsecutiveArticle } from "@/data/bluebook";
import { citationToHtml, citationToPlain } from "@/lib/citationRichText";
import { renderPeriodicalLocal } from "@/lib/periodicalLocal";
import { runCitation } from "@/lib/runCitation";
import { applyOverride, computeEffective, createRecord, detectClassification, engineRouteFor } from "@/lib/foreignClassification";

const b = vi.hoisted(() => ({ invoke: vi.fn(), classifier: vi.fn(), verified: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: b.invoke }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: b.verified }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: b.classifier } } }));

beforeEach(() => {
  vi.clearAllMocks();
  b.verified.mockResolvedValue(null);
  b.classifier.mockResolvedValue({ data: { sourceType: "foreign", confidence: 1 }, error: null });
  b.invoke.mockResolvedValue({ data: { content: "GENERIC MODEL OUTPUT" }, errorInfo: null });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No live network"); }));
});

// Synthetic names only.
const plain = (s?: string) => citationToPlain(s ?? "");
const art = (s: string) => renderPeriodicalLocal("foreign_journal_article", s);
const news = (s: string) => renderPeriodicalLocal("foreign_newspaper", s);

describe("R16.5 nonconsecutive journals/magazines", () => {
  it("signed issue-date article: italic title, small-caps periodical, cover date, at first, pins", () => {
    const r = art("Author: Alpha Gamma, Title: Quiet Fields, Synthetic Mag., Mar. 2020, at 12, 14–16")!;
    expect(r.citation).toBe("Alpha Gamma, ##Quiet Fields##, ^^Synthetic Mag.^^, Mar. 2020, at 12, 14–16.");
    expect(r.missing).toEqual([]);
  });
  it("unsigned article starts with title; no author is not missing", () => {
    const r = art("Quiet Fields, Synthetic Mag., Mar. 2020, at 12")!;
    expect(r.citation).toBe("##Quiet Fields##, ^^Synthetic Mag.^^, Mar. 2020, at 12.");
    expect(r.missing).toEqual([]);
  });
  it.each(["Winter 2019", "Sept.–Oct. 1979", "Fall–Winter 2019–20"])("keeps cover %s without inventing a day", (date) => {
    expect(plain(art(`Quiet Fields, Synthetic Mag., ${date}, at 12`)?.citation)).toBe(`Quiet Fields, Synthetic Mag., ${date}, at 12.`);
  });
  it("pinpoint list with range and note", () => {
    expect(plain(art("Quiet Fields, Synthetic Mag., Mar. 2020, at 12, 13, 15-17 n.2")?.citation)).toBe("Quiet Fields, Synthetic Mag., Mar. 2020, at 12, 13, 15–17 n.2.");
  });
  it("issue mode: volume goes before the periodical (R16.5 → R16.4)", () => {
    const r = art("Quiet Fields, Synthetic Mag., vol. 7, no. 3, 2020, at 12")!;
    expect(r.citation).toBe("##Quiet Fields##, 7 ^^Synthetic Mag.^^, no. 3, 2020, at 12.");
    expect(plain(r.citation)).not.toContain("vol.");
    expect(plain(art("Quiet Fields, Synthetic Mag., no. 3, Mar. 2020, at 12")?.citation)).toBe("Quiet Fields, Synthetic Mag., no. 3, Mar. 2020, at 12.");
    expect(r.warnings.join(" ")).toContain("מספר הגיליון");
  });
  it("unparseable no-date input is not routed here (existing consecutive path)", () => {
    expect(art("Quiet Fields, Synthetic Mag., at 12")).toBeNull();
    expect(art("Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)")).toBeNull();
    expect(plain(renderForeignCitation("Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)")?.citation)).toBe("Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960).");
  });
  it("missing title is reported without fabrication", () => {
    const r = renderNonconsecutiveArticle({ periodical: "Synthetic Mag.", date: "Mar. 2020", firstPage: "12", nonconsecutive: true });
    expect(r.missing).toEqual(["title"]);
  });
});

describe("R16.6(a),(b) print newspapers", () => {
  it("signed newspaper with place", () => {
    expect(news("Author: Ari Doe, Title: Local Vote Delayed, Daily Synthetic (Springfield), June 25, 1990, at A1")?.citation)
      .toBe("Ari Doe, ##Local Vote Delayed##, ^^Daily Synthetic^^ (Springfield), June 25, 1990, at A1.");
  });
  it("unsigned newspaper", () => {
    expect(plain(news("Local Vote Delayed, Daily Synthetic, June 25, 1990, at B12")?.citation)).toBe("Local Vote Delayed, Daily Synthetic, June 25, 1990, at B12.");
  });
  it("editorial designation is roman before the title", () => {
    expect(news("Editorial, Local Vote Delayed, Daily Synthetic, June 25, 1990, at 4F")?.citation)
      .toBe("Editorial, ##Local Vote Delayed##, ^^Daily Synthetic^^, June 25, 1990, at 4F.");
  });
  it("titleless letter: designation substitutes for title", () => {
    const r = news("Author: Ari Doe, Letter to the Editor, Daily Synthetic, June 25, 1990, at A22")!;
    expect(r.citation).toBe("Ari Doe, Letter to the Editor, ^^Daily Synthetic^^, June 25, 1990, at A22.");
    expect(r.missing).toEqual([]);
  });
  it("place (after paper) and section (after date) stay distinct", () => {
    const d = detectForeignSource("Local Vote Delayed, Daily Synthetic (Springfield), June 25, 1990 (§ 4), at 2");
    expect(d?.kind).toBe("newspaper");
    expect(d?.fields).toMatchObject({ place: "Springfield", section: "§ 4", date: "June 25, 1990" });
    expect(plain(renderForeignCitation("Local Vote Delayed, Daily Synthetic, June 25, 1990 (§ 4), at 2")?.citation)).toBe("Local Vote Delayed, Daily Synthetic, June 25, 1990 (§ 4), at 2.");
  });
  it("supplied newspaper pinpoint is not silently dropped", () => {
    const r = news("Local Vote Delayed, Daily Synthetic, June 25, 1990, at A1, A4")!;
    expect(plain(r.citation)).toBe("Local Vote Delayed, Daily Synthetic, June 25, 1990, at A1.");
    expect((r as { unrepresented?: string[] }).unrepresented).toContain("pinpoint: A4");
    expect(r.reply).toContain("A4");
  });
  it("no invented place/section/author/date", () => {
    const r = renderNewspaper({ title: "Local Vote Delayed", periodical: "Daily Synthetic", firstPage: "A1" });
    expect(r.missing).toEqual(["date"]);
    expect(r.citation).not.toMatch(/\(/);
  });
  it("newspaper with a season/month cover date is a preserved mismatch", () => {
    const r = news("Local Vote Delayed, Daily Synthetic, Winter 2019, at A1")!;
    expect(r.citation).toBe("Local Vote Delayed, Daily Synthetic, Winter 2019, at A1");
    expect(r.warningMsg).toContain("אינו תואם");
  });
  it("manual newspaper on unparseable input is preserved unsupported, not formatted", () => {
    expect(news("Daily Synthetic Wire, AP, June 25, 1990")?.warningMsg).toContain("אינו נתמך");
  });
});

describe("routing, ambiguity and safety", () => {
  it("day-date input without decisive structure is ambiguous → generic foreign, preserved", () => {
    const s = "Local Vote Delayed, Daily Synthetic, June 25, 1990, at A1";
    const d = detectForeignSource(s);
    expect(d?.sourceType).toBe("foreign");
    expect(renderForeignCitation(s)).toBeNull();
    const cls = detectClassification(s);
    expect(cls.scalars.family?.value).toBe("periodical");
    expect(cls.scalars.subtype?.value ?? null).toBeNull();
    expect(renderPeriodicalLocal("foreign", s)?.warningMsg).toContain("לא ניתן לקבוע");
  });
  it("manual article on newspaper structure is a preserved mismatch", () => {
    expect(art("Local Vote Delayed, Daily Synthetic (Springfield), June 25, 1990, at A1")?.warningMsg).toContain("אינו תואם");
  });
  it("exact mapped subtypes route; wire/database siblings stay unsupported", () => {
    const s = "Local Vote Delayed, Daily Synthetic, June 25, 1990, at A1";
    const det = detectClassification(s);
    const route = (sub: string) => engineRouteFor(computeEffective(det, applyOverride(createRecord("x", s), { scalars: { family: "periodical", subtype: sub } }).overrides));
    expect(route("periodical.newspaper")).toEqual({ sourceType: "foreign_newspaper", supported: true });
    expect(route("periodical.article")).toEqual({ sourceType: "foreign_journal_article", supported: true });
    expect(route("periodical.wire")).toEqual({ sourceType: "foreign", supported: false });
  });
  it("unsupported sibling (generic foreign) never formats a clear newspaper", () => {
    const r = renderPeriodicalLocal("foreign", "Local Vote Delayed, Daily Synthetic (Springfield), June 25, 1990, at A1")!;
    expect(r.citation).toBe("Local Vote Delayed, Daily Synthetic (Springfield), June 25, 1990, at A1");
  });
  it("unknown tails stay visible with a warning", () => {
    const r = news("Local Vote Delayed, Daily Synthetic, June 25, 1990, at A1 (late ed.)")!;
    expect(plain(r.citation)).toContain("(late ed.)");
    expect(r.warnings.join(" ")).toContain("late ed.");
  });
  it("HTML-like and literal ##/^^ markers are escaped", () => {
    const r = news("Local C## <script>x</script> ^^2, Daily Synthetic, June 25, 1990, at A1")!;
    expect(plain(r.citation)).toBe("Local C## <script>x</script> ^^2, Daily Synthetic, June 25, 1990, at A1.");
    const html = citationToHtml(r.citation);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("Hebrew input is left to the Israeli rules", () => {
    expect(detectForeignSource("כותרת, הארץ, June 25, 1990, at A1")?.kind).not.toBe("newspaper");
  });
  it.each([
    ["Author: Alpha Gamma, Title: Quiet Fields, Synthetic Mag., Sept.–Oct. 1979, at 89, 90", "foreign_journal_article", "Alpha Gamma, Quiet Fields, Synthetic Mag., Sept.–Oct. 1979, at 89, 90."],
    ["Author: Ari Doe, Title: Local Vote Delayed, Daily Synthetic (Springfield), June 25, 1990, at A1", "foreign_newspaper", "Ari Doe, Local Vote Delayed, Daily Synthetic (Springfield), June 25, 1990, at A1."],
    ["Quiet Fields, Synthetic Mag., Sept.–Oct. 1979, at 89", "foreign_journal_article", "Quiet Fields, Synthetic Mag., Sept.–Oct. 1979, at 89."],
  ])("real shared runCitation formats %s locally without classifier/provider", async (rawInput, type, expected) => {
    const result = await runCitation({ rawInput, useVerifiedStore: false });
    expect(result.sourceType).toBe(type);
    expect(plain(result.citation)).toBe(expected);
    expect(result.status).toBe("warning");
    expect(b.invoke).not.toHaveBeenCalled();
    expect(b.classifier).not.toHaveBeenCalled();
  });
  it("runCitation manual newspaper override on ambiguous input formats locally", async () => {
    const rawInput = "Local Vote Delayed, Daily Synthetic, June 25, 1990, at A1";
    const result = await runCitation({ rawInput, useVerifiedStore: false, overrideType: "foreign_newspaper" });
    expect(plain(result.citation)).toBe(`${rawInput}.`);
    expect(b.invoke).not.toHaveBeenCalled();
  });
});

describe("author-versus-title ambiguity (no invented author)", () => {
  const cases = [
    "Courts, Memory and Society, Synthetic Mag., Mar. 2020, at 12",
    "Courts, Codes and Reform, Example Monthly, Spring 2024, at 12",
    "Hidden Costs, Courts and Memory, Synthetic Mag., Mar. 2020, at 12",
    "New Horizons, Courts and Memory, Synthetic Mag., Mar. 2020, at 12",
    "Alpha Gamma, Quiet Fields, Synthetic Mag., Mar. 2020, at 12",
    "Ari Doe, Letter to the Editor, Daily Synthetic, June 25, 1990, at A22",
  ];
  it.each(cases)("preserves %s with a specific warning on every route", (s) => {
    for (const t of ["foreign_journal_article", "foreign_newspaper", "foreign"] as const) {
      const r = renderPeriodicalLocal(t, s)!;
      expect(r.citation).toBe(s);
      expect(r.warningMsg).toContain("שם מחבר");
    }
    const d = detectForeignSource(s);
    expect((d?.fields as { authors?: string })?.authors).toBeUndefined();
    expect(renderForeignCitation(s)).toBeNull();
  });
  it.each(cases)("real runCitation (auto and manual) preserves %s without provider", async (rawInput) => {
    for (const overrideType of [undefined, "foreign_journal_article", "foreign_newspaper"] as const) {
      const r = await runCitation({ rawInput, useVerifiedStore: false, overrideType });
      expect(r.citation).toBe(rawInput);
      expect(r.warningMsg).toContain("שם מחבר");
    }
    expect(b.invoke).not.toHaveBeenCalled();
    expect(b.classifier).not.toHaveBeenCalled();
  });
  it("explicit Author:/Title: labels establish the boundary (title may contain commas)", () => {
    expect(art("Author: Alpha B. Gamma & Ari Doe, Title: Hidden Costs, Courts and Memory, Synthetic Mag., Mar. 2020, at 12")?.citation)
      .toBe("Alpha B. Gamma & Ari Doe, ##Hidden Costs, Courts and Memory##, ^^Synthetic Mag.^^, Mar. 2020, at 12.");
    const t = art("Title: Hidden Costs, Courts and Memory, Synthetic Mag., Mar. 2020, at 12")!;
    expect(t.citation).toBe("##Hidden Costs, Courts and Memory##, ^^Synthetic Mag.^^, Mar. 2020, at 12.");
    expect((detectForeignSource("Title: Hidden Costs, Courts and Memory, Synthetic Mag., Mar. 2020, at 12")?.fields as { authors?: string }).authors).toBeUndefined();
  });
  it("editorial designation first never fabricates an author", () => {
    const d = detectForeignSource("Editorial, Local Vote, Again, Daily Synthetic (Springfield), June 25, 1990, at 4");
    expect(d?.fields).toMatchObject({ designation: "Editorial", title: "Local Vote, Again" });
    expect((d?.fields as { authors?: string }).authors).toBeUndefined();
  });
  it("volume-before-periodical stays correct", () => {
    expect(art("Title: Quiet Fields, Synthetic Mag., vol. 7, no. 3, 2020, at 12")?.citation).toBe("##Quiet Fields##, 7 ^^Synthetic Mag.^^, no. 3, 2020, at 12.");
  });
  it("ambiguous heading with markup stays escaped", () => {
    const r = art("Courts <b>x</b> ^^y, Memory, Synthetic Mag., Mar. 2020, at 12")!;
    expect(citationToHtml(r.citation)).toContain("&lt;b&gt;");
    expect(plain(r.citation)).toBe("Courts <b>x</b> ^^y, Memory, Synthetic Mag., Mar. 2020, at 12");
  });
});
