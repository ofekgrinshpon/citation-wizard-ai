/** Offline record-local Crossref adapter. Metadata proves only what Crossref's
 * deposit states, not publisher accuracy. No online/copyright date fallback and
 * no synthesis of an edition from ISBN, DOI path, year or work title. */
import {normalizeBookIsbn as canonicalIsbn, extractBookIsbn} from './bookIsbn.ts';
import {suppliedLookupFieldsMatch} from '../pastedCitation.ts';
export interface BookCrossrefRow {isbn:string;year:string;edition:string;doi:string;title:string;authors:string}
export type BookCrossrefEvidence={version:1;rows:BookCrossrefRow[]};
type ObjectRecord=Record<string,unknown>;
const object=(v:unknown):ObjectRecord|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as ObjectRecord:null;
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=2000&&!/[\u0000-\u001f]/.test(v);
function decode(s:string):string {
 return s.replace(/&(amp|quot|apos|nbsp|#39|#x27);/gi,(_,key:string)=>({amp:'&',quot:'"',apos:"'",nbsp:' ','#39':"'",'#x27':"'"}[key.toLowerCase()]!));
}
const normalize=(s:string)=>decode(s).normalize('NFKC').toLowerCase().replace(/(?<=\p{L})['’](?=\p{L})/gu,'').replace(/[\p{P}\p{S}]+/gu,' ').replace(/\s+/g,' ').trim();
// Preserve each person's tokens and byline order. Only explicit conjunctions
// normalize to one separator; never shuffle forenames/surnames across people.
const authorKey=(s:string)=>decode(s).split(/\s*(?:&|\band\b)\s*/iu).map(normalize).join(' | ');
function completeAuthors(value:unknown):string|null {
 if(!Array.isArray(value)||!value.length||value.length>30)return null;
 const names:string[]=[];
 for(const raw of value){
  const person=object(raw);if(!person)return null;
  let name:string;
  if(text(person.given)&&text(person.family)&&person.name===undefined)name=`${person.given} ${person.family}`;
  else if(text(person.name)&&person.given===undefined&&person.family===undefined)name=person.name;
  else return null;
  if(person.suffix!==undefined){if(!text(person.suffix))return null;name+=` ${person.suffix}`;}
  if(person.role!==undefined&&(!Array.isArray(person.role)||person.role.some(r=>object(r)?.role!=='author')))return null;
  if(!authorKey(name)||names.some(n=>authorKey(n)===authorKey(name)))return null;
  names.push(name);
 }
 return names.join(' & ');
}
function printYear(value:unknown):string|null {
 const parts=object(value)?.['date-parts'];
 if(!Array.isArray(parts)||parts.length!==1||!Array.isArray(parts[0]))return null;
 const [y,m,d]=parts[0];
 if(parts[0].length<1||parts[0].length>3||!parts[0].every(Number.isInteger)||y<1500||y>2099)return null;
 if(m!==undefined&&(m<1||m>12))return null;
 if(d!==undefined&&(d<1||d>new Date(Date.UTC(y,m,0)).getUTCDate()))return null;
 return String(y);
}
function safeDoi(record:ObjectRecord):{doi:string;url:string}|null {
 if(!text(record.DOI))return null;
 const doi=record.DOI.toLowerCase();
 // Restrict to unambiguous DOI paths: no URL delimiters, escape sequences,
 // credentials, dot-segment normalization or invisible/control characters.
 if(!/^10\.\d{4,9}\/[a-z0-9._;()/:+-]+$/.test(doi)||doi.split('/').some(p=>p==='.'||p==='..'))return null;
 const url=`https://doi.org/${doi}`;
 if(record.URL!==undefined){
  if(!text(record.URL)||/[\\\s%?#]/.test(record.URL))return null;
  try{const u=new URL(record.URL);if(u.protocol!=='https:'||u.hostname!=='doi.org'||u.username||u.password||u.port||u.href.toLowerCase()!==url)return null;}catch{return null;}
 }
 return {doi,url};
}
function claimsIsbn(record:ObjectRecord,expected:string):boolean {
 const top=Array.isArray(record.ISBN)?record.ISBN:[];
 const typed=Array.isArray(record['isbn-type'])?record['isbn-type']:[];
 return [...top,...typed.map(v=>object(v)?.value)].some(v=>typeof v==='string'&&canonicalIsbn(v)===expected);
}
function readOne(record:ObjectRecord,expected:{title:string;author:string;isbn:string}, allowUnresolvedEdition=false):BookCrossrefRow|null {
 if(!['book','edited-book','monograph'].includes(record.type as string))return null;
 if(!Array.isArray(record.title)||record.title.length!==1||!text(record.title[0]))return null;
 let title=record.title[0];
 if(record.subtitle!==undefined){if(!Array.isArray(record.subtitle)||record.subtitle.length>1||record.subtitle.some(v=>!text(v)))return null;if(record.subtitle.length)title+=`: ${record.subtitle[0]}`;}
 const author=completeAuthors(record.author);
 if(!author||normalize(title)!==normalize(expected.title)||authorKey(author)!==authorKey(expected.author))return null;
 const types=record['isbn-type'];
 if(!Array.isArray(types)||!types.length||types.length>30||!Array.isArray(record.ISBN)||!record.ISBN.length||record.ISBN.length>30)return null;
 const declared:string[]=[];
 for(const value of record.ISBN){if(typeof value!=='string')return null;const isbn=canonicalIsbn(value);if(!isbn)return null;declared.push(isbn);}
 let matched=false;
 for(const item of types){
  const row=object(item);if(!row||typeof row.value!=='string'||!['print','electronic'].includes(row.type as string))return null;
  const isbn=canonicalIsbn(row.value);if(!isbn||!declared.includes(isbn))return null;
  if(isbn===expected.isbn){if(row.type!=='print')return null;matched=true;}
 }
 if(!matched)return null;
 const year=printYear(record['published-print']),doi=safeDoi(record);if(!year||!doi)return null;
 const explicit=record['edition-number'];
 const edition=typeof explicit==='string'&&/^([1-9]\d?)$/.test(explicit)?explicit:'';
 if(!edition&&!allowUnresolvedEdition)return null;
 return {title,authors:author,isbn:expected.isbn,year,doi:doi.doi,edition};
}
/** [] is fail-closed (including malformed envelopes and ambiguous target-ISBN
 * records). A missing edition is not sufficient for this completion channel. */
export function readCrossrefBookProof(payload:unknown,expected:{title:string;author:string;isbn:string}):BookCrossrefRow[] {
 if(!expected||!text(expected.title)||!normalize(expected.title)||!text(expected.author)||!authorKey(expected.author)||typeof expected.isbn!=='string')return [];
 const isbn=canonicalIsbn(expected.isbn);if(!isbn)return [];
 const envelope=object(payload);if(!envelope||envelope.status!=='ok')return [];
 const message=object(envelope.message);if(!message)return [];
 let items:unknown[];
 if(envelope['message-type']==='work-list'){if(!Array.isArray(message.items)||message.items.length>100)return [];items=message.items;}
 else if(envelope['message-type']==='work')items=[message];
 else return [];
 const rows:BookCrossrefRow[]=[];
 for(const item of items){
  const record=object(item);if(!record)return [];
  if(!claimsIsbn(record,isbn))continue;
  const row=readOne(record,{...expected,isbn});if(!row)return [];
  if(!rows.some(known=>JSON.stringify(known)===JSON.stringify(row)))rows.push(row);
 }
 // Never arbitrarily choose from competing DOI records or conflicting deposits.
 return rows.length===1?rows:[];
}

/** Transient server-origin evidence still requires exact raw/request/target
 * rebinding on every client/replay use. This is structural validation, not an
 * authenticity signature: only authenticated server responses may supply it. */
export function readBookCrossrefEvidence(request:Record<string,unknown>,raw:string,response:unknown,localFields:Record<string,string>):BookCrossrefRow[]|null {
 const r=object(response), parsed=object(request.parsedFields), local=object(localFields);
 if(!r||!parsed||!local||request.kind!=='book'||request.jurisdiction!=='OTHER'||request.rawInput!==raw||
    r.kind!=='book'||r.jurisdiction!=='OTHER'||(r.rawInput!==undefined&&r.rawInput!==raw)||
    typeof raw!=='string'||raw.length>16000||extractBookIsbn(raw)||/\b\d{4}\b/.test(raw))return null;
 if(!text(parsed.bookTitle)||!text(parsed.authors)||!text(local.bookTitle)||!text(local.authors)||
    parsed.bookTitle!==local.bookTitle||parsed.authors!==local.authors||
    !suppliedLookupFieldsMatch(raw,'book',parsed)||!suppliedLookupFieldsMatch(raw,'book',local))return null;
 const forbidden=['year','isbn','edition','editor','editors','translator','translators'];
 if(forbidden.some(k=>(parsed[k]!==undefined&&parsed[k]!=='')||(local[k]!==undefined&&local[k]!=='')))return null;
 // Do not let an omitted wire field erase an explicit edition/role in raw text.
 if(/\b(?:ed(?:ition)?s?\.?|trans(?:lated|lator|lators)?\.?)\b/i.test(raw))return null;
 const e=object(r.bookCrossrefEvidence);
 if(!e||e.version!==1||Object.keys(e).some(k=>!['version','rows'].includes(k))||!Array.isArray(e.rows)||e.rows.length>4)return null;
 const rows:BookCrossrefRow[]=[];
 for(const value of e.rows){
  const row=object(value);if(!row||Object.keys(row).sort().join(',')!=='authors,doi,edition,isbn,title,year')return null;
  if(!text(row.title)||!text(row.authors)||normalize(row.title)!==normalize(parsed.bookTitle)||authorKey(row.authors)!==authorKey(parsed.authors)||
    typeof row.isbn!=='string'||!canonicalIsbn(row.isbn)||typeof row.year!=='string'||!/^(?:1[5-9]\d{2}|20\d{2})$/.test(row.year)||
    typeof row.edition!=='string'||!/^[1-9]\d?$/.test(row.edition))return null;
  const doi=safeDoi({DOI:row.doi});if(!doi)return null;
  const checked:BookCrossrefRow={isbn:canonicalIsbn(row.isbn)!,year:row.year,edition:row.edition,doi:doi.doi,title:row.title,authors:row.authors};
  const sameIsbn=rows.find(known=>known.isbn===checked.isbn),sameDoi=rows.find(known=>known.doi===checked.doi);
  if(sameIsbn&&(sameIsbn.year!==checked.year||sameIsbn.edition!==checked.edition||sameIsbn.doi!==checked.doi))return null;
  if(sameDoi&&(sameDoi.isbn!==checked.isbn||sameDoi.year!==checked.year||sameDoi.edition!==checked.edition))return null;
  // A single edition with inconsistent publication years is unresolved too.
  if(rows.some(known=>known.edition===checked.edition&&known.year!==checked.year))return null;
  if(!sameIsbn)rows.push(checked);
 }
 return rows;
}

/** Bounded search projection; ranking is never identity evidence. An empty
 * result is partial, not proof of completeness. Unnumbered print records can
 * veto a contradictory ISBN/year but never become selectable editions. */
export function readCrossrefSearchProof(payload:unknown,target:{title:string;author:string}):BookCrossrefRow[] {
 if(!target||!text(target.title)||!normalize(target.title)||!text(target.author)||!authorKey(target.author))return [];
 const e=object(payload),message=object(e?.message);
 if(!e||e.status!=='ok'||e['message-type']!=='work-list'||!message||!Array.isArray(message.items)||message.items.length>100)return [];
 const all:BookCrossrefRow[]=[];
 for(const value of message.items){
  const record=object(value);if(!record)return [];
  if(!['book','edited-book','monograph'].includes(record.type as string)||!Array.isArray(record['isbn-type']))continue;
  // readOne applies ordered full title/byline and all record-local checks for
  // each print identifier; electronic identifiers never contribute choices.
  const printIds=new Set<string>();
  for(const v of record['isbn-type']){const i=object(v);if(i?.type==='print'&&typeof i.value==='string'){const key=canonicalIsbn(i.value);if(key)printIds.add(key);}}
  for(const isbn of printIds){const row=readOne(record,{...target,isbn},true);if(row)all.push(row);}
 }
 const byIsbn=new Map<string,BookCrossrefRow[]>();
 for(const row of all){const group=byIsbn.get(row.isbn)??[];group.push(row);byIsbn.set(row.isbn,group);}
 // Fail closed rather than quietly remove a real contradictory edition and
 // present the remaining search window as if it were unambiguous.
 for(const group of byIsbn.values()){
  if(new Set(group.map(r=>r.year)).size>1||new Set(group.filter(r=>r.edition).map(r=>r.edition)).size>1||new Set(group.map(r=>r.doi)).size>1)return [];
 }
 const byEdition=new Map<string,BookCrossrefRow[]>();
 for(const row of all){if(!row.edition)continue;const group=byEdition.get(row.edition)??[];group.push(row);byEdition.set(row.edition,group);}
 if(byEdition.size>4)return [];
 const result:BookCrossrefRow[]=[];
 for(const group of byEdition.values()){
  if(new Set(group.map(r=>r.year)).size>1)return [];
  // Same described print edition/year can have several formats/ISBN aliases;
  // retain one deterministic real record rather than manufacture a new choice.
  result.push([...group].sort((a,b)=>a.isbn.localeCompare(b.isbn)||a.doi.localeCompare(b.doi))[0]);
 }
 return result.sort((a,b)=>Number(a.edition)-Number(b.edition)||a.isbn.localeCompare(b.isbn));
}
