import { wordCitationStyledRuns } from './wordCitationTypography';
import { citationInheritanceIsSafe } from './wordStyleInheritance';
import { citationTextOnly } from './citationSegments';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export interface StyledParagraphPatch {start:number;end:number;originalText:string;markedCitation:string}
interface NodeMap {start:number;end:number;xmlStart:number;xmlEnd:number;text:string;textOpen:string;runOpen:string;props:string;preserveSpace:boolean;runStyle:string|null}
/** Transform only text payload slices in a single ordinary paragraph. Fail closed
 * if the run/style placement is ambiguous; never serialize the source document. */
export function applyStyledParagraph(paragraphXml:string,stylesXml:string|null,patches:readonly StyledParagraphPatch[]):string {
 const reject=()=>{throw Error('לא ניתן לשמור את עיצוב ההערה בבטחה; ההערה תישאר ללא שינוי.');};
 if(/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<!--|<\?/i.test(paragraphXml))return reject();
 const doc=new DOMParser().parseFromString(`<root xmlns:w="${W}">${paragraphXml}</root>`,'application/xml');
 if(doc.getElementsByTagName('parsererror').length)return reject();
 const p=doc.documentElement.firstElementChild;
 if(!p||p.namespaceURI!==W||p.localName!=='p'||doc.documentElement.children.length!==1)return reject();
 if(Array.from(p.childNodes).some(n=>n.nodeType===3&&n.textContent?.trim())||Array.from(p.children).some(e=>e.namespaceURI!==W||!['pPr','r','proofErr'].includes(e.localName)))return reject();
 const pPr=Array.from(p.children).filter(e=>e.namespaceURI===W&&e.localName==='pPr');if(pPr.length>1)return reject();
 const pStyles=pPr.length?Array.from(pPr[0].children).filter(e=>e.namespaceURI===W&&e.localName==='pStyle'):[];
 if(pStyles.length>1)return reject();const paragraphStyle=pStyles[0]?.getAttributeNS(W,'val')??null;if(pStyles.length&&!paragraphStyle)return reject();
 const matches=[...paragraphXml.matchAll(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)];
 const domRuns=Array.from(p.getElementsByTagNameNS(W,'r'));if(matches.length!==domRuns.length)return reject();
 const mapped:NodeMap[]=[];let text='';
 for(let i=0;i<matches.length;i++){
  const match=matches[i],run=domRuns[i];if(run.parentElement!==p)return reject();
  if(Array.from(run.childNodes).some(n=>n.nodeType===3&&n.textContent?.trim())||Array.from(run.children).some(e=>e.namespaceURI!==W||!['rPr','t','footnoteRef'].includes(e.localName)||(e.localName==='t'&&e.children.length)||(e.localName==='footnoteRef'&&e.childNodes.length)))return reject();
  const props=Array.from(run.children).filter(e=>e.namespaceURI===W&&e.localName==='rPr');if(props.length>1)return reject();
  const styles=props.length?Array.from(props[0].children).filter(e=>e.namespaceURI===W&&e.localName==='rStyle'):[];
  if(styles.length>1)return reject();const runStyle=styles[0]?.getAttributeNS(W,'val')??null;if(styles.length&&!runStyle)return reject();
  const rPr=(match[0].match(/<w:rPr(?:\s[^>]*)?\s*\/>|<w:rPr(?:\s[^>]*)?>[\s\S]*?<\/w:rPr>/g)??[]);
  if(rPr.length!==props.length)return reject();
  const inner=rPr.length?rPr[0].replace(/^<w:rPr(?:\s[^>]*)?>/,'').replace(/<\/w:rPr>$/,'').replace(/^<w:rPr(?:\s[^>]*)?\s*\/>$/,''):'';
  const open=match[0].match(/^<w:r(?:\s[^>]*)?>/)?.[0];if(!open)return reject();
  const xmlText=[...match[0].matchAll(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g)];const domText=Array.from(run.getElementsByTagNameNS(W,'t'));
  if(xmlText.length!==domText.length)return reject();
  for(let j=0;j<xmlText.length;j++){
   const t=xmlText[j];if(domText[j].parentElement!==run)return reject();const value=domText[j].textContent??'';
   const textOpen=t[0].slice(0,t[0].indexOf('>')+1),start=text.length;text+=value;
   const offset=match.index!+t.index!;mapped.push({start,end:text.length,xmlStart:offset+textOpen.length,xmlEnd:offset+t[0].lastIndexOf('</w:t>'),text:value,textOpen,runOpen:open,props:inner,preserveSpace:/xml:space\s*=\s*['"]preserve['"]/.test(textOpen),runStyle});
  }
 }
 if(p.getElementsByTagNameNS(W,'t').length!==mapped.length)return reject();
 const sorted=[...patches].sort((a,b)=>a.start-b.start);let prev=-1;
 const changes=new Map<NodeMap,Array<{start:number;end:number;marked:string|null}>>();
 for(const patch of sorted){
  if(patch.originalText!==text||!Number.isInteger(patch.start)||!Number.isInteger(patch.end)||patch.start<0||patch.start>=patch.end||patch.end>text.length||patch.start<prev||!citationTextOnly(patch.markedCitation).trim())return reject();
  const splits=(at:number)=>at>0&&at<text.length&&/[\uD800-\uDBFF]/.test(text[at-1])&&/[\uDC00-\uDFFF]/.test(text[at]);if(splits(patch.start)||splits(patch.end))return reject();
  prev=patch.end;const targets=mapped.filter(n=>n.end>patch.start&&n.start<patch.end);if(!targets.length)return reject();
  if(!citationInheritanceIsSafe(stylesXml,paragraphStyle,targets.flatMap(n=>n.runStyle?[n.runStyle]:[])))return reject();
  // Distinct non-typographic run properties would be impossible to map to a
  // replacement of different length without guessing font/direction placement.
  const normalized=(x:string)=>x.replace(/<w:(?:b|bCs|i|iCs|smallCaps|caps)(?:\s[^>]*)?\s*\/>/g,'').trim();
  if(targets.some(n=>normalized(n.props)!==normalized(targets[0].props)))return reject();
  wordCitationStyledRuns(patch.markedCitation,targets[0].props); // validates markup/properties before mutation
  targets.forEach((n,i)=>{const entries=changes.get(n)??[];entries.push({start:Math.max(0,patch.start-n.start),end:Math.min(n.text.length,patch.end-n.start),marked:i===0?patch.markedCitation:null});changes.set(n,entries);});
 }
 const splices:Array<{start:number;end:number;value:string}>=[];
 for(const [n,entries] of changes){let pos=0,value='';
  for(const e of entries){const untouched=n.text.slice(pos,e.start);if(!n.preserveSpace&&(/^\s|\s$/.test(untouched))&&untouched)return reject();value+=escape(untouched);
   if(e.marked!==null){const rPr=n.props?`<w:rPr>${n.props}</w:rPr>`:'';value+='</w:t></w:r>'+wordCitationStyledRuns(e.marked,n.props)+n.runOpen+rPr+n.textOpen;}
   pos=e.end;
  }
  const tail=n.text.slice(pos);if(!n.preserveSpace&&(/^\s|\s$/.test(tail))&&tail)return reject();value+=escape(tail);splices.push({start:n.xmlStart,end:n.xmlEnd,value});
 }
 let output=paragraphXml;for(const splice of splices.sort((a,b)=>b.start-a.start))output=output.slice(0,splice.start)+splice.value+output.slice(splice.end);
 const result=new DOMParser().parseFromString(`<root xmlns:w="${W}">${output}</root>`,'application/xml');if(result.getElementsByTagName('parsererror').length)return reject();
 let expected=text;for(const patch of [...sorted].reverse())expected=expected.slice(0,patch.start)+citationTextOnly(patch.markedCitation)+expected.slice(patch.end);
 const resultText=Array.from(result.getElementsByTagNameNS(W,'t')).map(e=>e.textContent??'').join('');if(resultText!==expected)return reject();
 return output;
}
