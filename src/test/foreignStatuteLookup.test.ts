/**
 * Stage 4 — grounded foreign-legislation lookup (US/UK statutes only).
 *
 * Analogous to the foreign-case lookup: the server discovers facts (mocked
 * Perplexity Search here), extraction + grounding are deterministic, and the
 * existing Bluebook statute renderers remain the sole formatters.
 * UNKNOWN is not US; a website host alone never implies a jurisdiction;
 * conflicting/ambiguous evidence is an honest warning state, never a merge.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCitation, CitationRunError } from "@/lib/runCitation";
import { planForeignLookup } from "@/lib/runCitation";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { citationTextOnly } from "@/lib/citationSegments";

const boundaries = vi.hoisted(() => ({ invoke: vi.fn(), verified: vi.fn(), zero: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: boundaries.invoke }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: boundaries.verified, classifyVerifiedSource: vi.fn(), getVerifiedCategoryLabel: vi.fn() }));
vi.mock("@/lib/refundResponse", () => ({ handleRefundResponse: vi.fn() }));
vi.mock("@/lib/costTelemetry", async (original) => ({ ...await original<typeof import("@/lib/costTelemetry")>(), reportZeroWork: boundaries.zero }));

type Source = { title?: string; url?: string; snippet?: string };

function replay(tiers: Source[][]) {
  const searches: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    if (address === "https://api.perplexity.ai/search") {
      searches.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ results: tiers[searches.length - 1] ?? [] }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return {
    searches,
    lookup: (request: ForeignLookupInput) => runForeignLookup(request, { fetchImpl, apiKey: "offline-only" }),
  };
}

/** Wire the real server lookup (mocked transport) behind the real client caller. */
function wireCaller(tiers: Source[][]) {
  const test = replay(tiers);
  boundaries.invoke.mockImplementation(async (_name: string, body: { foreignLookup: ForeignLookupInput }) => ({
    data: { content: "", foreignLookup: await test.lookup(body.foreignLookup) },
    errorInfo: null,
  }));
  return test;
}

beforeEach(() => {
  vi.clearAllMocks();
  boundaries.verified.mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden in statute lookup tests"); }));
});

const DMCA_SNIPPET = {
  title: "17 U.S.C. § 512 - Limitations on liability relating to material online",
  url: "https://www.law.cornell.edu/uscode/text/17/512",
  snippet: "Digital Millennium Copyright Act — 17 U.S.C. § 512 (2018). Safe harbor provisions for online service providers.",
};

describe("planForeignLookup — statute bound is explicit", () => {
  it("plans a US statute lookup for a US-statute source type", () => {
    expect(planForeignLookup("foreign_statute_us", "Digital Millennium Copyright Act § 512", null))
      .toEqual({ kind: "statute", jurisdiction: "US" });
  });

  it("plans a UK statute lookup for a UK-statute source type", () => {
    expect(planForeignLookup("foreign_statute_uk", "Copyright, Designs and Patents Act § 12", null))
      .toEqual({ kind: "statute", jurisdiction: "UK" });
  });

  it("never plans a statute lookup for an unresolved or unsupported jurisdiction", () => {
    expect(planForeignLookup("foreign", "Some Statute § 5", null)).toBeNull();
    expect(planForeignLookup("foreign_book", "Some Statute § 5", null)).toBeNull();
  });
});

describe("server statute lookup — grounding and honesty", () => {
  const US_INPUT: ForeignLookupInput = {
    kind: "statute",
    jurisdiction: "US",
    rawInput: "Digital Millennium Copyright Act § 512",
    parsedFields: { statuteName: "Digital Millennium Copyright Act", section: "512" },
  };

  it("grounds title/code/year from an identity-matched strong source", async () => {
    const result = await replay([[DMCA_SNIPPET]]).lookup(US_INPUT);
    expect(result.identity.matched).toBe(true);
    expect(result.fields.titleNumber).toBe("17");
    expect(result.fields.code).toBe("U.S.C.");
    expect(result.fields.year).toBe("2018");
    expect(result.grounded.titleNumber).toBe(true);
    expect(result.provenance.titleNumber.sourceUrl).toContain("law.cornell.edu");
  });

  it("no identity-matched source → honest unmatched state, no fields", async () => {
    const result = await replay([[{ title: "Unrelated page", url: "https://law.cornell.edu/other", snippet: "Something else entirely." }]]).lookup(US_INPUT);
    expect(result.identity.matched).toBe(false);
    expect(result.identity.conflicts).toContain("no_identity_matched_source");
    expect(Object.keys(result.fields)).toHaveLength(0);
  });

  it("a user year anchor that evidence contradicts discards the source", async () => {
    const input: ForeignLookupInput = {
      kind: "statute", jurisdiction: "UK", rawInput: "Copyright Act 1978",
      parsedFields: { statuteName: "Copyright Act", year: "1978" },
    };
    const result = await replay([[{
      title: "Copyright Act 1956", url: "https://www.legislation.gov.uk/ukpga/1956/74",
      snippet: "Copyright Act 1956, c. 74. An Act to make new provision in respect of copyright.",
    }]]).lookup(input);
    expect(result.identity.matched).toBe(false);
    expect(result.identity.conflicts.some((c) => c.startsWith("year:1978 vs 1956"))).toBe(true);
    expect(result.fields.year).toBeUndefined();
  });

  it("same-name ambiguity between two different Acts stays unresolved", async () => {
    const input: ForeignLookupInput = {
      kind: "statute", jurisdiction: "UK", rawInput: "Copyright Act",
      parsedFields: { statuteName: "Copyright Act" },
    };
    const result = await replay([[
      { title: "Copyright Act 1956", url: "https://www.legislation.gov.uk/ukpga/1956/74", snippet: "Copyright Act 1956, c. 74." },
      { title: "Copyright Act 1911", url: "https://www.legislation.gov.uk/ukpga/1911/46", snippet: "Copyright Act 1911, c. 46." },
    ]]).lookup(input);
    expect(result.identity.matched).toBe(false);
    expect(result.identity.conflicts).toContain("ambiguous_record");
    expect(Object.keys(result.fields)).toHaveLength(0);
  });

  it("UK-planned lookup never crosses into US evidence", async () => {
    const input: ForeignLookupInput = {
      kind: "statute", jurisdiction: "UK", rawInput: "Digital Millennium Copyright Act § 512",
      parsedFields: { statuteName: "Digital Millennium Copyright Act", section: "512" },
    };
    const result = await replay([[DMCA_SNIPPET]]).lookup(input);
    expect(result.identity.matched).toBe(false);
    expect(result.fields.titleNumber).toBeUndefined();
  });

  it("UNKNOWN jurisdiction resolves only from an explicit citation form, never the host", async () => {
    const input: ForeignLookupInput = {
      kind: "statute", jurisdiction: "UNKNOWN", rawInput: "Copyright, Designs and Patents Act",
      parsedFields: { statuteName: "Copyright, Designs and Patents Act" },
    };
    const resolved = await replay([[{
      title: "Copyright, Designs and Patents Act 1988", url: "https://www.legislation.gov.uk/ukpga/1988/48",
      snippet: "Copyright, Designs and Patents Act 1988, c. 48. An Act to restate the law of copyright.",
    }]]).lookup(input);
    expect(resolved.identity.jurisdiction).toBe("UK");
    expect(resolved.identity.jurisdictionDiscovered).toBe(true);
    expect(resolved.fields.chapter).toBe("48");

    const hostOnly = await replay([[{
      title: "Copyright, Designs and Patents Act — overview", url: "https://www.legislation.gov.uk/some/overview",
      snippet: "Copyright, Designs and Patents Act guidance and explanatory notes.",
    }]]).lookup(input);
    expect(hostOnly.identity.matched).toBe(false);
    expect(hostOnly.identity.conflicts).toContain("jurisdiction_unresolved");
    expect(hostOnly.identity.jurisdiction).toBeUndefined();
  });

  it("mixed US and UK evidence for one name is ambiguous, not merged", async () => {
    const input: ForeignLookupInput = {
      kind: "statute", jurisdiction: "UNKNOWN", rawInput: "Copyright Act",
      parsedFields: { statuteName: "Copyright Act" },
    };
    const result = await replay([[
      { title: "Copyright Act 1956", url: "https://www.legislation.gov.uk/ukpga/1956/74", snippet: "Copyright Act 1956, c. 74." },
      { title: "Copyright Act — 17 U.S.C.", url: "https://www.law.cornell.edu/uscode/text/17", snippet: "Copyright Act, 17 U.S.C. § 101 (2018)." },
    ]]).lookup(input);
    expect(result.identity.matched).toBe(false);
    expect(result.identity.conflicts).toContain("ambiguous_jurisdiction");
  });
});

describe("client caller — runCitation statute path", () => {
  it("incomplete US statute grounds fields through the actual caller and renders deterministically", async () => {
    wireCaller([[DMCA_SNIPPET]]);
    const result = await runCitation({ rawInput: "Digital Millennium Copyright Act § 512", overrideType: "foreign_statute_us", useVerifiedStore: false });
    expect(boundaries.invoke).toHaveBeenCalledTimes(1);
    expect(boundaries.invoke.mock.calls[0][1].foreignLookup).toMatchObject({ kind: "statute", jurisdiction: "US" });
    expect(result.citation).toContain("Digital Millennium Copyright Act, 17 U.S.C. § 512 (2018)");
    expect(result.sourceType).toBe("foreign_statute_us");
    expect(result.status).toBe("valid");
  });

  it("complete structured input renders locally without any paid request", async () => {
    const result = await runCitation({ rawInput: "17 U.S.C. § 512 (2018)", overrideType: "foreign_statute_us", useVerifiedStore: false });
    expect(boundaries.invoke).not.toHaveBeenCalled();
    expect(result.citation).toContain("17 U.S.C. § 512 (2018)");
  });

  it("unmatched lookup returns an honest warning, not a fabricated citation", async () => {
    wireCaller([[{ title: "Unrelated", url: "https://law.cornell.edu/other", snippet: "No statute here." }]]);
    const result = await runCitation({ rawInput: "Digital Millennium Copyright Act § 512", overrideType: "foreign_statute_us", useVerifiedStore: false });
    expect(result.status).toBe("warning");
    expect(result.citation).toContain("Digital Millennium Copyright Act");
    expect(result.reply).toContain("⚠️");
  });

  it("user-supplied section list and range survive the lookup merge", async () => {
    wireCaller([[{
      title: "17 U.S.C. § 107 - Limitations on exclusive rights: Fair use",
      url: "https://www.law.cornell.edu/uscode/text/17/107",
      snippet: "Copyright Act — 17 U.S.C. § 107 (2018). Fair use.",
    }]]);
    const result = await runCitation({ rawInput: "Copyright Act §§ 107, 110–111", overrideType: "foreign_statute_us", useVerifiedStore: false });
    expect(result.citation).toContain("§§ 107, 110–111");
    expect(result.citation).toContain("17 U.S.C.");
  });

  it("manual UK classification survives: jurisdiction is never re-discovered or crossed", async () => {
    const test = wireCaller([[{
      title: "Copyright, Designs and Patents Act 1988", url: "https://www.legislation.gov.uk/ukpga/1988/48",
      snippet: "Copyright, Designs and Patents Act 1988, c. 48. Section 12.",
    }]]);
    const result = await runCitation({ rawInput: "Copyright, Designs and Patents Act § 12", overrideType: "foreign_statute_uk", useVerifiedStore: false });
    expect(test.searches).toHaveLength(1);
    expect(result.sourceType).toBe("foreign_statute_uk");
    expect(result.citation).toContain("Copyright, Designs and Patents Act 1988, c. 48, § 12");
  });

  it("a delayed response cannot overwrite a changed input", async () => {
    let current = true;
    boundaries.invoke.mockImplementation(async () => {
      current = false;
      return { data: { content: "", foreignLookup: { kind: "statute", jurisdiction: "US", fields: {}, grounded: {}, provenance: {}, sources: [], identity: { matched: false, anchors: [], conflicts: ["no_identity_matched_source"] }, diagnostics: { tier1Queried: true, tier2Fired: false } } }, errorInfo: null };
    });
    await expect(runCitation({
      rawInput: "Digital Millennium Copyright Act § 512", overrideType: "foreign_statute_us",
      useVerifiedStore: false, isResultCurrent: () => current,
    })).rejects.toMatchObject({ code: "CITATION_INPUT_CHANGED" });
  });

  it("user-supplied statute name with marker-like characters stays literal", async () => {
    wireCaller([[{
      title: "Guide Act 1990", url: "https://www.legislation.gov.uk/ukpga/1990/5",
      snippet: "Guide Act 1990, c. 5. An Act about guides.",
    }]]);
    const result = await runCitation({ rawInput: "C## Guide Act", overrideType: "foreign_statute_uk", useVerifiedStore: false });
    expect(citationTextOnly(result.citation)).toContain("C## Guide Act 1990, c. 5");
  });
});
