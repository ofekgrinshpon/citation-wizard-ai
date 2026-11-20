import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { verifiedPadiPublication, PADI_EVIDENCE_DOMAINS } from "../../supabase/functions/_shared/padiPublicationEvidence";
const target = {caseType:'ע״א',caseNumber:'140/00',party1:'עיזבון המנוח מיכאל אטינגר',party2:'החברה לשיקום ופיתוח הרובע היהודי בעיר העתיקה בירושלים בע״מ',decisionYear:'2004'};
const citation = `ע״א 140/00 ${target.party1} נ׳ ${target.party2}, פ״ד נח(4) 486 (2004)`;
const result = (snippet=citation,url='https://www.gov.il/BlobFolder/reports/interest/he/insurance_companies_a.pdf')=>({url,snippet});
const payload=(...search_results:unknown[])=>({search_results});
describe('printed reporter grounded excerpt',()=>{
 it.each(['https://www.gov.il/report.pdf','https://fs.knesset.gov.il/document.pdf','https://supremedecisions.court.gov.il/document.pdf','https://www.nevo.co.il/document','https://www.psakdin.co.il/document'])('accepts full same-block citation at %s without docket in URL',url=>{
  expect(verifiedPadiPublication(target,payload(result(citation,url)))).toEqual({padi_volume:'נח',padi_part:'4',padi_page:'486',year:'2004'});
 });
 it('supports older volume from text, not an inferred volume/year table',()=>{
  expect(verifiedPadiPublication({...target,caseNumber:'4628/93',party1:'מדינת ישראל',party2:'אפרופים שיכון ויזום (1991) בע״מ',decisionYear:'1995'},payload(result('ע״א 4628/93 מדינת ישראל נ׳ אפרופים שיכון ויזום (1991) בע״מ, פ״ד מט(2) 265 (1995)')))?.padi_volume).toBe('מט');
 });
 it.each(['','http://www.gov.il/doc','https://gov.il.evil.test/doc','https://user:pass@gov.il/doc','https://takdin.co.il/doc','https://example.org/doc'])('rejects absent/untrusted URL %s',url=>expect(verifiedPadiPublication(target,payload(result(citation,url)))).toBeNull());
 it('rejects model-only assertion, citations URL only, and title/snippet joining',()=>{
  expect(verifiedPadiPublication(target,{citations:['https://court.gov.il/140-00'],choices:[{message:{content:JSON.stringify({isPublished:true,padi_volume:'נח',padi_part:'4',padi_page:'486'})}}]})).toBeNull();
  expect(verifiedPadiPublication(target,payload({...result('פ״ד נח(4) 486 (2004)'),title:citation.split('פ״ד')[0]}))).toBeNull();
 });
 it.each([citation.replace('140/00','1140/00'),citation.replace('ע״א','דנ״א'),citation.replace(target.party1,'אדם אחר'),citation.replace('(2004)','(2005)'),citation.replace(' 486',''),citation.replace(' (2004)',''),citation.replace('פ״ד','עוד נדון עניין אחר שפורסם ב פ״ד'),citation.replace('פ״ד','ע״א 550/01 אחר נ׳ אחר, פ״ד')])('rejects alternate identity, year or incomplete evidence',snippet=>expect(verifiedPadiPublication(target,payload(result(snippet)))).toBeNull());
 it('Ettinger conflicting pages fail closed even when one agrees with model',()=>{
  expect(verifiedPadiPublication(target,payload(result(),result(citation.replace('486','558'),'https://fs.knesset.gov.il/doc.pdf')))).toBeNull();
 });
 it('duplicate corroboration is not conflict, but conflicting explicit year is',()=>{
  expect(verifiedPadiPublication(target,payload(result(),result()))?.padi_page).toBe('486');
  expect(verifiedPadiPublication(target,payload(result(),result(citation.replace('2004','2005'))))).toBeNull();
 });
 it('does not infer a missing decision year or join different source blocks',()=>{
  expect(verifiedPadiPublication({...target,decisionYear:''},payload(result()))).toBeNull();
  expect(verifiedPadiPublication(target,payload(result(citation.split('פ״ד')[0]),result('פ״ד נח(4) 486 (2004)')))).toBeNull();
 });
});

describe('actual docket second-pass integration, offline',()=>{
 const code=readFileSync('supabase/functions/citation-chat/index.ts','utf8');
 const block=code.slice(code.indexOf('// ── Secondary verification:'),code.indexOf('// Reconcile decision date/year'));
 const js=ts.transpileModule(`async function check(){${block}\nreturn parsed;}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 async function run(data:unknown,year='2004',docketYear='00') {
  const parsed={found:true,isPublished:false,party1:target.party1,party2:target.party2,year,padi_part:'9',padi_page:'999'};
  const fetch=vi.fn(async(_url: string, _init: {body: string})=>({ok:true,json:async()=>data}));
  const fn=new Function('parsed','trackedFetch','verifiedPadiPublication','PADI_EVIDENCE_DOMAINS','PADI_VOLUME_YEAR_RANGES','padiVolumeDocketConflict','isLowerCourt','docketCourt','fullCaseRef','caseType','caseNum','docketAnchor','PERPLEXITY_API_KEY',`${js};return check();`);
  const value=await fn(parsed,fetch,verifiedPadiPublication,PADI_EVIDENCE_DOMAINS,{נח:[2003,2005]},(_:string,y:string)=>y==='18'?'impossible':null,()=>false,null,'ע״א 140/00',target.caseType,target.caseNumber,{year:docketYear},'offline');
  return {value,fetch};
 }
 it('uses existing one request, adopts exact full tuple, no URL-docket requirement',async()=>{
  const {value,fetch}=await run(payload(result()));expect(value).toMatchObject({isPublished:true,padi_volume:'נח',padi_part:'4',padi_page:'486',year:'2004'});expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body).search_domain_filter).toContain('gov.il');
 });
 it('model-only or competing proof cannot upgrade database fallback',async()=>{
  for(const p of [{choices:[{message:{content:'{"isPublished":true,"padi_volume":"נח"}'}}]},payload(result(),result(citation.replace('486','558')))])expect((await run(p)).value.isPublished).toBe(false);
 });
 it('keeps filing-year and decision-year safeguards',async()=>{
  expect((await run(payload(result()),'2004','18')).value.isPublished).toBe(false);
  expect((await run(payload(result()),'2021')).value.isPublished).toBe(false);
 });
});
