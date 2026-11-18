import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareBookAwareCitationDelivery, readBookFinal, resolveBookCompletion, selectBookEditionChoice } from "../../supabase/functions/_shared/citationPure/bookFinal";
import type { BookCrossrefRow } from "../../supabase/functions/_shared/citationPure/bookCrossrefEvidence";
const title="Brownlie's Principles of Public International Law",author="James Crawford",raw=title+" by "+author;
const fields={bookTitle:title,authors:author};
const request={enabled:true,kind:"book",jurisdiction:"OTHER",rawInput:raw,parsedFields:fields};
const first:BookCrossrefRow={title,authors:author,isbn:"9780199699698",year:"2012",edition:"8",doi:"10.1093/he/9780199699698.001.0001"};
const second:BookCrossrefRow={...first,isbn:"9780198737445",year:"2019",edition:"9",doi:"10.1093/he/9780198737445.001.0001"};
const response=(rows:BookCrossrefRow[]=[first,second])=>({kind:"book",jurisdiction:"OTHER",fields:{},grounded:{},provenance:{},sources:[],diagnostics:{tier1Queried:false,tier2Fired:false},
 identity:{matched:rows.length>=2,anchors:["title:"+title,"author:"+author],conflicts:[]},bookCrossrefEvidence:{version:1,rows}});
const resolve=(r:unknown=response(),req=request,local:Record<string,string>=fields)=>resolveBookCompletion(req,raw,r,local,undefined,["year"]);
beforeEach(()=>vi.stubGlobal("fetch",vi.fn(()=>{throw new Error("No IO in local choice");})));
describe("Crossref evidence edition choices",()=>{
 it("offers years and editions, but fills neither automatically",()=>{
  const r=resolve();
  expect(r.bookEditionChoice?.options.map(o=>o.label)).toEqual(["2012 (8th ed.)","2019 (9th ed.)"]);
  expect(r.completion.fields).toEqual({});expect(r.citation).toContain("[חסר: שנה]");
 });
 it("orders verified edition numbers even when transport rows arrive reversed",()=>{
  const ascending=resolve(response()).bookEditionChoice!, reversed=resolve(response([second,first])).bookEditionChoice!;
  expect(reversed.options.map(o=>o.label)).toEqual(["2012 (8th ed.)","2019 (9th ed.)"]);
  expect(reversed.options.map(o=>o.id)).toEqual(ascending.options.map(o=>o.id));
  const sameYear=resolve(response([{...second,year:"2012"},first])).bookEditionChoice!;
  expect(sameYear.options.map(o=>o.edition)).toEqual(["8th ed.","9th ed."]);
  expect(new Set(sameYear.options.map(o=>o.id)).size).toBe(2);
 });
 it.each(["2012","2019"])("applies %s locally from one exact validated record",year=>{
  const c=resolve().bookEditionChoice!, o=c.options.find(o=>o.year===year)!;
  const r=selectBookEditionChoice(c,o.id,raw)!;
  expect(r.citation).toContain(year);expect(r.citation).toContain(o.edition);
  expect(r.completion.fields).toEqual({year,edition:o.edition});expect(r.bookEditionChoice).toBeUndefined();
  expect(r.completion.provenance.year).toMatchObject({sourceUrl:o.url});expect(fetch).not.toHaveBeenCalled();
 });
 it("explicitly keeps year missing",()=>{
  const c=resolve().bookEditionChoice!, r=selectBookEditionChoice(c,"keep-missing",raw)!;
  expect(r.citation).toContain("[חסר: שנה]");expect(r.completion.fields.year).toBeUndefined();expect(r.bookEditionChoice).toBeUndefined();expect(fetch).not.toHaveBeenCalled();
 });
 it("same-year genuinely distinct editions have separate IDs",()=>{
  const c=resolve(response([first,{...second,year:"2012"}])).bookEditionChoice!;
  expect(c.options).toHaveLength(2);expect(new Set(c.options.map(o=>o.id)).size).toBe(2);
  expect(selectBookEditionChoice(c,c.options[1].id,raw)?.citation).toContain("9th ed. 2012");
 });
 it.each([{rows:[]},{rows:[first]},{rows:[first,{...first}]}])("never autopicks fewer than two editions",({rows})=>{
  const r=resolve(response(rows));expect(r.bookEditionChoice).toBeUndefined();expect(r.completion.fields.year).toBeUndefined();expect(r.citation).toContain("[חסר: שנה]");
 });
 it("rejects stale raw, altered proof and invalid IDs including keep-missing",()=>{
  const c=resolve().bookEditionChoice!;
  expect(selectBookEditionChoice(c,c.options[0].id,raw+" ")).toBeNull();
  expect(selectBookEditionChoice(c,"unknown",raw)).toBeNull();
  const changed=structuredClone(c);(changed.response as ReturnType<typeof response>).bookCrossrefEvidence.rows[0].year="2011";
  expect(selectBookEditionChoice(changed,c.options[0].id,raw)).toBeNull();expect(selectBookEditionChoice(changed,"keep-missing",raw)).toBeNull();
  const changedIdentity=structuredClone(c);(changedIdentity.response as ReturnType<typeof response>).identity.anchors.push("other");
  expect(selectBookEditionChoice(changedIdentity,"keep-missing",raw)).toBeNull();
 });
 it("no hidden old model or forged legacy fields override this channel",()=>{
  const r=resolve({...response([]),fields:{year:"1987"},grounded:{year:true},provenance:{year:{value:"1987",basis:"structured_metadata",sourceUrl:"https://example.org"}},
    bookModelEvidence:{version:1,records:[{year:"1987"}],sources:[]}});
  expect(r.completion.fields).toEqual({});expect(r.citation).toContain("[חסר: שנה]");expect(r.citation).not.toContain("1987");
 });
 it("invalid proof formats only secure user facts, not forged records",()=>{
  const r=resolve(response([{...first,title:"Other Book"},second]));
  expect(r.bookEditionChoice).toBeUndefined();expect(r.citation).toContain("[חסר: שנה]");expect(r.citation).not.toContain("Other Book");
  expect(r.completion.identityConfirmed).toBe(false);expect(r.warningMsg).toBeTruthy();
 });
 it("wrong raw/type or supplied year cannot authorize proof formatting",()=>{
  const unbound=resolve(response(),{...request,rawInput:raw+" changed"});
  expect(unbound.citation).toBe(raw);expect(unbound.bookEditionChoice).toBeUndefined();
  const wrong=resolve({...response(),kind:"book_chapter"});expect(wrong.citation).toBe(raw);
  expect(resolve(response(),request,{...fields,year:"2001"}).bookEditionChoice).toBeUndefined();
 });
});


describe("Crossref transient delivery",()=>{
 const input={messages:[{role:"user",content:raw}],rawInput:raw,foreignLookup:request,batchId:null};
 it.each([{rows:[first,second]},{rows:[]},{rows:[first]}])("stores a framed visible result, never evidence or fallback model",({rows})=>{
   const body={content:"",foreignLookup:{...response(rows),bookModelEvidence:{version:99,trace:"DO_NOT_RETAIN_MODEL"}}};
   const delivered=prepareBookAwareCitationDelivery(body,input,"crossref-request-0001",raw);
   expect(delivered.body.content).toContain("[חסר: שנה]");
   expect(delivered.result).not.toBeNull();
   expect(readBookFinal(delivered.result!.content,input,"crossref-request-0001")?.reply).toBe(delivered.body.content);
   expect(JSON.stringify(delivered.result)).not.toMatch(/bookCrossrefEvidence|bookModelEvidence|DO_NOT_RETAIN_MODEL|9780199699698|10.1093/);
 });
 it("malformed envelope version produces a nonblank honest fallback with no foreign proof",()=>{
   const body={content:"",foreignLookup:{...response(),bookCrossrefEvidence:{version:9,rows:[first,second]}}};
   const delivered=prepareBookAwareCitationDelivery(body,input,"crossref-request-0001",raw);
   expect(String(delivered.body.content)).toContain("⚠️");
   expect(delivered.body.foreignLookup).toBeUndefined();expect(delivered.result?.content).toBeTruthy();
 });
});
