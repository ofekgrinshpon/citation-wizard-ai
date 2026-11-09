/**
 * Bounded AU/CA online completion — offline tests only (mocked search, no live provider).
 * Rules under test (from the approved plan):
 *  - only the six AU/CA templates complete; supplied values are never replaced;
 *  - a field is used only from a record bound to both party names, per template, never mixed;
 *  - several rulings / parallel reports → the user chooses (no automatic priority);
 *  - "(2010) 5 SCC 1" is not Canadian; an unclear country is asked, never guessed;
 *  - at most two searches, no page reading, no retry after an uncertain send.
 */
import { describe, expect, it, vi } from "vitest";
import {
  acceptCountryResponse, countryCues, countryPlanFromRaw, extractCountryChains, bindCountryChains, filterCountryDecisions,
  groupCountryDecisions, planCountryLookup, type CountryLookupRequest,
} from "../../supabase/functions/_shared/citationPure/countryLookup";
import { parseCountryLocal } from "../../supabase/functions/_shared/citationPure/countryLocal";
import { resolveCountryLookup, validateCountryRequest } from "../../supabase/functions/citation-chat/countryRoute";
import { citationRecoveryInput, citationRecoveryResult } from "../../supabase/functions/_shared/citationRecovery";
import { guardPastedCitationRequest } from "../../supabase/functions/_shared/pastedCitation";
import { CHAT_HOST, RUNNER_HOST, planCapabilityGate, planCitationEvidence, planTypedRequest, resolveCitationResponse, selectForeignCaseChoice } from "@/lib/citationPlanner";
import { citationManualChoice } from "@/lib/pastedCitationAdapter";
import { countryQuestionCurrent } from "@/lib/countryQuestion";
import { citationToPlain } from "@/lib/citationRichText";

const AU_CHOICE = citationManualChoice("foreign_case_other", "t2:australia");
const CA_CHOICE = citationManualChoice("foreign_case_other", "t2:canada");

function plan(raw: string, manual: ReturnType<typeof citationManualChoice> = null) {
  const r = planCountryLookup(parseCountryLocal(raw, manual), raw);
  if (r?.kind !== "lookup") throw new Error(`no lookup for ${raw}`);
  return r.request;
}

type Hit = { url: string; title?: string; snippet?: string };
function searchMock(rounds: Hit[][]) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    const results = rounds[calls.length - 1] ?? [];
    return new Response(JSON.stringify({ results }), { status: 200 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}
const lookup = (request: CountryLookupRequest, rounds: Hit[][]) => {
  const s = searchMock(rounds);
  return resolveCountryLookup(request, { apiKey: "offline", fetchImpl: s.fetchImpl }).then((r) => ({ r, calls: s.calls }));
};

describe("country cues come from the full citation form", () => {
  it.each([
    ["Mabo v Queensland (No 2) [1992] HCA 23", "AU"],
    ["Mabo v Queensland (1992) 175 CLR 1", "AU"],
    ["Racial Discrimination Act 1975 (Cth)", "AU"],
    ["R v Jordan, 2016 SCC 27", "CA"],
    ["R v Oakes, [1986] 1 SCR 103", "CA"],
    ["Criminal Code, R.S.C. 1985, c C-46", "CA"],
    ["State of Punjab v Davinder Singh (2010) 5 SCC 1", "ambiguous"],
    ["X v Y 2021 SCC OnLine SC 1", "ambiguous"],
    ["Mabo v Queensland", "none"],
    ["SCC Holdings v. Cedar", "none"],
  ])("%s → %s", (raw, cue) => expect(countryCues(raw)).toBe(cue));

  it("an Indian SCC form with an explicit Canada choice is blocked, never searched", () => {
    const raw = "State of Punjab v Davinder Singh (2010) 5 SCC 1";
    expect(planCountryLookup(parseCountryLocal(raw, CA_CHOICE), raw)).toEqual({ kind: "blocked", reason: "country_form_conflict" });
  });
});

describe("which incomplete inputs may ask for completion", () => {
  it.each([
    ["Mabo v Queensland (No 2) [1992] HCA 23", null, { caseName: "Mabo v Queensland (No 2)", neutralYear: "1992", court: "HCA", neutralNumber: "23" }],
    ["Wattle v Harbour [2020] FCA", null, { caseName: "Wattle v Harbour", neutralYear: "2020", court: "FCA" }],
    ["Mabo v Queensland", AU_CHOICE, { caseName: "Mabo v Queensland" }],
    ["R v Jordan, 2016 SCC", null, { caseName: "R v Jordan", neutralYear: "2016" }],
    ["Maple v. Cedar, [2020] 2 S.C.R.", null, { caseName: "Maple v. Cedar", reporterYear: "2020", reporterVolume: "2", reporter: "S.C.R." }],
    ["Racial Discrimination Act (Cth)", null, { statuteName: "Racial Discrimination Act", code: "Cth" }],
    ["Criminal Code, R.S.C. 1985", null, { statuteName: "Criminal Code", code: "R.S.C.", revisionYear: "1985" }],
  ])("%s asks with exactly the supplied fields", (raw, manual, fields) => {
    expect(plan(raw, manual).parsedFields).toEqual(fields);
  });
  it.each([
    ["Mabo v Queensland", null],                                  // no country evidence or choice
    ["Wattle v Harbour [2020] FCAFC 123", null],                  // Full Court: out of scope
    ["Maple v. Cedar, 2020 CanLII 12", null],                     // CanLII identifier: out of scope
    ["Maple v. Cedar, [1974] 2 SCR 100", null],                   // pre-1975 S.C.R.
    ["Wattle v Harbour [2020] HCA 1 (4 March 2020), No. 22", null], // unread tail
    ["Wattle v Harbour [2020] HCA 1 (4 March 2020)", null],       // already complete
  ])("%s never searches", (raw, manual) => {
    const r = planCountryLookup(parseCountryLocal(raw, manual), raw);
    expect(r?.kind === "lookup").toBe(false);
  });
});

describe("records: bound to both parties, grouped by decision, never mixed", () => {
  const hasParty = (t: string, which: 0 | 1) => (which === 0 ? /mabo/i : /queensland/i).test(t);
  it("one AustLII title yields the neutral record (with its own date) and the CLR report as two options of one decision", () => {
    const text = "Mabo v Queensland (No 2) [1992] HCA 23; (1992) 175 CLR 1 (3 June 1992)";
    const chains = extractCountryChains(text, "AU");
    expect(bindCountryChains(text, chains, hasParty, false)).toEqual([true]);
    const { decisions } = groupCountryDecisions(chains.map((chain) => ({ chain, source: { url: "https://www.austlii.edu.au/x", title: text, basis: "structured_metadata" } })), "AU");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].options.map((o) => o.label).sort()).toEqual(["(1992) 175 CLR 1", "[1992] HCA 23 (3 June 1992)"]);
  });
  it("a chain after a different caption is not bound to the target case", () => {
    const text = "Mabo v Queensland was distinguished in Wik Peoples v Queensland (1996) 187 CLR 1";
    const chains = extractCountryChains(text, "AU");
    expect(bindCountryChains(text, chains, hasParty, false)).toEqual([false]);
  });
  it("the same neutral record with two different dates is dropped, not guessed", () => {
    const src = (t: string) => ({ chain: extractCountryChains(t, "AU")[0], source: { url: "https://www.austlii.edu.au/x", title: t, basis: "structured_metadata" } });
    const { decisions, conflicts } = groupCountryDecisions([src("[1992] HCA 23 (3 June 1992)"), src("[1992] HCA 23 (4 June 1992)")], "AU");
    expect(decisions).toHaveLength(0); expect(conflicts.some((c) => c.startsWith("decisionDate:"))).toBe(true);
  });
  it("supplied details filter records; a supplied neutral form keeps only neutral options", () => {
    const t = "[1992] HCA 23; (1992) 175 CLR 1 (3 June 1992)";
    const { decisions } = groupCountryDecisions([{ chain: extractCountryChains(t, "AU")[0], source: { url: "https://www.hcourt.gov.au/x", basis: "official_record" } }], "AU");
    expect(filterCountryDecisions(decisions, { neutralYear: "1992", court: "HCA" })[0].options.map((o) => o.templateId)).toEqual(["au.case.neutral"]);
    expect(filterCountryDecisions(decisions, { neutralYear: "1993" })).toEqual([]);
  });
});

describe("server lookup (mocked search only)", () => {
  it("AU neutral: fills only the missing number and date from an identity-matched official record", async () => {
    const req = plan("Wattle v Harbour [2020] FCA");
    const { r, calls } = await lookup(req, [[{ url: "https://www.judgments.fedcourt.gov.au/judgments/fca/2020/123", title: "Wattle v Harbour [2020] FCA 123 (4 March 2020)" }]]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.perplexity.ai/search");
    expect(r.fields).toEqual({ neutralNumber: "123", decisionDate: "4 March 2020" });
    const a = acceptCountryResponse(req, req.rawInput, r);
    expect(a.kind).toBe("done");
    if (a.kind === "done") expect(citationToPlain(a.citation)).toBe("Wattle v Harbour [2020] FCA 123 (4 March 2020) (Austl.).");
  });
  it("AU reported: CLR record from a search-result title completes the citation", async () => {
    const req = plan("Mabo v Queensland (1992) 175 CLR");
    const { r } = await lookup(req, [[{ url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html", title: "Mabo v Queensland (No 2) [1992] HCA 23; (1992) 175 CLR 1 (3 June 1992)" }]]);
    const a = acceptCountryResponse(req, req.rawInput, r);
    expect(a.kind === "done" && citationToPlain(a.citation)).toBe("Mabo v Queensland (1992) 175 CLR 1 (Austl.).");
  });
  it("AU bare caption with an Australia choice: neutral and CLR of one ruling → location choice", async () => {
    const req = plan("Mabo v Queensland", AU_CHOICE);
    const { r } = await lookup(req, [[{ url: "https://www.austlii.edu.au/x", title: "Mabo v Queensland (No 2) [1992] HCA 23; (1992) 175 CLR 1 (3 June 1992)" }]]);
    const a = acceptCountryResponse(req, req.rawInput, r);
    expect(a.kind).toBe("choice");
    if (a.kind === "choice") { expect(a.stage).toBe("location"); expect(a.decisions[0].options).toHaveLength(2); }
  });
  it("two different rulings with the same caption → decision choice", async () => {
    const req = plan("Mabo v Queensland", AU_CHOICE);
    const { r } = await lookup(req, [[
      { url: "https://www.austlii.edu.au/a", title: "Mabo v Queensland [1988] HCA 69; (1988) 166 CLR 186 (8 December 1988)" },
      { url: "https://www.austlii.edu.au/b", title: "Mabo v Queensland (No 2) [1992] HCA 23; (1992) 175 CLR 1 (3 June 1992)" },
    ]]);
    const a = acceptCountryResponse(req, req.rawInput, r);
    expect(a.kind === "choice" && a.stage).toBe("decision");
  });
  it("party mismatch: a record for other parties is never used (one open-web retry, then nothing)", async () => {
    const req = plan("Wattle v Harbour [2020] FCA");
    const { r, calls } = await lookup(req, [[{ url: "https://www.judgments.fedcourt.gov.au/x", title: "Smith v Jones [2020] FCA 123 (4 March 2020)" }], []]);
    expect(calls).toHaveLength(2); expect(calls[1].body.search_domain_filter).toBeUndefined();
    expect(r.identity.matched).toBe(false); expect(r.fields).toEqual({});
    expect(acceptCountryResponse(req, req.rawInput, r)).toEqual({ kind: "fail", reason: "not_found" });
  });
  it("a weak host is a discovery hint only and never grounds a field", async () => {
    const req = plan("Wattle v Harbour [2020] FCA");
    const { r } = await lookup(req, [[{ url: "https://lawblog.example.com/x", title: "Wattle v Harbour [2020] FCA 123 (4 March 2020)" }], []]);
    expect(r.fields).toEqual({});
  });
  it("CA neutral + S.C.R. parallel in one chain; supplied neutral year kept", async () => {
    const req = plan("R v Jordan, 2016 SCC");
    const { r } = await lookup(req, [[{ url: "https://scc-csc.lexum.com/scc-csc/scc-csc/en/item/16057/index.do", title: "R. v. Jordan, 2016 SCC 27, [2016] 1 S.C.R. 631" }]]);
    const a = acceptCountryResponse(req, req.rawInput, r);
    expect(a.kind === "done" && citationToPlain(a.citation)).toBe("R v Jordan, 2016 SCC 27, [2016] 1 S.C.R. 631 (Can.).");
  });
  it("CA S.C.R. only (CanLII search result): first page completes; CanLII id is not used", async () => {
    const req = plan("R v Oakes, [1986] 1 S.C.R.");
    const { r } = await lookup(req, [[{ url: "https://www.canlii.org/en/ca/scc/doc/1986/1986canlii46/1986canlii46.html", title: "R. v. Oakes, 1986 CanLII 46 (SCC), [1986] 1 SCR 103" }]]);
    const a = acceptCountryResponse(req, req.rawInput, r);
    expect(a.kind === "done" && citationToPlain(a.citation)).toBe("R v Oakes, [1986] 1 S.C.R. 103 (Can.).");
  });
  it("AU statute: Act year only from a legislation.gov.au Act page whose title is the same Act", async () => {
    const req = plan("Racial Discrimination Act (Cth)");
    const { r } = await lookup(req, [[
      { url: "https://www.legislation.gov.au/C2004A00274/latest/text", title: "Racial Discrimination Act 1975" },
      { url: "https://www.legislation.gov.au/C2004A05000/latest/text", title: "Racial Discrimination Amendment Act 1983" },
    ]]);
    const a = acceptCountryResponse(req, req.rawInput, r);
    expect(a.kind === "done" && citationToPlain(a.citation)).toBe("Racial Discrimination Act 1975 (Cth) (Austl.).");
  });
  it("CA statute: chapter must match the Justice Laws page; a conflicting supplied year stops", async () => {
    const ok = plan("Criminal Code, R.S.C. 1985");
    const hit = { url: "https://laws-lois.justice.gc.ca/eng/acts/C-46/", title: "Criminal Code (R.S.C., 1985, c. C-46)" };
    const a = acceptCountryResponse(ok, ok.rawInput, (await lookup(ok, [[hit]])).r);
    expect(a.kind === "done" && citationToPlain(a.citation)).toBe("Criminal Code, R.S.C. 1985, c C-46 (Can.).");
    const bad = plan("Criminal Code, R.S.C. 1970");
    const r = (await lookup(bad, [[hit], [hit]])).r;
    expect(r.identity.conflicts).toContain("conflicting_statute_record");
    expect(acceptCountryResponse(bad, bad.rawInput, r)).toEqual({ kind: "fail", reason: "conflict" });
  });
  it("an uncertain send is never followed by another search", async () => {
    const req = plan("Wattle v Harbour [2020] FCA");
    const fetchImpl = vi.fn(async () => { throw new Error("network cut"); });
    const r = await resolveCountryLookup(req, { apiKey: "offline", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(r.error).toBe("lookup_failed");
  });
  it("forged requests are refused: widened fields, other country, complete input", () => {
    const req = plan("Wattle v Harbour [2020] FCA");
    expect(validateCountryRequest(req)).toEqual(req);
    expect(validateCountryRequest({ ...req, parsedFields: { ...req.parsedFields, neutralNumber: "999" } })).toBeNull();
    expect(validateCountryRequest({ ...req, jurisdiction: "CA" })).toBeNull();
    expect(validateCountryRequest({ ...req, rawInput: "Wattle v Harbour [2020] FCA 1 (4 March 2020)", parsedFields: {} })).toBeNull();
    expect(validateCountryRequest({ ...req, extra: true })).toBeNull();
  });
  it("the server guard passes only the exact plan for the same country", () => {
    const raw = "Wattle v Harbour [2020] FCA";
    const req = plan(raw);
    expect(guardPastedCitationRequest({ messages: [{ role: "user", content: raw }], rawInput: raw, foreignLookup: req }).route).toBe("foreign");
    const forged = guardPastedCitationRequest({ messages: [{ role: "user", content: raw }], rawInput: raw, foreignLookup: { ...req, parsedFields: { caseName: "Other v Party" } } });
    expect(forged.route).toBe("preserve"); expect(forged.conflicts).toContain("country_lookup_out_of_scope");
  });
});

describe("client acceptance never replaces supplied values", () => {
  it("a response that changes a supplied field fails closed", () => {
    const req = plan("Wattle v Harbour [2020] FCA");
    const res = { kind: "case", jurisdiction: "AU", fields: { neutralYear: "2021", neutralNumber: "1", decisionDate: "1 May 2021" },
      grounded: { neutralYear: true, neutralNumber: true, decisionDate: true }, provenance: {}, sources: [],
      identity: { matched: true, anchors: [], conflicts: [], jurisdiction: "AU" }, diagnostics: {} };
    expect(acceptCountryResponse(req, req.rawInput, res)).toEqual({ kind: "fail", reason: "conflict" });
  });
  it("an ungrounded or unsourced field is not used", () => {
    const req = plan("Wattle v Harbour [2020] FCA");
    const res = { kind: "case", jurisdiction: "AU", fields: { neutralNumber: "1", decisionDate: "1 May 2020" }, grounded: { neutralNumber: true },
      provenance: {}, sources: [], identity: { matched: true, anchors: [], conflicts: [], jurisdiction: "AU" }, diagnostics: {} };
    expect(acceptCountryResponse(req, req.rawInput, res).kind).toBe("fail");
  });
  it("a different country in the response is a binding failure", () => {
    const req = plan("Wattle v Harbour [2020] FCA");
    expect(acceptCountryResponse(req, req.rawInput, { kind: "case", jurisdiction: "CA", identity: { matched: true, conflicts: [] } })).toEqual({ kind: "fail", reason: "binding" });
  });
});

describe("asking for the country instead of guessing", () => {
  it("an Indian-style SCC case asks with no IO, in the capability gate", () => {
    const raw = "State of Punjab v Davinder Singh (2010) 5 SCC 1";
    const gate = planCapabilityGate({ evidence: planCitationEvidence(raw, null), sourceType: "foreign_case_other", input: raw, isPinpoint: false, manual: false });
    expect(gate?.resolution.countryQuestion?.reason).toBe("ambiguous_form");
    expect(gate?.resolution.countryQuestion?.options.map((o) => o.id)).toEqual(["us", "uk", "ca", "au", "other"]);
    expect(citationToPlain(gate!.resolution.citation)).toBe(raw);
  });
  it("2004 SCC 47 is Canadian (no question)", () => {
    const raw = "Haida Nation v British Columbia, 2004 SCC 47";
    const gate = planCapabilityGate({ evidence: planCitationEvidence(raw, null), sourceType: "foreign_case_other", input: raw, isPinpoint: false, manual: false });
    expect(gate?.resolution.countryQuestion).toBeUndefined();
  });
  const unmatched = { kind: "case", jurisdiction: "UNKNOWN", fields: {}, grounded: {}, provenance: {}, sources: [],
    identity: { matched: false, anchors: [], conflicts: [] }, diagnostics: { tier1Queried: true, tier2Fired: true } };
  const unknownPlan = (raw: string) => {
    const evidence = planCitationEvidence(raw, null);
    return planTypedRequest({ evidence, sourceType: "foreign_case_other", input: raw, isPinpoint: false, manual: false, statutePrep: null, canonicalRaw: raw }, CHAT_HOST);
  };
  it("Mabo v Queensland: an ungrounded US/UK search asks the country in chat instead of returning an unrelated record", () => {
    const p = unknownPlan("Mabo v Queensland");
    expect(p.foreignLookup).toMatchObject({ jurisdiction: "UNKNOWN" });
    const r = resolveCitationResponse(p, { foreignLookup: unmatched }, CHAT_HOST);
    expect(r.kind === "terminal" && r.resolution.countryQuestion?.reason).toBe("not_found");
    expect(r.kind === "terminal" && citationToPlain(r.resolution.citation)).toBe("Mabo v Queensland");
  });
  it("hosts without the question buttons keep the existing warning", () => {
    const r = resolveCitationResponse(unknownPlan("Mabo v Queensland"), { foreignLookup: unmatched }, RUNNER_HOST);
    expect(r.kind === "terminal" && r.resolution.countryQuestion).toBeUndefined();
  });
  it("editing the input cancels the question", () => {
    const raw = "State of Punjab v Davinder Singh (2010) 5 SCC 1";
    const q = planCapabilityGate({ evidence: planCitationEvidence(raw, null), sourceType: "foreign_case_other", input: raw, isPinpoint: false, manual: false })!.resolution.countryQuestion!;
    expect(countryQuestionCurrent(q, raw)).toBe(true);
    expect(countryQuestionCurrent(q, `${raw} 7`)).toBe(false);
  });
  it("after an explicit Australia choice the same caption plans one AU request (and no question)", () => {
    const raw = "Mabo v Queensland";
    const evidence = planCitationEvidence(raw, AU_CHOICE);
    const p = planTypedRequest({ evidence, sourceType: "foreign_case_other", input: raw, isPinpoint: false, manual: true, statutePrep: null, canonicalRaw: raw }, CHAT_HOST);
    expect(p.foreignLookup).toEqual({ enabled: true, kind: "case", jurisdiction: "AU", rawInput: raw, parsedFields: { caseName: raw } });
  });
});

describe("record-bound AU/CA choice in the app (no IO)", () => {
  it("choosing a parallel report renders only that record; an edited input is stale", async () => {
    const raw = "Mabo v Queensland";
    const evidence = planCitationEvidence(raw, AU_CHOICE);
    const p = planTypedRequest({ evidence, sourceType: "foreign_case_other", input: raw, isPinpoint: false, manual: true, statutePrep: null, canonicalRaw: raw }, CHAT_HOST);
    const { r } = await lookup(p.foreignLookup as unknown as CountryLookupRequest, [[{ url: "https://www.austlii.edu.au/x", title: "Mabo v Queensland (No 2) [1992] HCA 23; (1992) 175 CLR 1 (3 June 1992)" }]]);
    const res = resolveCitationResponse(p, { foreignLookup: r }, CHAT_HOST);
    if (res.kind !== "terminal" || !res.resolution.foreignChoice) throw new Error("expected a choice");
    const choice = res.resolution.foreignChoice;
    expect(choice.stage).toBe("location");
    const clr = choice.options.find((o) => o.label.includes("CLR"))!;
    expect(selectForeignCaseChoice(choice, clr.id, ["Mabo v Queensland v2"], CHAT_HOST)).toEqual({ kind: "stale" });
    const out = selectForeignCaseChoice(choice, clr.id, [raw], CHAT_HOST);
    expect(out.kind === "resolved" && citationToPlain(out.resolution.citation)).toBe("Mabo v Queensland (1992) 175 CLR 1 (Austl.).");
  });
});

describe("saved-request contract accepts the AU/CA wire (runtime validator)", () => {
  it("request and grounded result pass the closed recovery validators", async () => {
    const req = plan("Wattle v Harbour [2020] FCA");
    expect(citationRecoveryInput({ messages: [{ role: "user", content: req.rawInput }], rawInput: req.rawInput, foreignLookup: req, batchId: null })).not.toBeNull();
    const { r } = await lookup(req, [[{ url: "https://www.judgments.fedcourt.gov.au/x", title: "Wattle v Harbour [2020] FCA 123 (4 March 2020)" }]]);
    expect(citationRecoveryResult({ content: "", foreignLookup: r })).not.toBeNull();
  });
  it("countryPlanFromRaw re-derives the same plan as the client", () => {
    const raw = "Criminal Code, R.S.C. 1985";
    expect(countryPlanFromRaw(raw, "CA", "statute")).toEqual({ kind: "lookup", request: plan(raw) });
  });
});
