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

// Ordinary Word / python-docx templates must not block every footnote.
const W14='http://schemas.microsoft.com/office/word/2010/wordml';
const wrap14=(content:string)=>`<w:styles xmlns:w="${w}" xmlns:w14="${W14}">${content}</w:styles>`;
it('accepts a standard template whose table styles carry conditional table formatting',()=>{
 const table='<w:style w:type="table" w:styleId="LightShading"><w:basedOn w:val="TableNormal"/><w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:vanish/></w:rPr></w:tblStylePr></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:tblPr/></w:style>';
 expect(citationInheritanceIsSafe(wrap(style('Normal','<w:rPr><w:sz w:val="22"/></w:rPr>','w:default="1"')+table),'Normal',[])).toBe(true);
});
it('accepts Word 365 document defaults with kerning and ligatures',()=>{
 const defaults='<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:kern w:val="2"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:bidi="he-IL"/><w14:ligatures w14:val="standardContextual"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160"/></w:pPr></w:pPrDefault></w:docDefaults>';
 expect(citationInheritanceIsSafe(wrap14(defaults+style('Normal','<w:rPr><w:cs/></w:rPr>','w:default="1"')),'Normal',[])).toBe(true);
});
it('still refuses hidden, shifted or decorated text in the citation style chain',()=>{
 expect(citationInheritanceIsSafe(wrap14(style('Normal','<w:rPr><w14:textOutline/></w:rPr>','w:default="1"')),'Normal',[])).toBe(false);
 expect(citationInheritanceIsSafe(wrap14(style('Normal','<w:rPr><w:vanish/></w:rPr>','w:default="1"')),'Normal',[])).toBe(false);
 expect(citationInheritanceIsSafe(wrap14(style('Normal','<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>','w:default="1"')),'Normal',[])).toBe(false);
 expect(citationInheritanceIsSafe(wrap14(style('Normal','<w:rPr><w:kern w:val="2"><w:b/></w:kern></w:rPr>','w:default="1"')),'Normal',[])).toBe(false);
});
