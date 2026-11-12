import type { DocxFootnote } from './docxFootnoteRoundtrip';
import { hasMultipleSourceSignals, isUnboundRepeatReference } from './wordFootnotePlan';
import { mapWordSources, type WordSourceMap } from './wordSourceMap';

/** An explicit input edit binds one proposed replacement to the ORIGINAL note.
 * Never change DOCX coordinates or silently distribute a result across sources. */
export function mapEditedWordInput(note: DocxFootnote, input: string): WordSourceMap {
  const base = mapWordSources(note, []);
  const unresolved = (reason: string): WordSourceMap => ({...base, kind:'unresolved', sources:[], reason});
  if (!input.trim()) return unresolved('יש להזין קלט לבדיקה.');
  if (hasMultipleSourceSignals(input) || isUnboundRepeatReference(input))
    return unresolved('הקלט הערוך עדיין כולל כמה מקורות או הפניה לא מקושרת. יש להשאיר מקור אחד לבדיקה.');
  const ranges = note.editableRanges;
  if (!note.text.length || !ranges.length || ranges[0].start !== 0 || ranges[ranges.length-1].end !== note.text.length || ranges.some((range,index)=>index>0 && range.start!==ranges[index-1].end) || note.paragraphRanges.length !== 1)
    return unresolved('לא ניתן להחליף את ההערה השלמה בבטחה. יש לערוך את מסמך Word ולהעלותו מחדש.');
  return {...base,kind:'mapped',sources:[{sourceId:`${note.id}:0:${note.text.length}`,start:0,end:note.text.length,input,crossesRuns:ranges.length>1,identity:null}]};
}
