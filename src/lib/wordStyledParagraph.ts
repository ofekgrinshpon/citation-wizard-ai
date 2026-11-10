import { wordCitationStyledRuns } from './wordCitationTypography';
import { citationInheritanceIsSafe } from './wordStyleInheritance';
import { citationTextOnly } from './citationSegments';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export interface StyledParagraphPatch {start:number;end:number;originalText:string;markedCitation:string}
interface NodeMap {start:number;end:number;xmlStart:number;xmlEnd:number;text:string;textOpen:string;runOpen:string;props:string;preserveSpace:boolean;runStyle:string|null;wrapper:Element|null}

/** Suffix shared by every fail-closed reason; the UI strips it to show the reason alone. */
export const STYLE_ISSUE_SUFFIX='ההערה תישאר ללא שינוי.';
const ELEMENT_LABELS:Record<string,string>={
 fldSimple:'שדה Word (כגון קישור דינמי)',fldChar:'שדה Word (כגון קישור דינמי)',instrText:'שדה Word (כגון קישור דינמי)',
 bookmarkStart:'סימניה (Bookmark)',bookmarkEnd:'סימניה (Bookmark)',commentRangeStart:'הערת סוקר',commentRangeEnd:'הערת סוקר',commentReference:'הערת סוקר',
 ins:'שינוי במעקב',del:'שינוי במעקב',moveFrom:'שינוי במעקב',moveTo:'שינוי במעקב',smartTag:'תג חכם (Smart Tag)',sdt:'פקד תוכן',customXml:'תוכן XML מותאם',
 tab:'טאב',br:'שבירת שורה',cr:'שבירת שורה',sym:'סמל מיוחד',drawing:'תמונה או אובייקט',pict:'תמונה או אובייקט',object:'תמונה או אובייקט',
 noBreakHyphen:'מקף בלתי שביר',softHyphen:'מקף רך',footnoteReference:'הפניה להערה אחרת',endnoteReference:'הפניה להערת סיום',
};
const elementLabel=(e:Element)=>ELEMENT_LABELS[e.localName]??`רכיב Word מסוג ${e.prefix?`${e.prefix}:`:''}${e.localName}`;

/** Namespace declarations of the source root (e.g. w14 on Word 2010+ paragraph IDs), so an
 * isolated paragraph slice parses exactly as it does in the document. `w`/`r` stay pinned. */
export function rootNamespaceDeclarations(rootOpen:string|null|undefined):string {
 if(!rootOpen)return '';
 const out:string[]=[];
 for(const m of rootOpen.matchAll(/\sxmlns:([A-Za-z_][\w.-]*)\s*=\s*("[^"<]*"|'[^'<]*')/g)){
  const prefix=m[1],uri=m[2].slice(1,-1);
  if(prefix==='w'||prefix==='r'){if(uri!==(prefix==='w'?W:R))throw Error(`מרחב השמות של קובץ ה-Word אינו תקני; ${STYLE_ISSUE_SUFFIX}`);continue;}
  out.push(` xmlns:${prefix}=${m[2]}`);
 }
 return out.join('');
}

/** Transform only text payload slices in a single ordinary paragraph. Fail closed
 * if the run/style placement is ambiguous; never serialize the source document.
 * Every rejection carries a specific, user-readable reason. */
export function applyStyledParagraph(paragraphXml:string,stylesXml:string|null,patches:readonly StyledParagraphPatch[],sourceRootOpen?:string|null):string {
 const reject=(reason:string):never=>{throw Error(`${reason}; ${STYLE_ISSUE_SUFFIX}`);};
 const wrap=(xml:string)=>`<root xmlns:w="${W}" xmlns:r="${R}"${rootNamespaceDeclarations(sourceRootOpen)}>${xml}</root>`;
 if(/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<!--|<\?/i.test(paragraphXml))return reject('ההערה מכילה רכיב XML חריג (הערה פנימית או הוראת עיבוד)');
 const doc=new DOMParser().parseFromString(wrap(paragraphXml),'application/xml');
 if(doc.getElementsByTagName('parsererror').length)return reject('קוד ה-XML של ההערה לא נקרא בבטחה');
 const p=doc.documentElement.firstElementChild;
 if(!p||p.namespaceURI!==W||p.localName!=='p'||doc.documentElement.children.length!==1)return reject('מבנה הפסקה בהערה אינו נתמך');
 if(Array.from(p.childNodes).some(n=>n.nodeType===3&&n.textContent?.trim()))return reject('מבנה הפסקה בהערה אינו נתמך');
 const foreignChild=Array.from(p.children).find(e=>e.namespaceURI!==W||!['pPr','r','proofErr','hyperlink'].includes(e.localName));
 if(foreignChild)return reject(`ההערה מכילה ${elementLabel(foreignChild)}, שאינו נתמך בשינוי אוטומטי`);
 for(const h of Array.from(p.children).filter(e=>e.localName==='hyperlink'))if(!h.getAttributeNS(R,'id')||!h.children.length||Array.from(h.children).some(e=>e.namespaceURI!==W||e.localName!=='r')||Array.from(h.childNodes).some(n=>n.nodeType===3&&n.textContent?.trim()))return reject('מבנה הקישור בהערה אינו נתמך (למשל קישור פנימי למסמך)');
 const pPr=Array.from(p.children).filter(e=>e.namespaceURI===W&&e.localName==='pPr');if(pPr.length>1)return reject('סגנון הפסקה בהערה אינו חד־משמעי');
 const pStyles=pPr.length?Array.from(pPr[0].children).filter(e=>e.namespaceURI===W&&e.localName==='pStyle'):[];
 if(pStyles.length>1)return reject('סגנון הפסקה בהערה אינו חד־משמעי');const paragraphStyle=pStyles[0]?.getAttributeNS(W,'val')??null;if(pStyles.length&&!paragraphStyle)return reject('סגנון הפסקה בהערה אינו חד־משמעי');
 const matches=[...paragraphXml.matchAll(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)];
 const domRuns=Array.from(p.getElementsByTagNameNS(W,'r'));if(matches.length!==domRuns.length)return reject('לא ניתן למפות את קטעי הטקסט בהערה בבטחה');
 const mapped:NodeMap[]=[];let text='';
 for(let i=0;i<matches.length;i++){
  const match=matches[i],run=domRuns[i],wrapper=run.parentElement===p?null:run.parentElement;
  if(wrapper&&(wrapper.parentElement!==p||wrapper.namespaceURI!==W||wrapper.localName!=='hyperlink'||!wrapper.getAttributeNS(R,'id')))return reject('מבנה הקישור בהערה אינו נתמך');
  if(wrapper&&Array.from(wrapper.children).some(e=>e.namespaceURI!==W||e.localName!=='r'))return reject('מבנה הקישור בהערה אינו נתמך');
  if(Array.from(run.childNodes).some(n=>n.nodeType===3&&n.textContent?.trim()))return reject('לא ניתן למפות את קטעי הטקסט בהערה בבטחה');
  const runChild=Array.from(run.children).find(e=>e.namespaceURI!==W||!['rPr','t','footnoteRef'].includes(e.localName));
  if(runChild)return reject(`ההערה מכילה ${elementLabel(runChild)}, שאינו נתמך בשינוי אוטומטי`);
  if(Array.from(run.children).some(e=>(e.localName==='t'&&e.children.length)||(e.localName==='footnoteRef'&&e.childNodes.length)))return reject('לא ניתן למפות את קטעי הטקסט בהערה בבטחה');
  const props=Array.from(run.children).filter(e=>e.namespaceURI===W&&e.localName==='rPr');if(props.length>1)return reject('עיצוב קטע הטקסט בהערה אינו חד־משמעי');
  const styles=props.length?Array.from(props[0].children).filter(e=>e.namespaceURI===W&&e.localName==='rStyle'):[];
  if(styles.length>1)return reject('עיצוב קטע הטקסט בהערה אינו חד־משמעי');const runStyle=styles[0]?.getAttributeNS(W,'val')??null;if(styles.length&&!runStyle)return reject('עיצוב קטע הטקסט בהערה אינו חד־משמעי');
  const rPr=(match[0].match(/<w:rPr(?:\s[^>]*)?\s*\/>|<w:rPr(?:\s[^>]*)?>[\s\S]*?<\/w:rPr>/g)??[]);
  if(rPr.length!==props.length)return reject('עיצוב קטע הטקסט בהערה אינו חד־משמעי');
  const inner=rPr.length?rPr[0].replace(/^<w:rPr(?:\s[^>]*)?>/,'').replace(/<\/w:rPr>$/,'').replace(/^<w:rPr(?:\s[^>]*)?\s*\/>$/,''):'';
  const open=match[0].match(/^<w:r(?:\s[^>]*)?>/)?.[0];if(!open)return reject('לא ניתן למפות את קטעי הטקסט בהערה בבטחה');
  const xmlText=[...match[0].matchAll(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g)];const domText=Array.from(run.getElementsByTagNameNS(W,'t'));
  if(xmlText.length!==domText.length)return reject('לא ניתן למפות את קטעי הטקסט בהערה בבטחה');
  for(let j=0;j<xmlText.length;j++){
   const t=xmlText[j];if(domText[j].parentElement!==run)return reject('לא ניתן למפות את קטעי הטקסט בהערה בבטחה');const value=domText[j].textContent??'';
   const textOpen=t[0].slice(0,t[0].indexOf('>')+1),start=text.length;text+=value;
   const offset=match.index!+t.index!;mapped.push({start,end:text.length,xmlStart:offset+textOpen.length,xmlEnd:offset+t[0].lastIndexOf('</w:t>'),text:value,textOpen,runOpen:open,props:inner,preserveSpace:/xml:space\s*=\s*['"]preserve['"]/.test(textOpen),runStyle,wrapper});
  }
 }
 if(p.getElementsByTagNameNS(W,'t').length!==mapped.length)return reject('לא ניתן למפות את קטעי הטקסט בהערה בבטחה');
 const sorted=[...patches].sort((a,b)=>a.start-b.start);let prev=-1;
 const changes=new Map<NodeMap,Array<{start:number;end:number;marked:string|null}>>();
 for(const patch of sorted){
  if(patch.originalText!==text||!Number.isInteger(patch.start)||!Number.isInteger(patch.end)||patch.start<0||patch.start>=patch.end||patch.end>text.length||patch.start<prev)return reject('המקטע שנבחר אינו תואם לטקסט ההערה המקורי');
  if(!citationTextOnly(patch.markedCitation).trim())return reject('נוסח האזכור המוצע ריק');
  const splits=(at:number)=>at>0&&at<text.length&&/[\uD800-\uDBFF]/.test(text[at-1])&&/[\uDC00-\uDFFF]/.test(text[at]);if(splits(patch.start)||splits(patch.end))return reject('הבחירה חוצה תו מורכב');
  prev=patch.end;const targets=mapped.filter(n=>n.end>patch.start&&n.start<patch.end);if(!targets.length)return reject('לא נמצא טקסט להחלפה במקטע שנבחר');
  if(targets.some(n=>n.wrapper!==targets[0].wrapper))return reject('האזכור חוצה בין קישור לטקסט אחר או בין קישורים. אפשר לסמן את הקישור כ״טקסט הסבר שלא לשנות״');
  const linked=!!targets[0].wrapper;
  if(!citationInheritanceIsSafe(stylesXml,paragraphStyle,targets.flatMap(n=>n.runStyle?[n.runStyle]:[]),linked))return reject('סגנון ה-Word של ההערה כולל מאפיינים שלא ניתן לשמר בבטחה בעיצוב האזכור');
  // Distinct non-typographic run properties would be impossible to map to a
  // replacement of different length without guessing font/direction placement.
  const normalized=(x:string)=>x.replace(/<w:(?:b|bCs|i|iCs|smallCaps|caps)(?:\s[^>]*)?\s*\/>/g,'').trim();
  if(targets.some(n=>normalized(n.props)!==normalized(targets[0].props)))return reject('האזכור המקורי עובר בין קטעים בעיצוב שונה (גופן, גודל או כיוון), ואי אפשר לפצל אותו בלי לנחש');
  wordCitationStyledRuns(patch.markedCitation,targets[0].props,linked); // validates markup/properties before mutation
  targets.forEach((n,i)=>{const entries=changes.get(n)??[];entries.push({start:Math.max(0,patch.start-n.start),end:Math.min(n.text.length,patch.end-n.start),marked:i===0?patch.markedCitation:null});changes.set(n,entries);});
 }
 const edgeSpace='התיקון ישאיר רווח בקצה קטע טקסט שאינו משמר רווחים';
 const splices:Array<{start:number;end:number;value:string}>=[];
 for(const [n,entries] of changes){let pos=0,value='';
  for(const e of entries){const untouched=n.text.slice(pos,e.start);if(!n.preserveSpace&&(/^\s|\s$/.test(untouched))&&untouched)return reject(edgeSpace);value+=escape(untouched);
   if(e.marked!==null){const rPr=n.props?`<w:rPr>${n.props}</w:rPr>`:'';value+='</w:t></w:r>'+wordCitationStyledRuns(e.marked,n.props,!!n.wrapper)+n.runOpen+rPr+n.textOpen;}
   pos=e.end;
  }
  const tail=n.text.slice(pos);if(!n.preserveSpace&&(/^\s|\s$/.test(tail))&&tail)return reject(edgeSpace);value+=escape(tail);splices.push({start:n.xmlStart,end:n.xmlEnd,value});
 }
 let output=paragraphXml;for(const splice of splices.sort((a,b)=>b.start-a.start))output=output.slice(0,splice.start)+splice.value+output.slice(splice.end);
 const result=new DOMParser().parseFromString(wrap(output),'application/xml');if(result.getElementsByTagName('parsererror').length)return reject('בדיקת התוצאה לאחר ההחלפה נכשלה');
 let expected=text;for(const patch of [...sorted].reverse())expected=expected.slice(0,patch.start)+citationTextOnly(patch.markedCitation)+expected.slice(patch.end);
 const resultText=Array.from(result.getElementsByTagNameNS(W,'t')).map(e=>e.textContent??'').join('');if(resultText!==expected)return reject('בדיקת התוצאה לאחר ההחלפה נכשלה');
 return output;
}
