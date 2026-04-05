/**
 * Word insertion utilities for the Office Add-in.
 * Uses OOXML for reliable RTL/Hebrew formatting in footnotes.
 * Supports Word Desktop (Rich API), Word Online (Common API), and manual-copy fallback.
 */

import { copyPlainText } from "@/lib/clipboard";

export type InsertionResult = {
  mode: "footnote" | "inline" | "manual-copy";
  text?: string;
};

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
export function getPlainCitationText(rawText: string): string {
  return extractCitationText(rawText)
    .replace(/\*\*/g, "")
    .replace(/##/g, "");
}

/** Snapshot of available Office capabilities */
interface HostCapabilities {
  hasOffice: boolean;
  hasDocument: boolean;
  hasSetSelectedData: boolean;
  hasWordRun: boolean;
  bridgeConnected: boolean;
}

/** Detect what Office APIs are actually usable right now */
async function detectCapabilities(): Promise<HostCapabilities> {
  const win = window as any;
  const Office = win.Office;
  const Word = win.Word;

  const caps: HostCapabilities = {
    hasOffice: !!Office,
    hasDocument: !!Office?.context?.document,
    hasSetSelectedData: !!Office?.context?.document?.setSelectedDataAsync,
    hasWordRun: !!Word?.run,
    bridgeConnected: false,
  };

  // Active probe: actually try Word.run to see if the bridge works
  if (caps.hasWordRun) {
    try {
      await Word.run(async (ctx: any) => { await ctx.sync(); });
      caps.bridgeConnected = true;
    } catch {
      // Bridge not connected (e.g. executeRichApiRequestAsync missing)
    }
  }

  console.log("[WordInsertion] Capabilities:", caps);
  return caps;
}

/** Short wait for Office.js to settle (non-blocking) */
async function waitForOfficeInit(): Promise<void> {
  const win = window as any;
  const Office = win.Office;
  if (!Office?.onReady) return;

  await Promise.race([
    new Promise<void>((resolve) => { Office.onReady(() => resolve()); }),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
}

/** Strategy A: Rich API footnote insertion via Word.run */
async function tryRichApi(fullOoxml: string): Promise<InsertionResult | null> {
  const win = window as any;
  const Word = win.Word;
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
    return { mode: method };
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (msg.includes("executeRichApiRequestAsync")) {
      console.warn("[WordInsertion] Rich API bridge not connected");
      return null; // Don't retry — bridge won't appear
    }
    console.warn("[WordInsertion] Rich API failed:", msg);
    return null;
  }
}

/** Strategy B: Common API insertion via setSelectedDataAsync */
async function tryCommonApi(fullOoxml: string, plainText: string): Promise<InsertionResult | null> {
  const win = window as any;
  const Office = win.Office;
  const doc = Office?.context?.document;
  if (!doc?.setSelectedDataAsync) return null;

  // Try OOXML first
  try {
    await new Promise<void>((resolve, reject) => {
      doc.setSelectedDataAsync(
        fullOoxml,
        { coercionType: Office.CoercionType.Ooxml },
        (result: any) => {
          if (result.status === Office.AsyncResultStatus.Succeeded) resolve();
          else reject(new Error(result.error?.message || "OOXML failed"));
        }
      );
    });
    return { mode: "inline" };
  } catch {
    console.warn("[WordInsertion] OOXML coercion failed, trying plain text");
  }

  // Try plain text
  try {
    await new Promise<void>((resolve, reject) => {
      doc.setSelectedDataAsync(
        plainText,
        { coercionType: Office.CoercionType.Text },
        (result: any) => {
          if (result.status === Office.AsyncResultStatus.Succeeded) resolve();
          else reject(new Error(result.error?.message || "Text failed"));
        }
      );
    });
    return { mode: "inline" };
  } catch (e: any) {
    console.warn("[WordInsertion] Plain text also failed:", e?.message);
    return null;
  }
}

/** Insert citation at the current cursor position in Word.
 *  Returns the insertion mode used, including "manual-copy" as a last resort. */
export async function insertCitationAsFootnote(text: string): Promise<InsertionResult> {
  await waitForOfficeInit();

  const caps = await detectCapabilities();
  const ooxml = citationToOoxml(text);
  const fullOoxml = wrapInOoxmlPackage(ooxml);
  const plainText = getPlainCitationText(text);

  // Strategy A: Rich API (only if bridge is actually connected)
  if (caps.bridgeConnected) {
    const result = await tryRichApi(fullOoxml);
    if (result) return result;
  }

  // Strategy B: Common API
  if (caps.hasSetSelectedData) {
    const result = await tryCommonApi(fullOoxml, plainText);
    if (result) return result;
  }

  // Strategy C: Manual copy fallback
  console.log("[WordInsertion] No working API found — falling back to clipboard copy");
  try {
    await copyPlainText(plainText);
  } catch {
    // Clipboard may also fail in restricted iframe — text is still returned
  }
  return { mode: "manual-copy", text: plainText };
}
