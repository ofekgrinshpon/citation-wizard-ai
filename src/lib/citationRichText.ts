/**
 * Convert internal citation markers into rich HTML / clean plain text so that
 * what the user sees ≈ what the user pastes.
 *
 * Markers: **bold**  ##italic##  ^^small caps^^
 * The markers themselves must never reach the user in either output.
 */

import { copyRichText } from "@/lib/clipboard";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Rich HTML for the clipboard (bold / italics / real CSS small caps). */
export function citationToHtml(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\*\*([\s\S]*?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/##([\s\S]*?)##/g, "<em>$1</em>");
  out = out.replace(
    /\^\^([\s\S]*?)\^\^/g,
    '<span style="font-variant:small-caps;font-variant-caps:small-caps">$1</span>',
  );
  // Drop any unterminated marker rather than leaking it.
  out = out.replace(/\*\*|##|\^\^/g, "");
  return out.replace(/\n/g, "<br/>");
}

/** Clean plain-text fallback with all markers removed. */
export function citationToPlain(text: string): string {
  return text
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/##([\s\S]*?)##/g, "$1")
    .replace(/\^\^([\s\S]*?)\^\^/g, "$1")
    .replace(/\*\*|##|\^\^/g, "");
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
