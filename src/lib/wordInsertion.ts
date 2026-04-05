/**
 * Word insertion utilities for the Office Add-in.
 * Uses OOXML for reliable RTL/Hebrew formatting in footnotes.
 * Supports both Word Desktop (Word.run Rich API) and Word Online (Common API fallback).
 */

/** Strip citation metadata lines, keeping only the citation text */
function extractCitationText(fullContent: string): string {
  return fullContent
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^✓\s|^🏷️\s|^📐|^כלל:|^Based on Rule|^Rule \d|^מכיוון ש/.test(t)) return false;
      if (/העוזר המשפטי/.test(t)) return false;
      if (/^שלב \d|^זיהוי סוג|^נרמול|^יישום/.test(t)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

/** Convert citation text with **bold** and ##italic## markers to OOXML runs */
export function citationToOoxml(rawText: string): string {
  const text = extractCitationText(rawText);

  // Tokenize the text into segments with formatting
  const segments: { text: string; bold: boolean; italic: boolean }[] = [];

  // First pass: handle **bold** markers
  const boldParts = text.split(/\*\*/);
  boldParts.forEach((part, i) => {
    const isBold = i % 2 === 1;
    // Second pass within each part: handle ##italic## markers
    const italicParts = part.split(/##/);
    italicParts.forEach((subPart, j) => {
      const isItalic = j % 2 === 1;
      if (subPart) {
        segments.push({ text: subPart, bold: isBold, italic: isItalic });
      }
    });
  });

  // Build OOXML runs
  const runs = segments
    .map((seg) => {
      const rPr: string[] = [];
      if (seg.bold) rPr.push("<w:b/>");
      if (seg.italic) rPr.push("<w:i/>");
      // Always set RTL and Hebrew font
      rPr.push('<w:rtl/>');
      rPr.push('<w:rFonts w:cs="David" w:hint="cs"/>');
      rPr.push('<w:sz w:val="20"/>');
      rPr.push('<w:szCs w:val="20"/>');

      const escapedText = seg.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      return `<w:r><w:rPr>${rPr.join("")}</w:rPr><w:t xml:space="preserve">${escapedText}</w:t></w:r>`;
    })
    .join("");

  // Wrap in a BiDi paragraph
  const ooxml = `<w:p><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>${runs}</w:p>`;

  return ooxml;
}

/** Build a full OOXML package string from inner paragraph OOXML */
function wrapInOoxmlPackage(innerOoxml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">
  <pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml">
    <pkg:xmlData>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>
    </pkg:xmlData>
  </pkg:part>
  <pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml">
    <pkg:xmlData>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>${innerOoxml}</w:body>
      </w:document>
    </pkg:xmlData>
  </pkg:part>
</pkg:package>`;
}

/** Get plain text from citation (strip formatting markers) */
function getPlainText(rawText: string): string {
  return extractCitationText(rawText)
    .replace(/\*\*/g, "")
    .replace(/##/g, "");
}

/** Wait for Office.js to be fully ready, including document context (with timeout) */
async function ensureOfficeReady(): Promise<void> {
  const win = window as any;
  const Office = win.Office;
  if (!Office) {
    console.warn("[WordInsertion] Office global not found");
    return;
  }
  if (Office.context?.document) {
    return;
  }
  // Wait for onReady first
  if (Office.onReady) {
    await Promise.race([
      new Promise<void>((resolve) => {
        Office.onReady(() => resolve());
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
  // Poll for Office.context.document (Word Online populates it after onReady)
  if (!Office.context?.document) {
    console.log("[WordInsertion] document not yet available, polling...");
    await new Promise<void>((resolve) => {
      let elapsed = 0;
      const interval = setInterval(() => {
        elapsed += 200;
        if (Office.context?.document || elapsed >= 5000) {
          clearInterval(interval);
          console.log("[WordInsertion] poll result:", {
            hasDocument: !!Office.context?.document,
            elapsed,
          });
          resolve();
        }
      }, 200);
    });
  }
}

/** Insert citation at the current cursor position in Word.
 *  Tries Word.run Rich API first (Desktop); falls back to Office Common API (Word Online). */
export async function insertCitationAsFootnote(text: string): Promise<"footnote" | "inline"> {
  // Wait for Office to be fully initialized
  await ensureOfficeReady();

  const win = window as any;
  const Word = win.Word;
  const Office = win.Office;

  console.log("[WordInsertion] APIs available:", {
    hasWord: !!Word,
    hasWordRun: !!Word?.run,
    hasOffice: !!Office,
    hasContext: !!Office?.context,
    hasDocument: !!Office?.context?.document,
    hasSetSelectedData: !!Office?.context?.document?.setSelectedDataAsync,
  });

  const ooxml = citationToOoxml(text);
  const fullOoxml = wrapInOoxmlPackage(ooxml);

  // --- Attempt 1: Word.run Rich API (Desktop & Word Online) ---
  const tryWordRun = async (): Promise<"footnote" | "inline" | null> => {
    if (!Word?.run) return null;
    try {
      let method: "footnote" | "inline" = "footnote";
      await Word.run(async (context: any) => {
        const selection = context.document.getSelection();
        try {
          const footnote = selection.insertFootnote("");
          const body = footnote.body;
          body.insertOoxml(fullOoxml, "Replace");
        } catch {
          method = "inline";
          selection.insertOoxml(fullOoxml, "After");
        }
        await context.sync();
      });
      return method;
    } catch (e: any) {
      console.warn("[WordInsertion] Word.run attempt failed:", e?.message);
      return null;
    }
  };

  // First try
  let result = await tryWordRun();
  if (result) return result;

  // Retry after a brief wait (Word Online may need more time)
  if (Word?.run) {
    console.log("[WordInsertion] Retrying Word.run after 1s delay...");
    await new Promise((r) => setTimeout(r, 1000));
    result = await tryWordRun();
    if (result) return result;
  }

  // --- Attempt 2: Office Common API with OOXML coercion ---
  const doc = Office?.context?.document;
  if (doc?.setSelectedDataAsync || doc?.getSelectedDataAsync) {
    // Try OOXML first
    if (doc.setSelectedDataAsync) {
      try {
        await new Promise<void>((resolve, reject) => {
          doc.setSelectedDataAsync(
            fullOoxml,
            { coercionType: Office.CoercionType.Ooxml },
            (result: any) => {
              if (result.status === Office.AsyncResultStatus.Succeeded) {
                resolve();
              } else {
                reject(new Error(result.error?.message || "OOXML insertion failed"));
              }
            }
          );
        });
        return "inline";
      } catch {
        console.warn("OOXML coercion failed, falling back to plain text");
      }

      // Try plain text fallback
      const plainText = getPlainText(text);
      await new Promise<void>((resolve, reject) => {
        doc.setSelectedDataAsync(
          plainText,
          { coercionType: Office.CoercionType.Text },
          (result: any) => {
            if (result.status === Office.AsyncResultStatus.Succeeded) {
              resolve();
            } else {
              reject(new Error(result.error?.message || "Text insertion failed"));
            }
          }
        );
      });
      return "inline";
    }
  }

  throw new Error("Word API is not available. Office state: " + JSON.stringify({
    hasOffice: !!Office,
    hasContext: !!Office?.context,
    hasDocument: !!Office?.context?.document,
  }));
}
