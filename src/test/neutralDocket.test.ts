import { describe, it, expect, vi } from "vitest";
import { buildPastedCitation, guardPastedCitationRequest, needsNeutralDocketLookup } from "../../supabase/functions/_shared/pastedCitation";
import { resolveNeutralDocket } from "../../supabase/functions/citation-chat/neutralDocket";
import { planCitationEvidence, planLocalCitation, planTypedRequest, CHAT_HOST } from "@/lib/citationPlanner";
const row = (full_citation = 'ע״א 4628/93 מדינת ישראל נ׳ אפרופים שיכון ויזום (1991) בע״מ, פ״ד מט(2) 265 (1995)') => ({ full_citation, source_type: "case_law_published", verification_status: "verified" });
describe("neutral bare docket catalog", () => {
 it.each(["6821/93","4628/93","5121/98","140/00","389/80"])("keeps %s unknown and reaches server without foreign lookup", raw => {
  const evidence = planCitationEvidence(raw, null);
  expect(evidence.preserve).toBeNull();
  expect(needsNeutralDocketLookup(evidence.pasted.contract)).toBe(true);
  expect(evidence.pasted.contract.jurisdiction).toBe("UNKNOWN");
  const p = { evidence, sourceType: "unknown" as const, input:raw, isPinpoint:false, manual:false };
  expect(planLocalCitation(p, CHAT_HOST)).toEqual({origin:null,statutePrep:null});
  expect(planTypedRequest({...p,canonicalRaw:raw,statutePrep:null},CHAT_HOST).foreignLookup).toBeNull();
  expect(needsNeutralDocketLookup(guardPastedCitationRequest({rawInput:raw,messages:[{role:"user",content:raw}],pastedCitation:evidence.pasted.contract}))).toBe(true);
 });
 it.each(["ECHR 5493/72",'ע״א 4628/93',"50358-09-16","140/00 389/80","סעיף 140/00","140/00 Smith","2026-11-19"])("does not intercept %s",raw=>expect(needsNeutralDocketLookup(buildPastedCitation(raw))).toBe(false));
 it("does not intercept explicit manual choices or forged raw",()=>{
  expect(needsNeutralDocketLookup(buildPastedCitation("140/00",{jurisdiction:"US",sourceType:"foreign_case_us",foreign:true}))).toBe(false);
  expect(needsNeutralDocketLookup(guardPastedCitationRequest({rawInput:"140/00",messages:[{role:"user",content:"389/80"}]}))).toBe(false);
 });
 it("queries once, preserves exact raw, offers one verified candidate but never selects it",async()=>{
  const lookup=vi.fn(async()=>[row()]);const raw=" 4628/93 ";const reply=await resolveNeutralDocket(raw,lookup);
  expect(lookup).toHaveBeenCalledExactlyOnceWith("4628/93");expect(reply.startsWith(raw+"\n⚠️")).toBe(true);
  expect(reply).toContain("התאמה אפשרית בלבד");expect(reply).toContain("אפרופים");
 });
 it.each([[],[row(),row('ע״פ 4628/93 אחר נ׳ מדינת ישראל (1995)'),row('בג״ץ 4628/93 אחר נ׳ שר האוצר (1995)'),row('רע״א 4628/93 נוסף נ׳ אחר (1995)')],Array(21).fill(row()),[row('ע״א 14628/93 אחר נ׳ אחר (1995)')],[{...row(),verification_status:"pending"}],[{...row(),source_type:"article"}],[row('ע״א 4628/93 אחר נ׳ אחר 140/00 (1995)')]])("zero, competing, truncated, adjacent or untrusted records ask neutrally",async rows=>{
  const reply=await resolveNeutralDocket("4628/93",async()=>rows);expect(reply).not.toContain("התאמה אפשרית");expect(reply).toContain("נא להוסיף");expect(reply.startsWith("4628/93\n⚠️")).toBe(true);
 });
 it("accepts actual styled catalog citation and offers at most three exact candidates",async()=>{
  const styled={...row(),full_citation:`ע"א 4628/93 **מדינת ישראל** נ' **אפרופים שיכון ויזום (1991) בע"מ**, פ"ד מט(2) 265 (1995).`};
  expect(await resolveNeutralDocket("4628/93",async()=>[styled])).toContain("התאמה אפשרית בלבד");
  const reply=await resolveNeutralDocket("4628/93",async()=>[styled,row('ע״פ 4628/93 אחר נ׳ מדינת ישראל (1995)')]);
  expect(reply).toContain("כמה התאמות אפשריות בלבד");expect(reply.match(/• /g)).toHaveLength(2);expect(reply).not.toContain("**");
 });
 it("errors and malformed replies fail closed without retry",async()=>{
  const lookup=vi.fn(async()=>{throw Error("offline")});expect(await resolveNeutralDocket("140/00",lookup)).toContain("נא להוסיף");expect(lookup).toHaveBeenCalledTimes(1);
  expect(await resolveNeutralDocket("140/00",async()=>({rows:[row()]}))).toContain("נא להוסיף");
 });
});
