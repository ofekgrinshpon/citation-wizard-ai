/**
 * Bibliography copy payload (Stage B): one pure builder shared by the
 * bibliography panel so rich copy keeps citation styles (italic, small caps)
 * while the plain-text fallback stays clean of internal markers.
 */

import { citationToHtml, citationToPlain } from "@/lib/citationRichText";

export interface BibliographyCopyGroup {
  label: string;
  entries: { fullCitation: string }[];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build { html, plain } for a grouped bibliography. Styles are preserved in
 *  the HTML channel; the plain channel is marker-free with all text kept. */
export function buildBibliographyCopy(groups: BibliographyCopyGroup[]): { html: string; plain: string } {
  const htmlParts: string[] = [];
  const plainLines: string[] = [];

  for (const group of groups) {
    if (group.entries.length === 0) continue;
    htmlParts.push(`<div><strong>${escapeHtml(group.label)}</strong></div>`);
    plainLines.push(group.label, "");
    for (const entry of group.entries) {
      htmlParts.push(`<div>${citationToHtml(entry.fullCitation)}</div>`);
      plainLines.push(citationToPlain(entry.fullCitation));
    }
    plainLines.push("");
  }

  return { html: htmlParts.join(""), plain: plainLines.join("\n").trimEnd() };
}
