/**
 * legal-research-v2 — deterministic citation renderer.
 *
 * The model never writes a citation. This module owns markers, numbering,
 * repeated-source reuse, footnote text and the citation invariants.
 */

import type { DraftBlock, Footnote, RenderedAnswer, VerifiedEvidencePack } from "../types.ts";
import {
  isBareInstitutionTitle,
  looksLikeFilename,
  normalizeHebrewNumberRanges,
} from "../shared/primitives.ts";
import { stripInternalIds } from "../shared/titleHygiene.ts";

export interface CitationInfo {
  display_title: string;
  url?: string;
  locator?: string;
}

/** Deterministic Hebrew footnote text for one verified source. */
export function formatCitation(info: CitationInfo): string {
  let title = stripInternalIds((info.display_title ?? "").trim()).replace(/\s+/g, " ");
  // A URL is never a title: it belongs at the end of the citation, once.
  if (/^https?:\/\//i.test(title)) title = "";
  if (!title || looksLikeFilename(title) || isBareInstitutionTitle(title)) {
    title = title || "";
  }
  title = title.replace(/\s*[|–—-]\s*(?:נבו|תקדין|דין|פסקדין)\s*$/u, "").trim();
  let locator = info.locator?.trim() ?? "";
  // Don't repeat the docket when the title already carries it.
  const docket = locator.match(/\d{1,6}\/\d{2}/)?.[0];
  if (docket && title.includes(docket)) {
    locator = locator.replace(/^[^\d]*\d{1,6}\/\d{2}[^\u05D0-\u05EA\w]*/u, "").trim();
    locator = locator.replace(/^[,\-–—\s]+/, "").trim();
  }
  const parts = [title, locator && locator !== title ? locator : ""];
  let out = parts.filter(Boolean).join(", ") || "מקור ללא כותרת";
  if (info.url && !out.includes(info.url)) out += ` ${info.url}`;
  return normalizeHebrewNumberRanges(out.replace(/\s+/g, " ").trim());
}

function blockToMarkdown(block: DraftBlock, markers: string): string {
  const text = normalizeHebrewNumberRanges(block.text.trim());
  if (block.type === "heading") return `## ${text}`;
  if (block.type === "list_item") return `- ${text}${markers}`;
  return `${text}${markers}`;
}

export function renderAnswer(blocks: DraftBlock[], pack: VerifiedEvidencePack): RenderedAnswer {
  const infoBySource = new Map<string, CitationInfo>();
  for (const c of pack.claims) {
    for (const s of c.sources) {
      if (!infoBySource.has(s.source_id)) {
        infoBySource.set(s.source_id, {
          display_title: s.display_title,
          url: s.url,
          locator: s.locator,
        });
      }
    }
  }

  const footnotes: Footnote[] = [];
  const indexBySource = new Map<string, number>();
  const invariant_errors: string[] = [];
  const lines: string[] = [];

  for (const block of blocks) {
    const ids = block.type === "heading" ? [] : block.source_ids;
    const markerParts: string[] = [];
    for (const id of ids) {
      const info = infoBySource.get(id);
      if (!info) {
        invariant_errors.push(`block cites unverified source ${id}`);
        continue;
      }
      // Repeated sources reuse their first footnote number.
      let idx = indexBySource.get(id);
      if (idx === undefined) {
        idx = footnotes.length + 1;
        indexBySource.set(id, idx);
        footnotes.push({ index: idx, source_id: id, citation: formatCitation(info), url: info.url });
      }
      markerParts.push(`[^${idx}]`);
    }
    lines.push(blockToMarkdown(block, markerParts.join("")));
  }

  let answer_markdown = lines.join("\n\n").trim();
  if (footnotes.length) {
    answer_markdown += "\n\n" +
      footnotes.map((f) => `[^${f.index}]: ${f.citation}`).join("\n");
  }

  // Invariants.
  for (const f of footnotes) {
    if (!answer_markdown.includes(`[^${f.index}]:`)) {
      invariant_errors.push(`footnote ${f.index} has no definition`);
    }
    const markerCount = (answer_markdown.match(new RegExp(`\\[\\^${f.index}\\](?!:)`, "g")) ?? []).length;
    if (markerCount === 0) invariant_errors.push(`footnote ${f.index} is never referenced`);
    if (!f.citation.trim()) invariant_errors.push(`footnote ${f.index} has empty citation text`);
  }
  const seq = footnotes.map((f) => f.index);
  if (seq.some((n, i) => n !== i + 1)) invariant_errors.push("footnote numbering is not sequential");

  return {
    answer_markdown,
    footnotes,
    cited_source_ids: [...indexBySource.keys()],
    invariant_errors,
  };
}
