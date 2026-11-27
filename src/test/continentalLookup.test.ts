import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { preparePastedCitation } from "@/lib/pastedCitationAdapter";
import { acceptCountryResponse } from "../../supabase/functions/_shared/citationPure/countryLookup";
import { BOE_TEXT, germanDecisionApiUrl, germanDecisionRecord, parseContinental } from "../../supabase/functions/_shared/citationPure/continentalEvidence";
import { guardPastedCitationRequest } from "../../supabase/functions/_shared/pastedCitation";
import { resolveCountryLookup } from "../../supabase/functions/citation-chat/countryRoute";
import { createCitationBudget } from "../../supabase/functions/_shared/citationPure/freeformInterpret";

const f=(name:string)=>new Uint8Array(readFileSync(new URL("fixtures/continental/"+name,import.meta.url)));
const stc="https://hj.tribunalconstitucional.es/es-ES/Resolucion/Show/26778";
const bgb="https://www.gesetze-im-internet.de/bgb/__823.html";
function net(routes:Record<string,string>,hit?:string|string[]) {
 let selection="";
 return vi.fn(async (input: RequestInfo | URL, init?:RequestInit)=>{
   const url=String(input);
   const court="https://hj.tribunalconstitucional.es";
   if (url === court+"/es") return new Response('<input name="__RequestVerificationToken" type="hidden" value="normal_form_token" />',{headers:{"content-type":"text/html","set-cookie":"__RequestVerificationToken_L0hK0=normal_cookie"}});
   if (url === court+"/es/Busqueda/Buscar") {
     expect(init?.redirect).toBe("manual");
     expect(new Headers(init?.headers).get("cookie")).toBe("__RequestVerificationToken_L0hK0=normal_cookie");
     const submitted=new URLSearchParams(String(init?.body));
     expect(submitted.get("TIPO_RESOLUCION")).toBe("SENTENCIA");
     expect(submitted.get("__RequestVerificationToken")).toBe("normal_form_token");
     selection=submitted.get("NUMERO_RESOLUCION")+"/"+submitted.get("ANNO_RESOLUCION");
     const h=new Headers({location:"/es/Resolucion/List"});
     h.append("set-cookie","ASP.NET_SessionId=session0123; path=/; HttpOnly");
     h.append("set-cookie","ASP.NET_SessionId=session0123; path=/; SameSite=Lax");
     return new Response(null,{status:302,headers:h});
   }
   if (url === court+"/es/Resolucion/List") {
     expect(new Headers(init?.headers).get("cookie")).toBe("ASP.NET_SessionId=session0123");
     const candidates=Array.isArray(hit) ? hit : hit ? [hit] : [];
     const links=candidates.map(u => '<li><a class="resolucion-item" href="'+u.replace(court+"/es-ES/","/es/")+'">Pleno. SENTENCIA '+selection+', de 14 de julio</a></li>').join("");
     return new Response('<ul id="resolution-list">'+links+'</ul>',{headers:{"content-type":"text/html"}});
   }
   if (!routes[url]) throw new Error("unexpected URL");
   const xml=url.startsWith(BOE_TEXT);
   const mime=xml ? "application/xml" : url.includes("/v1/rechtsprechung?") ? "application/json" : "text/html";
   expect(new Headers(init?.headers).get("accept")).toBe(mime);
   expect(init?.redirect).toBe(url.includes("tribunalconstitucional.es") ? "manual" : "error");
   const bytes=f(routes[url]);
   if (url.includes("tribunalconstitucional.es")) {
     // Real record STC 31/2010 was ~2.77 MiB; parsing must stop at the metadata marker.
     const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes); c.enqueue(new Uint8Array(2_800_000)); c.close();}});
     return new Response(stream,{headers:{"content-type":mime}});
   }
   return new Response(bytes,{headers:{"content-type":mime}});
 });
}
describe("Germany and Spain official sources through the application planner and country route",()=>{
 const de="ECLI:DE:BVerfG:2026:rs20261116.1bvr180322";
 const climate="ECLI:DE:BVerfG:2021:rs20210324.1bvr265618";
 const german=(raw:string)=>germanDecisionApiUrl(parseContinental(raw)!);
 const cases: Array<[string,Record<string,string>,string|undefined,string]> = [
  ["STC 148/2021",{[stc]:"es-148"},stc,"STC 148/2021 (2021-07-14)."],
  ["STC 31/2010",{"https://hj.tribunalconstitucional.es/es-ES/Resolucion/Show/6670":"es-31"},"https://hj.tribunalconstitucional.es/es-ES/Resolucion/Show/6670","STC 31/2010 (2010-06-28)."],
  [de,{[german(de)]:"de-api-merits.json"},undefined,`BVerfG, 2026-11-16, ${de}.`],
  [climate,{[german(climate)]:"de-api-climate.json"},undefined,`BVerfG, 2021-03-24, ${climate}.`],
  ["BGB § 823",{[bgb]:"de-bgb-823"},undefined,"Bürgerliches Gesetzbuch [BGB] § 823."],
  ["Constitución Española art. 49(2) as of 2024-02-17",{[BOE_TEXT+"/bloque/a49"]:"boe-xml"},undefined,"Constitución Española [CE] art. 49(2) (versión de 2024-02-17)."],
 ];
 async function run(raw:string,routes:Record<string,string>,hit?:string|string[]) {
  vi.stubGlobal("Deno",{env:{get:()=>undefined}});
  try {
   const prepared=preparePastedCitation(raw);
   const request=prepared.countryLookup!;
   expect(request).toBeTruthy();
   const guarded=guardPastedCitationRequest({messages:[{role:"user",content:raw}],rawInput:raw,foreignLookup:request,pastedCitation:prepared.contract});
   expect(guarded.route).toBe("foreign");
   const budget=createCitationBudget(),fetchImpl=net(routes,hit);
   const result=await resolveCountryLookup(request,{apiKey:"test-only",fetchImpl,budget});
   expect(budget.retrievals).toBeLessThanOrEqual(raw.startsWith("STC ") ? 4 : 2);
   if (raw === "STC 1/2024" || raw === "STC 31/2010" || raw === "STC 148/2021") expect(budget.retrievals).toBe(1);
   expect(budget.searches).toBe(0);
   expect(budget.modelCalls).toBe(0);
   return acceptCountryResponse(request,raw,result);
  } finally { vi.unstubAllGlobals(); }
 }
 it.each(cases)("completes %s", async (raw,routes,hit,citation)=>{
  expect(await run(raw,routes,hit)).toMatchObject({kind:"done",citation});
 });
 it.each([
  ["STC 148/2021",{[stc]:"es-183"},stc],
  [de,{[german(de)]:"de-api-climate.json"},undefined],
  [de,{[german(de)]:"de-api-absent.json"},undefined],
  ["BGB § 823",{[bgb]:"de-bgb-824"},undefined],
  ["Constitución Española art. 49(2) as of 2024-02-16",{[BOE_TEXT+"/bloque/a49"]:"boe-xml"},undefined],
 ] as [string,Record<string,string>,string|undefined][])("fails closed for wrong record or effective version: %s",async (raw,routes,hit)=>{
  expect(await run(raw,routes,hit)).toEqual({kind:"fail",reason:"not_found"});
 });
 it("rejects inconsistent, ambiguous or non-constitutional API results",()=>{
   const id=parseContinental(de)!;
   const variants=[
     a=>{a.member[0].item.decisionDate="2026-11-15"},
     a=>{a.member[0].item.courtType="BGH"},
     a=>{a.member[0].item["@id"]="/v1/rechtsprechung/KVRE000000001"},
     a=>{a.totalItems=2; a.member.push(a.member[0])},
     a=>{a.view.next="/v1/rechtsprechung?pageIndex=1"}
   ] as Array<(collection:any)=>void>;
   for(const change of variants){
     const fixture=JSON.parse(new TextDecoder().decode(f("de-api-merits.json")));
     change(fixture);
     expect(germanDecisionRecord(id,JSON.stringify(fixture))).toBeNull();
   }
 });
 it("rejects ambiguous results and a real same-number court order",async()=>{
   const sentencia=stc.replace("26778","30062"), auto=stc.replace("26778","30085");
   expect(await run("STC 1/2024",{[sentencia]:"es-1-2024"},sentencia)).toMatchObject({kind:"done",citation:"STC 1/2024 (2024-01-15)."});
   expect(await run("STC 1/2024",{[sentencia]:"es-auto-1-2024"},auto)).toMatchObject({kind:"fail"});
   expect(await run("STC 9998/2021",{},[stc,auto])).toMatchObject({kind:"fail"});
   expect(await run("STC 9999/2021",{})).toMatchObject({kind:"fail"});
   expect(preparePastedCitation("ATC 1/2024").countryLookup).toBeNull();
 });
 it("does not accept lookalike hosts, unverified pinpoints or invalid calendar dates",async()=>{
  expect(await run("STC 9998/2021",{}, "https://hj.tribunalconstitucional.es.other.example/es-ES/Resolucion/Show/26778")).toMatchObject({kind:"fail"});
  for(const input of ["STC 148/2021 FJ 1","BGB § 823(2)","Constitución Española art. 49(2) as of 2024-02-30"])
    expect(preparePastedCitation(input).countryLookup).toBeNull();
 });
});
