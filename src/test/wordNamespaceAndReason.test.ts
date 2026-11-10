import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { applyStyledParagraph } from "@/lib/wordStyledParagraph";
import { inspectDocxFootnotes, checkStyledFootnote, embedStyledFootnotes } from "@/lib/docxFootnoteRoundtrip";
import { styleIssueReason } from "@/lib/wordStyleIssue";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const STYLES = `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:rPr><w:b/></w:rPr></w:style></w:styles>`;
const ROOT = `<w:footnotes xmlns:w="${W}" xmlns:w14="${W14}">`;
const modernNote = (id: number, text: string) =>
  `<w:footnote w:id="${id}"><w:p w14:paraId="73C82EF3" w14:textId="77777777"><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:footnote>`;

async function modernDocx(notes: string) {
  const z = new JSZip();
  z.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file("word/document.xml", `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p></w:body></w:document>`);
  z.file("word/footnotes.xml", `${ROOT}<w:footnote w:type="separator" w:id="-1"><w:p w14:paraId="00000001" w14:textId="77777777"><w:r><w:separator/></w:r></w:p></w:footnote>${notes}</w:footnotes>`);
  z.file("word/styles.xml", STYLES);
  return z.generateAsync({ type: "arraybuffer" });
}

describe("Word 2010+ paragraph IDs (w14 namespace)", () => {
  const paragraph = '<w:p w14:paraId="73C82EF3" w14:textId="77777777"><w:r><w:t>old</w:t></w:r></w:p>';
  const patch = { start: 0, end: 3, originalText: "old", markedCitation: "new" };

  it("a paragraph with w14:paraId is accepted when the document root declares w14", () => {
    expect(applyStyledParagraph(paragraph, STYLES, [patch], ROOT)).toContain("new");
  });

  it("without the document's namespace list the check still fails closed with an XML reason", () => {
    expect(() => applyStyledParagraph(paragraph, STYLES, [patch])).toThrow("קוד ה-XML של ההערה לא נקרא בבטחה");
  });

  it("a whole modern Word footnote passes the safety check and exports the new citation", async () => {
    const session = await inspectDocxFootnotes(await modernDocx(modernNote(1, "old citation")));
    const p = { id: "1", originalText: "old citation", start: 0, end: 12, replacement: "##New Citation##", approved: true };
    expect(await checkStyledFootnote(session, p)).toBeNull();
    const out = await JSZip.loadAsync(await embedStyledFootnotes(session, [p]));
    const xml = await out.file("word/footnotes.xml")!.async("string");
    expect(xml).toContain('w14:paraId="73C82EF3"');
    expect(xml).toContain("New Citation");
  });
});

describe("exact block reasons", () => {
  it("a bookmark inside the footnote is named as the reason", () => {
    const p = '<w:p><w:bookmarkStart w:id="0" w:name="x"/><w:r><w:t>old</w:t></w:r></w:p>';
    expect(() => applyStyledParagraph(p, null, [{ start: 0, end: 3, originalText: "old", markedCitation: "new" }])).toThrow("סימניה");
  });

  it("a tab inside the footnote text is named as the reason", () => {
    const p = "<w:p><w:r><w:tab/><w:t>old</w:t></w:r></w:p>";
    expect(() => applyStyledParagraph(p, null, [{ start: 0, end: 3, originalText: "old", markedCitation: "new" }])).toThrow("טאב");
  });

  it("styleIssueReason strips the shared 'unchanged' suffix", () => {
    expect(styleIssueReason("ההערה מכילה סימניה (Bookmark), שאינו נתמך בשינוי אוטומטי; ההערה תישאר ללא שינוי.")).toBe("ההערה מכילה סימניה (Bookmark), שאינו נתמך בשינוי אוטומטי");
  });

  it("styleIssueReason hides messages that only repeat the generic notice", () => {
    expect(styleIssueReason("לא ניתן לשמור את עיצוב ההערה בבטחה; ההערה תישאר ללא שינוי.")).toBeNull();
    expect(styleIssueReason("לא ניתן לשמור את ההערה בבטחה; היא נשארה ללא שינוי.")).toBeNull();
  });
});
