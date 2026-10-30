import {it,expect} from 'vitest';
import {mapWordSources,wordSourceIdentity,validateWordSource} from './wordSourceMap';
const A='Brown v. Board of Education, 347 U.S. 483 (1954)';
const B='Roe v. Wade, 410 U.S. 113 (1973)';
const note=(text:string)=>({id:'42',text,editableRanges:[{start:0,end:text.length}],paragraphRanges:[{start:0,end:text.length}]});
it('maps two complete independently parsed cases and preserves separator offsets',()=>{
 expect(wordSourceIdentity(A)).not.toBeNull();const n=note(A+'; '+B),plan=mapWordSources(n,[]);
 expect(plan.kind).toBe('mapped');expect(plan.sources.map(s=>s.input)).toEqual([A,B]);expect(plan.sources[1].start).toBe(A.length+2);
 expect(validateWordSource(n,[],plan.sources[0])).toBe(true);expect(validateWordSource(n,[],{...plan.sources[0],input:'wrong'})).toBe(false);
});
it('does not promote arbitrary split fragments into sources or concatenate around protection',()=>{
 for(const raw of ['A (2020); B (2021)',A+'; explanatory text',A+' and '+B])expect(mapWordSources(note(raw),[]).kind).toBe('unresolved');
 const raw=A+' PROTECTED '+B;const plan=mapWordSources(note(raw),[{start:A.length,end:A.length+11}]);expect(plan.sources.map(s=>s.input)).toEqual([A,B]);
});
it('standalone DOI identities do not turn attached explanatory text into identified sources',()=>{
 expect(wordSourceIdentity('doi:10.1000/abc')?.key).toBe('doi:10.1000/abc');expect(wordSourceIdentity('explanation doi:10.1000/abc')).toBeNull();
});

it('reuses the Hebrew journal grammar with full supplied tuple and lossless token roundtrip',()=>{
 const article='יעל דוגמה "משפט וצדק" משפטים כ 123 (2020)';
 expect(wordSourceIdentity(article)?.kind).toBe('journal_article');
 expect(wordSourceIdentity(article+' הסבר אחרי')).toBeNull();
 const n=note(article+'; '+article.replace('123','456'));
 expect(mapWordSources(n,[]).sources).toHaveLength(2);
});

it('fails closed for stale bounds, newly protected source, and punctuation inside a source title',()=>{
 const n=note(A+'; '+B),s=mapWordSources(n,[]).sources[0];expect(validateWordSource(n,[{start:0,end:A.length}],s)).toBe(false);
 expect(validateWordSource(note('prefix '+n.text),[],s)).toBe(false);
 expect(mapWordSources(note('יעל דוגמה "משפט; וצדק" משפטים כ 123 (2020); '+A),[]).kind).toBe('unresolved');
});
