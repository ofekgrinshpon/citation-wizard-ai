import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractBookWork } from "@/data/bluebook/bookWorks";
import { detectForeignSource } from "@/data/bluebook";
import { renderBookLocal } from "@/lib/bookLocal";
import { citationToHtml, citationToPlain } from "@/lib/citationRichText";
import { escapeCitationLiteral } from "@/lib/citationSegments";
import { runCitation } from "@/lib/runCitation";

const m = vi.hoisted(() => ({ invoke: vi.fn(), classifier: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: m.invoke }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: vi.fn().mockResolvedValue(null) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: m.classifier } } }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
});

const cases = [
  ["Hidden Costs, Courts and Memory, in Synthetic Collection 12 (Jane Doe ed., 2020)", "foreign_book_chapter", "ambiguous_author"],
  ["Jane Doe, Courts and Memory, in Synthetic Collection 12 (Jane Doe ed., 2020)", "foreign_book_chapter", "ambiguous_author"],
  ["Catch 22 (Jane Doe ed., 2021)", "foreign_book", "ambiguous_pinpoint"],
  ["Title 2020 (Jane Doe ed., 2021)", "foreign_book", "ambiguous_pinpoint"],
  ["Courts and Memory, in Synthetic Collection 2020 (Jane Doe ed., 2020)", "foreign_book_chapter", "ambiguous_pinpoint"],
  ["<b>C##</b> ^^Costs, Courts and Memory, in Synthetic Collection 12 (Jane Doe ed., 2020)", "foreign_book_chapter", "ambiguous_author"],
] as const;

describe("Stage 5 book/chapter explicit boundary safeguards", () => {
  it.each(cases)("parser and real caller preserve %s with %s", async (rawInput, type, reason) => {
    const p = extractBookWork(rawInput);
    expect(p?.preserve).toBe(reason);
    expect(p?.fields.authors).toBeUndefined();
    expect(p?.fields.firstPage).toBeUndefined();
    expect(p?.fields.pinpoint).toBeUndefined();
    expect(detectForeignSource(rawInput)?.kind).toBe("other");
    const local = renderBookLocal(type, rawInput, { deferToDeterministic: true });
    expect(local?.citation).toBe(escapeCitationLiteral(rawInput));
    for (const overrideType of [undefined, type]) {
      const r = await runCitation({ rawInput, useVerifiedStore: false, overrideType });
      expect(r.citation).toBe(escapeCitationLiteral(rawInput));
      expect(r.status).toBe("warning");
      expect(r.warningMsg).toContain(reason === "ambiguous_author" ? "המחבר" : "הכותרת");
      expect(citationToPlain(r.citation)).toBe(rawInput);
      expect(citationToHtml(r.citation)).not.toContain("<b>");
    }
    expect(m.invoke).not.toHaveBeenCalled();
    expect(m.classifier).not.toHaveBeenCalled();
  });

  it.each([
    ["Catch 22, at 15 (Jane Doe ed., 2021)", "foreign_book", "Catch 22, at 15 (Jane Doe ed., 2021)."],
    ["Title 2020, at 15 (Jane Doe ed., 2021)", "foreign_book", "Title 2020, at 15 (Jane Doe ed., 2021)."],
    ["Title: Catch 22; Editor: Jane Doe; Year: 2021; Pinpoint: 15", "foreign_book", "Catch 22, at 15 (Jane Doe ed., 2021)."],
    ["Author: Jane Doe; Chapter: Hidden Costs, Courts and Memory; Collection: Synthetic Collection 2020; First page: 12; Pinpoint: 15; Editor: Jane Doe; Year: 2020", "foreign_book_chapter", "Jane Doe, Hidden Costs, Courts and Memory, in Synthetic Collection 2020 12, 15 (Jane Doe ed., 2020)."],
  ] as const)("explicit metadata stays local: %s", async (rawInput, overrideType, expected) => {
    const r = await runCitation({ rawInput, overrideType, useVerifiedStore: false });
    expect(citationToPlain(r.citation)).toBe(expected);
    expect(m.invoke).not.toHaveBeenCalled();
    expect(m.classifier).not.toHaveBeenCalled();
  });

  it("explicit chapter pinpoint never supplies a missing first page or removes a collection title numeral", () => {
    const p = extractBookWork("Courts and Memory, in Synthetic Collection 2020, at 15 (Jane Doe ed., 2020)");
    expect(p?.fields.bookTitle).toBe("Synthetic Collection 2020");
    expect(p?.fields.firstPage).toBeUndefined();
    expect(p?.fields.pinpoint).toBe("15");
    const r = renderBookLocal("foreign_book_chapter", "Courts and Memory, in Synthetic Collection 2020, at 15 (Jane Doe ed., 2020)");
    expect(r?.missing).toContain("firstPage");
  });
});