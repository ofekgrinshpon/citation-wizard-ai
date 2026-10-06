import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCitation } from "@/lib/runCitation";
import { renderJournalArticle } from "@/data/bluebook/render";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";

const boundaries = vi.hoisted(() => ({ invoke: vi.fn(), classify: vi.fn(), verified: vi.fn(), zero: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: boundaries.invoke }));
vi.mock("@/lib/sourceTypeClassifier", () => ({ resolveSourceType: boundaries.classify }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: boundaries.verified, classifyVerifiedSource: vi.fn(), getVerifiedCategoryLabel: vi.fn() }));
vi.mock("@/lib/refundResponse", () => ({ handleRefundResponse: vi.fn() }));
vi.mock("@/lib/costTelemetry", async (original) => ({ ...await original<typeof import("@/lib/costTelemetry")>(), reportZeroWork: boundaries.zero }));

const donor = { title: "The Right to Privacy — Warren and Brandeis", url: "https://law.harvard.edu/privacy", snippet: "Samuel D. Warren and Louis D. Brandeis, The Right to Privacy, 4 Harvard Law Review 193 (1890)." };
const request = "Warren & Brandeis, The Right to Privacy, pp. 213–214.";

function lookupBoundary(results: typeof donor[]) {
  const calls: Record<string, unknown>[] = [];
  boundaries.invoke.mockImplementation(async (_name, body) => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url === "https://api.perplexity.ai/search") {
        calls.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ results }), { status: 200 });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const foreignLookup = await runForeignLookup(body.foreignLookup as ForeignLookupInput, { fetchImpl, apiKey: "mock-only" });
    return { data: { content: "", foreignLookup }, errorInfo: null };
  });
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  boundaries.classify.mockResolvedValue({ sourceType: "foreign_journal_article" });
  boundaries.verified.mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unmocked network is forbidden in article regressions"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("foreign article client / edge / renderer integration", () => {
  it.each(["Warren & Brandeis", "Warren and Brandeis", "Samuel D. Warren and Louis D. Brandeis"])("preserves %s as anchors and uses compatible full names in the citation", async (authors) => {
    const calls = lookupBoundary([donor]);
    const result = await runCitation({ rawInput: `${authors}, The Right to Privacy, pp. 213–214.`, useVerifiedStore: false });
    expect(result.citation).toContain("Samuel D. Warren and Louis D. Brandeis");
    expect(result.citation).toContain("The Right to Privacy");
    expect(result.citation).toContain("4");
    expect(result.citation).toContain("Harv. L. Rev.");
    expect(result.citation).toContain("193, 213–214");
    expect(result.citation).toContain("(1890)");
    expect(result.status).toBe("valid");
    expect(calls).toHaveLength(1);
    expect(boundaries.invoke.mock.calls[0][1].foreignLookup.parsedFields).toMatchObject({ authors, articleTitle: "The Right to Privacy", pinpoint: "213–214" });
    expect(boundaries.invoke.mock.calls[0][1].foreignLookup.articleResponseVersion).toBe(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("retains title-only autonomy and recovers authors from a bound reference", async () => {
    lookupBoundary([donor]);
    const result = await runCitation({ rawInput: "The Right to Privacy", useVerifiedStore: false });
    expect(result.citation).toContain("Samuel D. Warren and Louis D. Brandeis");
    expect(result.citation).toContain("193 (1890)");
    expect(result.status).toBe("valid");
  });

  it("returns a useful warned partial with the requested pinpoint in citation data", async () => {
    const calls = lookupBoundary([{ ...donor, title: "Privacy after a century", snippet: "Privacy after a century, 39 Catholic U. L. Rev. 703 (1990). Discusses Warren and Brandeis and The Right to Privacy." }]);
    const result = await runCitation({ rawInput: request, useVerifiedStore: false });
    expect(result.citation).toContain("Warren & Brandeis");
    expect(result.citation).toContain("The Right to Privacy");
    expect(result.citation).toContain("[חסר: עמוד], 213–214");
    expect(result.citation).not.toContain("Catholic");
    expect(result.status).toBe("warning");
    expect(calls).toHaveLength(2);
    expect(boundaries.invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps supplied publication anchors and visibly warns about rejected conflict", async () => {
    lookupBoundary([donor, { ...donor, url: "https://lawreview.example.edu/wrong", snippet: donor.snippet.replace("(1890)", "(1990)") }]);
    const result = await runCitation({ rawInput: "Warren & Brandeis, The Right to Privacy (1890), pp. 213–214.", useVerifiedStore: false });
    expect(result.citation).toContain("193, 213–214 (1890)");
    expect(result.status).toBe("warning");
    expect(result.warningMsg).toContain("סותרים");
  });

  it("does not relabel conflicting incomplete records as valid", async () => {
    lookupBoundary([donor, { ...donor, url: "https://lawreview.example.edu/conflict", snippet: donor.snippet.replace("4 Harvard Law Review 193 (1890)", "39 Catholic U. L. Rev. 703 (1990)") }]);
    const result = await runCitation({ rawInput: request, useVerifiedStore: false });
    expect(result.status).toBe("warning");
    expect(result.citation).toContain("213–214");
    expect(result.citation).not.toContain("703");
    expect(result.warningMsg).toContain("סותרים");
  });

  it("keeps complete article input on its existing no-engine fast path", async () => {
    const result = await runCitation({ rawInput: "Warren & Brandeis, The Right to Privacy, 4 Harv. L. Rev. 193, 213–214 (1890)", overrideType: "foreign_journal_article", useVerifiedStore: false });
    expect(result.citation).toContain("193, 213–214 (1890)");
    expect(result.status).toBe("valid");
    expect(boundaries.invoke).not.toHaveBeenCalled();
    expect(boundaries.zero).toHaveBeenCalledWith(undefined, "local_foreign_formatter", "deterministic");
  });

  it.each(["", ", 201–203"])("retains the requested pinpoint on a compatible verified article cache hit (cached pinpoint %s)", async (cachedPinpoint) => {
    boundaries.verified.mockResolvedValue({ source_name: "Warren & Brandeis, The Right to Privacy", full_citation: `Samuel D. Warren & Louis D. Brandeis, The Right to Privacy, 4 Harv. L. Rev. 193${cachedPinpoint} (1890)`, source_type: "article" });
    const result = await runCitation({ rawInput: request });
    expect(result.citation).toContain("Samuel D. Warren & Louis D. Brandeis");
    expect(result.citation).toContain("193, 213–214 (1890)");
    expect(result.fromVerifiedStore).toBe(true);
    expect(boundaries.invoke).not.toHaveBeenCalled();
  });

  it("rejects an incompatible article cache hit without losing supplied fields", async () => {
    boundaries.verified.mockResolvedValue({ source_name: "Warren & Brandeis, The Right to Privacy", full_citation: "Another Author, Privacy after a century, 39 Cath. U. L. Rev. 703 (1990)", source_type: "article" });
    lookupBoundary([donor]);
    const result = await runCitation({ rawInput: request });
    expect(result.fromVerifiedStore).toBe(false);
    expect(result.citation).toContain("193, 213–214 (1890)");
    expect(result.citation).not.toContain("Cath");
    expect(boundaries.invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["foreign_case_us", "Smith v. Jones, No. 18-cv-1234, 2019 WL 1234567, at *5 (S.D.N.Y. Mar. 22, 2019)", "2019 WL 1234567"],
    ["foreign_case_us", "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)", "910 F.3d 649"],
    ["foreign_book", "H.L.A. Hart, The Concept of Law (2d ed. 1994)", "1994"],
  ] as const)("preserves the complete %s fast path", async (overrideType, rawInput, expected) => {
    const result = await runCitation({ rawInput, overrideType, useVerifiedStore: false });
    expect(result.citation).toContain(expected);
    expect(boundaries.invoke).not.toHaveBeenCalled();
  });

  it("does not invent a first page to retain an explicit pinpoint", () => {
    const result = renderJournalArticle({ authors: "Warren & Brandeis", articleTitle: "The Right to Privacy", pinpoint: "213–214" });
    expect(result.citation).toContain("[חסר: עמוד], 213–214");
    expect(result.missing).toContain("firstPage");
  });
});
