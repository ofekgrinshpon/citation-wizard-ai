import type { DocxFootnote } from './docxFootnoteRoundtrip';
import type { ExplanationSpan } from './wordFootnotePlan';
import { mapWordSources, type WordSourceMap } from './wordSourceMap';

/** Conservative, single changed envelope. Only unchanged boundaries or the
 * envelope's outer edges can be rebound. Never guess positions inside an edit. */
export function wordEditCoordinates(original: string, edited: string) {
  let prefix = 0;
  while (prefix < original.length && prefix < edited.length && original[prefix] === edited[prefix]) prefix++;
  let suffix = 0;
  while (suffix < original.length-prefix && suffix < edited.length-prefix && original[original.length-1-suffix] === edited[edited.length-1-suffix]) suffix++;
  const oldEnd = original.length-suffix, newEnd = edited.length-suffix;
  const boundary = (at: number, fromEnd: number, toEnd: number, end: boolean) => {
    if (at < prefix) return at;
    if (at > fromEnd) return at + toEnd-fromEnd;
    // Insertions/deletions have two possible boundary affinities.
    if (at === prefix && at === fromEnd) return end ? prefix : toEnd;
    if (at === prefix) return prefix;
    if (at === fromEnd) return toEnd;
    return null;
  };
  const map = (span: ExplanationSpan, fromEnd: number, toEnd: number) => {
    const start = boundary(span.start,fromEnd,toEnd,false), end = boundary(span.end,fromEnd,toEnd,true);
    return start === null || end === null || end <= start ? null : {start,end};
  };
  return {
    toOriginal: (span: ExplanationSpan) => map(span,newEnd,oldEnd),
    toEdited: (span: ExplanationSpan) => map(span,oldEnd,newEnd),
  };
}

/** Protection always lives in immutable DOCX coordinates. Edited explanation
 * text cannot be silently dropped or exported under the guise of protection. */
export function editedProtection(original: string, edited: string, spans: readonly ExplanationSpan[]) {
  const coordinates = wordEditCoordinates(original,edited);
  const mapped = spans.map(span => coordinates.toEdited(span));
  return mapped.every((span,i) => span && original.slice(spans[i].start,spans[i].end) === edited.slice(span.start,span.end))
    ? mapped as ExplanationSpan[] : null;
}

export function mapEditedWordInput(note: DocxFootnote, input: string, explanations: readonly ExplanationSpan[] = []): WordSourceMap {
  const base = mapWordSources(note, explanations);
  const unresolved = (reason: string): WordSourceMap => ({...base,kind:'unresolved',sources:[],reason});
  if (!input.trim()) return unresolved('יש להזין קלט לבדיקה.');
  const mappedProtection = editedProtection(note.text,input,explanations);
  if (!mappedProtection) return unresolved('העריכה משנה הסבר מוגן או אינה מאפשרת למפות אותו בבטחה. בטלו את העריכה או השאירו את ההסבר ללא שינוי.');
  const ranges = note.editableRanges;
  if (!note.text.length || !ranges.length || ranges[0].start !== 0 || ranges[ranges.length-1].end !== note.text.length || ranges.some((range,index)=>index>0 && range.start!==ranges[index-1].end) || note.paragraphRanges.length !== 1)
    return unresolved('לא ניתן למפות את העריכה בבטחה. יש לערוך את מסמך Word ולהעלותו מחדש.');
  const plan = mapWordSources({...note,text:input,editableRanges:[{start:0,end:input.length}],paragraphRanges:[{start:0,end:input.length}]},mappedProtection);
  if (plan.kind !== 'mapped') return {...plan,fingerprint:base.fingerprint};
  const coordinates = wordEditCoordinates(note.text,input);
  const sources = plan.sources.map(source => {
    // Preserve the legacy whole-note override only when NOTHING is protected.
    const anchor = !explanations.length && plan.sources.length === 1 ? {start:0,end:note.text.length} : coordinates.toOriginal(source);
    if (!anchor || explanations.some(p=>p.start<anchor.end && anchor.start<p.end)) return null;
    return {...source,...anchor,sourceId:`${note.id}:${anchor.start}:${anchor.end}`,crossesRuns:ranges.filter(r=>r.end>anchor.start && r.start<anchor.end).length>1,identity:null};
  });
  if (sources.some(source=>!source)) return unresolved('גבולות האזכור השתנו באופן שאינו מאפשר מיפוי בטוח. בטלו את העריכה ונסו לערוך רק את האזכור.');
  return {...base,kind:'mapped',sources:sources as WordSourceMap['sources']};
}
