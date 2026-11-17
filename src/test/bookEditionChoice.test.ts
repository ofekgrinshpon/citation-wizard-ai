import { describe, it, expect } from "vitest";
import { resolveBookCompletion, selectBookEditionChoice } from "../../supabase/functions/_shared/citationPure/bookFinal";
const raw = "National Identity by Anthony D. Smith";
const fields = { authors: "Anthony D. Smith", bookTitle: "National Identity" };
const request = { kind: "book", jurisdiction: "OTHER", rawInput: raw, parsedFields: fields };
function response() { return { kind: "book", jurisdiction: "OTHER", fields: {}, grounded: {}, provenance: {}, identity: { matched: true, anchors: ["title:National Identity"], conflicts: ["year:editions:1991,1993"] }, sources: [1991,1993].map(year => ({url:`https://books.google.com/books?id=${year}`,title:"National Identity by Anthony D. Smith",snippet:`Anthony D. Smith, National Identity (${year})`,tier:"tier1",strong:true})) }; }
const resolve = (r = response()) => resolveBookCompletion(request, raw, r, fields, undefined, ["year"]);
describe("book edition local evidence choices", () => {
 it("rechecks generic snippet provenance instead of trusting a guessed field",()=> {
   const r = response() as any;
   r.identity.conflicts=[]; r.sources=[{...r.sources[0],snippet:"Anthony D. Smith, National Identity. Other Work (1999)."}];
   r.fields={year:"1999"};r.grounded={year:true};r.provenance={year:{value:"1999",sourceUrl:r.sources[0].url,sourceTitle:r.sources[0].title,basis:"search_result_explicit"}};
   expect(resolve(r).completion.fields.year).toBeUndefined();
   expect(resolve(r).completion.quarantined).toContain("year");
 });
 it("offers distinct grounded years and selects without inventing an edition", () => { const c = resolve().bookEditionChoice!; expect(c.options.map(o=>o.year)).toEqual(["1991","1993"]); const s=selectBookEditionChoice(c,c.options[1].id,raw)!; expect(s.completion.fields.year).toBe("1993"); expect(s.completion.fields.edition).toBeUndefined(); expect(s.bookEditionChoice).toBeUndefined(); });
 it("supports keep missing and rejects stale input or invalid option",()=> {const c=resolve().bookEditionChoice!; expect(selectBookEditionChoice(c,"keep-missing",raw)?.completion.fields.year).toBeUndefined(); expect(selectBookEditionChoice(c,"book-year-1991",raw+" ")).toBeNull(); expect(selectBookEditionChoice(c,"1999",raw)).toBeNull();});
 it("does not treat a marker, weak or wrong-author evidence as choices",()=>{ const r=response();r.sources=[];expect(resolve(r).bookEditionChoice).toBeUndefined(); const w=response(); w.sources[0].strong=false;expect(resolve(w).bookEditionChoice).toBeUndefined();const a=response();a.sources[0].title="National Identity by John Smith";a.sources[0].snippet="John Smith, National Identity (1991)";expect(resolve(a).bookEditionChoice).toBeUndefined(); });
 it("rejects credential URLs",()=>{const r=response();r.sources[0].url="https://user:password@books.google.com/books?id=1991";expect(resolve(r).bookEditionChoice).toBeUndefined();});
 it("preserves supplied years",()=>{ const supplied={...fields,year:"2001"};expect(resolveBookCompletion({...request,parsedFields:supplied},raw,response(),supplied,undefined,[]).bookEditionChoice).toBeUndefined(); });
 it("keeps an edition only on its own year",()=>{const r=response();r.sources[1].snippet="Anthony D. Smith, National Identity (2nd ed. 1993)";const c=resolve(r).bookEditionChoice!;expect(c.options[0].edition).toBeUndefined();expect(selectBookEditionChoice(c,c.options[1].id,raw)?.completion.fields.edition).toBe("2nd ed.");});
});
