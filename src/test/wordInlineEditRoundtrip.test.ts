import {describe,it,expect} from 'vitest';
import JSZip from 'jszip';
import {inspectDocxFootnotes,embedStyledFootnotes} from '../lib/docxFootnoteRoundtrip';
import {editedProtection,mapEditedWordInput,wordEditCoordinates} from '../lib/wordInputOverride';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';

describe('edited note original-coordinate safety',()=>{
 it.each(['12345','3'])('assembles a real DOCX with edited section %s and byte-preserved styled explanation',async(section)=>{
  const citation='ס׳ 2 לחוק הגנת הצרכן';const explanation='זו דוגמא לדברי הסבר שצריך לסמן.';
  const original=`${citation}, ${explanation}`;
  const protectedRun=`<w:r><w:rPr><w:i/><w:color w:val="AA0000"/></w:rPr><w:t>${explanation}</w:t></w:r>`;
  const z=new JSZip();
  z.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  const document=`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p></w:body></w:document>`;
  z.file('word/document.xml',document);
  z.file('word/styles.xml',`<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:rPr/></w:style></w:styles>`);
  z.file('word/footnotes.xml',`<w:footnotes xmlns:w="${W}"><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve">${citation}, </w:t></w:r>${protectedRun}</w:p></w:footnote></w:footnotes>`);
  const session=await inspectDocxFootnotes(await z.generateAsync({type:'arraybuffer'}));
  const note=session.notes[0];expect(note.text).toBe(original);
  const edited=original.replace('2',section);
  const selected=wordEditCoordinates(original,edited).toOriginal({start:edited.indexOf(explanation),end:edited.length})!;
  const plan=mapEditedWordInput(note,edited,[selected]);expect(plan.kind).toBe('mapped');
  const source=plan.sources[0];expect(source.input).not.toContain(explanation);expect(source.end).toBe(citation.length);
  const output=await embedStyledFootnotes(session,[{id:note.id,originalText:original,start:source.start,end:source.end,replacement:`ס׳ ${section} לחוק הגנת הצרכן`,approved:true}],[{...selected,id:note.id,originalText:original}]);
  const out=await JSZip.loadAsync(output);const xml=await out.file('word/footnotes.xml')!.async('string');
  expect(xml).toContain(protectedRun);expect(xml).toContain(`ס׳ ${section} לחוק הגנת הצרכן`);
  expect(await out.file('word/document.xml')!.async('string')).toBe(document);
  expect((await inspectDocxFootnotes(new Uint8Array(output).buffer)).notes[0].text).toBe(edited);
 });
 it('maps insertions/deletions adjacent to an unchanged protected suffix without stale offsets',()=>{
  for(const [original,edited] of [['A explain','Long A explain'],['Long A explain','A explain']]){
   const span={start:original.indexOf('explain'),end:original.length};
   const displayed=editedProtection(original,edited,[span]);expect(displayed).toEqual([{start:edited.indexOf('explain'),end:edited.length}]);
   expect(wordEditCoordinates(original,edited).toOriginal(displayed![0])).toEqual(span);
  }
 });
 it('fails closed for edits across protected text and ambiguous interior boundaries',()=>{
  const original='A explain B',edited='AA explain BB';
  expect(editedProtection(original,edited,[{start:2,end:9}])).toBeNull();
  expect(wordEditCoordinates(original,edited).toOriginal({start:4,end:8})).toBeNull();
 });
});
