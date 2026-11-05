import { applyStyledParagraph, type StyledParagraphPatch } from './wordStyledParagraph';
import JSZip from "jszip";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MAX_ARCHIVE = 10 * 1024 * 1024;
const MAX_EXPANDED = 40 * 1024 * 1024;
const MAX_ENTRY = 10 * 1024 * 1024;
const MAX_XML = 2 * 1024 * 1024;
const MAX_FILES = 1000;
export interface DocxFootnote { readonly id: string; readonly text: string; readonly editableRanges: ReadonlyArray<{ start: number; end: number }>; readonly paragraphRanges: ReadonlyArray<{ start: number; end: number }>; }
export interface SkippedDocxFootnote { readonly id: string; readonly reason: string; }
export interface ProtectedFootnoteSpan { id: string; originalText: string; start: number; end: number; }
export interface DocxFootnoteOrder { readonly id: string; readonly number: number | null; }
export interface DocxFootnoteSession { readonly documentOrder?: readonly DocxFootnoteOrder[]; readonly notes: readonly DocxFootnote[]; readonly skippedNotes: readonly SkippedDocxFootnote[]; readonly skippedCount: number; readonly warnings: readonly string[]; }
export interface ApprovedFootnotePatch { id: string; originalText: string; start: number; end: number; replacement: string; approved: boolean; /** Explicit per-selection consent: replacement inherits the first selected run; other selected text is cleared. */ allowFormattingNormalization?: boolean; }
interface TextPosition { start: number; end: number; xmlStart: number; xmlEnd: number; text: string; preserveSpace: boolean; }
interface Internal { files: Map<string, Uint8Array>; xml: string; positions: Map<string, TextPosition[]>; notes: readonly DocxFootnote[]; }
const sessions = new WeakMap<DocxFootnoteSession, Internal>();
function fail(message: string): never { throw new Error(message); }
const invalid = () => fail("קובץ Word פגום או מבנה ZIP שאינו נתמך.");

/** Validate metadata before JSZip sees compressed data. Reject ZIP64/multipart/encryption. */
function preflight(bytes: Uint8Array): Map<string, { size: number; crc: number }> {
  if (bytes.length < 22 || bytes.length > MAX_ARCHIVE) fail("גודל המסמך חורג מהמגבלה (10MB).");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = bytes.length - 22;
  const min = Math.max(0, e - 65535);
  while (e >= min && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < min || e + 22 + v.getUint16(e + 20, true) !== bytes.length) invalid();
  const count = v.getUint16(e + 10, true), size = v.getUint32(e + 12, true), offset = v.getUint32(e + 16, true);
  if (v.getUint16(e + 4, true) || v.getUint16(e + 6, true) || count !== v.getUint16(e + 8, true) || !count || count > MAX_FILES || offset + size !== e) invalid();
  const names = new Map<string, { size: number; crc: number }>(); let p = offset, total = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const occupied: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > e || v.getUint32(p, true) !== 0x02014b50) invalid();
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true);
    const compressed = v.getUint32(p + 20, true), expanded = v.getUint32(p + 24, true);
    const n = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    if (p + 46 + n + extra + comment > e || (flags & 1) || ![0, 8].includes(method) || v.getUint16(p + 34, true)) invalid();
    let name: string; try { name = decoder.decode(bytes.subarray(p + 46, p + 46 + n)); } catch { return invalid(); }
    if (!name || name.startsWith("/") || name.includes("\\") || name.includes("\0") || name.split("/").some(x => x === ".." || x === ".") || names.has(name)) invalid();
    if (expanded > MAX_ENTRY || expanded > Math.max(1024 * 1024, compressed * 200) || (total += expanded) > MAX_EXPANDED) fail("המסמך דחוס או גדול מדי לעיבוד בטוח.");
    if (/vbaProject|_xmlsignatures|embeddings\//i.test(name)) fail("מסמכים עם פקודות מאקרו, חתימות או אובייקטים מוטמעים אינם נתמכים.");
    if (local + 30 > offset || v.getUint32(local, true) !== 0x04034b50 || v.getUint16(local + 6, true) !== flags || v.getUint16(local + 8, true) !== method) invalid();
    const ln = v.getUint16(local + 26, true), le = v.getUint16(local + 28, true), data = local + 30 + ln + le;
    if (data + compressed > offset || ln !== n) invalid();
    for (let j = 0; j < n; j++) if (bytes[local + 30 + j] !== bytes[p + 46 + j]) invalid();
    if (!(flags & 8) && (v.getUint32(local + 18, true) !== compressed || v.getUint32(local + 22, true) !== expanded)) invalid();
    occupied.push([local, data + compressed]); names.set(name, { size: expanded, crc: v.getUint32(p + 16, true) }); p += 46 + n + extra + comment;
  }
  if (p !== e) invalid();
  occupied.sort((a,b) => a[0]-b[0]);
  for(let i=1;i<occupied.length;i++) if(occupied[i][0]<occupied[i-1][1]) invalid();
  return names;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let c = value; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff; for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0;
}
function boundedRead(entry: JSZip.JSZipObject, expected: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []; let length = 0, stopped = false;
    // JSZip exposes this bounded streaming API at runtime, but its bundled types omit it.
    type Stream = { on(event: "data", cb: (chunk: Uint8Array) => void): Stream; on(event: "error", cb: (error: Error) => void): Stream; on(event: "end", cb: () => void): Stream; pause(): Stream; resume(): Stream };
    const stream = (entry as JSZip.JSZipObject & { internalStream(type: "uint8array"): Stream }).internalStream("uint8array");
    stream.on("data", (chunk: Uint8Array) => {
      if (stopped) return;
      length += chunk.length;
      if (length > expected || length > MAX_ENTRY) { stopped = true; stream.pause(); reject(new Error("גודל הקובץ בפועל אינו תואם למבנה המסמך.")); return; }
      chunks.push(chunk);
    }).on("error", reject).on("end", () => {
      if (stopped) return;
      if (length !== expected) { reject(new Error("קובץ Word פגום.")); return; }
      const out = new Uint8Array(length); let offset = 0;
      chunks.forEach(c => { out.set(c, offset); offset += c.length; }); resolve(out);
    }).resume();
  });
}
function xmlDocument(xml: string): Document {
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<!--|<\?(?!xml(?:\s|\?>))/i.test(xml)) fail("מבנה XML מורכב אינו נתמך.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) invalid();
  return doc;
}
function textFile(files: Map<string, Uint8Array>, name: string): string {
  const bytes = files.get(name); if (!bytes || bytes.length > MAX_XML) fail("רכיבי ההערות במסמך חסרים או גדולים מדי.");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return invalid(); }
}

/** Decimal continuous numbering only. Section overrides, page/section restarts,
 * custom formats and malformed settings are unresolved rather than guessed.
 * Defaults follow ISO/IEC 29500 numStart/numRestart/numFmt (Microsoft Open XML docs).
 */
function documentNumbering(files: Map<string, Uint8Array>, body: Document, order: string[]): readonly DocxFootnoteOrder[] {
  let start=1, known=true;
  if(body.getElementsByTagNameNS(W,"footnotePr").length)known=false;
  for(const anchor of Array.from(body.getElementsByTagNameNS(W,"footnoteReference"))){
    for(let parent=anchor.parentElement;parent;parent=parent.parentElement){
      if(["txbxContent","drawing","pict"].includes(parent.localName))known=false;
    }
  }
  if (files.has("word/settings.xml")) {
    try {
      const settings=xmlDocument(textFile(files,"word/settings.xml"));
      if(settings.documentElement.namespaceURI!==W || settings.documentElement.localName!=="settings")known=false;
      const properties=settings.getElementsByTagNameNS(W,"footnotePr");
      if(properties.length>1)known=false;
      if(properties.length===1){
        const props=properties[0];
        for(const name of ["numStart","numRestart","numFmt"]){
          const values=props.getElementsByTagNameNS(W,name);if(values.length>1)known=false;
          const element=values[0],value=element?.getAttributeNS(W,"val");
          if(element && !value)known=false;
          if(name==="numStart" && value){if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>100000)known=false;else start=Number(value);}
          if(name==="numRestart" && value && value!=="continuous")known=false;
          if(name==="numFmt" && element && (value!=="decimal" || element.hasAttributeNS(W,"format")))known=false;
        }
      }
    } catch {known=false;}
  }
  return Object.freeze(order.map((id,index)=>Object.freeze({id,number:known?start+index:null})));
}

/** Body fields are retained verbatim, never evaluated. Only navigation fields with
 * balanced cached results and no footnote anchors are eligible. */
function validatePreservedBodyFields(doc: Document): boolean {
  const reject = () => fail("שדה Word בגוף המסמך אינו נתמך או שמבנהו אינו בטוח לשימור. נתמכים רק TOC ו־PAGEREF תקינים ללא הפניות להערות בתוכם.");
  const elements = Array.from(doc.getElementsByTagNameNS(W, "*"));
  const bookmarks = new Map<string, string>();
  const ends = new Map<string, number>();
  for (const e of elements) {
    if (e.localName === "bookmarkStart") {
      const name = e.getAttributeNS(W,"name"), id = e.getAttributeNS(W,"id");
      if (name && id !== null) bookmarks.set(name, bookmarks.has(name) ? "" : id);
    }
    if (e.localName === "bookmarkEnd") { const id=e.getAttributeNS(W,"id") || ""; ends.set(id,(ends.get(id)||0)+1); }
  }
  const instruction = (text: string): "TOC" | "PAGEREF" => {
    const code=text.trim();
    if (/^TOC(?:\s+\\(?:[hzu]|o\s+"[1-9]-[1-9]"|\*\s+MERGEFORMAT))*\s*$/i.test(code)) return "TOC";
    const match=/^PAGEREF\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+\\(?:[hp]|\*\s+MERGEFORMAT))*\s*$/i.exec(code);
    if (match) {
      const id=bookmarks.get(match[1]);
      const starts=elements.filter(e=>e.localName==="bookmarkStart" && e.getAttributeNS(W,"id")===id);
      const end=elements.find(e=>e.localName==="bookmarkEnd" && e.getAttributeNS(W,"id")===id);
      if (id && /^\d+$/.test(id) && ends.get(id)===1 && starts.length===1 && end && elements.indexOf(starts[0])<elements.indexOf(end)) return "PAGEREF";
    }
    return reject();
  };
  const stack: Array<{code:string;result:boolean;kind?:string}> = [];
  let found=false;
  for (const e of elements) {
    const current=stack[stack.length-1];
    if (e.localName==="fldSimple") reject(); // Keep simple fields outside this bounded implementation.
    if (e.localName==="footnoteReference" && current) reject();
    if (e.localName==="fldChar") {
      // Text boxes are separate Word stories; do not balance their fields against the body.
      for(let ancestor=e.parentElement;ancestor;ancestor=ancestor.parentElement) {
        if(ancestor.namespaceURI===W && ancestor.localName==="txbxContent") reject();
      }
      found=true;
      if(e.parentElement?.localName!=="r" || e.children.length || e.textContent?.trim()) reject();
      const type=e.getAttributeNS(W,"fldCharType");
      if(type==="begin") {
        if(current && (!current.result || current.kind!=="TOC" || stack.length>1)) reject();
        stack.push({code:"",result:false});
      } else if(type==="separate") {
        if(!current || current.result) reject();
        current.kind=instruction(current.code); current.result=true;
        if(stack.length>1 && current.kind!=="PAGEREF") reject();
      } else if(type==="end") {
        if(!current?.result) reject();
        stack.pop();
      } else reject();
    } else if(e.localName==="instrText") {
      if(!current || current.result || e.parentElement?.localName!=="r" || e.children.length) reject();
      current.code+=e.textContent || "";
    } else if(e.localName==="t" && current && !current.result) reject();
  }
  if(stack.length) reject();
  return found;
}

/** Spelling/grammar markers contain no source text. Keep only balanced, empty
 * paragraph-level markers; unsupported shapes keep the entire note uneditable. */
function safeProofMarkers(element: Element): boolean {
  for(const p of Array.from(element.getElementsByTagNameNS(W,"p"))) {
    const open=new Set<string>();
    for(const marker of Array.from(p.getElementsByTagNameNS(W,"proofErr"))) {
      const type=marker.getAttributeNS(W,"type") || "";
      const match=/^(spell|gram)(Start|End)$/.exec(type);
      if(marker.parentElement!==p || marker.childNodes.length || !match) return false;
      if(match[2]==="Start") {if(open.has(match[1])) return false; open.add(match[1]);}
      else if(!open.delete(match[1])) return false;
    }
    if(open.size) return false;
  }
  return true;
}

export async function inspectDocxFootnotes(input: ArrayBuffer): Promise<DocxFootnoteSession> {
  const bytes = new Uint8Array(input.slice(0)); const sizes = preflight(bytes);
  const zip = await JSZip.loadAsync(bytes, { createFolders: false });
  const files = new Map<string, Uint8Array>();
  for (const [name, metadata] of sizes) {
    const entry = zip.files[name]; if (!entry) invalid();
    const content = await boundedRead(entry, metadata.size);
    if (crc32(content) !== metadata.crc) invalid();
    files.set(name, content);
  }
  const body = textFile(files, "word/document.xml"); const xml = textFile(files, "word/footnotes.xml");
  const contentTypes = xmlDocument(textFile(files, "[Content_Types].xml"));
  if (!Array.from(contentTypes.getElementsByTagName("Override")).some(e => e.getAttribute("PartName") === "/word/document.xml" && e.getAttribute("ContentType") === "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")) invalid();
  const bodyDoc = xmlDocument(body), notesDoc = xmlDocument(xml);
  const MC="http://schemas.openxmlformats.org/markup-compatibility/2006";
  if([bodyDoc,notesDoc].some(doc=>doc.getElementsByTagNameNS(MC,"AlternateContent").length))
    fail("מסמך עם ענפי תוכן חלופיים של Word אינו נתמך. לא ניתן לקבוע אילו הפניות להערות פעילות.");
  if (bodyDoc.documentElement.namespaceURI !== W || notesDoc.documentElement.namespaceURI !== W || notesDoc.documentElement.nodeName !== "w:footnotes") invalid();
  // Revisions/endnotes remain unsupported. Navigation fields are validated separately and never rewritten.
  for (const doc of [bodyDoc, notesDoc]) {
    for (const name of ["ins", "del", "moveFrom", "moveTo", "endnoteReference", "altChunk"]) {
      if (doc.getElementsByTagNameNS(W, name).length) fail("מסמכים עם שינויים במעקב, שדות, הפניות צולבות או הערות סיום עדיין אינם נתמכים.");
    }
  }
  for (const name of ["fldSimple", "fldChar", "instrText"]) {
    if(notesDoc.getElementsByTagNameNS(W,name).length) fail("שדות בתוך הערות שוליים עדיין אינם נתמכים.");
  }
  const preservedFields = validatePreservedBodyFields(bodyDoc);
  const anchors = Array.from(bodyDoc.getElementsByTagNameNS(W, "footnoteReference"));
  const order = anchors.map(a => { if (a.hasAttributeNS(W, "customMarkFollows")) fail("סימוני הערות מותאמים אינם נתמכים."); return a.getAttributeNS(W, "id") || ""; });
  if (!order.length || order.length > 250 || new Set(order).size !== order.length) fail("נדרשות 1–250 הערות שוליים בעלות הפניות ייחודיות.");
  const positions = new Map<string, TextPosition[]>(), found = new Map<string, DocxFootnote>();
  const encountered = new Set<string>(), skipped = new Map<string, SkippedDocxFootnote>();
  const skip = (id: string, reason: string) => skipped.set(id, Object.freeze({id, reason}));
  // Exact XML slices are retained: only approved text-node payloads change on export.
  const pattern = /<w:footnote\b[^>]*>[\s\S]*?<\/w:footnote>/g;
  for (const match of xml.matchAll(pattern)) {
    const rootOpen = xml.match(/<w:footnotes\b[^>]*>/)?.[0];
    if (!rootOpen) invalid();
    const wrapped = xmlDocument(`${rootOpen}${match[0]}</w:footnotes>`);
    const element = wrapped.documentElement.firstElementChild!;
    const id = element.getAttributeNS(W, "id") || "";
    const noteType = element.getAttributeNS(W, "type");
    if (noteType === "separator" || noteType === "continuationSeparator" || noteType === "continuationNotice") continue;
    if (!/^\d+$/.test(id)) invalid();
    if (encountered.has(id)) invalid(); encountered.add(id);
    if (noteType && noteType !== "normal") { skip(id, "סוג הערה לא נתמך; ההערה תישמר ללא שינוי."); continue; }
    const paras = element.getElementsByTagNameNS(W, "p");
    if (!paras.length || Array.from(element.children).some(child => child.namespaceURI !== W || child.localName !== "p")) {
      skip(id, "מבנה ההערה אינו נתמך; ההערה תישמר ללא שינוי."); continue;
    }
    const unsupported = Array.from(element.getElementsByTagName("*")).some(child =>
      child.namespaceURI !== W || child.prefix !== "w" || !["p", "pPr", "r", "rPr", "t", "footnoteRef", "proofErr", "pStyle", "rStyle", "b", "bCs", "i", "iCs", "smallCaps", "caps", "rtl", "bidi", "lang", "sz", "szCs", "rFonts", "color", "spacing", "ind", "jc", "keepNext", "keepLines", "widowControl", "contextualSpacing", "vertAlign", "u", "highlight", "noProof"].includes(child.localName));
    const invalidHierarchy = Array.from(element.childNodes).some(node => node.nodeType === 3 && !!node.textContent?.trim()) || Array.from(element.getElementsByTagName("*")).some(child => {
      const parent = child.parentElement;
      const name = child.localName;
      const expectedParent = name === "p" ? "footnote" : name === "r" || name === "pPr" || name === "proofErr" ? "p" : name === "t" || name === "rPr" || name === "footnoteRef" ? "r" : null;
      // Run properties also describe paragraph-mark formatting under pPr.
      if (name === "rPr" ? !parent || !["r", "pPr"].includes(parent.localName) : expectedParent ? parent?.localName !== expectedParent : !parent || !["pPr","rPr"].includes(parent.localName)) return true;
      if (name === "t" && child.children.length) return true;
      return name !== "t" && Array.from(child.childNodes).some(node => node.nodeType === 3 && !!node.textContent?.trim());
    });
    if (unsupported || invalidHierarchy || !safeProofMarkers(element)) { skip(id, "הערה בעלת רכיב מורכב (כגון קישור או טבלה) תישמר ללא שינוי."); continue; }
    const list: TextPosition[] = [], paragraphRanges: Array<{start:number;end:number}> = []; let text = "";
    const paragraphMatches = Array.from(match[0].matchAll(/<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g));
    if (paragraphMatches.length !== paras.length) { skip(id, "לא ניתן למפות את פסקאות ההערה בבטחה."); continue; }
    for (const paragraph of paragraphMatches) {
      if (paragraphRanges.length) text += "\n"; // Uneditable separator; it is never written into XML.
      const paragraphStart = text.length;
      for (const t of paragraph[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)) {
        const parsed = xmlDocument(`<w:t xmlns:w="${W}">${t[1]}</w:t>`).documentElement.textContent || "";
        const start = text.length; text += parsed;
        const offset = match.index! + paragraph.index! + t.index!;
        list.push({start, end: text.length, text: parsed, preserveSpace: /xml:space\s*=\s*['"]preserve['"]/.test(t[0].slice(0,t[0].indexOf(">"))), xmlStart: offset + t[0].indexOf(">") + 1, xmlEnd: offset + t[0].lastIndexOf("</w:t>")});
      }
      paragraphRanges.push({start:paragraphStart,end:text.length});
    }
    if (!text.trim() || text.length > 10000) { skip(id, "הערה ריקה או ארוכה מדי תישמר ללא שינוי."); continue; }
    found.set(id, Object.freeze({id, text, editableRanges: Object.freeze(list.map(({start,end}) => Object.freeze({start,end}))), paragraphRanges:Object.freeze(paragraphRanges.map(range => Object.freeze(range)))})); positions.set(id,list);
  }
  if (encountered.size !== order.length || order.some(id => !encountered.has(id))) fail("מיפוי ההערות במסמך אינו חד־משמעי.");
  const notes = Object.freeze(order.filter(id => found.has(id)).map(id => found.get(id)!));
  const skippedNotes = Object.freeze(order.filter(id => skipped.has(id)).map(id => skipped.get(id)!));
  const session = Object.freeze({documentOrder: documentNumbering(files, bodyDoc, order), notes, skippedNotes, skippedCount:skippedNotes.length, warnings: Object.freeze([...(preservedFields ? ["תוכן העניינים והפניות העמוד נשמרו ללא חישוב מחדש. לאחר התיקון יש לעדכן שדות ולבדוק עימוד ב-Word."] : []), "אזכורים יישמרו רק כאשר ניתן להחיל את עיצובם בבטחה; אחרת ההערה תישאר ללא שינוי.", "אין להחליף אזכור שחוצה פסקאות. טקסט שלא סומן לתיקון והערות שדולגו נשמרים ללא שינוי.", "הקובץ המקורי נשמר ללא שינוי. יש לבדוק את העותק שהורד ב-Word."])});
  sessions.set(session, {files, xml, positions, notes}); return session;
}
const escapeXml = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
export async function embedApprovedFootnotes(session: DocxFootnoteSession, patches: readonly ApprovedFootnotePatch[], protectedSpans: readonly ProtectedFootnoteSpan[] = []): Promise<Uint8Array> {
  const data = sessions.get(session); if (!data) fail("המסמך אינו זמין. יש להעלות אותו מחדש.");
  const selected = patches.filter(p => p.approved);
  if (!selected.length) fail("יש לאשר לפחות תיקון אחד.");
  if (selected.length > 1000 || protectedSpans.length > 1000) fail("מספר המקטעים חורג מהמגבלה.");
  const changes: Array<{start:number;end:number;text:string}> = [];
  const localEdits = new Map<TextPosition, Array<{start:number;end:number;text:string}>>();
  const approvedRanges = new Map<string, Array<{start:number;end:number}>>();
  const protectedRanges = new Map<string, Array<{start:number;end:number}>>();
  const overlaps = (a:{start:number;end:number},b:{start:number;end:number}) => a.start < b.end && b.start < a.end;
  const validSpan = (span: ProtectedFootnoteSpan) => {
    const note = data.notes.find(n => n.id === span.id);
    if (!note || span.originalText !== note.text || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > note.text.length) fail("המקטע אינו תואם להערה המקורית.");
    const boundarySplitsPair = (at:number) => at > 0 && at < note.text.length && /[\uD800-\uDBFF]/.test(note.text[at-1]) && /[\uDC00-\uDFFF]/.test(note.text[at]);
    if (boundarySplitsPair(span.start) || boundarySplitsPair(span.end)) fail("הבחירה חוצה תו מורכב. יש לבחור תווים שלמים.");
    return note;
  };
  for (const span of protectedSpans) {
    validSpan(span);
    const ranges = protectedRanges.get(span.id) || [];
    if (ranges.some(range => overlaps(range, span))) fail("מקטעי ההסבר המוגנים חופפים.");
    ranges.push(span); protectedRanges.set(span.id,ranges);
  }
  for (const p of selected) {
    const note = validSpan(p);
    if (!note.paragraphRanges.some(range => p.start >= range.start && p.end <= range.end)) fail("לא ניתן להחליף אזכור שחוצה פסקאות.");
    const ranges = approvedRanges.get(p.id) || [];
    if (ranges.some(range => overlaps(range,p))) fail("התיקונים המאושרים חופפים. יש לבחור מקטעים נפרדים.");
    if (protectedRanges.get(p.id)?.some(range => overlaps(range,p))) fail("תיקון מאושר חופף להסבר מוגן; ההטמעה נעצרה.");
    ranges.push(p); approvedRanges.set(p.id,ranges);
    if (!p.replacement.trim() || p.replacement.length > 10000 || Array.from(p.replacement).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(p.replacement)) fail("טקסט התיקון אינו תקין.");
    const nodes = data.positions.get(p.id)!.filter(n => n.end > p.start && n.start < p.end);
    if (!nodes.length) fail("לא נמצא מקטע טקסט להטמעה.");
    if (nodes.length > 1 && p.allowFormattingNormalization !== true) fail("האזכור חוצה מקטעי עיצוב. נדרש אישור מפורש להחלת עיצוב המקטע הראשון על התיקון.");
    // Collect changes in original coordinates; multiple edits in one node are composed
    // right-to-left once, preventing last-write-wins loss of another approved citation.
    nodes.forEach((node,i) => {
      const edits = localEdits.get(node) || [];
      edits.push({start:Math.max(p.start,node.start)-node.start,end:Math.min(p.end,node.end)-node.start,text:i===0?p.replacement:""});
      localEdits.set(node,edits);
    });
  }
  for (const [node,edits] of localEdits) {
    let replacement = node.text;
    for (const edit of edits.sort((a,b)=>b.start-a.start)) replacement = replacement.slice(0,edit.start)+edit.text+replacement.slice(edit.end);
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(replacement)) fail("הבחירה חוצה תו מורכב. יש לבחור תווים שלמים.");
    if (!node.preserveSpace && /^\s|\s$/.test(replacement)) fail("התיקון יוצר רווחים בקצה מקטע ללא שימור רווחים. יש לצמצם את הבחירה או לתקן ב-Word.");
    changes.push({start:node.xmlStart,end:node.xmlEnd,text:escapeXml(replacement)});
  }
  let result = data.xml;
  for (const c of changes.sort((a,b)=>b.start-a.start)) result = result.slice(0,c.start)+c.text+result.slice(c.end);
  if (new TextEncoder().encode(result).length > MAX_XML) fail("התיקונים יוצרים רכיב הערות גדול מדי. יש לצמצם את הטקסט.");
  xmlDocument(result);
  const out = new JSZip();
  for(const [name,bytes] of data.files) out.file(name, name === "word/footnotes.xml" ? result : bytes, {dir:name.endsWith("/")});
  return out.generateAsync({type:"uint8array",compression:"DEFLATE"});
}

/** Preflight and splice rule-styled citations; no source document mutation. */
export async function embedStyledFootnotes(session:DocxFootnoteSession,patches:readonly ApprovedFootnotePatch[],protectedSpans:readonly ProtectedFootnoteSpan[]=[]):Promise<Uint8Array>{
 const data=sessions.get(session);if(!data)fail('המסמך אינו זמין. יש להעלות אותו מחדש.');
 const selected=patches.filter(p=>p.approved);if(!selected.length||selected.length>1000||protectedSpans.length>1000)fail('יש לאשר מספר תקין של תיקונים.');
 const styles=data.files.has('word/styles.xml')?textFile(data.files,'word/styles.xml'):null;
 const protectedByNote=new Map<string,ProtectedFootnoteSpan[]>();
 for(const span of protectedSpans){
  const note=data.notes.find(n=>n.id===span.id);
  if(!note||span.originalText!==note.text||!Number.isInteger(span.start)||!Number.isInteger(span.end)||span.start<0||span.end<=span.start||span.end>note.text.length)fail('ההסבר המוגן אינו תואם להערה המקורית.');
  const splits=(at:number)=>at>0&&at<note.text.length&&/[\uD800-\uDBFF]/.test(note.text[at-1])&&/[\uDC00-\uDFFF]/.test(note.text[at]);if(splits(span.start)||splits(span.end))fail('הבחירה חוצה תו מורכב. יש לבחור תווים שלמים.');
  const ranges=protectedByNote.get(span.id)??[];if(ranges.some(r=>r.start<span.end&&span.start<r.end))fail('מקטעי ההסבר המוגנים חופפים.');ranges.push(span);protectedByNote.set(span.id,ranges);
 }
 const groups=new Map<string,{xmlStart:number;xmlEnd:number;xml:string;patches:StyledParagraphPatch[]}>();
 const ranges=new Map<string,Array<{start:number;end:number}>>();
 const overlaps=(a:{start:number;end:number},b:{start:number;end:number})=>a.start<b.end&&b.start<a.end;
 const rootOpen=data.xml.match(/<w:footnotes\b[^>]*>/)?.[0];if(!rootOpen)invalid();
 for(const p of selected){
  const note=data.notes.find(n=>n.id===p.id);
  if(!note||p.originalText!==note.text||!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start<0||p.end<=p.start||p.end>note.text.length)fail('המקטע אינו תואם להערה המקורית.');
  if(protectedSpans.some(q=>q.id===p.id&&(q.originalText!==note.text||overlaps(q,p))))fail('תיקון חופף להסבר מוגן; ההערה תישאר ללא שינוי.');
  const used=ranges.get(p.id)??[];if(used.some(r=>overlaps(r,p)))fail('התיקונים המאושרים חופפים.');used.push(p);ranges.set(p.id,used);
  const pi=note.paragraphRanges.findIndex(r=>p.start>=r.start&&p.end<=r.end);if(pi<0)fail('לא ניתן להחליף אזכור שחוצה פסקאות.');
  let location:RegExpMatchArray|undefined;
  for(const m of data.xml.matchAll(/<w:footnote\b[^>]*>[\s\S]*?<\/w:footnote>/g)){
   const d=xmlDocument(`${rootOpen}${m[0]}</w:footnotes>`);if(d.documentElement.firstElementChild?.getAttributeNS(W,'id')===p.id){if(location)invalid();location=m;}
  }
  if(!location)invalid();
  const paragraphs=[...location[0].matchAll(/<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)];
  if(paragraphs.length!==note.paragraphRanges.length||!paragraphs[pi])invalid();
  const par=paragraphs[pi],xmlStart=location.index!+par.index!,key=`${p.id}:${pi}`,range=note.paragraphRanges[pi];
  const group=groups.get(key)??{xmlStart,xmlEnd:xmlStart+par[0].length,xml:par[0],patches:[]};
  group.patches.push({start:p.start-range.start,end:p.end-range.start,originalText:note.text.slice(range.start,range.end),markedCitation:p.replacement});groups.set(key,group);
 }
 const changes=[...groups.values()].map(group=>({start:group.xmlStart,end:group.xmlEnd,text:applyStyledParagraph(group.xml,styles,group.patches)})).sort((a,b)=>b.start-a.start);
 let result=data.xml;for(const c of changes)result=result.slice(0,c.start)+c.text+result.slice(c.end);
 if(new TextEncoder().encode(result).length>MAX_XML)fail('התיקונים יוצרים רכיב הערות גדול מדי.');xmlDocument(result);
 const out=new JSZip();for(const [name,bytes] of data.files)out.file(name,name==='word/footnotes.xml'?result:bytes,{dir:name.endsWith('/')});
 return out.generateAsync({type:'uint8array',compression:'DEFLATE'});
}

/** Async safety preflight shares the exact exporter; generated bytes are discarded. */
export async function checkStyledFootnotes(session:DocxFootnoteSession,patches:readonly ApprovedFootnotePatch[],protectedSpans:readonly ProtectedFootnoteSpan[]=[]):Promise<string|null>{
 try{await embedStyledFootnotes(session,patches.map(p=>({...p,approved:true})),protectedSpans);return null;}catch(error){return error instanceof Error?error.message:'לא ניתן לשמור את עיצוב ההערה בבטחה; ההערה תישאר ללא שינוי.';}
}

export async function checkStyledFootnote(session:DocxFootnoteSession,patch:ApprovedFootnotePatch,protectedSpans:readonly ProtectedFootnoteSpan[]=[]):Promise<string|null>{return checkStyledFootnotes(session,[patch],protectedSpans);}
