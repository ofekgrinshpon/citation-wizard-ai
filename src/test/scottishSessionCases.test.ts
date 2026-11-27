import { expect, it, vi } from "vitest";
import { readSessionCasesIndex } from "../../supabase/functions/_shared/citationPure/scottishSessionCases";
import { lookupSessionCases } from "../../supabase/functions/citation-chat/scottishSessionCasesRoute";
import { createCitationBudget, chargeSearch, chargePageFetch } from "../../supabase/functions/_shared/citationPure/freeformInterpret";
import kerr from "./fixtures/scotland/kerr-index.html?raw";
import king from "./fixtures/scotland/king-index.html?raw";
import baxter from "./fixtures/scotland/baxter-index.html?raw";
import centenary from "./fixtures/scotland/centenary-index.html?raw";

it.each([
  ["[2014] CSIH 69",kerr,"2015","17","1114"],
  ["[2024] CSIH 3",king,"2024","296","34674"],
  ["[2009] CSIH 75",baxter,"2010","156","675"],
])("binds publisher publication evidence to exact %s", (id, html, reportYear, firstPage, reportId)=>{
  expect(readSessionCasesIndex(html,id)).toEqual({state:"matched", neutral:id, caption:expect.any(String), reportYear, firstPage, reporter:"SC",
    url:`https://sclr-index.scottishlawreports.org.uk/report/${reportId}/`});
});
it("distinguishes a verified search miss from malformed or conflicting results",()=>{
  expect(readSessionCasesIndex(centenary,"[2024] CSIH 13")).toEqual({state:"no_exact_match"});
  expect(readSessionCasesIndex(kerr,"[2024] CSIH 13")).toEqual({state:"no_exact_match"});
  expect(readSessionCasesIndex(kerr.replace("</tbody>",""),"[2014] CSIH 69")).toEqual({state:"unverified"});
  expect(readSessionCasesIndex(kerr.replace("Total Reports: 1","Total Reports: 2"),"[2014] CSIH 69")).toEqual({state:"unverified"});
  const row=kerr.match(/<tr class="hover[^>]*>[\s\S]*?<\/tr>/)![0];
  expect(readSessionCasesIndex(kerr.replace(row,row+row.replace("2015 SC 17","2015 SC 18")).replace("Total Reports: 1","Total Reports: 2"),"[2014] CSIH 69"))
    .toEqual({state:"unverified"});
});
it("stays within the shared retrieval budget and pins the index request",async()=>{
  const budget=createCitationBudget();
  const fetcher=vi.fn(async()=>new Response(kerr,{headers:{"content-type":"text/html; charset=utf-8"}}));
  expect((await lookupSessionCases("[2014] CSIH 69",budget,fetcher)).state).toBe("matched");
  expect(fetcher).toHaveBeenCalledWith(new URL("https://sclr-index.scottishlawreports.org.uk/?ncit=%5B2014%5D+CSIH+69"),expect.objectContaining({redirect:"error"}));
  expect(budget.retrievals).toBe(1);
  expect(chargePageFetch(budget)).toBe(true);
  expect(chargeSearch(budget)).toBe(false);
  expect(await lookupSessionCases("[2014] CSIH 69",budget,fetcher)).toEqual({state:"unverified"});
  expect(fetcher).toHaveBeenCalledTimes(1);
});

import { CHAT_HOST, RUNNER_HOST, planCitationEvidence, planTypedRequest, resolveCitationResponse } from "@/lib/citationPlanner";
import { preparePastedCitation } from "@/lib/pastedCitationAdapter";
import { resolveCountryLookup } from "../../supabase/functions/citation-chat/countryRoute";
import { guardPastedCitationRequest } from "../../supabase/functions/_shared/pastedCitation";
import { citationRecoveryResult } from "../../supabase/functions/_shared/citationRecovery";
import { acceptCountryResponse } from "../../supabase/functions/_shared/citationPure/countryLookup";

it("routes the explicit report request through one official lookup without a search API key",async()=>{
  const raw="[2014] CSIH 69, Session Cases";
  const req=preparePastedCitation(raw).countryLookup!;
  expect(req.parsedFields.reporter).toBe("SC");
  expect(guardPastedCitationRequest({messages:[{role:"user",content:raw}],rawInput:raw,foreignLookup:req}).route).toBe("foreign");
  const fetcher=vi.fn(async()=>new Response(kerr,{headers:{"content-type":"text/html"}}));
  const result=await resolveCountryLookup(req,{fetchImpl:fetcher,budget:createCitationBudget()});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(citationRecoveryResult({foreignLookup:result})).not.toBeNull();
  expect(acceptCountryResponse(req,raw,result)).toMatchObject({kind:"done",citation:"##Kerr v Mangan## [2014] CSIH 69, 2015 SC 17."});
  for (const host of [CHAT_HOST,RUNNER_HOST]) {
    const evidence = planCitationEvidence(raw,null);
    const plan = planTypedRequest({evidence,sourceType:"foreign_case_other",input:raw,isPinpoint:false,manual:false,statutePrep:null,canonicalRaw:raw},host);
    expect(plan.foreignLookup).toEqual(req);
    expect(resolveCitationResponse(plan,{foreignLookup:result},host)).toMatchObject({
      kind:"terminal", resolution:{citation:"##Kerr v Mangan## [2014] CSIH 69, 2015 SC 17."},
    });
  }
  const mixed={...result,provenance:{...result.provenance,firstPage:{...result.provenance.firstPage,sourceUrl:"https://sclr-index.scottishlawreports.org.uk/report/34674/"}}};
  expect(acceptCountryResponse(req,raw,mixed)).toEqual({kind:"fail",reason:"binding"});
});
it("does not replace the default PDF path or downgrade a missing report silently",async()=>{
  const raw="[2024] CSIH 13, Session Cases";
  const req=preparePastedCitation(raw).countryLookup!;
  expect(preparePastedCitation("[2024] CSIH 13").countryLookup?.parsedFields.reporter).toBeUndefined();
  expect(preparePastedCitation("[2024] CSIH 13 [68], Session Cases").countryLookup).toBeNull();
  const result=await resolveCountryLookup(req,{fetchImpl:async()=>new Response(centenary,{headers:{"content-type":"text/html"}})});
  expect(acceptCountryResponse(req,raw,result)).toEqual({kind:"fail",reason:"not_found"});
});
