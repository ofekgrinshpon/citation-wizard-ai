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
export interface DocxFootnoteSession { readonly notes: readonly DocxFootnote[]; readonly skippedNotes: readonly SkippedDocxFootnote[]; readonly skippedCount: number; readonly warnings: readonly string[]; }
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
  if (bodyDoc.documentElement.namespaceURI !== W || notesDoc.documentElement.namespaceURI !== W || notesDoc.documentElement.nodeName !== "w:footnotes") invalid();
  // Do not attempt to rewrite numbering fields, revisions, endnotes, cross-references, or custom marks.
  for (const doc of [bodyDoc, notesDoc]) {
    for (const name of ["ins", "del", "moveFrom", "moveTo", "fldSimple", "fldChar", "instrText", "endnoteReference", "altChunk"]) {
      if (doc.getElementsByTagNameNS(W, name).length) fail("מסמכים עם שינויים במעקב, שדות, הפניות צולבות או הערות סיום עדיין אינם נתמכים.");
    }
  }
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
      child.namespaceURI !== W || child.prefix !== "w" || !["p", "pPr", "r", "rPr", "t", "footnoteRef", "pStyle", "rStyle", "b", "bCs", "i", "iCs", "rtl", "bidi", "lang", "sz", "szCs", "rFonts", "color", "spacing", "ind", "jc", "keepNext", "keepLines", "widowControl", "contextualSpacing", "vertAlign", "u", "highlight", "noProof"].includes(child.localName));
    const invalidHierarchy = Array.from(element.childNodes).some(node => node.nodeType === 3 && !!node.textContent?.trim()) || Array.from(element.getElementsByTagName("*")).some(child => {
      const parent = child.parentElement;
      const name = child.localName;
      const expectedParent = name === "p" ? "footnote" : name === "r" || name === "pPr" ? "p" : name === "t" || name === "rPr" || name === "footnoteRef" ? "r" : null;
      if (expectedParent ? parent?.localName !== expectedParent : !parent || !["pPr","rPr"].includes(parent.localName)) return true;
      if (name === "t" && child.children.length) return true;
      return name !== "t" && Array.from(child.childNodes).some(node => node.nodeType === 3 && !!node.textContent?.trim());
    });
    if (unsupported || invalidHierarchy) { skip(id, "הערה בעלת רכיב מורכב (כגון קישור או טבלה) תישמר ללא שינוי."); continue; }
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
  const session = Object.freeze({notes, skippedNotes, skippedCount:skippedNotes.length, warnings: Object.freeze(["אזכור שחוצה מקטעי עיצוב דורש אישור נפרד: התיקון יקבל את עיצוב המקטע הראשון, והעיצוב המעורב בתוך האזכור לא יישמר.", "אין להחליף אזכור שחוצה פסקאות. טקסט שלא סומן לתיקון והערות שדולגו נשמרים ללא שינוי.", "הקובץ המקורי נשמר ללא שינוי. יש לבדוק את העותק שהורד ב-Word."])});
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
