/**
 * English party names typed in lowercase are capitalized in foreign case
 * citations; when the chosen record's verified title spells the same words,
 * its casing is used. Words never change, only letter case. Mocked search only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { adoptVerifiedCasing, capitalizeCaseName } from "../../supabase/functions/_shared/citationPure/caseNameCase";
import { renderUkCase, renderUsCase } from "../../supabase/functions/_shared/citationPure/render";
import { CHAT_HOST, planCitationEvidence, planLocalCitation, planTypedRequest, resolveCitationResponse, selectForeignCaseChoice } from "@/lib/citationPlanner";
import { citationTextOnly } from "@/lib/citationSegments";

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); })); });

describe("lowercase party names get capitals", () => {
  it("capitalizes each party word, keeps small words and v. lowercase", () => {
    expect(capitalizeCaseName("brown v. board of education")).toBe("Brown v. Board of Education");
    expect(capitalizeCaseName("r v jogee")).toBe("R v Jogee");
    expect(capitalizeCaseName("united states ex rel. smith v. jones")).toBe("United States ex rel. Smith v. Jones");
    expect(capitalizeCaseName("in re gault")).toBe("In re Gault");
  });
  it("writes company designators in capitals", () => {
    expect(capitalizeCaseName("capitol records, llc v. vimeo, llc")).toBe("Capitol Records, LLC v. Vimeo, LLC");
  });
  it("leaves words that already have a capital as typed", () => {
    expect(capitalizeCaseName("eBay Inc. v. MercExchange, L.L.C.")).toBe("eBay Inc. v. MercExchange, L.L.C.");
    expect(capitalizeCaseName("capitol records v. reDigi")).toBe("Capitol Records v. reDigi");
  });
  it("does not touch Hebrew names", () => {
    expect(capitalizeCaseName("קול העם נ' שר הפנים")).toBe("קול העם נ' שר הפנים");
  });
  it("applies in US and UK case citations", () => {
    expect(citationTextOnly(renderUsCase({ caseName: "brown v. board of education", volume: "347", reporter: "U.S.", firstPage: "483", year: "1954" }).citation))
      .toBe("Brown v. Board of Education, 347 U.S. 483 (1954).");
    expect(citationTextOnly(renderUkCase({ caseName: "r v jogee", year: "2016", neutral: "UKSC 8" }).citation)).toBe("R v Jogee [2016] UKSC 8.");
  });
});

describe("casing from the verified record title", () => {
  it("uses the title's casing for the same words", () => {
    expect(adoptVerifiedCasing("capitol records, llc v. reDigi inc.", ["Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)"]))
      .toBe("Capitol Records, LLC v. ReDigi Inc.");
  });
  it("never adds or removes words: a shorter title still only recases", () => {
    expect(adoptVerifiedCasing("capitol records, llc v. redigi inc.", ["Capitol Records v. ReDigi - Casetext"]))
      .toBe("Capitol Records, llc v. ReDigi inc.");
  });
  it("ignores titles that miss a party word, are in all capitals, or would lower a typed capital", () => {
    expect(adoptVerifiedCasing("capitol records v. vimeo", ["Capitol Records, LLC v. ReDigi Inc."])).toBeNull();
    expect(adoptVerifiedCasing("capitol records v. redigi", ["CAPITOL RECORDS, LLC v. REDIGI INC."])).toBeNull();
    expect(adoptVerifiedCasing("Capitol Records v. ReDigi", ["capitol records v redigi"])).toBeNull();
  });
});

describe("after choosing a ruling", () => {
  it("capitol records v. reDigi: the chosen record's title fixes the casing, nothing else changes", async () => {
    const input = "capitol records, llc v. reDigi inc.";
    const evidence = planCitationEvidence(input, null);
    const p = { evidence, sourceType: null, input, isPinpoint: false, manual: false };
    const local = planLocalCitation(p, CHAT_HOST);
    const plan = planTypedRequest({ ...p, statutePrep: "statutePrep" in local ? local.statutePrep : null, canonicalRaw: input }, CHAT_HOST);
    expect(plan.foreignLookup?.kind).toBe("case");
    const items = [
      { title: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)", url: "https://www.courtlistener.com/opinion/4547155/", snippet: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)." },
      { title: "Capitol Records, LLC v. ReDigi Inc., 934 F. Supp. 2d 640 (S.D.N.Y. 2013)", url: "https://casetext.com/case/capitol-records-llc-v-redigi-inc", snippet: "Capitol Records, LLC v. ReDigi Inc., 934 F. Supp. 2d 640 (S.D.N.Y. 2013)." },
    ];
    const fetchImpl = (async (url: unknown) => String(url).includes("perplexity.ai")
      ? new Response(JSON.stringify({ results: items }), { status: 200 }) : new Response("nf", { status: 404 })) as unknown as typeof fetch;
    const response = await runForeignLookup({ ...plan.foreignLookup!, rawInput: input } as ForeignLookupInput, { fetchImpl, apiKey: "offline-only" });
    const r = resolveCitationResponse(plan, { foreignLookup: response }, CHAT_HOST);
    if (r.kind !== "terminal") throw new Error("not terminal");
    const choice = r.resolution.foreignChoice!;
    expect(choice.stage).toBe("decision");
    const appeal = choice.options.find((o) => o.label.includes("F.3d"))!;
    const out = selectForeignCaseChoice(choice, appeal.id, [input], CHAT_HOST);
    if (out.kind !== "resolved") throw new Error(out.kind);
    expect(citationTextOnly(out.resolution.citation)).toBe("Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018).");
  });
});
