import type {DocxFootnoteSession} from './docxFootnoteRoundtrip';
import {mapWordSources,wordSourceIdentity} from './wordSourceMap';
import {applyRepeatCitationRules} from './footnoteRepeatRules';
import {escapeCitationLiteral} from './citationSegments';
export interface WordRepeatRow {id:number;noteId:string;start:number;end:number;input:string;output:string|null;fullOutput?:string|null;approved?:boolean;status:string;repeatProposal?:boolean}
export interface WordProtection {noteId:string;start:number;end:number}
/** Full anchor order includes skipped/unknown notes. They remain barriers, not
 * deleted list items. Multi-source notes keep full forms until per-note repeat
 * semantics are explicitly supported. This function never approves or exports.
 */
export function proposeWordRepeats<T extends WordRepeatRow>(session:DocxFootnoteSession,rows:T[],protection:readonly WordProtection[]):T[]{
 const order=session.documentOrder;
 if(!order || order.some(item=>item.number===null))return rows;
 return rows.map(target=>{
  const full=target.fullOutput ?? target.output;
  if(!full || target.status==='error')return target;
  const originalIdentity=wordSourceIdentity(target.input),targetIdentity=wordSourceIdentity(full);
  if(!originalIdentity || !targetIdentity || originalIdentity.key!==targetIdentity.key)return target;
  const index=order.findIndex(n=>n.id===target.noteId);if(index<0)return target;
  const cells:Array<{id:number;input:string;output:string|null}>=[],keys=new Map<number,string|null>(),numbers=new Map<number,number|null>(),suffixes=new Map<number,string>(),adjacent=new Set<number>();
  let previousEligible=false;
  for(let i=0;i<=index;i++){
   const item=order[i],note=session.notes.find(n=>n.id===item.id),cellId=i+1;
   const plan=note?mapWordSources(note,protection.filter(p=>p.noteId===note.id)):null;
   // Protected text remains in the actual document and may itself cite a source.
   // Never pretend removing it from provider input removes it from context.
   const source=!protection.some(p=>p.noteId===item.id) && plan?.kind==='mapped' && plan.sources.length===1 ? plan.sources[0]:null;
   const row=source?rows.find(r=>r.noteId===item.id&&r.start===source.start&&r.end===source.end):undefined;
   // Approved proposal participates; otherwise the original source still does.
   const effective=i===index?full:row?.approved&&row.status!=='error'?(row.fullOutput??row.output):source?.input;
   const identity=effective?wordSourceIdentity(effective):null;
   if(!source || !identity || (i===index && source.sourceId!==`${target.noteId}:${target.start}:${target.end}`)){
    cells.push({id:cellId,input:'',output:null});keys.set(cellId,null);previousEligible=false;continue;
   }
   const output=i===index?full:row?.approved?(row.fullOutput??row.output??''):escapeCitationLiteral(source.input);
   cells.push({id:cellId,input:source.input,output});keys.set(cellId,identity.key);numbers.set(cellId,item.number);
   suffixes.set(cellId,identity.pinpoint?`${identity.pinpointKind==='paragraph'?"בפס'":"בעמ'"} ${identity.pinpoint}`:'');
   if(previousEligible)adjacent.add(cellId);previousEligible=true;
  }
  const next=applyRepeatCitationRules(cells,{sourceKeys:keys,referenceNumbers:numbers,adjacentToPrevious:adjacent,referenceSuffixes:suffixes}).at(-1)?.output;
  return next && next!==target.output ? {...target,fullOutput:full,output:next,approved:false,repeatProposal:next!==full}:target;
 });
}
/** An earlier changed choice may alter any later antecedent. Conservatively
 * restore contextual short proposals and require fresh approval. Full citations
 * have no antecedent dependency and retain their independent approvals. No export rewrite. */
export function invalidateWordDependents<T extends WordRepeatRow>(rows:T[],order:readonly string[],changedNote:string,changedStart=-1):T[]{
 const index=order.indexOf(changedNote);
 return rows.map(row=>{
  const position=order.indexOf(row.noteId);
  return row.repeatProposal && (position>index || (position===index && row.start>changedStart)) ? {...row,output:row.repeatProposal?(row.fullOutput??row.output):row.output,approved:false,repeatProposal:false}:row;
 });
}
