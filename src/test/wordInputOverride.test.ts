import {describe,it,expect} from 'vitest';
import {mapEditedWordInput} from '../lib/wordInputOverride';
const original='First (2020); Second (2021)';
const note={id:'1',text:original,editableRanges:[{start:0,end:original.length}],paragraphRanges:[{start:0,end:original.length}]};
describe('explicit Word input edits',()=>{
 it('binds edited input to original coordinates, never to edited length',()=>{
  const plan=mapEditedWordInput(note,'First (2020)');expect(plan.kind).toBe('mapped');expect(plan.sources[0]).toMatchObject({input:'First (2020)',start:0,end:original.length,identity:null});expect(note.text).toBe(original);
 });
 it('rejects empty, multiple, and unbound repeat input',()=>{
  for(const text of ['',original,'Ibid.'])expect(mapEditedWordInput(note,text).kind).toBe('unresolved');
 });
 it('cannot bypass unsafe structure or separate paragraphs',()=>{
  expect(mapEditedWordInput({...note,editableRanges:[{start:1,end:original.length}]},'First').kind).toBe('unresolved');
  expect(mapEditedWordInput({...note,paragraphRanges:[{start:0,end:5},{start:5,end:original.length}]},'First').kind).toBe('unresolved');
 });
});
