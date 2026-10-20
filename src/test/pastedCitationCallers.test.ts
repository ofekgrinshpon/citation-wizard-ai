import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCitation } from "@/lib/runCitation";
import { citationToPlain } from "@/lib/citationRichText";
const m = vi.hoisted(() => ({ invoke: vi.fn(), classifier: vi.fn(), cache: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: m.invoke }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: m.cache }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: m.classifier } } }));
beforeEach(() => {
  vi.clearAllMocks();
  m.cache.mockResolvedValue(null);
  m.classifier.mockResolvedValue({ data: { sourceType: "case_law_database", confidence: 1 }, error: null });
  m.invoke.mockResolvedValue({ data: { content: 'ע"א 400/51 כהן נ׳ לוי (נבו 2.3.2021)' }, errorInfo: null });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
});
describe("batch A real runCitation boundary", () => {
  it.each([{ kind: "book", fields: { bookTitle: "Brown" } }, { kind: "case", fields: { caseName: "Other v. Source", reporter: "U.S.", volume: "347", firstPage: "483", year: "1954" } }])("actual typed response %j cannot complete a different source", async foreignLookup => {
    m.invoke.mockResolvedValue({ data: { foreignLookup: { ...foreignLookup, identity: { matched: true, jurisdiction: "US" } }, content: "UNSAFE" }, errorInfo: null });
    const result = await runCitation({ rawInput: "Brown v. Board of Education", useVerifiedStore: false });
    expect(result.citation).toBe("Brown v. Board of Education"); expect(result.status).toBe("warning");
    expect(m.invoke).toHaveBeenCalledTimes(1);
  });
  it("valid canonical US typed completion retains supplied case name", async () => {
    const rawInput = "Brown v. Board of Education";
    m.invoke.mockResolvedValue({ data: { foreignLookup: { kind: "case", identity: { matched: true, jurisdiction: "US" }, fields: { caseName: rawInput, reporter: "U.S.", volume: "347", firstPage: "483", year: "1954" } } }, errorInfo: null });
    const result = await runCitation({ rawInput, useVerifiedStore: false });
    expect(result.citation).toBe(`${rawInput}, 347 U.S. 483 (1954).`); expect(m.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(["foreign_book", "foreign_book_chapter", "foreign_journal_article"] as const)("manual %s cannot cross supplied Brown source family", async overrideType => {
    const rawInput = "Brown v. Board of Education";
    const result = await runCitation({ rawInput, overrideType });
    expect(result.citation).toBe(rawInput);
    expect(result.pastedCitation?.conflicts).toContain("manual_source_kind_conflict");
    expect(result.status).toBe("warning");
    expect(m.invoke).not.toHaveBeenCalled(); expect(m.cache).not.toHaveBeenCalled(); expect(m.classifier).not.toHaveBeenCalled();
  });
  it("incomplete foreign case crosses request boundary typed, and generic response is terminal preservation", async () => {
    const rawInput = "Brown v. Board of Education";
    const r = await runCitation({ rawInput, useVerifiedStore: false });
    expect(m.invoke.mock.calls[0][1].pastedCitation).toMatchObject({ version: 1, jurisdiction: "UNKNOWN", rawInput });
    expect(m.invoke.mock.calls[0][1].foreignLookup).toMatchObject({ kind: "case", jurisdiction: "UNKNOWN", parsedFields: { caseName: rawInput } });
    expect(r.citation).toBe(rawInput); expect(r.status).toBe("warning");
  });
  it("typed response mismatch preserves original and does not redispatch", async () => {
    m.invoke.mockResolvedValue({ data: { content: "UNSAFE", pastedCitation: { version: 1, fingerprint: "wrong", rawInput: "wrong" } }, errorInfo: null });
    const r = await runCitation({ rawInput: "Brown v. Board of Education", useVerifiedStore: false });
    expect(r.citation).toBe("Brown v. Board of Education"); expect(m.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([
    "BVerfG, Urteil vom 15. Januar 1958, 1 BvR 400/51, BVerfGE 7, 198",
    "BVerfG 1 BvR 400/51",
    "BVerfG 1 BvR 400/51 — הערה C## Guide: x^^2 & A**B",
    "400/51",
  ])("preserves unsafe docket without classifier/cache/provider: %s", async (rawInput) => {
    const r = await runCitation({ rawInput });
    expect(citationToPlain(r.citation)).toBe(rawInput);
    expect(r.status).toBe("warning");
    expect(m.invoke).not.toHaveBeenCalled();
    expect(m.classifier).not.toHaveBeenCalled();
    expect(m.cache).not.toHaveBeenCalled();
  });
  it("Israel manual choice conflicts with supplied German evidence", async () => {
    const r = await runCitation({ rawInput: "BVerfG 1 BvR 400/51", overrideType: "case_law_database" });
    expect(r.warningMsg).toContain("סותר");
    expect(m.invoke).not.toHaveBeenCalled();
  });
  it("complete US case stays local", async () => {
    const r = await runCitation({ rawInput: "Brown v. Board of Education, 347 U.S. 483 (1954)", useVerifiedStore: false });
    expect(citationToPlain(r.citation)).toContain("347 U.S. 483 (1954)");
    expect(m.invoke).not.toHaveBeenCalled();
    expect(m.classifier).not.toHaveBeenCalled();
  });
});