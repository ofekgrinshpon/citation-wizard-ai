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

  const segments: { text: string; bold: boolean; italic: boolean }[] = [];

  const boldParts = text.split(/\*\*/);
  boldParts.forEach((part, i) => {
    const isBold = i % 2 === 1;
    const italicParts = part.split(/##/);
    italicParts.forEach((subPart, j) => {
      const isItalic = j % 2 === 1;
      if (subPart) {
        segments.push({ text: subPart, bold: isBold, italic: isItalic });
      }
    });
  });

  const runs = segments
    .map((seg) => {
      const rPr: string[] = [];
      if (seg.bold) rPr.push("<w:b/>");
      if (seg.italic) rPr.push("<w:i/>");
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

  return `<w:p><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr>${runs}</w:p>`;
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

/** Wait for Office.js to be fully ready, including document context (with extended timeout for Word Online) */
async function ensureOfficeReady(): Promise<void> {
  const win = window as any;
  const Office = win.Office;
  if (!Office) {
    console.warn("[WordInsertion] Office global not found");
    return;
  }

  // If document context already available, we're good
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

  // Don't trust Word.run existence alone — the bridge may not be connected yet.
  // Poll for Office.context.document only as a readiness signal.
  if (!Office.context?.document) {
    console.log("[WordInsertion] document not yet available, polling (up to 10s)...");
    await new Promise<void>((resolve) => {
      let elapsed = 0;
      const interval = setInterval(() => {
        elapsed += 500;
        if (Office.context?.document || elapsed >= 10000) {
          clearInterval(interval);
          console.log("[WordInsertion] poll result:", {
            hasDocument: !!Office.context?.document,
            hasWordRun: !!win.Word?.run,
            elapsed,
          });
          resolve();
        }
      }, 500);
    });
  }
}

/** Insert citation at the current cursor position in Word.
 *  Tries Word.run Rich API first (Desktop); falls back to Office Common API (Word Online). */
export async function insertCitationAsFootnote(text: string): Promise<"footnote" | "inline"> {
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

  // Track Word.run errors for diagnostics
  let lastWordRunError: string | null = null;

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
      lastWordRunError = e?.message || String(e);
      console.warn("[WordInsertion] Word.run attempt failed:", lastWordRunError);
      return null;
    }
  };

  // Try Word.run up to 3 times with increasing delays
  if (Word?.run) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await tryWordRun();
      if (result === ("bridge_missing" as any)) {
        console.warn("[WordInsertion] Rich API bridge not connected, skipping to Common API fallback");
        break;
      }
      if (result) return result;
      if (attempt < 3) {
        const delay = attempt * 2000;
        console.log(`[WordInsertion] Retry ${attempt}/3 after ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // --- Fallback: Office Common API with OOXML coercion ---
  const doc = Office?.context?.document;
  if (doc?.setSelectedDataAsync || doc?.getSelectedDataAsync) {
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

  // Build diagnostic message — prioritize Word.run errors
  const state = JSON.stringify({
    hasOffice: !!Office,
    hasHost: !!Office?.context?.host,
    hasDocument: !!Office?.context?.document,
    hasWordRun: !!Word?.run,
  });

  if (Word?.run && lastWordRunError) {
    throw new Error(`Word.run failed after 3 attempts: ${lastWordRunError}. State: ${state}`);
  }

  const diagnostics: string[] = [];
  if (!Office) diagnostics.push("Office.js not loaded");
  else if (!Office.context?.document) diagnostics.push("Word document is still loading — please wait a moment and try again");
  else diagnostics.push("Insertion APIs unavailable");

  throw new Error(`Word API is not available: ${diagnostics.join("; ")}. State: ${state}`);
}
