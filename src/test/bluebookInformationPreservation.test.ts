/**
 * Stage A — information preservation and honest warning states.
 * Synthetic offline fixtures only; these assert that supplied data is not
 * silently discarded, NOT that the output is legally correct Bluebook form.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderBook, renderBookChapter, renderForeignCitation, renderJournalArticle, stripMarkers } from "@/data/bluebook";
import { renderForeignArticleLookup } from "@/lib/foreignArticleAdapter";
import { runCitation } from "@/lib/runCitation";

const boundaries = vi.hoisted(() => ({ invoke: vi.fn(), classify: vi.fn(), verified: vi.fn(), zero: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: boundaries.invoke }));
vi.mock("@/lib/sourceTypeClassifier", () => ({ resolveSourceType: boundaries.classify }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: boundaries.verified, classifyVerifiedSource: vi.fn(), getVerifiedCategoryLabel: vi.fn() }));
vi.mock("@/lib/refundResponse", () => ({ handleRefundResponse: vi.fn() }));
vi.mock("@/lib/costTelemetry", () => ({ telemetryBody: () => ({}), reportZeroWork: boundaries.zero }));
vi.mock("@/lib/citationDiagnostic", () => ({ citationDiagnosticBody: () => ({}), observeCitationDiagnostic: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network forbidden in Stage A regressions"); }));
});
afterEach(() => vi.unstubAllGlobals());

const plain = (input: string) => {
  const r = renderForeignCitation(input);
  return r ? { ...r, text: stripMarkers(r.citation) } : null;
};

describe("1. UK paragraph lists vs ranges", () => {
  it("keeps a paragraph list as separate paragraphs", () => {
    const r = plain("Sample v Example [2020] UKSC 12 [23, 25]")!;
    expect(r.text).toBe("Sample v Example [2020] UKSC 12 [23, 25].");
    expect(r.text).not.toContain("23–25");
  });
  it("keeps a range as a range", () => {
    const r = plain("Sample v Example [2020] UKSC 12 [23–25]")!;
    expect(r.text).toBe("Sample v Example [2020] UKSC 12 [23–25].");
  });
  it("single paragraph control", () => {
    expect(plain("Sample v Example [2020] UKSC 12 [23]")!.text).toBe("Sample v Example [2020] UKSC 12 [23].");
  });
  it("mixed list/range control", () => {
    expect(plain("Sample v Example [2020] UKSC 12 [3, 5–7]")!.text).toBe("Sample v Example [2020] UKSC 12 [3, 5–7].");
  });
});

describe("2–3. US nonmajority attribution and procedural history", () => {
  it("retains a dissent parenthetical with an explicit warning", () => {
    const r = plain("Example v. Sample, 100 F.3d 200, 205 (2d Cir. 1996) (Taylor, J., dissenting)")!;
    expect(r.text).toContain("(Taylor, J., dissenting)");
    expect(r.unrepresented).toContain("(Taylor, J., dissenting)");
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it.each([
    ["Example v. Sample, 100 F.3d 200 (2d Cir. 1996), rev'd, 520 U.S. 100 (1997)", "rev'd, 520 U.S. 100 (1997)"],
    ["Example v. Sample, 100 F.3d 200 (2d Cir. 1996), overruled by Other v. Person, 600 U.S. 10 (2023)", "overruled by Other v. Person, 600 U.S. 10 (2023)"],
  ])("retains supplied history: %s", (input, history) => {
    const r = plain(input)!;
    expect(r.text).toContain(history);
    expect(r.warnings.join(" ")).toContain(history);
  });
});

describe("4. Parallel reporters", () => {
  it("keeps the second US reporter and its pinpoint", () => {
    const r = plain("Example v. Sample, 100 A.2d 200, 205, 50 N.Y.2d 1, 5 (1980)")!;
    expect(r.text).toContain("100 A.2d 200, 205");
    expect(r.text).toContain("50 N.Y.2d 1, 5");
    expect(r.text).toContain("(1980)");
    expect(r.missing).toEqual([]);
  });
  it("keeps an additional UK reporter with an in-year volume", () => {
    const r = plain("Sample v Example [2020] UKSC 12, [2021] 1 WLR 50")!;
    expect(r.text).toContain("[2021] 1 WLR 50");
  });
});

describe("5. Constitution ranges and status", () => {
  it("keeps the full section range", () => {
    const r = plain("U.S. CONST. art. III, §§ 1–2")!;
    expect(r.text).toBe("U.S. Const. art. III, §§ 1–2.");
  });
  it("keeps a supplied status with a warning", () => {
    const r = plain("U.S. CONST. amend. XVIII (repealed 1933)")!;
    expect(r.text).toContain("(repealed 1933)");
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("6. Secondary-source metadata", () => {
  it("book: unsupported publication metadata is reported, never dropped silently", () => {
    const r = renderBook({ authors: "Maya Levin", bookTitle: "Collected Essays", year: "2000", publisher: "Other Press", originalYear: "1901" } as never);
    expect(stripMarkers(r.citation)).toContain("Maya Levin, Collected Essays");
    expect(r.unrepresented?.join(" ")).toContain("Other Press");
    expect(r.unrepresented?.join(" ")).toContain("1901");
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it("book: supported editors/edition/translators survive", () => {
    const t = stripMarkers(renderBook({ authors: "A. Writer", bookTitle: "Some Book", editors: "B. Editor", translators: "C. Trans", edition: "3d", year: "2001" }).citation);
    expect(t).toBe("A. Writer, Some Book (B. Editor ed., C. Trans trans., 3d ed. 2001).");
  });
  it("chapter keeps editors and edition", () => {
    const r = renderBookChapter({ authors: "A. Writer", chapterTitle: "Part", bookTitle: "Whole", firstPage: "10", editors: "B. Editor", edition: "2d", year: "1999" });
    expect(stripMarkers(r.citation)).toBe("A. Writer, Part, in Whole 10 (B. Editor ed., 2d ed. 1999).");
    expect(r.warnings).toEqual([]);
  });
  it("article: unknown extra field is reported", () => {
    const r = renderJournalArticle({ authors: "A. Writer", articleTitle: "T", volume: "1", journal: "Yale L.J.", firstPage: "1", year: "2000", issue: "4" } as never);
    expect(r.unrepresented?.join(" ")).toContain("issue");
  });
  it("adapter path: extra article metadata reaches the user-facing warning", () => {
    const out = renderForeignArticleLookup(
      { parsedFields: { authors: "A. Writer", articleTitle: "Title", issue: "4" } },
      { identity: { matched: true }, articleResolution: "resolved", fields: { volume: "1", journal: "Yale L.J.", firstPage: "1", year: "2000" } },
    )!;
    expect(out.status).toBe("warning");
    expect(out.reply).toContain("issue");
  });
});

describe("7. Pinpoints as supplied", () => {
  it("explicit pinpoint equal to the first page stays represented", () => {
    expect(plain("Example v. Sample, 100 F.3d 200, 200 (2d Cir. 1996)")!.text).toBe("Example v. Sample, 100 F.3d 200, 200 (2d Cir. 1996).");
  });
  it("page list stays a list; range stays a range", () => {
    expect(plain("Example v. Sample, 100 F.3d 200, 205, 207 (2d Cir. 1996)")!.text).toContain("200, 205, 207 (");
    expect(plain("Example v. Sample, 100 F.3d 200, 205-207 (2d Cir. 1996)")!.text).toContain("200, 205–207 (");
  });
});

describe("8. Compatibility and negative controls", () => {
  it("ordinary cases and literature unchanged, with no new warnings", () => {
    for (const [input, expected] of [
      ["Brown v. Board of Education, 347 U.S. 483, 490 (1954)", "Brown v. Board of Education, 347 U.S. 483, 490 (1954)."],
      ["R (Miller) v Prime Minister [2019] UKSC 41", "R (Miller) v Prime Minister [2019] UKSC 41."],
      ["Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)", "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)."],
    ]) {
      const r = plain(input)!;
      expect(r.text).toBe(expected);
      expect(r.warnings).toEqual([]);
      expect(r.unrepresented ?? []).toEqual([]);
    }
  });
  it("unrelated trailing text is not read as a pinpoint", () => {
    const r = plain("Example v. Sample, 100 F.3d 200 (2d Cir. 1996) cited 5 times")!;
    expect(r.text).not.toMatch(/200, 5/);
    expect(r.unrepresented).toContain("cited 5 times");
  });
  it("incomplete input is not declared complete", () => {
    expect(renderForeignCitation("Smith v. Jones")).toBeNull();
    const r = plain("Example v. Sample, 100 F.3d 200")!;
    expect(r.missing).toContain("year");
  });
});

describe("caller propagation (runCitation, offline)", () => {
  it("history is kept and the warning reaches the reply", async () => {
    const rawInput = "Example v. Sample, 100 F.3d 200 (2d Cir. 1996), rev'd, 520 U.S. 100 (1997)";
    const res = await runCitation({ rawInput, overrideType: "foreign_case_us", useVerifiedStore: false });
    expect(res.status).toBe("warning");
    expect(stripMarkers(res.citation ?? "")).toContain("rev'd, 520 U.S. 100 (1997)");
    expect(res.reply).toContain("⚠️");
    expect(boundaries.invoke).not.toHaveBeenCalled();
  });
  it("UK paragraph list reaches the result unchanged", async () => {
    const res = await runCitation({ rawInput: "Sample v Example [2020] UKSC 12 [23, 25]", overrideType: "foreign_case_other", useVerifiedStore: false });
    expect(stripMarkers(res.citation ?? "")).toContain("[23, 25]");
    expect(boundaries.invoke).not.toHaveBeenCalled();
  });
});
