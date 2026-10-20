/**
 * Shared structural representation for citation text (Stage B).
 *
 * Stored citations keep the legacy inline markers (**bold**, ##italic##,
 * ^^small caps^^). This module is the single parser that turns marked text
 * into typed style segments; every output channel (display, rich/plain copy,
 * Word OOXML) is built from these segments instead of re-parsing markers.
 *
 * Invariants:
 * - Marker tokens are never leaked to any user-facing output.
 * - An unterminated marker is dropped; its text is kept.
 * - Literal source punctuation (single *, #, ^) is ordinary text.
 * - Segment text is always raw source text — escaping happens per channel.
 */

export interface CitationSegment {
  text: string;
  bold: boolean;
  italic: boolean;
  smallCaps: boolean;
}

type StyleKey = "bold" | "italic" | "smallCaps";

const MARKER_STYLES: Record<string, StyleKey> = {
  "**": "bold",
  "##": "italic",
  "^^": "smallCaps",
};

export function parseCitationSegments(text: string): CitationSegment[] {
  const segments: CitationSegment[] = [];
  const stack: StyleKey[] = [];
  let buf = "";

  const flush = () => {
    if (!buf) return;
    segments.push({
      text: buf,
      bold: stack.includes("bold"),
      italic: stack.includes("italic"),
      smallCaps: stack.includes("smallCaps"),
    });
    buf = "";
  };

  let i = 0;
  while (i < text.length) {
    const token = text.slice(i, i + 2);
    const style = MARKER_STYLES[token];
    if (style) {
      if (stack.includes(style)) {
        // Closer for the currently open style.
        flush();
        stack.splice(stack.lastIndexOf(style), 1);
        i += 2;
        continue;
      }
      if (text.indexOf(token, i + 2) !== -1) {
        // Opener with a matching closer later in the string.
        flush();
        stack.push(style);
        i += 2;
        continue;
      }
      // Unterminated marker: drop the token, keep the text.
      i += 2;
      continue;
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return segments;
}

/** Plain text with every internal marker removed and all text retained. */
export function citationTextOnly(text: string): string {
  return parseCitationSegments(text)
    .map((s) => s.text)
    .join("");
}
