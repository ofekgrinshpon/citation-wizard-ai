/**
 * Stage 4 correction — adversarial regressions from independent review.
 * All transport is mocked; live network is forbidden.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCitation } from "@/lib/runCitation";
import { parseStatuteInput, prepareForeignStatute, renderForeignStatuteLookup } from "@/lib/foreignStatuteAdapter";
import { citationTextOnly } from "@/lib/citationSegments";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { resolveStatuteLookup, validateStatuteRequest } from "../../supabase/functions/citation-chat/statuteRoute";

const boundaries = vi.hoisted(() => ({ invoke: vi.fn(), verified: vi.fn(), zero: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: boundaries.invoke }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: boundaries.verified, classifyVerifiedSource: vi.fn(), getVerifiedCategoryLabel: vi.fn() }));
vi.mock("@/lib/refundResponse", () => ({ handleRefundResponse: vi.fn() }));
vi.mock("@/lib/costTelemetry", async (original) => ({ ...await original<typeof import("@/lib/costTelemetry")>(), reportZeroWork: boundaries.zero }));

type Source = { title?: string; url?: string; snippet?: string };
function replay(tiers: Source[][]) {
  let n = 0;
  const fetchImpl = (async (url: string | URL | Request) => {
    if (String(url) === "https://api.perplexity.ai/search") {
      return new Response(JSON.stringify({ results: tiers[n++] ?? [] }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return (input: ForeignLookupInput) => runForeignLookup(input, { fetchImpl, apiKey: "offline-only" });
}

beforeEach(() => {
  vi.clearAllMocks();
  boundaries.verified.mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
});

const AU_CORNELL = {
  title: "Australia: Copyright Act 1968, c. 63.",
  url: "https://www.law.cornell.edu/world/australia/copyright",
  snippet: "Australia: Copyright Act 1968, c. 63.",
};

describe("#3 Act + year + chapter is not UK identity", () => {
  it("UNKNOWN 'Copyright Act' with an Australian page on a strong host stays unresolved", async () => {
    const r = await replay([[AU_CORNELL]])({ kind: "statute", jurisdiction: "UNKNOWN", rawInput: "Copyright Act", parsedFields: { statuteName: "Copyright Act" } });
    expect(r.identity.matched).toBe(false);
    expect(r.identity.jurisdiction).toBeUndefined();
    expect(r.jurisdiction).toBe("UNKNOWN");
    expect(Object.keys(r.fields)).toHaveLength(0);
  });

  it("given UK also rejects evidence that is not a UK official record", async () => {
    const r = await replay([[AU_CORNELL]])({ kind: "statute", jurisdiction: "UK", rawInput: "Copyright Act", parsedFields: { statuteName: "Copyright Act" } });
    expect(r.identity.matched).toBe(false);
    expect(r.fields.year).toBeUndefined();
    expect(r.fields.chapter).toBeUndefined();
  });

  it("a UK record path whose locator disagrees with the snippet is not grounding", async () => {
    const r = await replay([[{ title: "Copyright Act 1956", url: "https://www.legislation.gov.uk/ukpga/1911/46", snippet: "Copyright Act 1956, c. 74." }]])(
      { kind: "statute", jurisdiction: "UK", rawInput: "Copyright Act", parsedFields: { statuteName: "Copyright Act" } });
    expect(r.identity.matched).toBe(false);
  });

  it("a UK record for a differently named Act is not identity (no global title weakening)", async () => {
    const r = await replay([[{ title: "Guide Act 1990", url: "https://www.legislation.gov.uk/ukpga/1990/5", snippet: "Guide Act 1990, c. 5." }]])(
      { kind: "statute", jurisdiction: "UK", rawInput: "C## Guide Act", parsedFields: { statuteName: "C## Guide Act" } });
    expect(r.identity.matched).toBe(false);
    expect(Object.keys(r.fields)).toHaveLength(0);
  });
});

describe("#4 lookup fields merge only from matched, conflict-free, same-jurisdiction typed responses", () => {
  const typed = (over: Record<string, unknown>) => ({
    statuteResponseVersion: 1, kind: "statute", jurisdiction: "UK", fields: { year: "1999", chapter: "77" },
    grounded: {}, provenance: {}, sources: [], diagnostics: {},
    identity: { matched: false, jurisdiction: "UK", anchors: [], conflicts: ["wrong_record"] }, ...over,
  });

  it("reviewer reproduction: unmatched with conflicts never merges year/chapter", async () => {
    boundaries.invoke.mockResolvedValue({ data: { content: "", foreignLookup: typed({}) }, errorInfo: null });
    const r = await runCitation({ rawInput: "Example Act § 2", overrideType: "foreign_statute_uk", useVerifiedStore: false });
    expect(r.citation).not.toMatch(/1999|c\. 77/);
    expect(citationTextOnly(r.citation)).toContain("Example Act");
    expect(r.status).toBe("warning");
  });

  it("matched but carrying a conflict still does not merge", async () => {
    boundaries.invoke.mockResolvedValue({ data: { content: "", foreignLookup: typed({ identity: { matched: true, jurisdiction: "UK", conflicts: ["conflicting_statute_year"] } }) }, errorInfo: null });
    const r = await runCitation({ rawInput: "Example Act § 2", overrideType: "foreign_statute_uk", useVerifiedStore: false });
    expect(r.citation).not.toMatch(/1999|c\. 77/);
  });

  it("matched for another jurisdiction than the manual anchor does not merge", async () => {
    boundaries.invoke.mockResolvedValue({ data: { content: "", foreignLookup: typed({ identity: { matched: true, jurisdiction: "US", conflicts: [] } }) }, errorInfo: null });
    const r = await runCitation({ rawInput: "Example Act § 2", overrideType: "foreign_statute_uk", useVerifiedStore: false });
    expect(r.citation).not.toMatch(/1999|c\. 77/);
    expect(r.sourceType).toBe("foreign_statute_uk");
  });

  it("version-missing (old server) response is not trusted, nor is model content", async () => {
    const { statuteResponseVersion: _v, ...unversioned } = typed({ identity: { matched: true, jurisdiction: "UK", conflicts: [] } });
    boundaries.invoke.mockResolvedValue({ data: { content: "Fabricated Act 1999, c. 77, § 2.", foreignLookup: unversioned }, errorInfo: null });
    const r = await runCitation({ rawInput: "Example Act § 2", overrideType: "foreign_statute_uk", useVerifiedStore: false });
    expect(r.citation).not.toMatch(/1999|Fabricated/);
    expect(r.status).toBe("warning");

    boundaries.invoke.mockResolvedValue({ data: { content: "Fabricated Act 1999, c. 77, § 2." }, errorInfo: null });
    const r2 = await runCitation({ rawInput: "Example Act § 2", overrideType: "foreign_statute_uk", useVerifiedStore: false });
    expect(r2.reply).not.toContain("Fabricated");
    expect(citationTextOnly(r2.citation)).toContain("Example Act");
  });

  it("a valid matched response fills only gaps; supplied fields win", () => {
    const prep = prepareForeignStatute("foreign_statute_uk", "Example Act § 2")!;
    const out = renderForeignStatuteLookup(prep, typed({ fields: { year: "1999", chapter: "77", statuteName: "Other Act" }, identity: { matched: true, jurisdiction: "UK", conflicts: [] } }));
    expect(citationTextOnly(out.citation)).toBe("Example Act 1999, c. 77, § 2.");
  });
});

describe("#5 years only in dated context; manual jurisdiction never crossed", () => {
  it("reviewer reproduction: '§ 1983' is a section, not a year", async () => {
    boundaries.invoke.mockResolvedValue({ data: { content: "" }, errorInfo: null });
    await runCitation({ rawInput: "Civil Rights Act § 1983", overrideType: "foreign_statute_us", useVerifiedStore: false });
    const sent = boundaries.invoke.mock.calls[0][1].foreignLookup;
    expect(sent.parsedFields).toEqual({ statuteName: "Civil Rights Act", section: "1983" });
    expect(sent.parsedFields.year).toBeUndefined();
  });

  it("server does not read a year from rawInput either", async () => {
    const r = await replay([[{ title: "42 U.S.C. § 1983", url: "https://www.law.cornell.edu/uscode/text/42/1983", snippet: "Civil Rights Act — 42 U.S.C. § 1983 (2018)." }]])(
      { kind: "statute", jurisdiction: "US", rawInput: "Civil Rights Act § 1983", parsedFields: { statuteName: "Civil Rights Act", section: "1983" } });
    expect(r.identity.anchors.some((a) => a.startsWith("year:"))).toBe(false);
    expect(r.identity.matched).toBe(true);
    expect(r.fields.year).toBe("2018");
  });

  it("keeps real digits in names, s./ss./§§ forms, lists and ranges", () => {
    expect(parseStatuteInput("Civil Rights Act of 1964 § 2000e-2", "US")).toEqual({ statuteName: "Civil Rights Act of 1964", section: "2000e-2" });
    expect(parseStatuteInput("Copyright Act §§ 107, 110-111", "US")).toMatchObject({ sections: ["107", "110–111"], multi: true });
    expect(parseStatuteInput("Data Protection Act 2018 s. 12", "UK")).toEqual({ statuteName: "Data Protection Act", year: "2018", section: "12" });
    expect(parseStatuteInput("Data Protection Act 2018 ss. 12-14", "UK")).toMatchObject({ statuteName: "Data Protection Act", year: "2018", unparsedRemainder: "ss. 12-14" });
  });

  it("unsupported suffixes are preserved in the citation, never truncated", async () => {
    const us = await runCitation({ rawInput: "17 U.S.C. § 512 et seq.", overrideType: "foreign_statute_us", useVerifiedStore: false });
    expect(citationTextOnly(us.citation)).toContain("et seq");
    expect(us.status).toBe("warning");
    const uk = await runCitation({ rawInput: "Data Protection Act 2018 ss. 12-14", overrideType: "foreign_statute_uk", useVerifiedStore: false });
    expect(citationTextOnly(uk.citation)).toContain("ss. 12-14");
    expect(boundaries.invoke).not.toHaveBeenCalled();
  });

  it("manual UK vs deterministic US detection: honest mismatch, no crossing, no request", async () => {
    const r = await runCitation({ rawInput: "17 U.S.C. § 512 (2018)", overrideType: "foreign_statute_uk", useVerifiedStore: false });
    expect(boundaries.invoke).not.toHaveBeenCalled();
    expect(r.sourceType).toBe("foreign_statute_uk");
    expect(r.status).toBe("warning");
    expect(r.reply).toContain("סותר");
  });
});

describe("#2 typed statute route always terminates (shared with citation-chat)", () => {
  const valid = { enabled: true, statuteResponseVersion: 1, kind: "statute", jurisdiction: "US", rawInput: "Civil Rights Act § 1983", parsedFields: { statuteName: "Civil Rights Act", section: "1983" } };

  it("invalid / unsupported / version-missing requests are typed errors, no lookup", async () => {
    const runLookup = vi.fn();
    for (const bad of [{ ...valid, statuteResponseVersion: undefined }, { ...valid, jurisdiction: "AU" }, { ...valid, rawInput: "" }, { ...valid, parsedFields: { section: 5 } }, null]) {
      const r = await resolveStatuteLookup(bad, { apiKey: "k", runLookup });
      expect(r).toMatchObject({ statuteResponseVersion: 1, kind: "statute", error: "invalid_statute_request" });
      expect(r.identity.matched).toBe(false);
    }
    expect(runLookup).not.toHaveBeenCalled();
    expect(validateStatuteRequest(valid)).not.toBeNull();
  });

  it("missing key → typed warning, provider never called", async () => {
    const runLookup = vi.fn();
    const r = await resolveStatuteLookup(valid, { apiKey: undefined, runLookup });
    expect(r.error).toBe("missing_perplexity_credentials");
    expect(runLookup).not.toHaveBeenCalled();
  });

  it("thrown timeout/error → typed lookup_failed, marked uncertain once, no retry", async () => {
    const runLookup = vi.fn().mockRejectedValue(new DOMException("timeout", "AbortError"));
    const onProviderUnknown = vi.fn();
    const r = await resolveStatuteLookup(valid, { apiKey: "k", runLookup, onProviderUnknown });
    expect(r.error).toBe("lookup_failed");
    expect(Object.keys(r.fields)).toHaveLength(0);
    expect(runLookup).toHaveBeenCalledTimes(1);
    expect(onProviderUnknown).toHaveBeenCalledTimes(1);
  });

  it("empty or malformed result → typed empty_result, never a success signal", async () => {
    for (const bad of [null, undefined, {}, { kind: "case", identity: { matched: true, conflicts: [] }, fields: { year: "1" } }]) {
      const r = await resolveStatuteLookup(valid, { apiKey: "k", runLookup: vi.fn().mockResolvedValue(bad) });
      expect(r.error).toBe("empty_result");
      expect(r.identity.matched).toBe(false);
    }
  });

  it("client renders every typed failure as supplied input + warning", async () => {
    const prep = prepareForeignStatute("foreign_statute_us", "Civil Rights Act § 1983")!;
    for (const error of ["missing_perplexity_credentials", "lookup_failed", "empty_result", "invalid_statute_request"]) {
      const r = renderForeignStatuteLookup(prep, { statuteResponseVersion: 1, kind: "statute", error, identity: { matched: true, jurisdiction: "US", conflicts: [] }, fields: { titleNumber: "42", code: "U.S.C." } });
      expect(r.citation).not.toContain("42 U.S.C.");
      expect(r.status).toBe("warning");
    }
  });

  it("citation-chat routes statute requests only through the typed route, before any generic model", () => {
    const src = readFileSync("supabase/functions/citation-chat/index.ts", "utf8");
    const statuteIdx = src.indexOf("if (statuteRequest) {");
    const genericIdx = src.indexOf('["case", "journal_article", "book", "book_chapter"].includes(flKind)');
    expect(statuteIdx).toBeGreaterThan(0);
    expect(genericIdx).toBeGreaterThan(statuteIdx);
    expect(src.slice(statuteIdx, genericIdx)).toMatch(/resolveStatuteLookup[\s\S]*return completeResponse/);
    expect(src).not.toMatch(/"book_chapter", "statute"\]/);
    // Malformed statute requests are rejected before the usage claim.
    expect(src.indexOf("validateStatuteRequest(foreignLookupRequest)")).toBeLessThan(src.indexOf("usageGuard.begin("));
  });
});
