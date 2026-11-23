import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { verifiedPadiPublication, PADI_EVIDENCE_DOMAINS, findTypedPadiEvidence, findTypedPadiCitation, mergeTypedPadiEvidence, readTypedDecisionDate, typedSupremeFilingYear, typedPadiDraftMatches } from "../../supabase/functions/_shared/padiPublicationEvidence";
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
  const typedPadi=false, typedEvidence={kind:'none'};
  const parsed={found:true,isPublished:false,party1:target.party1,party2:target.party2,year,padi_part:'9',padi_page:'999'};
  const fetch=vi.fn(async(_url: string, _init: {body: string})=>({ok:true,json:async()=>data}));
  const fn=new Function('parsed','trackedFetch','verifiedPadiPublication','PADI_EVIDENCE_DOMAINS','PADI_VOLUME_YEAR_RANGES','padiVolumeDocketConflict','isLowerCourt','docketCourt','fullCaseRef','caseType','caseNum','docketAnchor','PERPLEXITY_API_KEY','typedPadi','typedEvidence',`${js};return check();`);
  const value=await fn(parsed,fetch,verifiedPadiPublication,PADI_EVIDENCE_DOMAINS,{נח:[2003,2005]},(_:string,y:string)=>y==='18'?'impossible':null,()=>false,null,'ע״א 140/00',target.caseType,target.caseNumber,{year:docketYear},'offline',typedPadi,typedEvidence);
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

describe("typed Supreme reporter/decision binding", () => {
 const kol = {caseType:'בג״ץ', caseNumber:'73/53', party1:'חברת קול העם בע״מ', party2:'שר הפנים', filingYear:1953};
 const pin = {caseType:'בג״ץ', caseNumber:'1843/93', party1:'פנחסי', party2:'כנסת ישראל', filingYear:1993};
 const pin93 = 'בג״ץ 1843/93 פנחסי נ׳ כנסת ישראל, פ״ד מח(4) 492 (1993)';
 const pin95 = 'בג״ץ 1843/93 פנחסי נ׳ כנסת ישראל, פ״ד מט(1) 661 (17.1.1995)';
 it.each([['53',1953],['1953',1953],['24',2024],['93',1993],['49',1949],['38',null],['2053',null]])("resolves filing suffix %s as %s without changing dockets", (suffix, year) => {
   expect(typedSupremeFilingYear(suffix, 2026)).toBe(year);
 });
 it("does not choose if future dates make the century genuinely ambiguous", () => {
   expect(typedSupremeFilingYear("53", 2053)).toBeNull();
 });
 it("accepts an exact quote-free type, doubled docket year, curly quotes, optional reporter part and explicit date", () => {
   const snippet = 'בגץ 73/1953 חברת “קול העם” בע״מ נ׳ שר הפנים, פ״ד ז 871 (1953), ניתן ביום 16.10.1953';
   expect(findTypedPadiEvidence(kol,payload({...result(snippet),date:'1995-01-17'}))).toEqual({
     kind:'verified', publication:{padi_volume:'ז',padi_part:'',padi_page:'871',year:'1953'},date:'16.10.1953',
   });
 });
 it("handles presentation-only dash and quote variants without permitting unrelated captions", () => {
   const ad = {caseType:'בג״ץ',caseNumber:'1113/99',party1:'עדאלה - המרכז המשפטי לזכויות המיעוט הערבי בישראל',party2:'השר לענייני דתות',filingYear:1999};
   const curr = 'בג״ץ 1113/99 עדאלה—המרכז המשפטי לזכויות המיעוט הערבי בישראל נ’ השר לענייני דתות, פ״ד נ״ד(2) 164 (2000)';
   const old = curr.replace('1113/99','240/98').replace('נ״ד(2) 164 (2000)','נב(5) 167 (1998)');
   expect(findTypedPadiEvidence(ad,payload(result(curr)))).toMatchObject({kind:'verified',publication:{padi_volume:'נד',padi_part:'2',padi_page:'164',year:'2000'},date:null});
   expect(findTypedPadiEvidence(ad,payload(result('בג״ץ 1113/99 '+old)))).toEqual({kind:'none'});
   expect(findTypedPadiEvidence(ad,payload(result(curr.replace('השר לענייני דתות','אדם אחר'))))).toEqual({kind:'none'});
 });
 it("recognizes real reporter punctuation and a single attached Hebrew preposition without reclassifying", () => {
   const t = {...kol,caseType:'ע״א',caseNumber:'5604/94',party1:'חמד',party2:'מדינת ישראל',filingYear:1994};
   const s = 'בע״א 5604/94 חמד נ׳ מדינת ישראל, פ"ד נח(2), עמ׳ 498, (2004)';
   expect(findTypedPadiEvidence(t,payload(result(s)))).toMatchObject({kind:'verified',publication:{padi_page:'498',year:'2004'}});
   expect(findTypedPadiEvidence({...t,caseType:'ע״מ'},payload(result(s.replace('בע״א','בע״מ'))))).toEqual({kind:'none'});
 });
 it("keeps first page 5 when the same citation includes pinpoint 15", () => {
   const t = {...kol,caseNumber:'7/48',party1:'אל-כרבוטלי',party2:'שר הביטחון',filingYear:1948};
   const s = 'בג״ץ 7/48 אל־כרבוטלי נ׳ שר הביטחון, פ״ד ב 5, 15 (1949)';
   expect(findTypedPadiEvidence(t,payload(result(s)))).toMatchObject({kind:'verified',publication:{padi_page:'5',year:'1949'}});
 });
 it("never binds reporter evidence across results or to different proceeding types / court qualifiers", () => {
   expect(findTypedPadiEvidence(pin,payload(result(pin93.split('פ״ד')[0]),result('פ״ד מח(4) 492 (1993)')))).toEqual({kind:'none'});
   expect(findTypedPadiEvidence(pin,payload(result(pin93.replace('בג״ץ','ע״א'))))).toEqual({kind:'none'});
   expect(findTypedPadiEvidence(pin,payload(result(pin93.replace('בג״ץ','בג״ץ (מחוזי ת״א)'))))).toEqual({kind:'none'});
   expect(findTypedPadiEvidence(pin,payload(result(pin93,'https://israel.com/he/court-rulings/x')))).toEqual({kind:'none'});
 });
 it("does not pick one of two reporter/date records under the same docket", () => {
   expect(findTypedPadiEvidence(pin,payload(result(pin93+'; '+pin95)))).toEqual({kind:'conflict'});
   expect(mergeTypedPadiEvidence(findTypedPadiEvidence(pin,payload(result(pin93))),findTypedPadiEvidence(pin,payload(result(pin95))))).toEqual({kind:'conflict'});
   expect(findTypedPadiEvidence(pin,payload(result(pin93),result(pin93)))).toMatchObject({kind:'verified',publication:{year:'1993'},date:null});
 });
 it("rejects impossible dates and surfaces contradictory attached dates", () => {
   expect(readTypedDecisionDate('2022-12-77')).toBeNull();
   expect(readTypedDecisionDate('29.2.2023')).toBeNull();
   expect(readTypedDecisionDate('2004-02-29')).toEqual({year:'2004',date:'29.2.2004'});
   expect(findTypedPadiEvidence(pin,payload(result(pin93+', ניתן ביום 17.1.1995')))).toEqual({kind:'conflict'});
 });
});

describe("typed Supreme citation unit: docket + parties + reporter from one trusted citation", () => {
 const mizrahi = {caseType:'ע״א', caseNumber:'6821/93', filingYear:1993};
 const full = 'ע״א 6821/93 בנק המזרחי המאוחד בע״מ נ׳ מגדל כפר שיתופי, פ״ד מט(4) 221 (1995)';
 const scraper = {url:'https://israel.com/he/court-rulings/ca-6821-93', snippet:'ע"א 6821/93 בנק המזרחי נ\' מיגדל (1.1.2005)'};
 const nevo = (snippet:string, url='https://www.nevo.co.il/psika_html/elyon/93068210.htm') => ({url, snippet});
 it("Bank Mizrahi: a weaker scraper caption no longer blocks the trusted printed citation", () => {
   const pData = payload(scraper), vData = payload(nevo(`כפי שנפסק ב${full}, ניתן ביום 9.11.1995`));
   // Old failure: the scraper spelling cannot match the trusted citation.
   expect(findTypedPadiEvidence({...mizrahi,party1:'בנק המזרחי',party2:'מיגדל'},vData)).toEqual({kind:'none'});
   const bound = findTypedPadiCitation(mizrahi,[pData,null,vData]);
   expect(bound).toEqual({kind:'verified',party1:'בנק המזרחי המאוחד בע״מ',party2:'מגדל כפר שיתופי',
     publication:{padi_volume:'מט',padi_part:'4',padi_page:'221',year:'1995'},date:'9.11.1995'});
   if (bound.kind!=='verified') throw new Error('unreachable');
   expect(findTypedPadiEvidence({...mizrahi,party1:bound.party1,party2:bound.party2},vData)).toMatchObject({kind:'verified',publication:{padi_page:'221'}});
 });
 it("no trusted complete citation: no change (untrusted hosts are not added)", () => {
   expect(findTypedPadiCitation(mizrahi,[payload(scraper)])).toEqual({kind:'none'});
   expect(findTypedPadiCitation(mizrahi,[payload(nevo(full,'https://israel.com/he/court-rulings/ca-6821-93'))])).toEqual({kind:'none'});
   expect(findTypedPadiCitation(mizrahi,[payload(nevo('ע״א 6821/93 בנק המזרחי המאוחד בע״מ נ׳ מגדל כפר שיתופי (9.11.1995)'))])).toEqual({kind:'none'});
   expect(findTypedPadiCitation(mizrahi,[payload(nevo(full.replace('ע״א','רע״א')))])).toEqual({kind:'none'});
   expect(findTypedPadiCitation(mizrahi,[payload(nevo(full.replace('6821/93','6821/94')))])).toEqual({kind:'none'});
 });
 it("trusted sources that disagree on names or reporter leave the existing route unchanged", () => {
   expect(findTypedPadiCitation(mizrahi,[payload(nevo(full),nevo(full.replace('בנק המזרחי המאוחד בע״מ','בנק המזרחי'),'https://www.gov.il/x.pdf'))])).toEqual({kind:'conflict'});
   expect(findTypedPadiCitation(mizrahi,[payload(nevo(full)),payload(nevo(full.replace('221','222'),'https://fs.knesset.gov.il/a.pdf'))])).toEqual({kind:'conflict'});
   expect(findTypedPadiCitation(mizrahi,[payload(nevo(full),nevo(full))])).toMatchObject({kind:'verified',publication:{padi_page:'221'}});
 });
 it("already-working typed cases bind to the same parties and reporter as before", () => {
   const cases: Array<[{caseType:string;caseNumber:string;filingYear:number}, string, string, string, string]> = [
     [{caseType:'בג״ץ',caseNumber:'73/53',filingYear:1953},'בג״ץ 73/53 חברת “קול העם” בע״מ נ׳ שר הפנים, פ״ד ז 871 (1953)','חברת "קול העם" בע״מ','שר הפנים','871'],
     [{caseType:'ע״א',caseNumber:'4628/93',filingYear:1993},'ע״א 4628/93 מדינת ישראל נ׳ אפרופים שיכון ויזום (1991) בע״מ, פ״ד מט(2) 265 (1995)','מדינת ישראל','אפרופים שיכון ויזום (1991) בע״מ','265'],
     [{caseType:'ע״א',caseNumber:'5604/94',filingYear:1994},'בע״א 5604/94 חמד נ׳ מדינת ישראל, פ"ד נח(2), עמ׳ 498, (2004)','חמד','מדינת ישראל','498'],
     [{caseType:'בג״ץ',caseNumber:'7/48',filingYear:1948},'בג״ץ 7/48 אל־כרבוטלי נ׳ שר הביטחון, פ״ד ב 5, 15 (1949)','אל־כרבוטלי','שר הביטחון','5'],
   ];
   for (const [t, s, party1, party2, page] of cases) {
     const bound = findTypedPadiCitation(t,[payload(result(s))]);
     expect(bound).toMatchObject({kind:'verified',party1,party2,publication:{padi_page:page}});
     // Same proof the existing exact gate already gave with those parties.
     expect(findTypedPadiEvidence({...t,party1,party2},payload(result(s)))).toMatchObject({kind:'verified',publication:{padi_page:page}});
   }
 });
 it("a page citing two dockets never gives 6821/93 the other docket's reporter", () => {
   const afropim = 'ע״א 4628/93 מדינת ישראל נ׳ אפרופים שיכון ויזום (1991) בע״מ, פ״ד מט(2) 265 (1995)';
   expect(findTypedPadiCitation(mizrahi,[payload(nevo(`ע״א 6821/93 פלוני נ׳ אלמוני; ${afropim}`))])).toEqual({kind:'none'});
   expect(findTypedPadiCitation(mizrahi,[payload(nevo(`כפי שנקבע בע״א 6821/93, ראו ${afropim}`))])).toEqual({kind:'none'});
   expect(findTypedPadiCitation(mizrahi,[payload(nevo(`ע״א 6821/93 בנק המזרחי המאוחד בע״מ נ׳ מגדל כפר שיתופי (ראו גם ${afropim})`))])).toEqual({kind:'none'});
   expect(findTypedPadiCitation(mizrahi,[payload(nevo(`${afropim}; ${full}`))])).toMatchObject({kind:'verified',party2:'מגדל כפר שיתופי',publication:{padi_volume:'מט',padi_part:'4',padi_page:'221'}});
   expect(findTypedPadiCitation({caseType:'ע״א',caseNumber:'4628/93',filingYear:1993},[payload(nevo(`${full}; ${afropim}`))])).toMatchObject({kind:'verified',party1:'מדינת ישראל',publication:{padi_volume:'מט',padi_part:'2',padi_page:'265'}});
 });
});

describe("recognized Israeli case repositories (afiklaw, psikan)", () => {
 const mizrahi = {caseType:'ע״א', caseNumber:'6821/93', filingYear:1993};
 const full = 'ע״א 6821/93 בנק המזרחי המאוחד בע״מ נ׳ מגדל כפר שיתופי, פ״ד מט(4) 221 (1995)';
 const scraper = {url:'https://israel.com/he/court-rulings/ca-6821-93', snippet:'ע"א 6821/93 בנק המזרחי נ\' מיגדל (1.1.2005)'};
 it("are part of the printed-reporter search filter", () => {
   expect(PADI_EVIDENCE_DOMAINS).toEqual(expect.arrayContaining(['afiklaw.com','psikan.com']));
   expect(PADI_EVIDENCE_DOMAINS).not.toContain('takdin.co.il');
 });
 it("Bank Mizrahi: the afiklaw citation supplies parties and פ״ד despite the scraper spelling", () => {
   const bound = findTypedPadiCitation(mizrahi,[payload(scraper,{url:'https://he.afiklaw.com/caselaw/4390',snippet:full})]);
   expect(bound).toEqual({kind:'verified',party1:'בנק המזרחי המאוחד בע״מ',party2:'מגדל כפר שיתופי',
     publication:{padi_volume:'מט',padi_part:'4',padi_page:'221',year:'1995'},date:null});
 });
 it("psikan counts for the exact same-block citation only", () => {
   const t = {caseType:'ע״א',caseNumber:'5604/94',filingYear:1994};
   const s = 'ע״א 5604/94 חמד נ׳ מדינת ישראל, פ״ד נח(2) 498 (2004)';
   expect(findTypedPadiCitation(t,[payload({url:'https://psikan.com/rulings/x',snippet:s})])).toMatchObject({kind:'verified',party1:'חמד',party2:'מדינת ישראל',publication:{padi_page:'498'}});
   expect(findTypedPadiCitation(t,[payload({url:'https://psikan.com/rulings/x',snippet:`ע״א 5604/94 חמד נ׳ מדינת ישראל; ${full}`})])).toEqual({kind:'none'});
 });
 it("a repository disagreeing with another trusted source is a conflict, not a winner", () => {
   expect(findTypedPadiCitation(mizrahi,[payload({url:'https://he.afiklaw.com/caselaw/4390',snippet:full},{url:'https://www.nevo.co.il/a',snippet:full.replace('221','222')})])).toEqual({kind:'conflict'});
 });
 it.each(['https://afiklaw.com.evil.test/x','https://notafiklaw.com/x','http://he.afiklaw.com/x','https://psikan.com.example.org/x','https://www.takdin.co.il/x'])("rejects lookalike or excluded host %s", url => {
   expect(findTypedPadiCitation(mizrahi,[payload({url,snippet:full})])).toEqual({kind:'none'});
 });
});

describe("source reporter without a parenthesized year (repository headings)", () => {
 const mizrahi = {caseType:'ע״א', caseNumber:'6821/93', filingYear:1993};
 const head = 'עא 6821/93 בנק המזרחי המאוחד בע"מ נ\' מגדל כפר שיתופי, פ"ד מט(4) 221';
 const afik = (snippet:string) => ({url:'https://he.afiklaw.com/caselaw/4390', snippet});
 const scraper = {url:'https://israel.com/he/court-rulings/ca-6821-93', snippet:'ע"א 6821/93 בנק המזרחי נ\' מיגדל (1.1.2005)'};
 const expected = {kind:'verified',party1:'בנק המזרחי המאוחד בע"מ',party2:'מגדל כפר שיתופי',
   publication:{padi_volume:'מט',padi_part:'4',padi_page:'221',year:'1995'},date:'9.11.1995'};
 it("Bank Mizrahi: the Afik heading with the date on the next line binds parties, פ״ד and year", () => {
   expect(findTypedPadiCitation(mizrahi,[payload(scraper,afik(`${head} · פסקי דין · אפיק ושות׳\n09 נובמבר 1995`))])).toEqual(expected);
 });
 it("reads a numeric or ב-prefixed Hebrew-month date the same way", () => {
   expect(findTypedPadiCitation(mizrahi,[payload(afik(`${head}\n9.11.1995`))])).toEqual(expected);
   expect(findTypedPadiCitation(mizrahi,[payload(afik(`${head}, ניתן 9 בנובמבר 1995`))])).toEqual(expected);
 });
 it("never takes the year from the volume alone: no date means no proof", () => {
   expect(findTypedPadiCitation(mizrahi,[payload(afik(head))])).toEqual({kind:'none'});
   expect(findTypedPadiCitation(mizrahi,[payload(afik(`${head} · פסקי דין · אפיק ושות׳`))])).toEqual({kind:'none'});
 });
 it("rejects a date that is far away, after other numbers, impossible, or after another docket", () => {
   expect(findTypedPadiCitation(mizrahi,[payload(afik(`${head} ${'מילים רבות בדף '.repeat(6)}9.11.1995`))])).toEqual({kind:'none'});
   expect(findTypedPadiCitation(mizrahi,[payload(afik(`${head} עמודים 30\n9.11.1995`))])).toEqual({kind:'none'});
   expect(findTypedPadiCitation(mizrahi,[payload(afik(`${head}\n31 נובמבר 1995`))])).toEqual({kind:'none'});
   expect(findTypedPadiCitation(mizrahi,[payload(afik(`${head}; ע"א 4628/93 מדינת ישראל נ' אפרופים 9.11.1995`))])).toEqual({kind:'none'});
 });
 it("a detached date that disagrees with another trusted source's year is a conflict", () => {
   const nevo = {url:'https://www.nevo.co.il/a', snippet:'ע״א 6821/93 בנק המזרחי המאוחד בע"מ נ\' מגדל כפר שיתופי, פ״ד מט(4) 221 (1996)'};
   expect(findTypedPadiCitation(mizrahi,[payload(afik(`${head}\n9.11.1995`),nevo)])).toEqual({kind:'conflict'});
 });
 it("untrusted hosts still never count, even with the date", () => {
   expect(findTypedPadiCitation(mizrahi,[payload({...afik(`${head}\n9.11.1995`),url:'https://israel.com/he/x'})])).toEqual({kind:'none'});
 });
 it("the formatted answer itself must still print the year", () => {
   const t = {...mizrahi,party1:'בנק המזרחי המאוחד בע"מ',party2:'מגדל כפר שיתופי'};
   const ev = findTypedPadiEvidence(t,payload(afik(`${head}\n9.11.1995`)));
   expect(ev).toMatchObject({kind:'verified',publication:{year:'1995'},date:'9.11.1995'});
   expect(typedPadiDraftMatches(t,ev,`ע"א 6821/93 בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי, פ"ד מט(4) 221 (1995)`)).toBe(true);
   expect(typedPadiDraftMatches(t,ev,`ע"א 6821/93 בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי, פ"ד מט(4) 221`)).toBe(false);
 });
 it("Rule 18: a paragraph/judge pinpoint before the closing year is still the verified citation", () => {
   const t = {...mizrahi,party1:'בנק המזרחי המאוחד בע"מ',party2:'מגדל כפר שיתופי'};
   const ev = findTypedPadiEvidence(t,payload(afik(`${head}\n9.11.1995`)));
   expect(typedPadiDraftMatches(t,ev,`ע"א 6821/93 בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי, פ"ד מט(4) 221, פס' 3 לפסק דינו של הנשיא ברק (1995).`)).toBe(true);
   expect(typedPadiDraftMatches(t,ev,`ע"א 6821/93 בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי, פ"ד מט(4) 222, פס' 3 לפסק דינו של הנשיא ברק (1995).`)).toBe(false);
 });
});
