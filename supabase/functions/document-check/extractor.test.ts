import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import JSZip from "npm:jszip@3.10.1";
import { extractDocxNotes } from "../_shared/docxNotesExtractor.ts";

function buildDocx(parts: { document: string; footnotes?: string; endnotes?: string }): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<?xml version=\"1.0\"?><Types/>");
  zip.file("word/document.xml", parts.document);
  if (parts.footnotes) zip.file("word/footnotes.xml", parts.footnotes);
  if (parts.endnotes) zip.file("word/endnotes.xml", parts.endnotes);
  return zip.generateAsync({ type: "arraybuffer" }) as Promise<ArrayBuffer>;
}

const FN_XML = `<?xml version="1.0"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:t>sep</w:t></w:r></w:p></w:footnote>
  <w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:t>cont</w:t></w:r></w:p></w:footnote>
  <w:footnote w:id="1"><w:p><w:r><w:t>בג"ץ 1234/56 פלוני נ' אלמוני, פ"ד נ(1) 100 (2000).</w:t></w:r></w:p></w:footnote>
  <w:footnote w:id="2"><w:p><w:r><w:t>חוק יסוד: כבוד האדם וחירותו</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;

const DOC_XML_BASIC = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>טקסט</w:t><w:footnoteReference w:id="1"/></w:r></w:p>
    <w:p><w:r><w:t>טקסט נוסף</w:t><w:footnoteReference w:id="2"/></w:r></w:p>
  </w:body>
</w:document>`;

Deno.test("extracts footnotes in document order, skips separators", async () => {
  const buf = await buildDocx({ document: DOC_XML_BASIC, footnotes: FN_XML });
  const result = await extractDocxNotes(buf);
  assertEquals(result.notes.length, 2);
  assertEquals(result.notes[0].note_number, 1);
  assertEquals(result.notes[0].note_type, "footnote");
  assert(result.notes[0].original_note_text.includes("בג"));
  assertEquals(result.notes[1].note_number, 2);
  assert(result.notes[1].original_note_text.includes("חוק יסוד"));
});

Deno.test("returns empty notes when document has no footnote references", async () => {
  const docNoRefs = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>גוף הטקסט בלבד</w:t></w:r></w:p></w:body>
</w:document>`;
  const buf = await buildDocx({ document: docNoRefs });
  const result = await extractDocxNotes(buf);
  assertEquals(result.notes.length, 0);
  assertEquals(result.has_footnotes_part, false);
});

Deno.test("supports endnotes alongside footnotes", async () => {
  const en = `<?xml version="1.0"?>
<w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:t>s</w:t></w:r></w:p></w:endnote>
  <w:endnote w:id="1"><w:p><w:r><w:t>הערת סיום ראשונה</w:t></w:r></w:p></w:endnote>
</w:endnotes>`;
  const doc = `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>x</w:t><w:footnoteReference w:id="1"/></w:r></w:p>
    <w:p><w:r><w:t>y</w:t><w:endnoteReference w:id="1"/></w:r></w:p>
  </w:body>
</w:document>`;
  const fnSingle = `<?xml version="1.0"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:id="1"><w:p><w:r><w:t>הערת שוליים</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;
  const buf = await buildDocx({ document: doc, footnotes: fnSingle, endnotes: en });
  const result = await extractDocxNotes(buf);
  assertEquals(result.notes.length, 2);
  assertEquals(result.notes[0].note_type, "footnote");
  assertEquals(result.notes[1].note_type, "endnote");
  assert(result.notes[1].original_note_text.includes("הערת סיום"));
});

Deno.test("rejects invalid DOCX", async () => {
  const bad = new TextEncoder().encode("not a zip").buffer;
  let threw = false;
  try { await extractDocxNotes(bad); } catch (e) { threw = (e as Error).message === "DOCX_INVALID"; }
  assert(threw);
});
