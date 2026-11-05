import {expect,it} from 'vitest';
import {citationInheritanceIsSafe} from './wordStyleInheritance';
const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const wrap=(content:string)=>`<w:styles xmlns:w="${w}">${content}</w:styles>`;
const style=(id:string,body:string,attrs='')=>`<w:style w:styleId="${id}" w:type="${id==='C'?'character':'paragraph'}" ${attrs}>${body}</w:style>`;
it('accepts inherited bold and italic while traversing basedOn styles',()=>{
 const xml=wrap(style('Normal','<w:rPr><w:b/><w:iCs/></w:rPr>','w:default="1"')+style('Footnote','<w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>'));
 expect(citationInheritanceIsSafe(xml,'Footnote',[])).toBe(true);
});
it.each(['<w:vertAlign w:val="superscript"/>','<w:vanish/>','<w:webHidden/>','<w:position w:val="2"/>','<w:strike/>'])('refuses inherited unsupported property %s',property=>{
 const xml=wrap(style('Normal',`<w:rPr>${property}</w:rPr>`)+style('Footnote','<w:basedOn w:val="Normal"/>'));
 expect(citationInheritanceIsSafe(xml,'Footnote',[])).toBe(false);
});
it('checks document default run properties and selected character styles',()=>{
 expect(citationInheritanceIsSafe(wrap('<w:docDefaults><w:rPrDefault><w:rPr><w:vanish/></w:rPr></w:rPrDefault></w:docDefaults>'),null,[])).toBe(false);
 expect(citationInheritanceIsSafe(wrap(style('C','<w:rPr><w:vertAlign w:val="subscript"/></w:rPr>')),null,['C'])).toBe(false);
});
it('rejects missing, duplicate and cyclic style inheritance',()=>{
 expect(citationInheritanceIsSafe(null,null,[])).toBe(false);
 expect(citationInheritanceIsSafe(wrap(''),'Missing',[])).toBe(false);
 expect(citationInheritanceIsSafe(wrap(style('A','')+style('A','')),'A',[])).toBe(false);
 expect(citationInheritanceIsSafe(wrap(style('A','<w:basedOn w:val="B"/>')+style('B','<w:basedOn w:val="A"/>')),'A',[])).toBe(false);
});

it('rejects malformed property text, misplaced special properties and type mismatch',()=>{
 expect(citationInheritanceIsSafe(wrap(style('A','<w:rPr>hidden</w:rPr>')),'A',[])).toBe(false);
 expect(citationInheritanceIsSafe(wrap(style('A','<w:vanish/>')),'A',[])).toBe(false);
 expect(citationInheritanceIsSafe(wrap('<w:style w:styleId="A"/>'),'A',[])).toBe(false);
 expect(citationInheritanceIsSafe(wrap(style('A','<w:basedOn w:val="C"/>')+style('C','')),'A',[])).toBe(false);
});

it('rejects misplaced default properties and non-whitespace style text',()=>{
 expect(citationInheritanceIsSafe(wrap('<w:docDefaults><w:rPrDefault><w:vanish/></w:rPrDefault></w:docDefaults>'),null,[])).toBe(false);
 expect(citationInheritanceIsSafe(wrap(style('A','hidden')),'A',[])).toBe(false);
});

it('rejects misplaced properties and text directly in document defaults',()=>{
 expect(citationInheritanceIsSafe(wrap('<w:docDefaults><w:vanish/></w:docDefaults>'),null,[])).toBe(false);
 expect(citationInheritanceIsSafe(wrap('<w:docDefaults>hidden</w:docDefaults>'),null,[])).toBe(false);
});
