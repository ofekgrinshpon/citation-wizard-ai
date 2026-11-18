import { describe, expect, it } from "vitest";
import { bookCrossrefTarget } from "../../supabase/functions/citation-chat/bookCrossrefTarget";
import { prepareFreeformHandoff } from "../../supabase/functions/_shared/citationPure/freeformInterpret";
import type { CitationRecoveryInput } from "../../supabase/functions/_shared/citationRecovery";
const title="Brownlie's Principles of Public International Law", author="James Crawford";
function input(raw=`${title} BY ${author}`):CitationRecoveryInput{
 const route=prepareFreeformHandoff(raw);
 return {messages:[{role:"user",content:raw}],rawInput:raw,foreignLookup:route?.mode==="search" ? {...route.request} : null,batchId:null};
}
describe("regular authenticated Crossref scope",()=>{
 it("supports any deterministic title/byline with no owner, title list or expiry",()=>{
  expect(bookCrossrefTarget(undefined,input())).toEqual({title,author});
  expect(bookCrossrefTarget("on",input("National Identity by Anthony D. Smith"))).toEqual({title:"National Identity",author:"Anthony D. Smith"});
 });
 it.each(["off","OFF","","unknown"])("respects the server kill switch even on an eligible citation (%s)",setting=>{
  expect(bookCrossrefTarget(setting,input())).toBeNull();
 });
 it("rejects supplied dates, identifiers, editions, free notes and mismatched anchors",()=>{
  for(const suffix of [" (2019)", "; Edition: 8th ed.", " ISBN: 9780198737445", "\nהערה: חסוי", " — כתב יד"]) {
   expect(bookCrossrefTarget(undefined,input(`${title} BY ${author}${suffix}`))).toBeNull();
  }
  const altered=input();altered.foreignLookup={...altered.foreignLookup,parsedFields:{bookTitle:title,authors:"Different Author"}};
  expect(bookCrossrefTarget(undefined,altered)).toBeNull();
  expect(bookCrossrefTarget(undefined,null)).toBeNull();
 });
});
