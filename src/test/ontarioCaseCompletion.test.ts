import { expect, it } from "vitest";
import {validateCitationInput} from "@/lib/citationInputValidation";
import {preparePastedCitation} from "@/lib/pastedCitationAdapter";
import {acceptCountryResponse} from "../../supabase/functions/_shared/citationPure/countryLookup";
import {resolveCountryLookup, validateCountryRequest} from "../../supabase/functions/citation-chat/countryRoute";
import {createCitationBudget} from "../../supabase/functions/_shared/citationPure/freeformInterpret";
import {guardPastedCitationRequest} from "../../supabase/functions/_shared/pastedCitation";
import {CHAT_HOST, RUNNER_HOST, planCitationEvidence, planTypedRequest, resolveCitationResponse} from "@/lib/citationPlanner";
import husky from "./fixtures/ontario/21380.html?raw";
import siebold from "./fixtures/ontario/21394.html?raw";

const host = "https://coadecisions.ontariocourts.ca/coa/coa/en/item/";
async function run(input: string, record: string, body: string) {
 const plan = preparePastedCitation(input);
 expect(plan.contract.route).toBe("foreign");
 const request = plan.countryLookup!;
 expect(validateCountryRequest(request)).toEqual(request);
 expect(guardPastedCitationRequest({messages:[{role:"user",content:input}],rawInput:input,foreignLookup:request}).route).toBe("foreign");
 const calls: Array<{url:string; init?:RequestInit}> = [];
 const budget = createCitationBudget();
 const result = await resolveCountryLookup(request, {apiKey:"offline",budget,fetchImpl:(async (target,init) => {
  const url = String(target);
  calls.push({url,init});
  return url.startsWith("https://api.perplexity.ai/") ? Response.json({ results:[{url: record, snippet:input}] })
     : new Response(body,{headers:{"content-type":"text/html; charset=utf-8"}});
 }) as typeof fetch});
 const rendered = acceptCountryResponse(request,input,result);
 for (const entry of [CHAT_HOST,RUNNER_HOST]) {
  const evidence = planCitationEvidence(input,null);
  const typed = planTypedRequest({evidence,sourceType:"foreign_case_other",input,isPinpoint:false,manual:false,statutePrep:null,canonicalRaw:input},entry);
  expect(typed.foreignLookup).toEqual(request);
  if (rendered.kind === "done") expect(resolveCitationResponse(typed,{foreignLookup:result},entry)).toMatchObject({kind:"terminal",resolution:{citation:rendered.citation,warningMsg:expect.stringContaining(record+"?iframe=true")}});
 }
 return {request,result,calls,budget,rendered};
}
it.each([
 ["2023 ONCA 260","21380",husky,"Husky Food Importers & Distributors Ltd. v. JH Whittaker & Sons Limited"],
 ["2023 ONCA 276","21394",siebold,"Siebold v. Lawand"],
])("completes literal neutral number %s from official HTML through client and server", async (input,item,html,name)=>{
 const url=host+item+"/index.do";
 const {calls,rendered,budget,result}=await run(input,url,html);
 expect(calls).toHaveLength(2);
 expect(calls[1]).toMatchObject({url:url+"?iframe=true",init:{redirect:"error"}});
 expect(budget.retrievals).toBe(2);
 expect(result.provenance.caseName).toMatchObject({basis:"official_record",sourceUrl:url+"?iframe=true"});
 expect(rendered).toMatchObject({kind:"done",templateId:"ca.case.onca_neutral",citation:`##${name}##, ${input}.`});
});
it("never fills from a differently numbered judgment even if the discovery snippet matches",async()=>{
 const {rendered}=await run("2023 ONCA 260",host+"21394/index.do",siebold+"<p>2023 ONCA 260</p>");
 expect(rendered).toEqual({kind:"fail",reason:"not_found"});
});
it("never follows a search hit outside the exact official court page shape",async()=>{
 const {rendered,calls}=await run("2023 ONCA 260","https://example.com/court",husky);
 expect(calls).toHaveLength(1);
 expect(rendered).toEqual({kind:"fail",reason:"not_found"});
});
it("rejects unread tails and does not reroute federal SCC",()=>{
 expect(preparePastedCitation("2023 ONCA 260, para. 7").countryLookup).toBeNull();
 expect(preparePastedCitation("R. v. Jordan, 2016 SCC 27").country?.templateId).toBe("ca.case.scc_neutral");
});

it("never substitutes the Supreme Court Heller appeal for the Ontario decision",async()=>{
 const scc="https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/18406/index.do";
 const {rendered,calls}=await run("2019 ONCA 1",scc,"");
 expect(calls).toHaveLength(1);
 expect(rendered).toEqual({kind:"fail",reason:"not_found"});
});

it("recognizes only the supported short bare citation in frontend preflight",()=>{
 expect(validateCitationInput("2023 ONCA 260").valid).toBe(true);
 for (const raw of ["2023 ONCA 0","2023 XXCA 260","abcdef123"]) expect(validateCitationInput(raw).valid).toBe(false);
});
