import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectForeignSource, renderBookChapter } from "@/data/bluebook";
import { citationToHtml, citationToPlain } from "@/lib/citationRichText";
import { renderBookLocal } from "@/lib/bookLocal";
import { renderPeriodicalLocal } from "@/lib/periodicalLocal";
import { runCitation } from "@/lib/runCitation";

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
const book = (s: string) => renderBookLocal("foreign_book", s);
const chap = (s: string) => renderBookLocal("foreign_book_chapter", s);

describe("R15.1–15.4(a) books", () => {
  it("editor-only book begins with small-caps title; absent author is not missing", () => {
    const r = book("The Synthetic Handbook (Ana Roe ed., 2010)")!;
    expect(r.citation).toBe("^^The Synthetic Handbook^^ (Ana Roe ed., 2010).");
    expect(r.missing).toEqual([]);
    expect(plain(book("The Synthetic Handbook (Ana Roe & Ben Poe eds., 2010)")?.citation)).toBe("The Synthetic Handbook (Ana Roe & Ben Poe eds., 2010).");
  });
  it("editor, translator, edition and year in order", () => {
    expect(plain(book("Ana Roe, Quiet Rules (Ben Poe ed., Cy Lu trans., 2d ed. 2001)")?.citation)).toBe("Ana Roe, Quiet Rules (Ben Poe ed., Cy Lu trans., 2d ed. 2001).");
  });
  it("labelled non-original publisher and original year render; author never inferred", () => {
    const r = book("Author: Ana Roe; Title: Quiet Rules; Editor: Ben Poe; Publisher: Synthetic Press; Publisher status: non-original; Year: 1999; Original year: 1901; Pinpoint: 49–55")!;
    expect(r.citation).toBe("^^Ana Roe, Quiet Rules^^ 49–55 (Ben Poe ed., Synthetic Press 1999) (1901).");
  });
  it("original-publisher status omits the publisher with a warning", () => {
    const r = book("Author: Ana Roe; Title: Quiet Rules; Publisher: Synthetic Press; Publisher status: original; Year: 1999")!;
    expect(plain(r.citation)).toBe("Ana Roe, Quiet Rules (1999).");
    expect(r.reply).toContain("Synthetic Press");
  });
  it.each([
    "Ana Roe, Quiet Rules (Synthetic Press 1999)",
    "Author: Ana Roe; Title: Quiet Rules; Publisher: Synthetic Press; Year: 1999",
  ])("unknown publisher status is preserved with a warning: %s", (s) => {
    const r = book(s)!;
    expect(r.citation).toBe(s);
    expect(r.warningMsg).toContain("המו״ל המקורי");
  });
  it("pre-1900 edition grammar is declined safely", () => {
    expect(book("Ana Roe, Quiet Rules (Synthetic Press 1850)")?.warningMsg).toContain("1900");
    expect(book("Author: Ana Roe; Title: Quiet Rules; Publisher: Synthetic Press; Publisher status: non-original; Year: 1850")?.warningMsg).toContain("1900");
  });
  it("volume at the beginning", () => {
    expect(book("3 Ana Roe, Quiet Rules (2001)")?.citation).toBe("3 ^^Ana Roe, Quiet Rules^^ (2001).");
  });
  it("numeric-title ending needs explicit ', at'; bare number after it is ambiguous", () => {
    expect(book("Ana Roe, Catch 22 15 (Ben Poe ed., 2001)")?.warningMsg).toContain("\", at\"");
    expect(book("Ana Roe, Catch 22 15 (Ben Poe ed., 2001)")?.citation).toBe("Ana Roe, Catch 22 15 (Ben Poe ed., 2001)");
    expect(plain(book("Ana Roe, Catch 22, at 15 (Ben Poe ed., 2001)")?.citation)).toBe("Ana Roe, Catch 22, at 15 (Ben Poe ed., 2001).");
    expect(plain(book("Ana Roe, Quiet Rules 15 (Ben Poe ed., 2001)")?.citation)).toBe("Ana Roe, Quiet Rules 15 (Ben Poe ed., 2001).");
    expect(plain(book("Ana Roe, Quiet Rules, at 15 (2001)")?.citation)).toBe("Ana Roe, Quiet Rules 15 (2001).");
  });
  it("explicit section/paragraph and ', at' roman pinpoints", () => {
    expect(plain(book("Ana Roe, Quiet Rules § 4.2 (2001)")?.citation)).toBe("Ana Roe, Quiet Rules § 4.2 (2001).");
    expect(plain(book("Ana Roe, Quiet Rules ¶ 7 (2001)")?.citation)).toBe("Ana Roe, Quiet Rules ¶ 7 (2001).");
    expect(plain(book("Ana Roe, Quiet Rules, at xii (2001)")?.citation)).toBe("Ana Roe, Quiet Rules xii (2001).");
    expect(book("Ana Roe, Quiet Rules xii (2001)")?.warningMsg).toContain("\", at\"");
  });
  it("free-text heading is kept whole: no author identity asserted", () => {
    const d = detectForeignSource("Ana Roe, Quiet Rules, at 9 (Ben Poe ed., 2001)");
    expect(d?.kind).toBe("book");
    expect((d?.fields as { heading?: string }).heading).toBe("Ana Roe, Quiet Rules");
    expect((d?.fields as { authors?: string }).authors).toBeUndefined();
  });
});

describe("R15.5.1(a) chapters (Israeli 36.8 italic 'in')", () => {
  it("roman author, italic title, comma outside italics, italic in, small-caps collection", () => {
    const r = chap("Author: Ana Roe; Chapter: Quiet Rules; Collection: The Synthetic Collection; First page: 210; Pinpoint: 214; Editor: Ben Poe; Year: 2015")!;
    expect(r.citation).toBe("Ana Roe, ##Quiet Rules##, ##in## ^^The Synthetic Collection^^ 210, 214 (Ben Poe ed., 2015).");
    const html = citationToHtml(r.citation);
    expect(html).toContain("<em>in</em>");
    expect(html).not.toMatch(/##|\^\^/);
  });
  it("volume before collection, translator, edition, original year", () => {
    const r = chap("Author: Ana Roe; Chapter: Quiet Rules; In: The Synthetic Collection; Volume: 3; First page: 210; Editor: Ben Poe; Translator: Cy Lu; Edition: 2d; Year: 2015; Original year: 1960")!;
    expect(plain(r.citation)).toBe("Ana Roe, Quiet Rules, in 3 The Synthetic Collection 210 (Ben Poe ed., Cy Lu trans., 2d ed. 2015) (1960).");
  });
  it("missing first page stays missing, never taken from the pinpoint", () => {
    const r = chap("Author: Ana Roe; Chapter: Quiet Rules; Collection: The Synthetic Collection; Pinpoint: 214; Year: 2015")!;
    expect(r.missing).toContain("firstPage");
    expect(plain(r.citation)).toContain("[חסר: עמוד], 214");
    expect(renderBookChapter({ authors: "A", chapterTitle: "B", bookTitle: "C", pinpoint: "9", year: "2000" }).missing).toContain("firstPage");
  });
  it("comma-ambiguous author/title boundary is preserved", () => {
    const s = "Ana Roe, Ben Poe, Quiet Rules, in The Synthetic Collection 210 (2015)";
    expect(chap(s)?.citation).toBe(s);
    expect(chap(s)?.warningMsg).toContain("המחבר");
  });
});

describe("routing and safety", () => {
  const CH = "Author: Ana Roe; Chapter: Quiet Rules; Collection: The Synthetic Collection; First page: 210; Year: 2015";
  it("manual book/chapter mismatch is preserved", () => {
    expect(book(CH)?.warningMsg).toContain("אינו תואם");
    expect(chap("The Synthetic Handbook (Ana Roe ed., 2010)")?.warningMsg).toContain("אינו תואם");
  });
  it("unsupported sibling (generic foreign) never formats", () => {
    const r = renderBookLocal("foreign", CH)!;
    expect(r.citation).toBe(CH);
    expect(r.warningMsg).toContain("אינו נתמך");
  });
  it("unknown tails stay visible with a warning", () => {
    const r = book("The Synthetic Handbook (Ana Roe ed., 2010) (reprint note)")!;
    expect(plain(r.citation)).toContain("(reprint note)");
    expect(r.warnings.join(" ")).toContain("reprint note");
  });
  it("HTML and literal ##/^^ are escaped", () => {
    const r = book("The <b>C##</b> ^^Guide (Ana Roe ed., 2010)")!;
    expect(plain(r.citation)).toBe("The <b>C##</b> ^^Guide (Ana Roe ed., 2010).");
    expect(citationToHtml(r.citation)).toContain("&lt;b&gt;");
  });
  it("journal articles and periodicals are untouched", () => {
    expect(renderBookLocal("foreign", "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)")).toBeNull();
    expect(detectForeignSource("Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)")?.kind).toBe("journal_article");
    expect(renderPeriodicalLocal("foreign_journal_article", "Title: Quiet Fields, Synthetic Mag., Mar. 2020, at 12")?.citation).toBe("##Quiet Fields##, ^^Synthetic Mag.^^, Mar. 2020, at 12.");
  });
  it("Hebrew input is left to Israeli rules", () => {
    expect(renderBookLocal("foreign_book", "ספר כלשהו (Ana Roe ed., 2010)")).toBeNull();
  });
  it.each([
    ["The Synthetic Handbook (Ana Roe ed., 2010)", "foreign_book", "The Synthetic Handbook (Ana Roe ed., 2010)."],
    [CH, "foreign_book_chapter", "Ana Roe, Quiet Rules, in The Synthetic Collection 210 (2015)."],
  ])("real runCitation formats %s locally without classifier/provider", async (rawInput, type, expected) => {
    const r = await runCitation({ rawInput, useVerifiedStore: false });
    expect(r.sourceType).toBe(type);
    expect(plain(r.citation)).toBe(expected);
    expect(b.invoke).not.toHaveBeenCalled();
    expect(b.classifier).not.toHaveBeenCalled();
  });
  it("runCitation manual mismatch and ambiguous input are preserved locally", async () => {
    const r = await runCitation({ rawInput: CH, useVerifiedStore: false, overrideType: "foreign_book" });
    expect(r.citation).toBe(CH);
    const a = await runCitation({ rawInput: "Ana Roe, Catch 22 15 (Ben Poe ed., 2001)", useVerifiedStore: false });
    expect(a.citation).toBe("Ana Roe, Catch 22 15 (Ben Poe ed., 2001)");
    expect(b.invoke).not.toHaveBeenCalled();
  });
});
