import {expect,it} from 'vitest';
import {applyStyledParagraph} from './wordStyledParagraph';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const styles=`<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:rPr><w:b/><w:iCs/></w:rPr></w:style></w:styles>`;
const parse=(p:string)=>new DOMParser().parseFromString(`<root xmlns:w="${W}">${p}</root>`,'application/xml');
it('preserves marker once, shared runs, multiple text nodes, prefix and suffix',()=>{
 const input='<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:rtl/><w:b/></w:rPr><w:footnoteRef/><w:t xml:space="preserve">prefix old</w:t><w:t xml:space="preserve"> cite suffix</w:t></w:r></w:p>';
 const output=applyStyledParagraph(input,styles,[{start:7,end:15,originalText:'prefix old cite suffix',markedCitation:'##new## ^^Review^^'}]);const doc=parse(output);
 expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);expect(doc.getElementsByTagNameNS(W,'footnoteRef')).toHaveLength(1);
 expect([...doc.getElementsByTagNameNS(W,'t')].map(e=>e.textContent).join('')).toBe('prefix new Review suffix');
 expect([...doc.getElementsByTagNameNS(W,'smallCaps')].some(e=>e.getAttributeNS(W,'val')==='1')).toBe(true);
 expect([...doc.getElementsByTagNameNS(W,'iCs')].some(e=>e.getAttributeNS(W,'val')==='1')).toBe(true);
 expect([...doc.getElementsByTagNameNS(W,'rFonts')].every(e=>e.getAttributeNS(W,'ascii')==='Arial')).toBe(true);
});
it('handles two nonoverlapping patches in one text node',()=>{
 const input='<w:p><w:r><w:t xml:space="preserve">aa oldA middle oldB zz</w:t></w:r></w:p>',originalText='aa oldA middle oldB zz';
 const output=applyStyledParagraph(input,styles,[{originalText,start:3,end:7,markedCitation:'**first**'},{originalText,start:15,end:19,markedCitation:'##second##'}]);
 expect([...parse(output).getElementsByTagNameNS(W,'t')].map(e=>e.textContent).join('')).toBe('aa first middle second zz');
});
it('allows formatting-only changes and escaped literal marker text',()=>{
 const input='<w:p><w:r><w:t>C## &amp; x^^2</w:t></w:r></w:p>',originalText='C## & x^^2';
 const output=applyStyledParagraph(input,styles,[{originalText,start:0,end:originalText.length,markedCitation:'##C\\#\\# &amp; x\\^\\^2##'.replace('&amp;','&')}]);
 expect([...parse(output).getElementsByTagNameNS(W,'t')].map(e=>e.textContent).join('')).toBe(originalText);
});
it('refuses unsafe style inheritance or conflicting run font properties',()=>{
 const text='ab',input='<w:p><w:r><w:rPr><w:rFonts w:ascii="A"/></w:rPr><w:t>a</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="B"/></w:rPr><w:t>b</w:t></w:r></w:p>';
 expect(()=>applyStyledParagraph(input,styles,[{start:0,end:2,originalText:text,markedCitation:'##x##'}])).toThrow('תישאר');
 const hidden=styles.replace('<w:b/>','<w:vanish/>');expect(()=>applyStyledParagraph(input,hidden,[{start:0,end:1,originalText:text,markedCitation:'x'}])).toThrow('תישאר');
});
it('refuses malformed hierarchy, overlapping patches, stale data and unknown content',()=>{
 const input='<w:p><w:r><w:t>abcd</w:t></w:r></w:p>',p={start:0,end:2,originalText:'abcd',markedCitation:'x'};
 expect(()=>applyStyledParagraph(input,styles,[p,{...p,start:1,end:3}])).toThrow();expect(()=>applyStyledParagraph(input,styles,[{...p,originalText:'stale'}])).toThrow();
 expect(()=>applyStyledParagraph(input.replace('</w:p>','<w:hyperlink/></w:p>'),styles,[p])).toThrow();expect(()=>applyStyledParagraph(input,null,[p])).toThrow();
});

it('rejects surrogate boundaries and nested text markup',()=>{
 const a='<w:p><w:r><w:t>A😀B</w:t></w:r></w:p>';expect(()=>applyStyledParagraph(a,styles,[{start:1,end:2,originalText:'A😀B',markedCitation:'x'}])).toThrow();
 const b='<w:p><w:r><w:t>abcd<w:r/></w:t></w:r></w:p>';expect(()=>applyStyledParagraph(b,styles,[{start:0,end:2,originalText:'abcd',markedCitation:'x'}])).toThrow();
});
it('does not apply an untouched superscript footnote-marker character style to the citation',()=>{
 const markerStyles=styles.replace('</w:styles>','<w:style w:type="character" w:styleId="FootnoteReference"><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style></w:styles>');
 const input='<w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t>old</w:t></w:r></w:p>';
 const output=applyStyledParagraph(input,markerStyles,[{start:0,end:3,originalText:'old',markedCitation:'^^new^^'}]);
 expect(output).toContain('<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>');expect([...parse(output).getElementsByTagNameNS(W,'t')].map(e=>e.textContent).join('')).toBe('new');
});
it.each([
 ['Hebrew article container','מחבר, כותרת, **כתב עת** (2020)', 'כתב עת', 'b'],
 ['foreign article title and journal','##Title##, ^^JOURNAL^^ 1 (2020)', 'Title', 'i'],
 ['US case in roman','Brown v. Board, 347 U.S. 483 (1954)', 'Brown', 'plain'],
 ['short case in italics','##Brown##, at 2', 'Brown', 'i'],
 ['Australian statute','##Competition and Consumer Act 2010## (Cth)', 'Competition', 'i'],
 ['escaped literal markers','C\\#\\# x\\^\\^2 A\\*\\*B & <', 'C##', 'plain'],
])('preserves rule-marked text for %s under inherited emphasis',(_label,marked,needle,kind)=>{
 const input='<w:p><w:r><w:rPr><w:b/><w:i/><w:rtl/><w:rFonts w:ascii="Arial"/></w:rPr><w:t>old</w:t></w:r></w:p>';const result=parse(applyStyledParagraph(input,styles,[{start:0,end:3,originalText:'old',markedCitation:marked}]));
 const t=[...result.getElementsByTagNameNS(W,'t')].find(e=>e.textContent?.includes(needle));expect(t).toBeDefined();const pr=t!.parentElement!.getElementsByTagNameNS(W,'rPr')[0];
 if(kind==='plain'){expect(pr.getElementsByTagNameNS(W,'b')[0].getAttributeNS(W,'val')).toBe('0');expect(pr.getElementsByTagNameNS(W,'i')[0].getAttributeNS(W,'val')).toBe('0');}else expect(pr.getElementsByTagNameNS(W,kind)[0].getAttributeNS(W,'val')).toBe('1');
 expect(pr.getElementsByTagNameNS(W,'rtl')).toHaveLength(1);expect(pr.getElementsByTagNameNS(W,'rFonts')[0].getAttributeNS(W,'ascii')).toBe('Arial');
});

it.each(['<w:u w:val="single"/>','<w:highlight w:val="yellow"/>'])('rejects unverified direct or inherited emphasis %s',(prop)=>{
 const input='<w:p><w:r><w:rPr>'+prop+'</w:rPr><w:t>old</w:t></w:r></w:p>',patch={start:0,end:3,originalText:'old',markedCitation:'new'};
 expect(()=>applyStyledParagraph(input,styles,[patch])).toThrow();const inherited=styles.replace('<w:b/>',prop);expect(()=>applyStyledParagraph('<w:p><w:r><w:t>old</w:t></w:r></w:p>',inherited,[patch])).toThrow();
});
it('allows explicitly neutral underline and highlight',()=>{const input='<w:p><w:r><w:rPr><w:u w:val="none"/><w:highlight w:val="none"/></w:rPr><w:t>old</w:t></w:r></w:p>';expect(()=>applyStyledParagraph(input,styles,[{start:0,end:3,originalText:'old',markedCitation:'new'}])).not.toThrow();});
