/**
 * Convert internal citation markers into rich HTML / clean plain text so that
 * what the user sees ≈ what the user pastes.
 *
 * Markers: **bold**  ##italic##  ^^small caps^^
 * The markers themselves must never reach the user in either output.
 *
 * Built on the shared structural parser (citationSegments) so every output
 * channel parses markers exactly once, the same way. All source text is
 * HTML-escaped; only http(s) URLs become links, with escaped href values.
 */

import { copyRichText } from "@/lib/clipboard";
import { citationTextOnly, parseCitationSegments } from "@/lib/citationSegments";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;

/** Escape text and turn bare http(s) URLs into safe anchors. */
function escapeAndLinkify(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    // Trailing sentence punctuation is not part of the link.
    const url = m[0].replace(/[.,;:)\]]+$/, "");
    out += escapeHtml(text.slice(last, start));
    out += `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`;
    last = start + url.length;
  }
  return out + escapeHtml(text.slice(last));
}

/** Rich HTML for the clipboard (bold / italics / real CSS small caps). */
export function citationToHtml(text: string): string {
  const out = parseCitationSegments(text)
    .map((seg) => {
      let inner = escapeAndLinkify(seg.text);
      if (seg.smallCaps) {
        inner = `<span style="font-variant:small-caps;font-variant-caps:small-caps">${inner}</span>`;
      }
      if (seg.italic) inner = `<em>${inner}</em>`;
      if (seg.bold) inner = `<strong>${inner}</strong>`;
      return inner;
    })
    .join("");
  return out.replace(/\n/g, "<br/>");
}

/** Clean plain-text fallback with all markers removed. */
export function citationToPlain(text: string): string {
  return citationTextOnly(text);
}

/** Copy one citation (or a joined block) preserving bold/italic/small caps. */
export async function copyCitationRich(text: string): Promise<void> {
  await copyRichText(citationToHtml(text), citationToPlain(text));
}

/** Copy several citations as a formatted list with a clean plain fallback. */
export async function copyCitationsRich(lines: string[]): Promise<void> {
  const html = lines.map((l) => `<div>${citationToHtml(l)}</div>`).join("");
  const plain = lines.map(citationToPlain).join("\n");
  await copyRichText(html, plain);
}
