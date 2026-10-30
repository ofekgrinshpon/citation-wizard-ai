import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { inspectDocxFootnotes, embedApprovedFootnotes } from "./docxFootnoteRoundtrip";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const note = (id: number, text: string) => `<w:footnote w:id="${id}"><w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:footnoteRef/></w:r><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:footnote>`;
async function fixture(notes = note(42,"הסבר: מקור ישן; הסבר נוסף")+note(7,"untouched"), body = '<w:p><w:r><w:footnoteReference w:id="7"/></w:r><w:r><w:footnoteReference w:id="42"/></w:r></w:p>') {
 const z = new JSZip();
 z.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 z.file('word/document.xml',`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
 z.file('word/footnotes.xml',`<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>${notes}</w:footnotes>`);
 z.file('word/styles.xml','<styles>DO NOT TOUCH</styles>');
 return z.generateAsync({type:'arraybuffer',compression:'DEFLATE'});
}
describe('DOCX selective footnote round trip',()=>{
 it('maps by native ID in anchor order, never visible numbering',async()=>{
 const s=await inspectDocxFootnotes(await fixture()); expect(s.notes.map(n=>n.id)).toEqual(['7','42']);expect(s.notes[1].text).toBe('הסבר: מקור ישן; הסבר נוסף');
 });
 it('replaces only selected approved text and preserves every other uncompressed entry and note XML',async()=>{
 const input=await fixture(), original=new Uint8Array(input).slice(); const s=await inspectDocxFootnotes(input);
 const text=s.notes[1].text,start=text.indexOf('מקור ישן');
 const out=await embedApprovedFootnotes(s,[{id:'42',originalText:text,start,end:start+8,replacement:'מקור & <חדש>',approved:true},{id:'7',originalText:'untouched',start:0,end:9,replacement:'WRONG',approved:false}]);
 expect(new Uint8Array(input)).toEqual(original);
 const a=await JSZip.loadAsync(input),b=await JSZip.loadAsync(out);
 for(const name of Object.keys(a.files)){if(name==='word/footnotes.xml')continue;expect(await b.files[name].async('uint8array')).toEqual(await a.files[name].async('uint8array'));}
 const before=await a.file('word/footnotes.xml')!.async('string'),after=await b.file('word/footnotes.xml')!.async('string');expect(after).toBe(before.replace('מקור ישן','מקור &amp; &lt;חדש&gt;'));
 });
 it('exports repeatedly from original without cumulative edits',async()=>{
 const s=await inspectDocxFootnotes(await fixture());const patch={id:'7',originalText:'untouched',start:0,end:9,replacement:'changed',approved:true};
 for(let i=0;i<2;i++){const z=await JSZip.loadAsync(await embedApprovedFootnotes(s,[patch]));expect(await z.file('word/footnotes.xml')!.async('string')).toContain('changed');}
 });
 it('rejects missing approvals, stale text, duplicate IDs and out-of-bound spans',async()=>{
 const s=await inspectDocxFootnotes(await fixture());const p={id:'7',originalText:'untouched',start:0,end:9,replacement:'changed',approved:true};
 await expect(embedApprovedFootnotes(s,[])).rejects.toThrow();await expect(embedApprovedFootnotes(s,[{...p,originalText:'stale'}])).rejects.toThrow();await expect(embedApprovedFootnotes(s,[p,p])).rejects.toThrow();await expect(embedApprovedFootnotes(s,[{...p,end:99}])).rejects.toThrow();await expect(embedApprovedFootnotes({...s},[p])).rejects.toThrow();
 });
 it('rejects cross-run edits but permits a span inside one run',async()=>{
 const s=await inspectDocxFootnotes(await fixture(note(7,'one').replace('</w:t></w:r></w:p>','</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>two</w:t></w:r></w:p>'),'<w:p><w:r><w:footnoteReference w:id="7"/></w:r></w:p>'));
 expect(s.notes[0].editableRanges).toEqual([{start:0,end:3},{start:3,end:6}]);
 await expect(embedApprovedFootnotes(s,[{id:'7',originalText:'onetwo',start:0,end:6,replacement:'new',approved:true}])).rejects.toThrow('מקטעי');
 await expect(embedApprovedFootnotes(s,[{id:'7',originalText:'onetwo',start:3,end:6,replacement:'new',approved:true}])).resolves.toBeInstanceOf(Uint8Array);
 });
 it.each(['<w:ins/>','<w:fldChar/>','<w:endnoteReference w:id="2"/>'])('rejects unsafe body feature %s',async(feature)=>{await expect(inspectDocxFootnotes(await fixture(undefined,feature))).rejects.toThrow();});
 it('skips complex notes but rejects malformed XML and duplicate anchors',async()=>{
 const skipped = await inspectDocxFootnotes(await fixture(note(7,'text').replace('<w:t','<w:hyperlink><w:t').replace('</w:t>','</w:t></w:hyperlink>'),'<w:p><w:r><w:footnoteReference w:id="7"/></w:r></w:p>')); expect(skipped.notes).toHaveLength(0); expect(skipped.skippedNotes[0].id).toBe('7');
 await expect(inspectDocxFootnotes(await fixture(undefined,'<w:p>'))).rejects.toThrow();
 await expect(inspectDocxFootnotes(await fixture(undefined,'<w:p><w:r><w:footnoteReference w:id="7"/><w:footnoteReference w:id="7"/></w:r></w:p>'))).rejects.toThrow();
 });
 it('rejects corrupt archive and inflated central directory size before decompression',async()=>{
 await expect(inspectDocxFootnotes(new ArrayBuffer(30))).rejects.toThrow();const input=await fixture();const v=new DataView(input);let p=0;while(v.getUint32(p,true)!==0x02014b50)p++;v.setUint32(p+24,100*1024*1024,true);await expect(inspectDocxFootnotes(input)).rejects.toThrow();
 });
 it('rejects encrypted and duplicate-path metadata',async()=>{
 const input=await fixture();const v=new DataView(input);let p=0;while(v.getUint32(p,true)!==0x02014b50)p++;v.setUint16(p+8,v.getUint16(p+8,true)|1,true);await expect(inspectDocxFootnotes(input)).rejects.toThrow();
 });
 it('rejects CRC mismatch and decompressed-size lies',async()=>{
 for(const kind of ['crc','size']) {
 const input=await fixture();const v=new DataView(input);let p=0;while(v.getUint32(p,true)!==0x02014b50)p++;
 if(kind==='crc')v.setUint32(p+16,123,true);
 else{const local=v.getUint32(p+42,true);v.setUint32(p+24,1,true);v.setUint32(local+22,1,true);}
 await expect(inspectDocxFootnotes(input)).rejects.toThrow();
 }
 });
 it('rejects macros and entity declarations before XML processing',async()=>{
 const zip=await JSZip.loadAsync(await fixture());zip.file('word/vbaProject.bin',new Uint8Array([1,2]));await expect(inspectDocxFootnotes(await zip.generateAsync({type:'arraybuffer'}))).rejects.toThrow();
 zip.remove('word/vbaProject.bin');zip.file('word/footnotes.xml','<!DOCTYPE w:footnotes [<!ENTITY a "a">]><w:footnotes/>');await expect(inspectDocxFootnotes(await zip.generateAsync({type:'arraybuffer'}))).rejects.toThrow();
 });
 it('does not permit a selection to split a Unicode surrogate pair',async()=>{
 const s=await inspectDocxFootnotes(await fixture(note(7,'A😀B'),'<w:p><w:r><w:footnoteReference w:id="7"/></w:r></w:p>'));
 await expect(embedApprovedFootnotes(s,[{id:'7',originalText:'A😀B',start:1,end:2,replacement:'x',approved:true}])).rejects.toThrow();
 });

 it('rejects hidden XML comment text and unsafe whitespace edits',async()=>{
 const input=await fixture(); const zip=await JSZip.loadAsync(input);const xml=await zip.file('word/footnotes.xml')!.async('string');zip.file('word/footnotes.xml',xml.replace('untouched','<!-- <w:t>fake</w:t> -->untouched'));
 await expect(inspectDocxFootnotes(await zip.generateAsync({type:'arraybuffer'}))).rejects.toThrow();
 const s=await inspectDocxFootnotes(await fixture(note(7,'text').replace(' xml:space="preserve"',''),'<w:p><w:r><w:footnoteReference w:id="7"/></w:r></w:p>'));
 await expect(embedApprovedFootnotes(s,[{id:'7',originalText:'text',start:0,end:4,replacement:' padded ',approved:true}])).rejects.toThrow();
 });

 it('normalizes only an explicitly approved multi-run span to its first run, preserving prefix/suffix styles and all other XML',async()=>{
 const xmlNote = `<w:footnote w:id="7"><w:p><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">prefix old</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">&amp; 😀</w:t></w:r><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">cite suffix</w:t></w:r></w:p></w:footnote>`;
 const input = await fixture(xmlNote + note(42,'unchanged'));
 const session = await inspectDocxFootnotes(input);const originalText=session.notes[0].text;
 expect(originalText).toBe('prefix old& 😀cite suffix');
 const patch={id:'7',originalText,start:7,end:originalText.indexOf(' suffix'),replacement:'חדש <&> 😀',approved:true};
 await expect(embedApprovedFootnotes(session,[patch])).rejects.toThrow('אישור');
 const output=await embedApprovedFootnotes(session,[{...patch,allowFormattingNormalization:true}]);
 const beforeZip=await JSZip.loadAsync(input),afterZip=await JSZip.loadAsync(output);
 const before=await beforeZip.file('word/footnotes.xml')!.async('string');
 const after=await afterZip.file('word/footnotes.xml')!.async('string');
 expect(after).toBe(before.replace('prefix old','prefix חדש &lt;&amp;&gt; 😀').replace('&amp; 😀</w:t>','</w:t>').replace('cite suffix',' suffix'));
 expect((await inspectDocxFootnotes(output.buffer.slice(output.byteOffset,output.byteOffset+output.byteLength) as ArrayBuffer)).notes[0].text).toBe('prefix חדש <&> 😀 suffix');
 expect(await afterZip.file('word/document.xml')!.async('string')).toBe(await beforeZip.file('word/document.xml')!.async('string'));
 });
 it('does not consume adjacent nodes when multi-run selection ends exactly at a boundary',async()=>{
 const xmlNote='<w:footnote w:id="7"><w:p><w:r><w:t>aaa</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bbb</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>ccc</w:t></w:r></w:p></w:footnote>';
 const session=await inspectDocxFootnotes(await fixture(xmlNote+note(42,'unchanged')));
 const zip=await JSZip.loadAsync(await embedApprovedFootnotes(session,[{id:'7',originalText:'aaabbbccc',start:0,end:6,replacement:'new',approved:true,allowFormattingNormalization:true}]));
 const result=await zip.file('word/footnotes.xml')!.async('string');
 expect(result).toContain('<w:r><w:rPr><w:i/></w:rPr><w:t>ccc</w:t></w:r>');
 expect(result).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t></w:t></w:r>');
 });
 it('fails multi-run export when a preserved suffix would acquire unsafe edge whitespace',async()=>{
 const xmlNote='<w:footnote w:id="7"><w:p><w:r><w:t>old</w:t></w:r><w:r><w:t>cite suffix</w:t></w:r></w:p></w:footnote>';
 const session=await inspectDocxFootnotes(await fixture(xmlNote+note(42,'unchanged')));
 await expect(embedApprovedFootnotes(session,[{id:'7',originalText:'oldcite suffix',start:0,end:7,replacement:'new',approved:true,allowFormattingNormalization:true}])).rejects.toThrow('רווחים');
 });
 it('rejects a multi-run boundary that splits a Unicode character even with normalization consent',async()=>{
 const xmlNote='<w:footnote w:id="7"><w:p><w:r><w:t>A😀</w:t></w:r><w:r><w:t>bbb</w:t></w:r></w:p></w:footnote>';
 const session=await inspectDocxFootnotes(await fixture(xmlNote+note(42,'unchanged')));
 await expect(embedApprovedFootnotes(session,[{id:'7',originalText:'A😀bbb',start:2,end:6,replacement:'new',approved:true,allowFormattingNormalization:true}])).rejects.toThrow('תו מורכב');
 });

 it('composes two approved citations in one text node using original coordinates, leaving protected and unclassified prose intact',async()=>{
 const originalText='intro oldA protected explanation oldB tail';const session=await inspectDocxFootnotes(await fixture(note(7,originalText)+note(42,'unchanged')));
 const a=originalText.indexOf('oldA'),b=originalText.indexOf('oldB'),protectedStart=originalText.indexOf('protected');
 const patches=[{id:'7',originalText,start:b,end:b+4,replacement:'SECOND & citation',approved:true},{id:'7',originalText,start:a,end:a+4,replacement:'FIRST',approved:true}];
 const output=await embedApprovedFootnotes(session,patches,[{id:'7',originalText,start:protectedStart,end:b}]);
 const zip=await JSZip.loadAsync(output);const xml=await zip.file('word/footnotes.xml')!.async('string');expect(xml).toContain('intro FIRST protected explanation SECOND &amp; citation tail');
 });
 it('supports adjacent nonoverlapping patches but rejects overlaps, duplicates and protected conflicts atomically',async()=>{
 const originalText='abcdef'; const session=await inspectDocxFootnotes(await fixture(note(7,originalText)+note(42,'unchanged')));
 const a={id:'7',originalText,start:0,end:3,replacement:'A',approved:true},b={...a,start:3,end:6,replacement:'B'};
 const zip=await JSZip.loadAsync(await embedApprovedFootnotes(session,[a,b]));expect(await zip.file('word/footnotes.xml')!.async('string')).toContain('>AB</w:t>');
 await expect(embedApprovedFootnotes(session,[a,{...b,start:2}])).rejects.toThrow('חופפים');
 await expect(embedApprovedFootnotes(session,[a,a])).rejects.toThrow('חופפים');
 await expect(embedApprovedFootnotes(session,[a,b],[{id:'7',originalText,start:4,end:5}])).rejects.toThrow('מוגן');
 // A rejected attempt does not mutate the session; another valid export remains available.
 await expect(embedApprovedFootnotes(session,[a,b])).resolves.toBeInstanceOf(Uint8Array);
 });
 it('rejects stale, invalid and overlapping protection spans rather than ignoring them',async()=>{
 const originalText='abcdef';const session=await inspectDocxFootnotes(await fixture(note(7,originalText)+note(42,'unchanged')));const patch={id:'7',originalText,start:0,end:1,replacement:'A',approved:true};
 const protectedSpan={id:'7',originalText,start:2,end:4};
 for(const spans of [[{...protectedSpan,originalText:'stale'}],[{...protectedSpan,end:100}],[protectedSpan,{...protectedSpan,start:3,end:5}]]) await expect(embedApprovedFootnotes(session,[patch],spans)).rejects.toThrow();
 });
 it('supports ordinary multi-paragraph notes with uneditable newline gaps and retains all paragraph XML',async()=>{
 const xmlNote='<w:footnote w:id="7"><w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t>first old</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>second old</w:t></w:r></w:p></w:footnote>';
 const input=await fixture(xmlNote+note(42,'unchanged'));const session=await inspectDocxFootnotes(input);const n=session.notes[0];expect(n.text).toBe('first old\nsecond old');expect(n.paragraphRanges).toEqual([{start:0,end:9},{start:10,end:20}]);expect(n.editableRanges).toEqual([{start:0,end:9},{start:10,end:20}]);
 const patches=[{id:'7',originalText:n.text,start:6,end:9,replacement:'ONE',approved:true},{id:'7',originalText:n.text,start:17,end:20,replacement:'TWO',approved:true}];
 const zip=await JSZip.loadAsync(await embedApprovedFootnotes(session,patches));expect(await zip.file('word/footnotes.xml')!.async('string')).toContain(xmlNote.replace('first old','first ONE').replace('second old','second TWO'));
 await expect(embedApprovedFootnotes(session,[{...patches[0],end:13,allowFormattingNormalization:true}])).rejects.toThrow('פסקאות');
 await expect(embedApprovedFootnotes(session,[{...patches[0],start:9,end:10,allowFormattingNormalization:true}])).rejects.toThrow('פסקאות');
 });
 it('preserves unsupported notes byte-for-byte and exposes only id and reason, not their contents',async()=>{
 const skippedNote='<w:footnote w:id="7"><w:p><w:hyperlink><w:r><w:t>UNSUPPORTED PRIVATE TEXT</w:t></w:r></w:hyperlink></w:p></w:footnote>';
 const input=await fixture(skippedNote+note(42,'old'));const session=await inspectDocxFootnotes(input);expect(session.notes.map(n=>n.id)).toEqual(['42']);expect(session.skippedCount).toBe(1);expect(Object.keys(session.skippedNotes[0]).sort()).toEqual(['id','reason']);expect(JSON.stringify(session)).not.toContain('UNSUPPORTED PRIVATE TEXT');
 const zip=await JSZip.loadAsync(await embedApprovedFootnotes(session,[{id:'42',originalText:'old',start:0,end:3,replacement:'new',approved:true}]));expect(await zip.file('word/footnotes.xml')!.async('string')).toContain(skippedNote);
 await expect(embedApprovedFootnotes(session,[{id:'7',originalText:'UNSUPPORTED PRIVATE TEXT',start:0,end:3,replacement:'bad',approved:true}])).rejects.toThrow();
 });
 it('composes multiple multi-run patches sharing a middle text node without lost updates',async()=>{
 const xmlNote='<w:footnote w:id="7"><w:p><w:r><w:t xml:space="preserve">AA</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">BB explanation CC</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">DD</w:t></w:r></w:p></w:footnote>';
 const session=await inspectDocxFootnotes(await fixture(xmlNote+note(42,'unchanged')));const originalText=session.notes[0].text,b=originalText.indexOf('CC');
 const output=await embedApprovedFootnotes(session,[{id:'7',originalText,start:0,end:4,replacement:'FIRST',approved:true,allowFormattingNormalization:true},{id:'7',originalText,start:b,end:originalText.length,replacement:'SECOND',approved:true,allowFormattingNormalization:true}],[{id:'7',originalText,start:4,end:b}]);
 const zip=await JSZip.loadAsync(output);const xml=await zip.file('word/footnotes.xml')!.async('string');expect(xml).toContain('>FIRST</w:t>');expect(xml).toContain('> explanation SECOND</w:t>');expect(xml).toContain('<w:rPr><w:i/></w:rPr><w:t xml:space="preserve"></w:t>');
 });

 it('accepts explicitly normal note types and valid native id zero without treating them as separators',async()=>{
 const input=await fixture(note(0,'normal').replace('w:id="0"','w:id="0" w:type="normal"'),'<w:p><w:r><w:footnoteReference w:id="0"/></w:r></w:p>');
 const session=await inspectDocxFootnotes(input);expect(session.notes[0].id).toBe('0');expect(session.skippedCount).toBe(0);
 });

 it('skips namespace-alias text rather than silently omitting it from the whole-note preview',async()=>{
 const complex=`<w:footnote w:id="7" xmlns:q="${W}"><w:p><w:r><w:t>visible </w:t><q:t>ALIAS CONTENT</q:t></w:r></w:p></w:footnote>`;
 const input=await fixture(complex+note(42,'old'));const session=await inspectDocxFootnotes(input);expect(session.notes.map(n=>n.id)).toEqual(['42']);expect(session.skippedNotes[0].id).toBe('7');
 const zip=await JSZip.loadAsync(await embedApprovedFootnotes(session,[{id:'42',originalText:'old',start:0,end:3,replacement:'new',approved:true}]));expect(await zip.file('word/footnotes.xml')!.async('string')).toContain(complex);
 });
 it('skips invalid text/run hierarchy and maps ordinary empty paragraphs as gaps',async()=>{
 const invalid='<w:footnote w:id="7"><w:p><w:t>invalid location</w:t></w:p></w:footnote>';
 expect((await inspectDocxFootnotes(await fixture(invalid+note(42,'old')))).skippedNotes[0].id).toBe('7');
 const ordinary='<w:footnote w:id="7"><w:p><w:r><w:t>first</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>last</w:t></w:r></w:p></w:footnote>';
 const session=await inspectDocxFootnotes(await fixture(ordinary+note(42,'old')));expect(session.notes[0].text).toBe('first\n\nlast');expect(session.notes[0].paragraphRanges).toEqual([{start:0,end:5},{start:6,end:6},{start:7,end:11}]);
 });

 it('resolves continuous decimal numbering from settings while retaining skipped slots and never using native IDs',async()=>{
  const z=await JSZip.loadAsync(await fixture());
  const settings=(inside:string)=>`<w:settings xmlns:w="${W}"><w:footnotePr>${inside}</w:footnotePr></w:settings>`;
  z.file('word/settings.xml',settings('<w:numStart w:val="10"/><w:numFmt w:val="decimal"/>'));
  const s=await inspectDocxFootnotes(await z.generateAsync({type:'arraybuffer'}));expect(s.documentOrder).toEqual([{id:'7',number:10},{id:'42',number:11}]);
  for(const value of ['<w:numRestart w:val="eachPage"/>','<w:numRestart w:val="eachSect"/>','<w:numFmt w:val="lowerRoman"/>','<w:numStart w:val="0"/>']){
   z.file('word/settings.xml',settings(value));expect((await inspectDocxFootnotes(await z.generateAsync({type:'arraybuffer'}))).documentOrder!.every(n=>n.number===null)).toBe(true);
  }
  z.remove('word/settings.xml');expect((await inspectDocxFootnotes(await z.generateAsync({type:'arraybuffer'}))).documentOrder!.map(n=>n.number)).toEqual([1,2]);
  z.file('word/document.xml',(await z.file('word/document.xml')!.async('string')).replace('</w:body>','<w:sectPr><w:footnotePr><w:numStart w:val="4"/></w:footnotePr></w:sectPr></w:body>'));
  expect((await inspectDocxFootnotes(await z.generateAsync({type:'arraybuffer'}))).documentOrder!.every(n=>n.number===null)).toBe(true);
 });

 it('rejects compatibility alternatives instead of counting or sending inactive footnote branches',async()=>{
  const z=await JSZip.loadAsync(await fixture());
  z.file('word/document.xml',`<w:document xmlns:w="${W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body><mc:AlternateContent><mc:Choice Requires="w"><w:p><w:r><w:footnoteReference w:id="7"/></w:r></w:p></mc:Choice><mc:Fallback><w:p><w:r><w:footnoteReference w:id="42"/></w:r></w:p></mc:Fallback></mc:AlternateContent></w:body></w:document>`);
  await expect(inspectDocxFootnotes(await z.generateAsync({type:'arraybuffer'}))).rejects.toThrow('ענפי תוכן חלופיים');
 });

});
