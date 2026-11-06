/** Generates runs only; callers must first validate inherited styles at the insertion site. */
import { parseCitationSegments } from './citationSegments';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const safeTags=new Set(['rFonts','rtl','lang','sz','szCs','color','spacing','u','highlight','noProof','b','bCs','i','iCs','smallCaps','caps']);
const typography=new Set(['b','bCs','i','iCs','smallCaps','caps']);
const xmlEscape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/** Create replacement-only runs; callers must separately prove safe placement.
 * Paragraph styles are not consulted: direct off values override only the listed
 * bold/italic/caps properties. Inherited visibility/vertical alignment need validation.
 * Unsupported run properties are refused rather than normalized. */
export function wordCitationStyledRuns(marked:string,originalProperties:string,linked=false):string {
 const stack:string[]=[];
 for(let i=0;i<marked.length;){
  if(marked[i]==='\\'&&/[\\*#^]/.test(marked[i+1]??'')){i+=2;continue;}
  const token=marked.slice(i,i+2);
  if(['**','##','^^'].includes(token)){
   if(stack[stack.length-1]===token)stack.pop();
   else if(stack.includes(token))throw Error('עיצוב האזכור אינו חד־משמעי; ההערה תישאר ללא שינוי.');
   else stack.push(token);
   i+=2;
  }else i++;
 }
 if(stack.length)throw Error('עיצוב האזכור אינו חד־משמעי; ההערה תישאר ללא שינוי.');
 const parsed=new DOMParser().parseFromString(`<w:rPr xmlns:w="${W}">${originalProperties}</w:rPr>`,'application/xml');
 if(parsed.getElementsByTagName('parsererror').length)throw Error('עיצוב האזכור אינו נתמך; ההערה תישאר ללא שינוי.');
 const root=parsed.documentElement;
 for(const child of Array.from(root.children)){
  if(child.namespaceURI!==W||child.prefix!=='w'||(!safeTags.has(child.localName)&&!(linked&&child.localName==='rStyle'))||(['u','highlight'].includes(child.localName)&&child.getAttributeNS(W,'val')!=='none'&&!(linked&&child.localName==='u'&&child.getAttributeNS(W,'val')==='single'))||child.children.length||child.textContent?.trim())throw Error('עיצוב האזכור אינו נתמך; ההערה תישאר ללא שינוי.');
  if(child.localName==='rStyle'&&(!child.getAttributeNS(W,'val')||Array.from(child.attributes).some(a=>a.namespaceURI!=='http://www.w3.org/2000/xmlns/'&&!(a.namespaceURI===W&&a.localName==='val'))))throw Error('סגנון הקישור אינו נתמך; ההערה תישאר ללא שינוי.');
  if(typography.has(child.localName))root.removeChild(child);
 }
 if(Array.from(root.childNodes).some(n=>n.nodeType===3&&n.textContent?.trim()))throw Error('עיצוב האזכור אינו נתמך; ההערה תישאר ללא שינוי.');
 const preserved=Array.from(root.children).map(el=>new XMLSerializer().serializeToString(el)).join('');
 const segments=parseCitationSegments(marked);
 if(!segments.length||segments.some(seg=>/[\u0000-\u001f\u007f\uFFFE\uFFFF]/.test(seg.text)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(seg.text)))throw Error('נוסח האזכור אינו נתמך; ההערה תישאר ללא שינוי.');
 return segments.map(seg=>{
  const on=(tag:string,value:boolean)=>`<w:${tag} w:val="${value?'1':'0'}"/>`;
  const props=preserved+on('b',seg.bold)+on('bCs',seg.bold)+on('i',seg.italic)+on('iCs',seg.italic)+on('smallCaps',seg.smallCaps)+on('caps',false);
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xmlEscape(seg.text)}</w:t></w:r>`;
 }).join('');
}
