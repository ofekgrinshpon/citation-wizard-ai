import { describe, expect, it, vi } from "vitest";
import { acquireScottishRecord } from "../../supabase/functions/citation-chat/scottishRecordRoute";
import outer from "./fixtures/scotland/outer.txt?raw";
import merits from "./fixtures/scotland/merits.txt?raw";
import expenses from "./fixtures/scotland/expenses.txt?raw";

const origin = "https://www.scotcourts.gov.uk/media/";
const actual = [
  ["[2023] CSOH 28", origin+"itomvyqk/court-of-session-centenary-6-limited-against-tlt-llp-05-may-2023.pdf", outer, "5 May 2023"],
  ["[2024] CSIH 13", origin+"yaxjurel/2024csih13-centenary-6-limited-against-tlt-llp.pdf", merits, "4 June 2024"],
  ["[2024] CSIH 29", origin+"5skivb2d/2024csih29.pdf", expenses, "19 September 2024"],
];
const pdf = () => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } });
function deps(text: string, truncated = false) {
  const fetch = vi.fn(async () => pdf());
  const extract = vi.fn(async () => ({
    text, pages: [{ page: 1, status: "read" as const, start: 0, end: text.length, truncated }],
    stopped_reason: "document_end" as const, total_pages: 1, pages_attempted: 1, pages_extracted: 1,
    first_page_extracted: 1, last_page_extracted: 1, chars_extracted: text.length, latency_ms: 5,
  }));
  return { fetch, extract };
}
describe("Scottish Court of Session exact-neutral PDF acquisition", () => {
  it.each(actual)("reads %s only from original page one", async (id, url, extracted, date) => {
    const d = deps(extracted);
    expect(await acquireScottishRecord(id,url,d)).toEqual({
      identifier:id, caption:"CENTENARY 6 LIMITED v TLT LLP", date, docket:"CA29/21", sourceUrl:url,
    });
    expect(d.fetch).toHaveBeenCalledWith(new URL(url),expect.objectContaining({redirect:"error"}));
    expect(d.extract).toHaveBeenCalledWith(expect.any(Uint8Array),expect.objectContaining({maxPages:1}));
  });
  it("does not substitute another decision with the same docket and parties", async () => {
    expect(await acquireScottishRecord(actual[1][0],actual[1][1],deps(expenses+"\n[2024] CSIH 13"))).toBeNull();
    expect(await acquireScottishRecord(actual[1][0],actual[2][1],deps(merits))).toBeNull();
  });
  it("refuses unsupported text or an unofficial host before acquisition", async () => {
    const d = deps(merits);
    expect(await acquireScottishRecord("[2024] CSIH 13 at [68]",actual[1][1],d)).toBeNull();
    expect(await acquireScottishRecord(actual[1][0],actual[1][1].replace("gov.uk","gov.uk.example"),d)).toBeNull();
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it("refuses truncated extraction and non-PDF data", async () => {
    const d = deps(merits);
    expect(await acquireScottishRecord(actual[1][0],actual[1][1],deps(merits,true))).toBeNull();
    d.fetch.mockImplementation(async () => new Response("not a PDF",{headers:{"content-type":"application/pdf"}}));
    expect(await acquireScottishRecord(actual[1][0],actual[1][1],d)).toBeNull();
    expect(d.extract).not.toHaveBeenCalled();
  });
});

import { validateCitationInput } from "@/lib/citationInputValidation";
import { preparePastedCitation } from "@/lib/pastedCitationAdapter";
import { buildPastedCitation, guardPastedCitationRequest } from "../../supabase/functions/_shared/pastedCitation";
import { acceptCountryResponse } from "../../supabase/functions/_shared/citationPure/countryLookup";
import { createCitationBudget } from "../../supabase/functions/_shared/citationPure/freeformInterpret";
import { resolveCountryLookup, validateCountryRequest, isCountryLookupRequest } from "../../supabase/functions/citation-chat/countryRoute";
import { CHAT_HOST, RUNNER_HOST, planCitationEvidence, planTypedRequest, resolveCitationResponse } from "@/lib/citationPlanner";
import { citationRecoveryInput, citationRecoveryResult } from "../../supabase/functions/_shared/citationRecovery";

async function discover(input: string, candidates: Array<{url: string; title?: string; snippet?: string}>, extracted: string) {
  expect(validateCitationInput(input).valid).toBe(true);
  const request = preparePastedCitation(input).countryLookup!;
  expect(request).toBeTruthy();
  const messages = [{role:"user",content:input}];
  expect(guardPastedCitationRequest({messages,rawInput:input,foreignLookup:request}).route).toBe("foreign");
  expect(citationRecoveryInput({messages,rawInput:input,foreignLookup:request,batchId:null})).not.toBeNull();
  expect(validateCountryRequest(request)).toEqual(request);
  const d = deps(extracted);
  const fetch = vi.fn(async (target: URL | RequestInfo) => String(target).startsWith("https://api.perplexity.ai/") ?
    Response.json({results:candidates}) : pdf());
  const budget = createCitationBudget();
  const response = await resolveCountryLookup(request,{apiKey:"offline",fetchImpl:fetch,extractScottishPdf:d.extract,budget});
  return {request,response,budget,fetch,extract:d.extract};
}
it.each(actual)("finds %s by number in the chat and runner path",async(input,url,extracted)=>{
  const search = await discover(input,[{url:actual[2][1],snippet:input},{url,title:input}],extracted);
  expect(search.response.provenance.caseName).toMatchObject({sourceUrl:url,basis:"official_record"});
  expect(citationRecoveryResult({foreignLookup:search.response})).not.toBeNull();
  expect(search.budget.retrievals).toBe(2);
  expect(search.fetch).toHaveBeenCalledTimes(2);
  expect(String(search.fetch.mock.calls[1][0])).toBe(url);
  for(const host of [CHAT_HOST,RUNNER_HOST]){
    const evidence=planCitationEvidence(input,null);
    const typed=planTypedRequest({evidence,sourceType:"foreign_case_other",input,isPinpoint:false,manual:false,statutePrep:null,canonicalRaw:input},host);
    expect(typed.foreignLookup).toEqual(search.request);
    expect(resolveCitationResponse(typed,{foreignLookup:search.response},host)).toMatchObject({
      kind:"terminal",resolution:{citation:`##CENTENARY 6 LIMITED v TLT LLP## ${input}.`},
    });
  }
});
it("never trusts search fields or a non-judgment URL",async()=>{
  const input=actual[1][0];
  const first=await discover(input,[{url:"https://scotcourts.gov.uk/livestream/court-of-session/case-ca29-21/",title:input}],merits);
  expect(first.fetch).toHaveBeenCalledTimes(1);
  expect(first.extract).not.toHaveBeenCalled();
  expect(acceptCountryResponse(first.request,input,first.response)).toEqual({kind:"fail",reason:"not_found"});
  const second=await discover(input,[{url:actual[1][1],title:input}],expenses);
  expect(acceptCountryResponse(second.request,input,second.response)).toEqual({kind:"fail",reason:"not_found"});
});
it("preserves unread tails, rejects forged supplied fields and keeps UKSC generic",()=>{
  const input=actual[1][0];
  const r=preparePastedCitation(input).countryLookup!;
  for(const tail of [", paras 69–68",", paras 1–100"," [2024] CSIH 29",", 2024 S.L.T. 3"]){
    expect(preparePastedCitation(input+tail).countryLookup).toBeNull();
    expect(buildPastedCitation(input+tail).route).toBe("preserve");
  }
  expect(validateCountryRequest({...r,parsedFields:{...r.parsedFields,neutralNumber:"29"}})).toBeNull();
  expect(buildPastedCitation(input,{jurisdiction:"US"}).route).toBe("preserve");
  expect(isCountryLookupRequest({kind:"case",jurisdiction:"UK",rawInput:"R v Jogee [2016] UKSC 8",parsedFields:{court:"UKSC"}})).toBe(false);
});

it("does not accept cached fields bound to another decision", async()=>{
  const input = actual[1][0];
  const search = await discover(input,[{url:actual[1][1],title:input}],merits);
  const response = {...search.response, identity:{...search.response.identity,anchors:[actual[2][0]]}};
  expect(acceptCountryResponse(search.request,input,response)).toEqual({kind:"fail",reason:"binding"});
});

import meritsPages from "./fixtures/scotland/merits-paragraphs.json";
import expensesPages from "./fixtures/scotland/expenses-paragraphs.json";
function paged(pages: string[], breakPage?: number) {
  return vi.fn(async (_bytes: Uint8Array, opts: {startPage?:number;maxPages:number}) => {
    const start = opts.startPage ?? 1;
    const selected = pages.slice(start-1,start-1+opts.maxPages);
    let text = "";
    const indexed = selected.map((content,i)=>{
      if (i) text += "\n\n";
      const offset = text.length;
      text += content;
      return {page:start+i,start:offset,end:text.length,status:"read" as const,truncated:start+i===breakPage};
    });
    return {text,pages:indexed,total_pages:pages.length,pages_attempted:indexed.length,pages_extracted:indexed.length,
      first_page_extracted:start,last_page_extracted:start+indexed.length-1,chars_extracted:text.length,latency_ms:15,
      stopped_reason:(start+indexed.length-1>=pages.length?"document_end":"page_cap_reached") as "document_end"|"page_cap_reached"};
  });
}
it("grounds the supplied range on the merits PDF across bounded windows",async()=>{
  const input=actual[1][0]+", paras 68–69";
  const request=preparePastedCitation(input).countryLookup!;
  expect(request.parsedFields.paragraph).toBe("68–69");
  expect(guardPastedCitationRequest({messages:[{role:"user",content:input}],rawInput:input,foreignLookup:request}).route).toBe("foreign");
  const extract=paged(meritsPages);
  const result=await resolveCountryLookup(request,{apiKey:"offline",extractScottishPdf:extract,
    fetchImpl:async target=>String(target).includes("perplexity.ai")?Response.json({results:[{url:actual[1][1]}]}):pdf()});
  expect(extract.mock.calls.map(c=>c[1].startPage??1)).toEqual([1,17,33]);
  expect(citationRecoveryResult({foreignLookup:result})).not.toBeNull();
  expect(result.provenance.paragraph).toMatchObject({value:"68–69",basis:"document_inspection",sourceUrl:actual[1][1]});
  expect(acceptCountryResponse(request,input,result)).toMatchObject({kind:"done",citation:`##CENTENARY 6 LIMITED v TLT LLP## ${actual[1][0]} [68]–[69].`});
  const swapped={...result,provenance:{...result.provenance,paragraph:{...result.provenance.paragraph,sourceUrl:actual[2][1]}}};
  expect(acceptCountryResponse(request,input,swapped)).toEqual({kind:"fail",reason:"binding"});
});
it("refuses the same requested range on the expenses decision and does not count a cited paragraph",async()=>{
  for(const paragraph of "paras 68–69|para. 333".split("|")){
    const extract=paged(expensesPages);
    expect(await acquireScottishRecord(actual[2][0]+", "+paragraph,actual[2][1],{fetch:async()=>pdf(),extract})).toBeNull();
    expect(extract).toHaveBeenCalledTimes(1);
  }
});
it("never certifies a locator past an unread page or the bounded extraction cap",async()=>{
  const input=actual[1][0]+", paras 68-69";
  const broken=paged(meritsPages,17);
  expect(await acquireScottishRecord(input,actual[1][1],{fetch:async()=>pdf(),extract:broken})).toBeNull();
  expect(broken).toHaveBeenCalledTimes(2);
  const delayed=paged([...meritsPages.slice(0,16),...Array(48).fill("Continuation page"),...meritsPages.slice(16)]);
  expect(await acquireScottishRecord(input,actual[1][1],{fetch:async()=>pdf(),extract:delayed})).toBeNull();
  expect(delayed).toHaveBeenCalledTimes(3);
});

it("accepts court-style brackets without treating a second decision as a locator",()=>{
  expect(preparePastedCitation(actual[1][0]+" [68]").countryLookup?.parsedFields.paragraph).toBe("68");
  expect(preparePastedCitation(actual[1][0]+" [68]–[69]").countryLookup?.parsedFields.paragraph).toBe("68–69");
  expect(preparePastedCitation(actual[1][0]+" [2024] CSIH 29").countryLookup).toBeNull();
  expect(preparePastedCitation("[2004] CSIH 13").countryLookup).toBeNull();
});
