// DOCX footnote/endnote extractor.
// Reads word/footnotes.xml and word/endnotes.xml, plus the in-document references
// in word/document.xml to recover the user-visible note numbering order.
//
// Returns ONLY structured Word notes — never body text. If a document has no
// real footnotes/endnotes (e.g. user typed "1." inline), this returns [] and
// callers surface a clear Hebrew message.

import JSZip from "npm:jszip@3.10.1";

export interface ExtractedNote {
  note_id: string;
  note_number: number;
  note_type: "footnote" | "endnote";
  original_note_text: string;
}

export interface ExtractionResult {
  notes: ExtractedNote[];
  warnings: string[];
  has_footnotes_part: boolean;
  has_endnotes_part: boolean;
}

const SKIP_TYPES = new Set(["separator", "continuationSeparator"]);
const MAX_NOTES = 1000;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

/**
 * Pulls all <w:t>...</w:t> text inside a single note element XML chunk,
 * inserts a space at paragraph boundaries (<w:p>), and a tab for <w:tab/>.
 */
function extractNoteText(noteXml: string): string {
  let working = noteXml.replace(/<w:tab\b[^/]*\/>/g, "\t");
  // Insert space at paragraph boundaries to avoid word fusion.
  working = working.replace(/<\/w:p>/g, " ");
  const parts: string[] = [];
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(working)) !== null) parts.push(decodeXmlEntities(m[1]));
  return parts.join("").replace(/[ \t]+/g, " ").replace(/\s+\n/g, "\n").trim();
}

/**
 * Parse footnotes.xml or endnotes.xml. Returns map of id -> text, in source order.
 */
function parseNotesPart(xml: string, tag: "footnote" | "endnote"): Map<string, string> {
  const out = new Map<string, string>();
  const elemRe = new RegExp(
    `<w:${tag}\\b([^>]*)>([\\s\\S]*?)<\\/w:${tag}>`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = elemRe.exec(xml)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const idMatch = attrs.match(/w:id="(-?\d+)"/);
    const typeMatch = attrs.match(/w:type="([^"]+)"/);
    if (!idMatch) continue;
    if (typeMatch && SKIP_TYPES.has(typeMatch[1])) continue;
    const id = idMatch[1];
    const text = extractNoteText(inner);
    if (text.length > 0) out.set(id, text);
  }
  return out;
}

/**
 * Walk document.xml in source order and return arrays of footnote and endnote
 * IDs in the order they are referenced (= the user-visible numbering).
 */
function readReferenceOrder(documentXml: string): {
  footnoteIds: string[];
  endnoteIds: string[];
} {
  const footnoteIds: string[] = [];
  const endnoteIds: string[] = [];
  const refRe = /<w:(footnoteReference|endnoteReference)\b[^>]*w:id="(-?\d+)"[^/>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = refRe.exec(documentXml)) !== null) {
    if (m[1] === "footnoteReference") footnoteIds.push(m[2]);
    else endnoteIds.push(m[2]);
  }
  return { footnoteIds, endnoteIds };
}

export async function extractDocxNotes(buffer: ArrayBuffer): Promise<ExtractionResult> {
  const warnings: string[] = [];
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (_e) {
    throw new Error("DOCX_INVALID");
  }

  const footnotesFile = zip.file("word/footnotes.xml");
  const endnotesFile = zip.file("word/endnotes.xml");
  const documentFile = zip.file("word/document.xml");

  const has_footnotes_part = !!footnotesFile;
  const has_endnotes_part = !!endnotesFile;

  if (!documentFile) {
    throw new Error("DOCX_NO_DOCUMENT_XML");
  }

  const documentXml = await documentFile.async("text");
  const footnotesXml = footnotesFile ? await footnotesFile.async("text") : "";
  const endnotesXml = endnotesFile ? await endnotesFile.async("text") : "";

  const footnotesById = footnotesXml ? parseNotesPart(footnotesXml, "footnote") : new Map();
  const endnotesById = endnotesXml ? parseNotesPart(endnotesXml, "endnote") : new Map();

  const { footnoteIds, endnoteIds } = readReferenceOrder(documentXml);

  const notes: ExtractedNote[] = [];
  let totalBytes = 0;
  let counter = 0;
  const seenFootnoteIds = new Set<string>();
  const seenEndnoteIds = new Set<string>();

  for (const id of footnoteIds) {
    if (seenFootnoteIds.has(id)) continue;
    seenFootnoteIds.add(id);
    const text = footnotesById.get(id);
    if (!text) continue;
    counter++;
    totalBytes += text.length;
    if (totalBytes > MAX_TEXT_BYTES) { warnings.push("notes_text_truncated"); break; }
    notes.push({
      note_id: `f${id}`,
      note_number: counter,
      note_type: "footnote",
      original_note_text: text,
    });
    if (notes.length >= MAX_NOTES) { warnings.push("notes_count_capped"); break; }
  }

  // Append endnotes after footnotes, continuing the displayed counter
  // (Word numbers them separately, but for review we render them sequentially).
  if (notes.length < MAX_NOTES) {
    for (const id of endnoteIds) {
      if (seenEndnoteIds.has(id)) continue;
      seenEndnoteIds.add(id);
      const text = endnotesById.get(id);
      if (!text) continue;
      counter++;
      totalBytes += text.length;
      if (totalBytes > MAX_TEXT_BYTES) { warnings.push("notes_text_truncated"); break; }
      notes.push({
        note_id: `e${id}`,
        note_number: counter,
        note_type: "endnote",
        original_note_text: text,
      });
      if (notes.length >= MAX_NOTES) { warnings.push("notes_count_capped"); break; }
    }
  }

  // Defensive: any notes present in the parts but not referenced (rare) are appended at end
  // so the user still sees them, but with a warning that order may be imperfect.
  const orphans: ExtractedNote[] = [];
  for (const [id, text] of footnotesById) {
    if (!seenFootnoteIds.has(id)) orphans.push({ note_id: `f${id}`, note_number: 0, note_type: "footnote", original_note_text: text });
  }
  for (const [id, text] of endnotesById) {
    if (!seenEndnoteIds.has(id)) orphans.push({ note_id: `e${id}`, note_number: 0, note_type: "endnote", original_note_text: text });
  }
  if (orphans.length > 0) {
    warnings.push("orphan_notes_present");
    for (const o of orphans) {
      if (notes.length >= MAX_NOTES) break;
      counter++;
      notes.push({ ...o, note_number: counter });
    }
  }

  if (footnoteIds.length === 0 && endnoteIds.length === 0 && (footnotesById.size > 0 || endnotesById.size > 0)) {
    warnings.push("no_references_in_document");
  }

  return { notes, warnings, has_footnotes_part, has_endnotes_part };
}
