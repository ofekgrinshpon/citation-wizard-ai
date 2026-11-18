import { it, expect } from 'vitest';
import { resolveBookCompletion, selectBookEditionChoice } from '../../supabase/functions/_shared/citationPure/bookFinal';
const raw = 'National Identity by Anthony D. Smith';
const fields = { authors:'Anthony D. Smith',bookTitle:'National Identity' };
const request = {kind:'book',jurisdiction:'OTHER',rawInput:raw,parsedFields:fields};
function response(two=false): any {
 const records = [{sourceId:'a',title:fields.bookTitle,author:fields.authors,year:'1993',isbn:'9780874172041',kind:'publication',quote:'National Identity by Anthony D. Smith Paperback 9780874172041 Published March 1, 1993'}];
 if(two) records.push({...records[0],sourceId:'b',year:'1994',isbn:'9780198761228',quote:'National Identity by Anthony D. Smith Paperback 9780198761228 Published 1994'});
 return {kind:'book',jurisdiction:'OTHER',identity:{matched:true,anchors:['title:National Identity'],conflicts:two?['year:editions:1993,1994']:[]},sources:[],fields:{},grounded:{},provenance:{},bookModelEvidence:{version:1,records,sources:records.map(r=>({id:r.sourceId,url:`https://example.org/${r.sourceId}`,text:r.quote}))}};
}
const resolve = (r=response()) => resolveBookCompletion(request,raw,r,fields,undefined,['year']);
it('accepts quoted year, not edition, and carries no choice for one year',()=>{const r=resolve();expect(r.completion.fields.year).toBe('1993');expect(r.completion.fields.edition).toBeUndefined();expect(r.bookEditionChoice).toBeUndefined();});
it('offers years, selects locally and rejects stale/altered proof',()=>{const c=resolve(response(true)).bookEditionChoice!;expect(c.options.length).toBe(2);expect(selectBookEditionChoice(c,'book-year-1994',raw)?.completion.fields.year).toBe('1994');expect(selectBookEditionChoice(c,'keep-missing',raw)?.completion.fields.year).toBeUndefined();expect(selectBookEditionChoice(c,'book-year-1993',raw+' ')).toBeNull();(c.response as any).bookModelEvidence.sources[0].text+=' altered';expect(selectBookEditionChoice(c,'book-year-1994',raw)).toBeNull();});
it.each(['wrong title','wrong author','edited quote','credentials','oversized','empty','bad version'])('fails closed: %s',which=>{const r=response(),e=r.bookModelEvidence;if(which==='wrong title')e.records[0].title='Other';if(which==='wrong author')e.records[0].author='John Smith';if(which==='edited quote')e.records[0].quote+=' fabricated';if(which==='credentials')e.sources[0].url='https://user:pass@example.org';if(which==='oversized')e.sources[0].text+='x'.repeat(1501);if(which==='empty')e.records=[];if(which==='bad version')e.version=2;expect(resolve(r).completion.fields.year).toBeUndefined();});
it('rejects wrong kind and altered local target',()=>{expect(resolveBookCompletion({...request,kind:'book_chapter'},raw,response(),fields,undefined,['year']).completion.fields.year).toBeUndefined();expect(resolveBookCompletion(request,raw,response(),{...fields,authors:'John Smith'},undefined,['year']).completion.fields.year).toBeUndefined();});
it('rejects conflicting same ISBN years',()=>{const r=response(true);r.bookModelEvidence.records[1].isbn='9780874172041';r.bookModelEvidence.records[1].quote=r.bookModelEvidence.records[1].quote.replace('9780198761228','9780874172041');r.bookModelEvidence.sources[1].text=r.bookModelEvidence.records[1].quote;expect(resolve(r).bookEditionChoice).toBeUndefined();expect(resolve(r).completion.fields.year).toBeUndefined();});
it('rejects unrepresented supplied translator constraints',()=>{expect(resolveBookCompletion(request,raw,response(),{...fields,translators:'Someone'},undefined,['year']).completion.fields.year).toBeUndefined();});
it('frames final text only; reload retains accepted year but not transient evidence/choices',async()=>{
 const { frameBookFinal,readBookFinal,eligibleBookCompletion }=await import('../../supabase/functions/_shared/citationPure/bookFinal');
 const frameRaw='Author: Anthony D. Smith; Book: National Identity';
 const input:any={messages:[{role:'user',content:frameRaw}],rawInput:frameRaw,foreignLookup:{...request,rawInput:frameRaw,parsedFields:eligibleBookCompletion('foreign_book',frameRaw)!.wire,enabled:true},batchId:null};
 const result=resolve();const framed=frameBookFinal(input,'r1',result.reply);
 expect(framed).not.toContain('bookModelEvidence');expect(framed).not.toContain('9780874172041');expect(framed).not.toContain('example.org');
 expect(readBookFinal(framed,input,'r1')?.reply).toContain('1993');
 expect(readBookFinal(framed,{...input,rawInput:raw+' changed'},'r1')).toBeNull();
 expect(readBookFinal(framed,input,'r2')).toBeNull();
});
it('pins supplied edition rather than choosing an unanchored year',()=>{
 const pinnedRaw=raw+'; Edition: 2nd ed.';const pinned={...fields,edition:'2nd ed.'};
 expect(resolveBookCompletion({...request,rawInput:pinnedRaw,parsedFields:pinned},pinnedRaw,response(),pinned,undefined,['year']).completion.fields.year).toBeUndefined();
});
it('cannot use the experimental envelope for ISBN-only lookup',()=>{
 const isbnRaw='ISBN: 9780874172041';expect(resolveBookCompletion({...request,rawInput:isbnRaw},isbnRaw,response(),fields,undefined,['year']).completion.fields.year).toBeUndefined();
});
