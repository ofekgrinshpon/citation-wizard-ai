import {expect,it} from 'vitest';
import {wordCitationStyledRuns} from './wordCitationTypography';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const elements=(markup:string)=>{const xml=new DOMParser().parseFromString(`<w:p xmlns:w="${W}">${markup}</w:p>`,'application/xml');expect(xml.getElementsByTagName('parsererror')).toHaveLength(0);return [...xml.getElementsByTagNameNS(W,'r')];};
it('applies citation bold, italic, small caps and explicit plain overrides without losing font or direction',()=>{
 const runs=elements(wordCitationStyledRuns('מחבר, ##כותרת##, ^^Review^^ **דגש**.','<w:rFonts w:ascii="Arial"/><w:rtl/><w:sz w:val="24"/><w:b/><w:i/>'));
 expect(runs.map(r=>r.textContent)).toEqual(['מחבר, ','כותרת',', ','Review',' ','דגש','.']);
 const property=(i:number,name:string)=>runs[i].getElementsByTagNameNS(W,name)[0]?.getAttributeNS(W,'val');
 expect(property(0,'b')).toBe('0');expect(property(0,'iCs')).toBe('0');expect(property(1,'i')).toBe('1');expect(property(1,'iCs')).toBe('1');expect(property(3,'smallCaps')).toBe('1');expect(property(5,'bCs')).toBe('1');
 for(const r of runs){expect(r.getElementsByTagNameNS(W,'rFonts')[0].getAttributeNS(W,'ascii')).toBe('Arial');expect(r.getElementsByTagNameNS(W,'rtl')).toHaveLength(1);}
});
it('escapes entities and preserves literal marker characters',()=>{const runs=elements(wordCitationStyledRuns('A & <B> \\#\\# C',''));expect(runs.map(r=>r.textContent).join('')).toBe('A & <B> ## C');});
it.each(['<w:vertAlign w:val="superscript"/>','<w:rStyle w:val="Custom"/>','<w:b><w:t>hidden</w:t></w:b>'])('refuses unsupported properties %s',props=>expect(()=>wordCitationStyledRuns('##x##',props)).toThrow('תישאר'));

it.each(['##unfinished','##one ^^two## three^^'])('rejects ambiguous markup %s',value=>expect(()=>wordCitationStyledRuns(value,'')).toThrow('חד־משמעי'));
