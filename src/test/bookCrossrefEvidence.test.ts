import {describe,it,expect} from 'vitest';
import {readCrossrefBookProof as read,readBookCrossrefEvidence as accept,type BookCrossrefRow} from '../../supabase/functions/_shared/citationPure/bookCrossrefEvidence';
const title="Brownlie's Principles of Public International Law",author='James Crawford',isbn='9780199699698';
const raw=`${title} by ${author}`,fields={bookTitle:title,authors:author};
const request={kind:'book',jurisdiction:'OTHER',rawInput:raw,parsedFields:fields};
// Frozen field projection of publisher-deposited Crossref record. No IO.
const book={type:'edited-book',title:[title],author:[{given:'James',family:'Crawford'}],ISBN:[isbn,'9780191764622'],'isbn-type':[{type:'print',value:isbn},{type:'electronic',value:'9780191764622'}],DOI:'10.1093/he/9780199699698.001.0001',URL:'https://doi.org/10.1093/he/9780199699698.001.0001','published-print':{'date-parts':[[2012,9,27]]},'published-online':{'date-parts':[[2013,6]]},'edition-number':'8'};
const envelope=(items:unknown[])=>({status:'ok','message-type':'work-list',message:{items}});
const proof=(patch:Record<string,unknown>={})=>read(envelope([{...book,...patch}]),{title,author,isbn});
const row:BookCrossrefRow={title,authors:author,isbn,year:'2012',edition:'8',doi:book.DOI};
const response=(rows:unknown[]=[row])=>({kind:'book',jurisdiction:'OTHER',bookCrossrefEvidence:{version:1,rows}});
const second:BookCrossrefRow={...row,isbn:'9780198737445',year:'2019',edition:'9',doi:'10.1093/he/9780198737445.001.0001'};
describe('Crossref explicit print book parser',()=>{
 it('reads printed eighth edition, not later online year',()=>expect(proof()).toEqual([row]));
 it('requires explicit numeric edition',()=>{for(const value of [undefined,null,'revised','8th',8,'0','100'])expect(proof({'edition-number':value})).toEqual([]);});
 it('rejects title/byline and print ISBN mismatch',()=>{for(const patch of [{title:['Other']},{author:[{given:'James',family:'Other'}]},{author:[...book.author,{given:'Second',family:'Author'}]},{'isbn-type':[{value:isbn,type:'electronic'}]},{ISBN:['9780191764622']}])expect(proof(patch)).toEqual([]);});
 it('requires complete coauthors, not first-author-only',()=>{const two={...book,author:[{given:'James',family:'Crawford'},{given:'Jane',family:'Smith'}]};expect(read(envelope([two]),{title,author:'James Crawford & Jane Smith',isbn})).toHaveLength(1);expect(read(envelope([two]),{title,author,isbn})).toEqual([]);});
 it('preserves author grouping and ordering rather than mixing surnames',()=>{
  const actual={...book,author:[{given:'Richard',family:'Whish'},{given:'David',family:'Bailey'}]};
  expect(read(envelope([actual]),{title,author:'Richard Whish and David Bailey',isbn})).toHaveLength(1);
  for(const wrong of ['Richard Bailey & David Whish','David Bailey & Richard Whish','Richard Whish David Bailey','R. Whish & D. Bailey'])expect(read(envelope([actual]),{title,author:wrong,isbn})).toEqual([]);
  const target={bookTitle:title,authors:'Richard Whish & David Bailey'},input=`${title} by ${target.authors}`;
  expect(accept({...request,rawInput:input,parsedFields:target},input,response([{...row,authors:'Richard Bailey & David Whish'}]),target)).toBeNull();
 });
 it('accepts book and monograph; rejects chapters and articles',()=>{for(const type of ['book','monograph'])expect(proof({type})).toHaveLength(1);for(const type of ['book-chapter','journal-article'])expect(proof({type})).toEqual([]);});
 it('never substitutes online, copyright or issued dates',()=>expect(proof({'published-print':undefined,'copyright-year':2012,issued:{'date-parts':[[2012]]}})).toEqual([]));
 it('rejects malformed dates, unsafe DOI and resolver URL',()=>{for(const patch of [{'published-print':{'date-parts':[[2012,2,31]]}},{DOI:'10.1234/../x'},{DOI:'10.1234/x?next=y'},{URL:'https://evil.example/x'},{URL:book.URL+'#x'}])expect(proof(patch)).toEqual([]);});
 it('deduplicates exact rows, abstains on competing ISBN deposits',()=>{expect(read(envelope([book,book]),{title,author,isbn})).toHaveLength(1);for(const patch of [{'edition-number':'9'},{'published-print':{'date-parts':[[2013]]}},{author:[{given:'Other',family:'Author'}]}])expect(read(envelope([book,{...book,...patch}]),{title,author,isbn})).toEqual([]);});
 it('supports work envelopes and safely rejects malformed payload',()=>{expect(read({status:'ok','message-type':'work',message:book},{title,author,isbn})).toHaveLength(1);for(const payload of [null,{},envelope([null]),envelope(Array(101).fill(book))])expect(read(payload,{title,author,isbn})).toEqual([]);});
});
describe('transient Crossref proof rebinding',()=>{
 it('accepts bound explicit rows and clean empty results',()=>{expect(accept(request,raw,response(),fields)).toEqual([row]);expect(accept(request,raw,response([]),fields)).toEqual([]);});
 it('rejects stale raw, wrong kind/jurisdiction, absent or conflicting parsed identity',()=>{for(const patch of [{rawInput:raw+' changed'},{kind:'book_chapter'},{jurisdiction:'US'},{parsedFields:{}},{parsedFields:{...fields,authors:'Other'}}])expect(accept({...request,...patch},raw,response(),fields)).toBeNull();for(const patch of [{kind:'book_chapter'},{jurisdiction:'US'},{rawInput:'Other'}])expect(accept(request,raw,{...response(),...patch},fields)).toBeNull();});
 it('rejects every supplied year/isbn/edition/role without overwriting it',()=>{for(const key of ['year','isbn','edition','editor','editors','translator','translators'])expect(accept({...request,parsedFields:{...fields,[key]:'supplied'}},raw,response(),{...fields,[key]:'supplied'})).toBeNull();});
 it('does not let omitted parsed fields hide raw year/ISBN/edition',()=>{for(const suffix of [' 2012',' ISBN 9780199699698',' 8th ed.']){const changed=raw+suffix;expect(accept({...request,rawInput:changed},changed,response(),fields)).toBeNull();}});
 it('caps rows, validates envelope and permits no unknown row authority fields',()=>{expect(accept(request,raw,response(Array(5).fill(row)),fields)).toBeNull();expect(accept(request,raw,response([{...row,verified:true}]),fields)).toBeNull();expect(accept(request,raw,{...response(),bookCrossrefEvidence:{version:2,rows:[]}},fields)).toBeNull();});
 it('rejects malformed and identity-swapped rows',()=>{for(const patch of [{title:'Other'},{authors:'Other'},{isbn:'bad'},{year:2012},{year:'19999'},{edition:'eighth'},{doi:'10.1234/x#y'}])expect(accept(request,raw,response([{...row,...patch}]),fields)).toBeNull();});
 it('canonicalizes equivalent ISBN, deduplicates and rejects conflicts',()=>{expect(accept(request,raw,response([row,row]),fields)).toEqual([row]);for(const patch of [{year:'2013'},{edition:'9'},{doi:'10.1234/other'}])expect(accept(request,raw,response([row,{...row,...patch}]),fields)).toBeNull();});
 it('permits independent same-year distinct editions, never same-edition different years',()=>{expect(accept(request,raw,response([row,{...second,year:row.year}]),fields)).toHaveLength(2);expect(accept(request,raw,response([row,{...second,edition:row.edition}]),fields)).toBeNull();});
 it('requires exact parsed/local fields and raw containment',()=>{expect(accept(request,raw,response(),{...fields,authors:'Crawford, James'})).toBeNull();const r={...request,rawInput:'Other'};expect(accept(r,'Other',response(),fields)).toBeNull();});
});

import {readCrossrefSearchProof as search} from '../../supabase/functions/_shared/citationPure/bookCrossrefEvidence';
import frozen from './fixtures/bookCrossrefRoute.frozen.json';
describe('direct Crossref search proof without catalog dependency',()=>{
 it('frozen Brownlie returns exactly editions eight and nine',()=>expect(search(frozen.brownlie,{title,author}).map(r=>[r.year,r.edition])).toEqual([['2012','8'],['2019','9']]));
 it('frozen National Identity false-positive search stays empty',()=>expect(search(frozen.smith,{title:'National Identity',author:'Anthony D. Smith'})).toEqual([]));
 it('frozen Whish returns nine/ten/eleven, ignores electronic and reversed-author record',()=>expect(search(frozen.whish,{title:'Competition Law',author:'Richard Whish & David Bailey'}).map(r=>[r.year,r.edition])).toEqual([['2018','9'],['2021','10'],['2024','11']]));
 it('ranking and other-title/author records have no effect',()=>expect(search(envelope([{...book,title:['Other']},{...book,author:[{given:'Wrong',family:'Name'}]},book]),{title,author})).toEqual([row]));
 it('missing or malformed edition cannot become a choice',()=>{for(const edition of [undefined,'0','8th',8])expect(search(envelope([{...book,'edition-number':edition}]),{title,author})).toEqual([]);});
 it('an unnumbered same-ISBN different year vetoes proven edition',()=>expect(search(envelope([book,{...book,'edition-number':undefined,'published-print':{'date-parts':[[2013]]}}]),{title,author})).toEqual([]));
 it('unresolved same-date record does not veto or synthesize',()=>expect(search(envelope([book,{...book,'edition-number':undefined}]),{title,author})).toEqual([row]));
 it('same edition conflicting years vetoes independent ISBNs',()=>{const newer={...book,ISBN:[second.isbn],'isbn-type':[{value:second.isbn,type:'print'}],DOI:second.doi,URL:`https://doi.org/${second.doi}`,'published-print':{'date-parts':[[2019]]}};expect(search(envelope([book,newer]),{title,author})).toEqual([]);});
 it('more than four distinct proven editions fails closed instead of truncating',()=>{const ids=['9780199699698','9780198737445','9780198836322','9780198779063','9780198906032'];const items=ids.map((id,i)=>({...book,ISBN:[id],'isbn-type':[{value:id,type:'print'}],DOI:`10.1234/book${i}`,URL:`https://doi.org/10.1234/book${i}`,'edition-number':String(i+1)}));expect(search(envelope(items),{title,author})).toEqual([]);expect(search(envelope(items.slice(0,4)),{title,author})).toHaveLength(4);});
});
