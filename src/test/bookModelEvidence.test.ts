import {describe,it,expect} from 'vitest';
import {validateBookModelEvidence as validate, validBookIsbn, canonicalBookIsbn, buildBookEvidencePrompt, BOOK_EVIDENCE_LIMITS, type BookEvidencePacket} from '../../supabase/functions/_shared/citationPure/bookModelEvidence';
const quote='J. R. Vale. A Small Book. Publication 1991. ISBN 9780306406157.';
const packet:BookEvidencePacket={title:'A Small Book',author:'J.R. Vale',sources:[{id:'s',text:`Catalog\n${quote}\nEnd`}]};
const record={title:packet.title,author:'Vale, J. R.',year:'1991',isbn:'9780306406157',quote,sourceId:'s',kind:'publication'};
const run=(change:Record<string,unknown>={},p=packet)=>validate([{...record,...change}],p);
describe('generic source-grounded book evidence',()=>{
 it('normalizes spaced initials and byline order without replacing user strings',()=>{expect(run().records[0]).toMatchObject({title:packet.title,author:packet.author,year:'1991'});});
 it('matches compact uppercase initials in a public byline to explicit target initials',()=>{
  const p={...packet,author:'H. L. A. Hart',title:'The Concept of Law'};
  const q='The Concept of Law. HLA Hart. Publication 1994. ISBN 9780306406157.';
  const r={...record,author:'HLA Hart',title:p.title,year:'1994',quote:q};
  expect(validate([r],{...p,sources:[{id:'s',text:q}]}).records).toHaveLength(1);
  for(const author of ['Hla Hart','HXA Hart','Herbert Lionel Adolphus Hart']){
    const other=q.replace('HLA Hart',author);
    expect(validate([{...r,author,quote:other}],{...p,sources:[{id:'s',text:other}]}).records).toHaveLength(0);
  }
 });
 it('does not split an uppercase full-name token without explicit matching target initials',()=>{
  const p={...packet,author:'Hla Hart'};const q=quote.replace('J. R. Vale','HLA Hart');
  expect(validate([{...record,author:'H. L. A. Hart',quote:q}],{...p,sources:[{id:'s',text:q}]}).records).toHaveLength(0);
 });
 it('keeps title order and requires a consecutive quoted title',()=>{
  const p={...packet,title:'A Theory of Justice'};
  const q=quote.replace('A Small Book',p.title);
  const r={...record,title:p.title,quote:q};
  expect(validate([r],{...p,sources:[{id:'s',text:q}]}).records).toHaveLength(1);
  const rearranged=q.replace(p.title,'A Justice of Theory');
  expect(validate([{...r,title:'A Justice of Theory',quote:rearranged}],{...p,sources:[{id:'s',text:rearranged}]}).records).toHaveLength(0);
  const dispersed=q.replace(p.title,'A Theory was discussed. Other books cover questions of Justice');
  expect(validate([{...r,quote:dispersed}],{...p,sources:[{id:'s',text:dispersed}]}).records).toHaveLength(0);
 });
 it('permits only explicitly marked quoted subtitles when input gives main title',()=>{
  const full=packet.title+': An Introduction', q=quote.replace(packet.title,full);
  const p={...packet,sources:[{id:'s',text:q}]};
  expect(validate([{...record,title:full,quote:q}],p).records).toHaveLength(1);
  expect(validate([{...record,quote:q}],p).records).toHaveLength(1);
  expect(validate([{...record,title:packet.title+' An Introduction',quote:q}],p).records).toHaveLength(0);
  expect(validate([{...record,quote:q}],{...p,title:full}).records).toHaveLength(0);
 });
 it('accepts whitespace normalization only',()=>{expect(run({quote:quote.replaceAll(' ','\n ')}).records).toHaveLength(1);expect(run({quote:quote.replace('Publication','…')}).records).toHaveLength(0);});
 for(const [field,value] of [['title','A Different Book'],['author','J. X. Vale'],['year','1992'],['isbn','9780140328721'],['sourceId','other'],['kind','review'],['format','audiobook'],['format','unknown'],['translated',true],['isbn','9780306406158'],['year',1991]])it(`rejects ${field} ${value}`,()=>expect(run({[field]:value}).records).toHaveLength(0));
 it('rejects unquoted author and title even with matching model claims',()=>{const q='Publication 1991. ISBN 9780306406157.';expect(run({quote:q},{...packet,sources:[{id:'s',text:q}]}).records).toHaveLength(0);});
 it('does not infer full forenames from initials',()=>expect(run({author:'John Richard Vale'}).records).toHaveLength(0));
 it('supports original-language exact works without English-only rules',()=>{const q='Émile Durand. La pensée. Publication 1991. ISBN 9780306406157.';const p={title:'La pensée',author:'Émile Durand',sources:[{id:'s',text:q}]};expect(validate([{...record,title:p.title,author:p.author,quote:q}],p).records).toHaveLength(1);});
 it('allows explicitly anchored translations only with quoted version/language',()=>{const q=quote+' English translation.';expect(run({quote:q,translated:true,language:'English',version:'translation'},{...packet,language:'English',version:'translation',sources:[{id:'s',text:q}]}).records).toHaveLength(1);});
 it('preserves supplied year, ISBN, edition and format',()=>{for(const p of [{year:'1992'},{isbn:'9780140328721'},{edition:'second edition'},{format:'ebook' as const}])expect(run({}, {...packet,...p}).records).toHaveLength(0);});
 it('validates checksum and canonicalizes equivalent ISBN10 and ISBN13',()=>{expect(validBookIsbn('0-8044-2957-X')).toBe(true);expect(canonicalBookIsbn('0-306-40615-2')).toBe('9780306406157');});
 it('abstains for conflicting year on equivalent ISBNs, even with supplied year',()=>{const second={...record,year:'1993',isbn:'0306406152',sourceId:'t',quote:quote.replace('1991','1993').replace('9780306406157','0306406152')};const p={...packet,sources:[...packet.sources,{id:'t',text:second.quote}]};for(const supplied of [p,{...p,year:'1991'}]){const r=validate([record,second],supplied);expect(r.options).toHaveLength(0);expect(r.conflictingIsbns).toEqual(['9780306406157']);}});
 it('offers distinct verified years for distinct ISBNs',()=>{const second={...record,year:'1993',isbn:'9780140328721',sourceId:'t',quote:quote.replace('1991','1993').replace('9780306406157','9780140328721')};expect(validate([record,second],{...packet,sources:[...packet.sources,{id:'t',text:second.quote}]}).options.map(r=>r.year)).toEqual(['1991','1993']);});
 it('deduplicates equivalent ISBN aliases on one source',()=>{const alias={...record,isbn:'0306406152',quote:quote+' ISBN 0306406152.'};expect(validate([record,alias],{...packet,sources:[{id:'s',text:alias.quote}]}).records).toHaveLength(1);});
 it('fails closed on duplicate ambiguous source ids',()=>expect(run({}, {...packet,sources:[...packet.sources,{id:'s',text:'other'}]}).records).toHaveLength(0));
 it('rejects malformed and oversized data without throwing',()=>{for(const value of [null,{},'json',Array(25).fill(record)])expect(validate(value,packet).records).toHaveLength(0);expect(run({}, {...packet,sources:[{id:'s',text:'x'.repeat(BOOK_EVIDENCE_LIMITS.sourceChars+1)}]}).records).toHaveLength(0);});
 it('never puts target or user supplied constraints into model prompt',()=>{const prompt=buildBookEvidencePrompt({...packet,title:'PRIVATE TITLE',author:'PRIVATE NAME',edition:'PRIVATE EDITION'})!;expect(prompt).not.toContain('PRIVATE');expect(JSON.parse(prompt).sources).toEqual(packet.sources);});
 it('does not overclaim semantic binding of an incidental year',()=>{const q=quote.replace('Publication 1991','Reviewed 1991');const r=run({quote:q},{...packet,sources:[{id:'s',text:q}]});expect(r.records).toHaveLength(1);expect(r.limitation).toContain('do not establish');});
 it('rejects hidden year/ISBN fragments inside longer tokens',()=>{const q=quote.replace('1991','11991').replace('9780306406157','19780306406157');expect(run({quote:q},{...packet,sources:[{id:'s',text:q}]}).records).toHaveLength(0);});
});
