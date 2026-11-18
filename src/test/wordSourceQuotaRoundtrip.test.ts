import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { inspectDocxFootnotes, embedStyledFootnotes } from '../lib/docxFootnoteRoundtrip';
import { mapWordSources } from '../lib/wordSourceMap';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
describe('Word quota partial-source export', () => {
  it('changes one approved source and byte-preserves the styled unselected source in the same footnote', async () => {
    const first = 'Brown v. Board of Education, 347 U.S. 483 (1954)';
    const second = 'Roe v. Wade, 410 U.S. 113 (1973)';
    const untouchedRun = `<w:r><w:rPr><w:i/><w:color w:val="AA0000"/></w:rPr><w:t>${second}</w:t></w:r>`;
    const archive = new JSZip();
    archive.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    const document = `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p></w:body></w:document>`;
    archive.file('word/document.xml', document);
    archive.file('word/styles.xml', `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:rPr/></w:style></w:styles>`);
    archive.file('word/footnotes.xml', `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve">${first}; </w:t></w:r>${untouchedRun}</w:p></w:footnote></w:footnotes>`);
    const session = await inspectDocxFootnotes(await archive.generateAsync({ type: 'arraybuffer' }));
    const note = session.notes[0]; const mapped = mapWordSources(note, []);
    expect(mapped.sources).toHaveLength(2);
    const source = mapped.sources[0]; const replacement = '**Brown v. Board of Education**, 347 U.S. 483 (1954)';
    const output = await embedStyledFootnotes(session, [{ id: note.id, originalText: note.text, start: source.start, end: source.end, replacement, approved: true }], []);
    const actual = await JSZip.loadAsync(output);
    expect(await actual.file('word/footnotes.xml')!.async('string')).toContain(untouchedRun);
    expect(await actual.file('word/document.xml')!.async('string')).toBe(document);
    expect((await inspectDocxFootnotes(new Uint8Array(output).buffer)).notes[0].text).toBe(`${first}; ${second}`);
  });
});
