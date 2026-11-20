import { escapeCitationLiteral } from './segments.ts';
import { rawCitationFingerprint } from '../pastedCitation.ts';
export interface HebrewBookOption {id:string;title:string;author:string;year?:string;edition?:string;url:string}
export interface HebrewBookChoice {version:1;rawInput:string;fingerprint:string;options:HebrewBookOption[];proof:HebrewBookProof}
interface Candidate {title:string;author:string;sourceUrl:string}
interface Source {url:string;title:string;snippet:string}
export interface HebrewBookProof {candidates:Candidate[];sources:Source[]}
const norm=(s:string)=>s.normalize('NFKC').replace(/[\u0591-\u05c7]/g,'').replace(/["״׳']/g,'').replace(/\s+/g,' ').trim();
const obj=(v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const hosts=['biupress.co.il','nli.org.il','nli.ac.il','nevo.co.il','bursi.co.il','sadanpublishing.co.il','lawpubshop.co.il','magnespress.co.il','karmel.co.il','modan.co.il'];
function safeUrl(v:unknown):string|null{try{if(typeof v!=='string'||v.length>500||/[\s\\]/.test(v))return null;const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))return null;return u.href;}catch{return null;}}
const clean=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max&&!/[<>\r\n]/.test(v)?v.trim():'';
export function isHebrewBookTitleQuery(raw:string):boolean{return raw.length>=3&&raw.length<=120&&/^[\u0590-\u05ff\s"״׳'־–-]+$/.test(raw)&&raw.trim().split(/\s+/).length<=3&&!/(?:מאמר|פרק|בתוך|עמוד|פסיקה|פסק דין|נגד|נ[׳']|מחבר|מאת|מהדורה)/.test(raw);}
function fields(source:Source):Map<string,string>{const map=new Map<string,string>();for(const line of source.snippet.split(/[;\n|]/)){const m=line.trim().match(/^(שם הספר|כותר|כותרת|מחבר|מחברים|מאת|שנת פרסום|שנת הוצאה|מהדורה)\s*:\s*(.+)$/);if(m){if(map.has(m[1])&&map.get(m[1])!==m[2])map.set(m[1],'');else map.set(m[1],m[2].trim());}}return map;}
export function projectHebrewBookProof(payload:unknown):HebrewBookProof {
 const p=obj(payload);const rows=Array.isArray(p?.candidates)?p!.candidates:[];const sources=Array.isArray(p?.search_results)?p!.search_results:[];
 if(rows.length>8||sources.length>12)return {candidates:[],sources:[]};
 return {candidates:rows.slice(0,8).flatMap(x=>{const r=obj(x),title=clean(r?.bookTitle??r?.title,120),author=clean(r?.author,100),url=safeUrl(r?.sourceUrl);return title&&author&&url?[{title,author,sourceUrl:url}]:[];}),sources:sources.slice(0,12).flatMap(x=>{const r=obj(x),url=safeUrl(r?.url),title=clean(r?.title,250),snippet=typeof r?.snippet==='string'?r.snippet.slice(0,1000):'';return url&&title?[{url,title,snippet}]:[];})};
}
export function buildHebrewBookChoice(raw:string,proof:HebrewBookProof):HebrewBookChoice|null {
 if(!isHebrewBookTitleQuery(raw)||proof.candidates.length>8||proof.sources.length>12)return null;
 const options:HebrewBookOption[]=[];
 for(const c of proof.candidates){if(norm(c.title)!==norm(raw)||!safeUrl(c.sourceUrl)||!clean(c.author,100))continue;
  for(const s of proof.sources){if(s.url!==c.sourceUrl||!safeUrl(s.url)||s.snippet.length>1000||/פסק.?דין|מאמר|פרק מתוך|ביקורת ספר|כתב עת/.test(s.title))continue;
   const f=fields(s),t=f.get('שם הספר')??f.get('כותר')??f.get('כותרת'),a=f.get('מחבר')??f.get('מחברים')??f.get('מאת');
   const heading=s.title.split(/\s+[|–—-]\s+/).map(norm);
   const headingBound=heading.length>=2&&heading[0]===norm(c.title)&&heading[1]===norm(c.author);
   if(!headingBound&&!(t&&a&&norm(t)===norm(c.title)&&norm(a)===norm(c.author)))continue;
   const yearValues=[f.get('שנת פרסום'),f.get('שנת הוצאה')].filter((x):x is string=>x!==undefined);const yearValue=new Set(yearValues).size===1?yearValues[0]:undefined;const year=yearValue&&/^(?:1[5-9]\d{2}|20\d{2})$/.test(yearValue)?yearValue:undefined;
   const ed=f.get('מהדורה'),edition=ed&&/^(?:ראשונה|שנייה|שניה|שלישית|רביעית|חמישית|שישית|שביעית|שמינית|תשיעית|עשירית|[1-9]\d?)(?: מתוקנת| מעודכנת)?$/.test(ed)?ed:undefined;
   const identity=JSON.stringify([c.title,c.author,year??'',edition??'',s.url]);
   const option={id:'hebook-'+rawCitationFingerprint(identity),title:c.title,author:c.author,year,edition,url:s.url};
   if(!options.some(o=>norm(o.author)===norm(option.author)&&o.year===year&&o.edition===edition))options.push(option);
  }
 }
 if(!options.length||options.length>4)return null;
 return {version:1,rawInput:raw,fingerprint:rawCitationFingerprint(raw),options,proof};
}
export function hebrewBookPartial(raw:string):string{return `[חסר: מחבר] **${escapeCitationLiteral(raw)}** ([חסר: שנה]).\n⚠️ לא נבחר ספר או מהדורה אוטומטית; יש להשלים את הפרטים מול המקור.`;}
export function readHebrewBookChoice(value:unknown,raw:string):HebrewBookChoice|null{
 const v=obj(value);if(v?.version!==1||v.rawInput!==raw||v.fingerprint!==rawCitationFingerprint(raw))return null;
 const p=obj(v.proof);if(!p||!Array.isArray(p.candidates)||!Array.isArray(p.sources))return null;
 // Re-project bounded transferable evidence instead of trusting supplied options.
 const proof=projectHebrewBookProof({candidates:p.candidates,search_results:p.sources});
 const validated=buildHebrewBookChoice(raw,proof);if(!validated||JSON.stringify(validated.options)!==JSON.stringify(v.options))return null;return validated;
}
export function selectHebrewBook(choice:HebrewBookChoice,id:string,raw:string):{citation:string;reply:string;status:'warning';warningMsg:string;sourceType:'book';sourceLabel:string}|null{
 const valid=readHebrewBookChoice(choice,raw);if(!valid)return null;
 if(id==='keep-missing'){const reply=hebrewBookPartial(raw);return {citation:reply.split('\n')[0],reply,status:'warning',warningMsg:'פרטי הספר נותרו חסרים',sourceType:'book',sourceLabel:'ספר'};}
 const o=valid.options.find(o=>o.id===id);if(!o)return null;
 const citation=`${escapeCitationLiteral(o.author)} **${escapeCitationLiteral(o.title)}** (${o.edition?'מהדורה '+escapeCitationLiteral(o.edition)+', ':''}${o.year??'[חסר: שנה]'}).`;
 const warningMsg=o.year?'נבחרה רשומה מהמקור; מומלץ לבדוק את המהדורה שבידך.':'שנת הפרסום לא אומתה ונשארה חסרה.';
 return {citation,reply:`${citation}\n⚠️ ${warningMsg}`,status:'warning',warningMsg,sourceType:'book',sourceLabel:'ספר'};
}
