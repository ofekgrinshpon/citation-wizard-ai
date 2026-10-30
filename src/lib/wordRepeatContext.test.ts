import {it,expect} from 'vitest';
import {proposeWordRepeats,invalidateWordDependents} from './wordRepeatContext';
import {wordSourceIdentity} from './wordSourceMap';
import type {DocxFootnoteSession} from './docxFootnoteRoundtrip';
const A='Brown v. Board of Education, 347 U.S. 483 (1954)', B='Roe v. Wade, 410 U.S. 113 (1973)';
const note=(id:string,text:string)=>({id,text,editableRanges:[{start:0,end:text.length}],paragraphRanges:[{start:0,end:text.length}]});
function setup(texts=[A,A,B,A],start=10){
 const notes=texts.map((t,i)=>note(String(42-i*3),t));
 const session:DocxFootnoteSession={notes,documentOrder:notes.map((n,i)=>({id:n.id,number:start+i})),skippedNotes:[],skippedCount:0,warnings:[]};
 const rows=notes.map((n,i)=>({id:i+1,noteId:n.id,start:0,end:n.text.length,input:n.text,output:n.text,fullOutput:n.text,status:'valid',approved:false}));return {session,rows};
}
it('reuses existing repeat helper with supplied identity and actual document numbering, including unchanged originals',()=>{
 const {session,rows}=setup();const result=proposeWordRepeats(session,rows,[]);
 expect(result[0].output).toBe(A);expect(result[1].output).toBe('שם.');expect(result[3].output).toContain('לעיל ה"ש 10');expect(result[3].approved).toBe(false);
 // No prior corrections approved: original full citations still provide context.
 expect(rows.every(r=>!r.approved)).toBe(true);
});
it('skipped notes break adjacency and retain their numbering slots',()=>{
 const {session,rows}=setup([A,'unknown',A]);const unknown=session.notes[1];const filtered={...session,notes:session.notes.filter(n=>n.id!==unknown.id),skippedNotes:[{id:unknown.id,reason:'unsupported'}]};
 const result=proposeWordRepeats(filtered,rows.filter(r=>r.noteId!==unknown.id),[]);expect(result[1].output).toContain('לעיל ה"ש 10');expect(result[1].output).not.toBe('שם.');
});
it('unknown numbering and multi-source notes retain full citations, without treating the last source as the previous note',()=>{
 const {session,rows}=setup([A+'; '+B,B]);expect(proposeWordRepeats(session,rows,[])[1].output).toBe(B);
 const same=setup([A,A]);const unresolved={...same.session,documentOrder:same.session.documentOrder!.map(n=>({...n,number:null}))};expect(proposeWordRepeats(unresolved,same.rows,[])[1].output).toBe(A);
});
it('keeps pinpoint separate from identity and reuses suffix formatting',()=>{
 const pinned='Brown v. Board of Education, 347 U.S. 483, 490 (1954)';
 expect(wordSourceIdentity(pinned)?.key).toBe(wordSourceIdentity(A)?.key);expect(wordSourceIdentity(pinned)?.pinpoint).toBe('490');
 const {session,rows}=setup([A,pinned]);expect(proposeWordRepeats(session,rows,[])[1].output).toBe("שם, בעמ' 490.");
});
it('uses approved changed source instead of original and restores full dependent proposals on upstream change',()=>{
 const {session,rows}=setup([A,A]);rows[0]={...rows[0],fullOutput:B,output:B,approved:true};expect(proposeWordRepeats(session,rows,[])[1].output).toBe(A);
 rows[0]={...rows[0],approved:false};const repeated=proposeWordRepeats(session,rows,[]);expect(repeated[1].output).toBe('שם.');
 const approved=repeated.map(r=>({...r,approved:true}));const invalid=invalidateWordDependents(approved,session.notes.map(n=>n.id),rows[0].noteId,rows[0].start);
 expect(invalid[0].approved).toBe(true);expect(invalid[1].approved).toBe(false);expect(invalid[1].output).toBe(A);
});
it('does not shorten title-only similarities, mismatched output identities, and makes explicit new short-form proposals require approval again',()=>{
 const {session,rows}=setup(['Author Title (2020)','Author Title (2020)']);expect(proposeWordRepeats(session,rows,[])).toEqual(rows);
 const x=setup([A,A]);x.rows[1].output=B;x.rows[1].fullOutput=B;expect(proposeWordRepeats(x.session,x.rows,[])[1].output).toBe(B);
 x.rows[1].output=A;x.rows[1].fullOutput=A;x.rows[1].approved=true;expect(proposeWordRepeats(x.session,x.rows,[])[1]).toMatchObject({output:'שם.',approved:false});
});
