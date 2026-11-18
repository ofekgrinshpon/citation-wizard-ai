import { describe, expect, it } from "vitest";
import { boundBookCompletion, eligibleBookCompletion, frameBookFinal, readBookFinal, resolveBookCompletion } from "../../supabase/functions/_shared/citationPure/bookFinal";
import { prepareFreeformHandoff } from "../../supabase/functions/_shared/citationPure/freeformInterpret";
import type { CitationRecoveryInput } from "../../supabase/functions/_shared/citationRecovery";
const raws = ["National Identity by Anthony D. Smith", "Brownlie's Principles of Public International Law by James Crawford"];
function inputFor(raw: string): CitationRecoveryInput {
  const handoff = prepareFreeformHandoff(raw);
  if (handoff?.mode !== "search") throw new Error("fixture must use deterministic free-form planner");
  return { messages: [{role:"user",content:raw}], rawInput:raw, foreignLookup:{...handoff.request}, batchId:null };
}
describe("deterministic missing-year book final binding",()=>{
  for (const raw of raws) {
    it(`binds and frames an honest empty-evidence result: ${raw}`,()=>{
      const input = inputFor(raw);
      const bound = boundBookCompletion(input);
      expect(bound).not.toBeNull();
      expect(bound!.local.wire).toEqual(input.foreignLookup!.parsedFields);
      const response = {kind:"book",jurisdiction:"OTHER",fields:{},grounded:{},provenance:{},sources:[],
        identity:{matched:false,anchors:[],conflicts:[]},bookModelEvidence:{version:1,records:[],sources:[]}};
      const final = resolveBookCompletion(bound!.request,raw,response,bound!.local.wire,undefined,bound!.bound.missing);
      expect(final.reply).toContain("[חסר: שנה]"); expect(final.reply).toContain("⚠️");
      expect(final.completion.fields.year).toBeUndefined();
      expect(final.completion.completeness).toBe("unconfirmed");
      expect(final.completion.identityConfirmed).toBe(false);
      const frame=frameBookFinal(input,"fixture-book-request",final.reply);
      expect(readBookFinal(frame,input,"fixture-book-request")?.reply).toBe(final.reply);
    });
    it(`rejects altered wire/raw/manual classification: ${raw}`,()=>{
      for(const change of ["author","title","extra","raw","manual"]) {
        const input=inputFor(raw), request=input.foreignLookup!;
        if(change==="author") (request.parsedFields as Record<string,string>).authors="Other Author";
        if(change==="title") (request.parsedFields as Record<string,string>).bookTitle="Other Book";
        if(change==="extra") (request.parsedFields as Record<string,string>).year="1991";
        if(change==="raw") input.rawInput=raw+" changed";
        if(change==="manual") input.messages=[{role:"user",content:`[סיווג שיפוט ידני: {"sourceType":"foreign_case_other","jurisdiction":"UK"}]\n${raw}`}];
        expect(boundBookCompletion(input)).toBeNull();
      }
    });
  }
  it("preserves formal book fields and supplied spans",()=>{
    const local=eligibleBookCompletion("foreign_book","Author: Jane Doe; Book: Synthetic Collection")!;
    expect(local.wire).toEqual({authors:"Jane Doe",bookTitle:"Synthetic Collection"});
    expect(local.suppliedFields?.authors?.spans).toHaveLength(1);
  });
  it("preserves chapter handling and never reclassifies it as a book",()=>{
    const raw="Author: Jane Doe; Chapter: Quiet Rules; Collection: Synthetic Collection; First page: 12; Pinpoint: 214-216";
    expect(eligibleBookCompletion("foreign_book_chapter",raw)?.kind).toBe("book_chapter");
    expect(eligibleBookCompletion("foreign_book",raw)).toBeNull();
  });
  it("does not expand nonbook, supplied-year, ambiguous or model-only eligibility",()=>{
    expect(eligibleBookCompletion("foreign_case_other",raws[0])).toBeNull();
    expect(eligibleBookCompletion("foreign_book_chapter",raws[0])).toBeNull();
    expect(eligibleBookCompletion("foreign_book","National Identity by Anthony D. Smith (1991)")).toBeNull();
    expect(eligibleBookCompletion("foreign_book","Anthony D. Smith wrote the book National Identity.")).toBeNull();
    expect(eligibleBookCompletion("foreign_book","National Identity")).toBeNull();
  });
});


describe("pilot abstention only formats supplied missing-year facts", () => {
  const raw = raws[0], input = inputFor(raw), request = input.foreignLookup!;
  const local = eligibleBookCompletion("foreign_book", raw)!;
  const empty = () => ({kind:"book",jurisdiction:"OTHER",fields:{},grounded:{},provenance:{},sources:[],
    identity:{matched:false,anchors:[],conflicts:[]},bookModelEvidence:{version:1,records:[],sources:[]}});
  const resolve = (response: unknown, req=request, fields=local.wire) => resolveBookCompletion(req,raw,response,fields,undefined,["year"]);
  it("formats an unavailable clean pilot without promoting verification",()=>{
    const result=resolve({...empty(),error:"lookup_failed"});
    expect(result.citation).toContain("[חסר: שנה]");
    expect(result.completion.identityConfirmed).toBe(false);
    expect(result.completion.fields).toEqual({});
  });
  it("leaves legacy unmatched book behavior unchanged",()=>{
    const {bookModelEvidence: _unused, ...legacy}=empty();
    expect(resolve(legacy).citation).toBe(raw);
  });
  it.each(["binding","malformed","bad envelope","bad identity","conflict","altered fields"])("does not format when %s",which=>{
    const response:any=empty(); let req=request, fields=local.wire;
    if(which==="binding") req={...request,rawInput:raw+" edited"};
    if(which==="malformed") response.kind="book_chapter";
    if(which==="bad envelope") response.bookModelEvidence.version=2;
    if(which==="bad identity") response.identity.matched="false";
    if(which==="conflict") response.identity.conflicts=["wrong_author"];
    if(which==="altered fields") fields={...local.wire,authors:"Other Author"};
    expect(resolve(response,req,fields).citation).toBe(raw);
  });
});
