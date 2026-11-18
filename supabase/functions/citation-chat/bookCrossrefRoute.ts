/** Bounded public Crossref search. No catalogue API, account data, or raw prompt.
 * Search is not exhaustive: returned rows attest records, not absence of other editions. */
import { readCrossrefSearchProof } from '../_shared/citationPure/bookCrossrefEvidence.ts';
import type { BookCrossrefEvidence } from '../_shared/citationPure/bookCrossrefEvidence.ts';
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
function publicText(s:string):boolean{return typeof s==='string'&&s.length>=2&&s.length<=240&&!/[\u0000-\u001f\u007f<>@]|https?:\/\/|\b(?:bearer|password|token)\s*[:=]/i.test(s);}
export async function lookupBookCrossref(target:{title:string;author:string},deps:{fetchImpl:typeof fetch}):Promise<BookCrossrefEvidence>{
 const empty=():BookCrossrefEvidence=>({version:1,rows:[]});
 if(!publicText(target.title)||!publicText(target.author)||!target.title.trim()||!target.author.trim())return empty();
 const controller=new AbortController();let totalBytes=0;let timer:ReturnType<typeof setTimeout>|undefined;
 async function get(url:URL):Promise<Record<string,unknown>>{
  if(url.protocol!=='https:'||url.hostname!=='api.crossref.org'||url.username||url.password||url.port)throw Error('Invalid provider');
  const r=await deps.fetchImpl(url.href,{method:'GET',redirect:'error',credentials:'omit',signal:controller.signal,headers:{Accept:'application/json'}});
  if(controller.signal.aborted||r.status!==200||r.redirected||(r.url&&r.url!==url.href))throw Error('Provider unavailable');
  const declared=r.headers.get('content-length');
  if(declared&&(!/^\d+$/.test(declared)||+declared>1_000_000))throw Error('Large body');
  if(!/application\/(?:[\w.-]+\+)?json/i.test(r.headers.get('content-type')??'')||!r.body)throw Error('Invalid body');
  const reader=r.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;totalBytes+=part.value.length;if(bytes>1_000_000||totalBytes>3_000_000)throw Error('Large body');chunks.push(part.value);}}
  catch(e){cancel();throw e;}finally{controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
  if(controller.signal.aborted)throw Error('Deadline');
  const data=new Uint8Array(bytes);let at=0;for(const c of chunks){data.set(c,at);at+=c.length;}
  const result=object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)));if(!result)throw Error('Invalid JSON');return result;
 }
 async function run():Promise<BookCrossrefEvidence>{
  const url=new URL('https://api.crossref.org/works');
  url.searchParams.set('query.title',target.title);url.searchParams.set('query.author',target.author);
  url.searchParams.set('filter','type:book,type:edited-book,type:monograph');url.searchParams.set('rows','12');
  const data=await get(url),message=object(data.message);
  if(data.status!=='ok'||data['message-type']!=='work-list'||!message||!Array.isArray(message.items)||message.items.length>12||!Number.isSafeInteger(message['total-results'])||Number(message['total-results'])<message.items.length)return empty();
  if(!message.items.length)return empty();
  const rows=readCrossrefSearchProof(data,target);
  if(rows.length>4)return empty();
  return {version:1,rows};
 }
 try{
  const deadline=new Promise<BookCrossrefEvidence>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(empty());},7000);});
  return await Promise.race([run().catch(()=>empty()),deadline]);
 }finally{if(timer)clearTimeout(timer);controller.abort();}
}
