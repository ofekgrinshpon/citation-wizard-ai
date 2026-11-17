/**
 * Stage 3 of the foreign free-form plan — record-bound choices for foreign
 * rulings. Mocked search only; choosing never searches again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { readLocationChoice } from "../../supabase/functions/_shared/citationPure/caseLocations";
import { CHAT_HOST, WORD_HOST, RUNNER_HOST, planCitationEvidence, planLocalCitation, planTypedRequest, resolveCitationResponse, selectForeignCaseChoice } from "@/lib/citationPlanner";
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

describe("partial UK neutral completion", () => {
  for (const caps of [CHAT_HOST, WORD_HOST, RUNNER_HOST]) {
    for (const [name, year, number] of [["R v Jogee", "2016", "8"], ["R (Miller) v The Prime Minister", "2019", "41"]]) {
      it(`completes ${name} for ${JSON.stringify(caps)}`, async () => {
        const raw = `${name} [${year}] UKSC`;
        const item = { title: `${name} [${year}] UKSC ${number}`, snippet: `${name} [${year}] UKSC ${number}.`, url: `https://www.bailii.org/uk/cases/UKSC/${year}/${number}.html` };
        const { plan, data } = await lookup(raw, [item]);
        const r = terminal(resolveCitationResponse(plan, data, caps));
        expect(citationTextOnly(r.resolution.citation)).toBe(`${name} [${year}] UKSC ${number}.`);
      });
    }
  }
});
describe("partial UK record binding", () => {
  const raw = "R (Miller) v The Prime Minister [2019] UKSC";
  const item = (n: string) => ({ title: `R (Miller) v The Prime Minister [2019] UKSC ${n}`, snippet: `R (Miller) v The Prime Minister [2019] UKSC ${n}.`, url: `https://www.bailii.org/uk/cases/UKSC/2019/${n}.html` });
  for (const caps of [CHAT_HOST, WORD_HOST]) it("applies only a bound choice without extra I/O", async () => {
    // 42 is a synthetic ambiguity fixture, not a claim about the real case.
    const { plan, data } = await lookup(raw, [item("41"), item("42")]);
    const choice = terminal(resolveCitationResponse(plan, data, caps)).resolution.foreignChoice!;
    const option = choice.options.find(o => o.label.includes("41"))!;
    const before = searches;
    const out = selectForeignCaseChoice(choice, option.id, [raw], caps);
    expect(out.kind).toBe("resolved");
    if (out.kind === "resolved") expect(citationTextOnly(out.resolution.citation)).toBe("R (Miller) v The Prime Minister [2019] UKSC 41.");
    expect(searches).toBe(before);
    expect(selectForeignCaseChoice(choice, option.id, [raw + " edited"], caps).kind).toBe("stale");
  });
  it("does not fill from the wrong year", async () => {
    const bad = { title: "R v Jogee [2017] UKSC 8", snippet: "R v Jogee [2017] UKSC 8.", url: "https://www.bailii.org/uk/cases/UKSC/2017/8.html" };
    const { plan, data } = await lookup("R v Jogee [2016] UKSC", [bad]);
    const r = terminal(resolveCitationResponse(plan, data, CHAT_HOST));
    expect(citationTextOnly(r.resolution.citation)).not.toContain("[2017]");
    expect(citationTextOnly(r.resolution.citation)).not.toContain("UKSC 8");
  });
});
