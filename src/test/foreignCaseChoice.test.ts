/**
 * Stage 3 of the foreign free-form plan — record-bound choices for foreign
 * rulings. Mocked search only; choosing never searches again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { readLocationChoice } from "../../supabase/functions/_shared/citationPure/caseLocations";
import { CHAT_HOST, RUNNER_HOST, planCitationEvidence, planLocalCitation, planTypedRequest, resolveCitationResponse, selectForeignCaseChoice } from "@/lib/citationPlanner";
import { buildForeignCaseChoice } from "@/lib/foreignCaseChoice";
import { citationTextOnly } from "@/lib/citationSegments";

interface Item { title: string; url: string; snippet: string }
let searches = 0;
beforeEach(() => { searches = 0; vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); })); });

const planFor = (input: string) => {
  const evidence = planCitationEvidence(input, null);
  const p = { evidence, sourceType: null, input, isPinpoint: false, manual: false };
  const local = planLocalCitation(p, CHAT_HOST);
  return planTypedRequest({ ...p, statutePrep: "statutePrep" in local ? local.statutePrep : null, canonicalRaw: input }, CHAT_HOST);
};
async function lookup(input: string, items: Item[]) {
  const plan = planFor(input);
  expect(plan.foreignLookup?.kind).toBe("case");
  const fetchImpl = (async (url: unknown) => {
    if (String(url).includes("perplexity.ai")) { searches++; return new Response(JSON.stringify({ results: items }), { status: 200 }); }
    return new Response("nf", { status: 404 });
  }) as unknown as typeof fetch;
  const response = await runForeignLookup({ ...plan.foreignLookup!, rawInput: input } as ForeignLookupInput, { fetchImpl, apiKey: "offline-only" });
  return { plan, data: { foreignLookup: response } as Record<string, unknown> };
}
const terminal = (r: ReturnType<typeof resolveCitationResponse>) => { if (r.kind !== "terminal") throw new Error("not terminal"); return r; };

const BROWN_I = { title: "Brown v. Board of Education, 347 U.S. 483 (1954)", url: "https://www.courtlistener.com/opinion/1/", snippet: "Brown v. Board of Education, 347 U.S. 483 (1954)." };
const BROWN_II = { title: "Brown v. Board of Education, 349 U.S. 294 (1955)", url: "https://law.justia.com/cases/federal/us/349/294/", snippet: "Brown v. Board of Education, 349 U.S. 294 (1955)." };
const DONOGHUE = { title: "Donoghue v Stevenson [1932] UKHL 100 (26 May 1932)", url: "https://www.bailii.org/uk/cases/UKHL/1932/100.html", snippet: "Donoghue v Stevenson [1932] UKHL 100, [1932] AC 562, 1932 SC (HL) 31." };

describe("choosing between rulings", () => {
  it("Brown I or Brown II: the chosen ruling is formatted from its own record without another search", async () => {
    const input = "Brown v. Board of Education";
    const { plan, data } = await lookup(input, [BROWN_I, BROWN_II]);
    const before = searches;
    const r = terminal(resolveCitationResponse(plan, data, CHAT_HOST));
    expect(r.origin).toBe("disambiguation");
    const choice = r.resolution.foreignChoice!;
    expect(choice.stage).toBe("decision");
    expect(choice.options.map((o) => o.label).sort()).toEqual(["347 U.S. 483 (1954)", "349 U.S. 294 (1955)"]);
    const brownII = choice.options.find((o) => o.label.includes("1955"))!;
    const out = selectForeignCaseChoice(choice, brownII.id, [input], CHAT_HOST);
    expect(out.kind).toBe("resolved");
    if (out.kind !== "resolved") return;
    expect(citationTextOnly(out.resolution.citation)).toBe("Brown v. Board of Education, 349 U.S. 294 (1955).");
    expect(out.resolution.completion?.provenance.firstPage).toMatchObject({ sourceUrl: BROWN_II.url });
    expect(out.resolution.foreignChoice).toBeUndefined();
    expect(searches).toBe(before);
  });

  it("a chosen ruling with parallel reports asks for the report next, from the same records", async () => {
    const input = "Brown v. Board of Education";
    const { plan, data } = await lookup(input, [
      { ...BROWN_I, snippet: "Brown v. Board of Education, 347 U.S. 483, 74 S. Ct. 686 (1954)." }, BROWN_II,
    ]);
    const choice = terminal(resolveCitationResponse(plan, data, CHAT_HOST)).resolution.foreignChoice!;
    const brownI = choice.options.find((o) => o.label.includes("1954"))!;
    const step = selectForeignCaseChoice(choice, brownI.id, [input], CHAT_HOST);
    if (step.kind !== "resolved") throw new Error(step.kind);
    expect(step.resolution.citation).toBe("");
    const next = step.resolution.foreignChoice!;
    expect(next.stage).toBe("location");
    expect(next.options.map((o) => o.label)).toEqual(["347 U.S. 483", "74 S. Ct. 686"]);
    const sct = next.options.find((o) => o.label === "74 S. Ct. 686")!;
    const out = selectForeignCaseChoice(next, sct.id, [input], CHAT_HOST);
    if (out.kind !== "resolved") throw new Error(out.kind);
    expect(citationTextOnly(out.resolution.citation)).toBe("Brown v. Board of Education, 74 S. Ct. 686 (1954).");
    // An option from the earlier step is not accepted at this step.
    expect(selectForeignCaseChoice(next, brownI.id, [input], CHAT_HOST).kind).toBe("invalid");
  });
});

describe("choosing between parallel reports", () => {
  it("Donoghue v Stevenson: the chosen report is used, never mixed with the other", async () => {
    const input = "Donoghue v Stevenson";
    const { plan, data } = await lookup(input, [DONOGHUE]);
    const choice = terminal(resolveCitationResponse(plan, data, CHAT_HOST)).resolution.foreignChoice!;
    expect(choice.stage).toBe("location");
    expect(choice.options.map((o) => o.label)).toEqual(["[1932] AC 562", "1932 SC (HL) 31"]);
    const sc = choice.options[1];
    const out = selectForeignCaseChoice(choice, sc.id, [input], CHAT_HOST);
    if (out.kind !== "resolved") throw new Error(out.kind);
    const text = citationTextOnly(out.resolution.citation);
    expect(text).toContain("1932 SC (HL) 31");
    // Pre-2001: the database-assigned neutral citation is not added to a printed report.
    expect(text).not.toContain("UKHL 100");
    expect(text).not.toContain("AC 562");
  });

  it("Donoghue v Stevenson: choosing the official Law Reports gives [1932] AC 562 alone", async () => {
    const input = "Donoghue v Stevenson";
    const { plan, data } = await lookup(input, [DONOGHUE]);
    const choice = terminal(resolveCitationResponse(plan, data, CHAT_HOST)).resolution.foreignChoice!;
    const out = selectForeignCaseChoice(choice, choice.options[0].id, [input], CHAT_HOST);
    if (out.kind !== "resolved") throw new Error(out.kind);
    expect(citationTextOnly(out.resolution.citation)).toBe("Donoghue v Stevenson [1932] AC 562.");
  });
});

describe("a choice is bound to the original input", () => {
  it("is rejected after the input is edited", async () => {
    const input = "Donoghue v Stevenson";
    const { plan, data } = await lookup(input, [DONOGHUE]);
    const choice = terminal(resolveCitationResponse(plan, data, CHAT_HOST)).resolution.foreignChoice!;
    expect(selectForeignCaseChoice(choice, choice.options[0].id, ["Donoghue v Stevenson [1931]"], CHAT_HOST).kind).toBe("stale");
    expect(selectForeignCaseChoice(choice, choice.options[0].id, [], CHAT_HOST).kind).toBe("stale");
    // Whitespace-only differences still bind to the same input.
    expect(selectForeignCaseChoice(choice, choice.options[0].id, ["  Donoghue  v Stevenson "], CHAT_HOST).kind).toBe("resolved");
  });

  it("rejects an unknown option and a tampered record", async () => {
    const input = "Donoghue v Stevenson";
    const { plan, data } = await lookup(input, [DONOGHUE]);
    const choice = terminal(resolveCitationResponse(plan, data, CHAT_HOST)).resolution.foreignChoice!;
    expect(selectForeignCaseChoice(choice, "UK|ac|1932||999", [input], CHAT_HOST).kind).toBe("invalid");
    const fl = structuredClone(data.foreignLookup) as { caseDecisions: Array<{ locations: Array<{ firstPage: string }> }> };
    fl.caseDecisions[0].locations[0].firstPage = "563"; // id no longer names the record
    expect(buildForeignCaseChoice(plan, fl, undefined, "location")).toBeNull();
  });

  it("is offered only in chat; batch and bibliography keep the text list", async () => {
    const input = "Donoghue v Stevenson";
    const { plan, data } = await lookup(input, [DONOGHUE]);
    const r = terminal(resolveCitationResponse(plan, data, RUNNER_HOST));
    expect(r.origin).toBe("disambiguation");
    expect(r.resolution.foreignChoice).toBeUndefined();
  });

  it("an Israeli citation never produces a foreign choice", () => {
    const plan = planFor('ע"א 240/95 פלוני נ\' אלמוני');
    expect(plan.foreignLookup?.kind).not.toBe("case");
  });
});

describe("conflicting reports are never offered", () => {
  it("drops a reporter whose own records disagree from the choice list", () => {
    const loc = (id: string, reporter: string, firstPage: string, yearStyle = "square") =>
      ({ id, jurisdiction: "UK", reporter, firstPage, volumeYear: "1932", yearStyle, sourceUrl: "https://www.bailii.org/a" });
    const base = { locationChoiceRequired: true, caseDecisions: [{ jurisdiction: "UK", locations: [
      loc("a", "AC", "562"), loc("b", "AC", "563"), loc("c", "SC (HL)", "31", "none"), loc("d", "All ER Rep", "1"),
    ] }] };
    expect(readLocationChoice(base, "UK")?.map((o) => o.label)).toEqual(["1932 SC (HL) 31", "[1932] All ER Rep 1"]);
  });
});

describe("rulings found without a stated country", () => {
  it("a pasted case name with two tied rulings gets record-bound options", async () => {
    const input = "Brown v. Board of Education";
    const plan = planFor(input);
    expect(plan.foreignLookup?.jurisdiction).toBe("UNKNOWN");
    const { data } = await lookup(input, [BROWN_I, BROWN_II]);
    const fl = data.foreignLookup as { caseDecisions?: unknown[]; jurisdiction?: string };
    expect(fl.caseDecisions).toHaveLength(2);
    expect(fl.jurisdiction).toBe("US");
  });
});
