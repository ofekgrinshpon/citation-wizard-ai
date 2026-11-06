const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SAFE_RUN_PROPERTIES=new Set(['rFonts','rtl','lang','sz','szCs','color','spacing','u','highlight','noProof','b','bCs','i','iCs','smallCaps','caps']);
/** Conservative check: any unknown inherited run property fails closed. A
 * missing style, cyclic inheritance, or malformed/unknown hierarchy is unsafe. */
export function citationInheritanceIsSafe(stylesXml:string|null,paragraphStyle:string|null,characterStyles:readonly string[],linked=false):boolean {
 if(!stylesXml||/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<!--|<\?(?!xml(?:\s|\?>))/i.test(stylesXml))return false;
 const doc=new DOMParser().parseFromString(stylesXml,'application/xml');
 if(doc.getElementsByTagName('parsererror').length||doc.documentElement.namespaceURI!==W||doc.documentElement.localName!=='styles')return false;
 const propsSafe=(element:Element,linkStyle=false)=>Array.from(element.getElementsByTagNameNS(W,'rPr')).every(props=>
  !Array.from(props.childNodes).some(n=>n.nodeType===3&&n.textContent?.trim())&&
  Array.from(props.children).every(c=>c.namespaceURI===W&&c.prefix==='w'&&SAFE_RUN_PROPERTIES.has(c.localName)&&(!['u','highlight'].includes(c.localName)||c.getAttributeNS(W,'val')==='none'||(linkStyle&&c.localName==='u'&&c.getAttributeNS(W,'val')==='single'))&&!c.children.length&&!c.textContent?.trim()));
 for(const d of Array.from(doc.getElementsByTagNameNS(W,'docDefaults'))) {
  if(!propsSafe(d)||Array.from(d.childNodes).some(n=>n.nodeType===3&&n.textContent?.trim())||Array.from(d.children).some(c=>c.namespaceURI!==W||!['rPrDefault','pPrDefault'].includes(c.localName))||Array.from(d.getElementsByTagNameNS(W,'rPrDefault')).some(r=>Array.from(r.children).some(c=>c.namespaceURI!==W||c.localName!=='rPr')||Array.from(r.childNodes).some(n=>n.nodeType===3&&n.textContent?.trim())))return false;
 }
 const styles=Array.from(doc.getElementsByTagNameNS(W,'style'));
 const byId=new Map<string,Element>();
 for(const style of styles){const id=style.getAttributeNS(W,'styleId'),type=style.getAttributeNS(W,'type');if(!id||!type||!['paragraph','character','table','numbering'].includes(type)||byId.has(id))return false;byId.set(id,style);}
 const safeStyleChildren=new Set(['name','aliases','basedOn','next','link','autoRedefine','hidden','uiPriority','semiHidden','unhideWhenUsed','qFormat','locked','personal','personalCompose','personalReply','rsid','pPr','rPr','tblPr','trPr','tcPr']);
 for(const style of styles)if(Array.from(style.childNodes).some(n=>n.nodeType===3&&n.textContent?.trim())||Array.from(style.children).some(c=>c.namespaceURI!==W||!safeStyleChildren.has(c.localName)))return false;
 if(paragraphStyle&&byId.get(paragraphStyle)?.getAttributeNS(W,'type')!=='paragraph')return false;
 if(characterStyles.some(id=>byId.get(id)?.getAttributeNS(W,'type')!=='character'))return false;
 const roots=new Set([...characterStyles,...(paragraphStyle?[paragraphStyle]:[])]);
 for(const style of styles)if(['1','true','on'].includes(style.getAttributeNS(W,'default')??''))roots.add(style.getAttributeNS(W,'styleId')!);
 const done=new Set<string>(),active=new Set<string>();
 const visit=(id:string,linkStyle=false):boolean=>{
  const key=`${id}:${linkStyle}`;if(done.has(key))return true;if(active.has(id))return false;
  const style=byId.get(id);if(!style||!propsSafe(style,linkStyle))return false;
  active.add(id);
  const parents=Array.from(style.children).filter(c=>c.namespaceURI===W&&c.localName==='basedOn');
  if(parents.length>1)return false;
  const parent=parents[0]?.getAttributeNS(W,'val');if(parents.length&&!parent)return false;
  if(parent&&(byId.get(parent)?.getAttributeNS(W,'type')!==style.getAttributeNS(W,'type')||!visit(parent,linkStyle)))return false;
  active.delete(id);done.add(key);return true;
 };
 return [...roots].every(id=>visit(id,linked&&characterStyles.includes(id)));
}
