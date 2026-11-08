/**
 * Stage 2 of the foreign free-form plan — case location records, grouping by
 * decision, expanded UK reporters and search completion. Mocked search only;
 * no live provider calls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import {
  extractLocationChains, formatLocationLabel, readLocationChoice,
} from "../../supabase/functions/_shared/citationPure/caseLocations";
import { renderForeignDetection } from "@/data/bluebook";
import { citationTextOnly } from "@/lib/citationSegments";
import { CHAT_HOST, planCitationEvidence, planLocalCitation, planTypedRequest, resolveCitationResponse } from "@/lib/citationPlanner";

interface Item { title: string; url: string; snippet: string }

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); })));

function run(input: ForeignLookupInput, tiers: Item[][], page = "") {
  const searches: Array<Record<string, unknown>> = [];
  let pages = 0;
  let i = 0;
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("perplexity.ai")) {
      searches.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ results: tiers[Math.min(i++, tiers.length - 1)] }), { status: 200 });
    }
    pages++;
    return page ? new Response(page, { status: 200 }) : new Response("nf", { status: 404 });
  }) as unknown as typeof fetch;
  return { p: runForeignLookup(input, { fetchImpl, apiKey: "offline-only" }), searches, pages: () => pages };
}

const uk = (raw: string, caseName = raw): ForeignLookupInput => ({ kind: "case", jurisdiction: "UK", rawInput: raw, parsedFields: { caseName } });
const us = (raw: string, caseName = raw, extra: Record<string, string> = {}): ForeignLookupInput =>
  ({ kind: "case", jurisdiction: "US", rawInput: raw, parsedFields: { caseName, ...extra } });
const render = (jurisdiction: "US" | "UK", fields: Record<string, string>) => citationTextOnly(renderForeignDetection({
  sourceType: jurisdiction === "US" ? "foreign_case_us" : "foreign_case_other", kind: "case", jurisdiction, confidence: "deterministic", fields,
})!.citation);

describe("location records", () => {
  it("keeps each UK report form exactly, including the newly supported reporters", () => {
    const chains = extractLocationChains("Donoghue v Stevenson [1932] UKHL 100, [1932] AC 562 (HL), 1932 SC (HL) 31, [1932] All ER Rep 1", "UK");
    expect(chains).toHaveLength(1);
    expect(chains[0]).toMatchObject({ neutral: "UKHL 100", decisionYear: "1932" });
    expect(chains[0].locations.map(formatLocationLabel)).toEqual(["[1932] AC 562 (HL)", "1932 SC (HL) 31", "[1932] All ER Rep 1"]);
    const round = extractLocationChains("Dalton v Angus (1881) 6 App Cas 740 (HL)", "UK")[0].locations[0];
    expect(round).toMatchObject({ volumeYear: "1881", volume: "6", reporter: "App Cas", firstPage: "740", yearStyle: "round", court: "HL" });
  });

  it("does not read a Canadian neutral citation as a Scottish report", () => {
    expect(extractLocationChains("Maple v Cedar, 2020 SCC 12", "UK")).toEqual([]);
  });

  it("joins a US parallel chain under its single decision parenthetical", () => {
    const [chain] = extractLocationChains("Brown v. Board of Education, 347 U.S. 483, 74 S. Ct. 686, 98 L. Ed. 873 (1954)", "US");
    expect(chain.decisionYear).toBe("1954");
    expect(chain.locations.map(formatLocationLabel)).toEqual(["347 U.S. 483", "74 S. Ct. 686", "98 L. Ed. 873"]);
  });
});

describe("grouping by decision before choosing a location", () => {
  it("offers parallel UK reports of one decision as a choice instead of picking one", async () => {
    const r = await run(uk("Donoghue v Stevenson"), [[{
      title: "Donoghue v Stevenson [1932] UKHL 100 (26 May 1932)",
      url: "https://www.bailii.org/uk/cases/UKHL/1932/100.html",
      snippet: "Donoghue v Stevenson [1932] UKHL 100, [1932] AC 562, 1932 SC (HL) 31.",
    }]]).p;
    expect(r.identity.matched).toBe(true);
    expect(r.caseDecisions).toHaveLength(1);
    expect(r.locationChoiceRequired).toBe(true);
    expect(r.fields).toEqual({ neutral: "UKHL 100", year: "1932" });
    expect(r.fields.reporter).toBeUndefined();
  });

  it("groups reports found in different sources into the same decision", async () => {
    const r = await run(uk("Donoghue v Stevenson [1932]", "Donoghue v Stevenson"), [[
      { title: "Donoghue v Stevenson [1932] AC 562 (HL)", url: "https://www.bailii.org/uk/cases/UKHL/1932/100.html", snippet: "Donoghue v Stevenson [1932] AC 562 (HL)." },
      { title: "Donoghue v Stevenson", url: "https://www.casetext.com/x", snippet: "Reported as Donoghue v Stevenson 1932 SC (HL) 31." },
    ]]).p;
    expect(r.caseDecisions).toHaveLength(1);
    expect(r.caseDecisions![0].locations).toHaveLength(2);
    expect(r.locationChoiceRequired).toBe(true);
  });

  it("separates Brown I and Brown II as different decisions and asks which one", async () => {
    const r = await run(us("Brown v. Board of Education"), [[
      { title: "Brown v. Board of Education, 347 U.S. 483 (1954)", url: "https://www.courtlistener.com/opinion/1/", snippet: "Brown v. Board of Education, 347 U.S. 483 (1954)." },
      { title: "Brown v. Board of Education, 349 U.S. 294 (1955)", url: "https://law.justia.com/cases/federal/us/349/294/", snippet: "Brown v. Board of Education, 349 U.S. 294 (1955)." },
    ]]).p;
    expect(r.identity.matched).toBe(false);
    expect(r.fields).toEqual({});
    expect(r.caseDecisions?.map((d) => d.decisionYear).sort()).toEqual(["1954", "1955"]);
    expect(r.disambiguation?.map((d) => d.label).sort()).toEqual(["347 U.S. 483 (1954)", "349 U.S. 294 (1955)"]);
  });

  it("uses the user's year to select one decision without guessing", async () => {
    const r = await run(us("Brown v. Board of Education (1955)", "Brown v. Board of Education", { year: "1955" }), [[
      { title: "Brown v. Board of Education, 347 U.S. 483 (1954)", url: "https://www.courtlistener.com/opinion/1/", snippet: "Brown v. Board of Education, 347 U.S. 483 (1954)." },
      { title: "Brown v. Board of Education, 349 U.S. 294 (1955)", url: "https://law.justia.com/cases/federal/us/349/294/", snippet: "Brown v. Board of Education, 349 U.S. 294 (1955)." },
    ]]).p;
    expect(r.identity.matched).toBe(true);
    expect(r.fields).toMatchObject({ volume: "349", reporter: "U.S.", firstPage: "294" });
    expect(r.provenance.firstPage.sourceUrl).toContain("justia.com");
  });

  it("offers US parallel reporters of one decision as a choice", async () => {
    const r = await run(us("Brown v. Board of Education"), [[{
      title: "Brown v. Board of Education", url: "https://www.courtlistener.com/opinion/1/",
      snippet: "Brown v. Board of Education, 347 U.S. 483, 74 S. Ct. 686, 98 L. Ed. 873 (1954).",
    }]]).p;
    expect(r.locationChoiceRequired).toBe(true);
    expect(r.fields).toEqual({ year: "1954" });
  });

  it("never binds a citation that belongs to another case named in the same text", async () => {
    const r = await run(uk("Donoghue v Stevenson"), [[{
      title: "Caparo Industries plc v Dickman",
      url: "https://www.bailii.org/uk/cases/UKHL/1990/2.html",
      snippet: "Caparo Industries plc v Dickman [1990] 2 AC 605, applying Donoghue v Stevenson [1932] AC 562 (HL).",
    }]]).p;
    expect(r.caseDecisions).toHaveLength(1);
    expect(r.fields).toMatchObject({ reporter: "AC", firstPage: "562", year: "1932", court: "HL" });
  });
});

describe("decision year is kept apart from the report year", () => {
  it("R v Jogee: decided 2016, reported in the 2017 volume", async () => {
    const r = await run(uk("R v Jogee"), [[{
      title: "R v Jogee [2016] UKSC 8", url: "https://www.supremecourt.uk/cases/uksc-2015-0015.html",
      snippet: "R v Jogee [2016] UKSC 8, [2017] AC 387.",
    }]]).p;
    expect(r.identity.matched).toBe(true);
    expect(r.caseDecisions![0]).toMatchObject({ decisionYear: "2016", neutral: "UKSC 8" });
    expect(r.caseDecisions![0].locations[0]).toMatchObject({ volumeYear: "2017", reporter: "AC", firstPage: "387" });
    expect(r.fields).toMatchObject({ neutral: "UKSC 8", year: "2016", volume: "2017", reporter: "AC", firstPage: "387" });
    expect(render("UK", { caseName: "R v Jogee", ...r.fields })).toBe("R v Jogee [2016] UKSC 8, [2017] AC 387.");
  });

  it("renders a round-bracket report in the form the source used", async () => {
    const r = await run(uk("Dalton v Angus"), [[{
      title: "Dalton v Angus (1881) 6 App Cas 740 (HL)", url: "https://www.bailii.org/uk/cases/UKHL/1881/1.html",
      snippet: "Dalton v Angus (1881) 6 App Cas 740 (HL).",
    }]]).p;
    expect(r.fields).toMatchObject({ year: "1881", reporterVolume: "6", reporter: "App Cas", firstPage: "740", reportYearStyle: "round" });
    expect(render("UK", { caseName: "Dalton v Angus", ...r.fields })).toBe("Dalton v Angus (1881) 6 App Cas 740 (HL).");
  });
});

describe("search completion", () => {
  it("runs the open search when the first search returns only an unrelated official record", async () => {
    const { p, searches } = run(uk("Donoghue v Stevenson"), [
      [{ title: "Smith v Jones [2004] EWCA Civ 123", url: "https://www.bailii.org/ew/cases/EWCA/Civ/2004/123.html", snippet: "Smith v Jones [2004] EWCA Civ 123." }],
      [{ title: "Donoghue v Stevenson [1932] AC 562 (HL)", url: "https://www.lawteacher.ac.uk/donoghue", snippet: "Donoghue v Stevenson [1932] AC 562 (HL)." }],
    ]);
    const r = await p;
    expect(r.diagnostics.tier2Fired).toBe(true);
    expect(searches).toHaveLength(2);
    expect(searches[1].search_domain_filter).toBeUndefined();
    expect(r.fields).toMatchObject({ reporter: "AC", firstPage: "562" });
  });

  it("inspects the related record when it has no usable details, and does not add a third retrieval", async () => {
    const { p, searches, pages } = run(uk("Donoghue v Stevenson"), [
      [{ title: "Donoghue v Stevenson", url: "https://www.bailii.org/uk/cases/UKHL/1932/100.html", snippet: "The snail in the bottle case." }],
      [],
    ]);
    const r = await p;
    expect(r.diagnostics.tier2Fired).toBe(false);
    expect(searches).toHaveLength(1);
    expect(pages()).toBe(1);
    expect(r.fields).toEqual({});
  });

  it("does not run the open search when the first search is already productive", async () => {
    const { p, searches } = run(uk("Donoghue v Stevenson"), [[
      { title: "Donoghue v Stevenson [1932] AC 562 (HL)", url: "https://www.bailii.org/uk/cases/UKHL/1932/100.html", snippet: "Donoghue v Stevenson [1932] AC 562 (HL)." },
    ]]);
    expect((await p).diagnostics.tier2Fired).toBe(false);
    expect(searches).toHaveLength(1);
  });
});

describe("app handling of a parallel-report choice", () => {
  const planFor = (input: string) => {
    const evidence = planCitationEvidence(input, null);
    const p = { evidence, sourceType: null, input, isPinpoint: false, manual: false };
    const local = planLocalCitation(p, CHAT_HOST);
    return planTypedRequest({ ...p, statutePrep: "statutePrep" in local ? local.statutePrep : null, canonicalRaw: input }, CHAT_HOST);
  };

  it("shows the parallel reports for choice and formats nothing on its own", async () => {
    const input = "Donoghue v Stevenson";
    const plan = planFor(input);
    expect(plan.foreignLookup?.kind).toBe("case");
    const response = await run({ ...plan.foreignLookup!, rawInput: input } as ForeignLookupInput, [[{
      title: "Donoghue v Stevenson [1932] UKHL 100 (26 May 1932)",
      url: "https://www.bailii.org/uk/cases/UKHL/1932/100.html",
      snippet: "Donoghue v Stevenson [1932] UKHL 100, [1932] AC 562, 1932 SC (HL) 31.",
    }]]).p;
    const result = resolveCitationResponse(plan, { foreignLookup: response }, CHAT_HOST);
    expect(result.kind).toBe("terminal");
    if (result.kind !== "terminal") return;
    expect(result.origin).toBe("disambiguation");
    expect(result.resolution.citation).toBe("");
    expect(result.resolution.reply).toContain("[1932] AC 562");
    expect(result.resolution.reply).toContain("1932 SC (HL) 31");
  });

  it("rejects a malformed or single-option choice", () => {
    const base = { locationChoiceRequired: true, caseDecisions: [{ jurisdiction: "UK", locations: [
      { id: "a", jurisdiction: "UK", reporter: "AC", firstPage: "562", volumeYear: "1932", yearStyle: "square", sourceUrl: "https://www.bailii.org/a" },
      { id: "b", jurisdiction: "UK", reporter: "SC (HL)", firstPage: "31", volumeYear: "1932", yearStyle: "none", sourceUrl: "https://www.bailii.org/b" },
    ] }] };
    expect(readLocationChoice(base, "UK")?.map((o) => o.label)).toEqual(["[1932] AC 562", "1932 SC (HL) 31"]);
    expect(readLocationChoice(base, "US")).toBeNull();
    expect(readLocationChoice({ ...base, caseDecisions: [{ ...base.caseDecisions[0], locations: [base.caseDecisions[0].locations[0]] }] }, "UK")).toBeNull();
    expect(readLocationChoice({ ...base, caseDecisions: [{ ...base.caseDecisions[0], locations: [{ ...base.caseDecisions[0].locations[0], sourceUrl: "javascript:alert(1)" }, base.caseDecisions[0].locations[1]] }] }, "UK")).toBeNull();
  });
});
