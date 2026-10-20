/**
 * Shared structural representation for citation text (Stage B).
 *
 * Stored citations keep the legacy inline markers (**bold**, ##italic##,
 * ^^small caps^^). This module is the single parser that turns marked text
 * into typed style segments; every output channel (display, rich/plain copy,
 * Word OOXML) is built from these segments instead of re-parsing markers.
 *
 * Literal characters: a backslash before one of `\ * # ^` makes the next
 * character literal text (never markup). Renderers escape source-supplied
 * text with `escapeCitationLiteral`, so a title such as "C## Guide: x^^2"
 * survives every channel. Legacy stored text has no escapes and reads as before.
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

const ESCAPABLE = new Set(["\\", "*", "#", "^"]);

/** Index of the next unescaped occurrence of a two-char marker token. */
function findUnescaped(text: string, token: string, from: number): number {
  let i = from;
  while (i < text.length - 1) {
    if (text[i] === "\\" && ESCAPABLE.has(text[i + 1] ?? "")) { i += 2; continue; }
    if (text.startsWith(token, i)) return i;
    i += 1;
  }
  return -1;
}

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
    if (text[i] === "\\" && ESCAPABLE.has(text[i + 1] ?? "")) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
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
      if (findUnescaped(text, token, i + 2) !== -1) {
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

/**
 * Mark source-supplied text as literal so marker-like characters (C##, x^^2,
 * A**B) are never read as styling. Only backslashes before a marker
 * character and runs of doubled marker characters are escaped, so ordinary
 * text (single *, #, ^, star pinpoints) is byte-identical.
 */
export function escapeCitationLiteral(text: string): string {
  return text
    .replace(/\\(?=[\\*#^])/g, "\\\\")
    .replace(/([*#^])\1+/g, (run) => run.split("").map((c) => `\\${c}`).join(""));
}

/** Inverse of escapeCitationLiteral for plain-text consumers. */
export function unescapeCitationLiteral(text: string): string {
  return text.replace(/\\([\\*#^])/g, "$1");
}

/** Lines that are warnings (presentation metadata, never citation text). */
export function isWarningLine(line: string): boolean {
  return /^⚠️/.test(line.trim());
}

/**
 * Split marked citation text into the citation lines and its warning lines
 * (without the ⚠️ prefix). Markup in the citation lines is preserved.
 */
export function splitCitationWarnings(text: string): { citation: string; warnings: string[] } {
  const citation: string[] = [];
  const warnings: string[] = [];
  for (const line of text.split("\n")) {
    if (isWarningLine(line)) {
      const w = line.trim().replace(/^⚠️\s*/, "").trim();
      if (w) warnings.push(w);
    } else {
      citation.push(line);
    }
  }
  return { citation: citation.join("\n").trim(), warnings };
}

/** Merge warnings without duplicates (a warning contained in another is dropped). */
export function mergeWarnings(...lists: (string | undefined | null | readonly string[])[]): string[] {
  const all = lists.flatMap((l) => (l == null ? [] : typeof l === "string" ? [l] : [...l]))
    .map((w) => w.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const w of all) {
    if (out.some((o) => o.includes(w))) continue;
    for (let k = out.length - 1; k >= 0; k--) if (w.includes(out[k])) out.splice(k, 1);
    out.push(w);
  }
  return out;
}

/**
 * Compose one export payload (marked text) from a citation, a separate
 * source URL and its warnings. The URL line is added only when the citation
 * does not already contain it; warnings are literal (escaped) lines.
 */
export function composeCitationExport(opts: {
  citation: string;
  url?: string | null;
  warnings?: readonly string[];
}): string {
  const lines = [opts.citation.trim()];
  const url = opts.url?.trim();
  if (url && !citationTextOnly(opts.citation).includes(url)) lines.push(escapeCitationLiteral(url));
  for (const w of opts.warnings ?? []) lines.push(`⚠️ ${escapeCitationLiteral(w)}`);
  return lines.filter(Boolean).join("\n");
}
