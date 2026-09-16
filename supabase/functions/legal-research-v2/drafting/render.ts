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
import {
  buildOccurrenceFootnotes,
  type CitationOccurrence,
  placeMarkerAfterPunctuation,
  toSuperscript,
} from "../../_shared/footnoteOccurrences.ts";

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
  // Internal ids — evidence ids ("S1") and served-excerpt ids ("S2-q25") —
  // are bookkeeping, never part of a citation.
  locator = locator.replace(/\bS\d{1,3}-q\d{1,4}\b/gu, "").replace(/^[\s,;،.\-–—]+/u, "").trim();
  if (/^(?:מקור\s*)?S\d{1,3}$/u.test(locator)) locator = "";
  locator = locator.replace(/\s*[,(]?\s*(?:מקור\s*)?S\d{1,3}\s*\)?\s*$/u, "").trim();
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
  const text = placeMarkerAfterPunctuation(
    normalizeHebrewNumberRanges(block.text.trim()),
    markers,
  );
  if (block.type === "heading") return `## ${normalizeHebrewNumberRanges(block.text.trim())}`;
  if (block.type === "list_item") return `- ${text}`;
  return text;
}

export function renderAnswer(
  blocks: DraftBlock[],
  pack: VerifiedEvidencePack,
  /**
   * Academic Writing only: continuous footnote numbering across chapters.
   * 0 (the default) reproduces the previous behaviour exactly.
   */
  opts: { footnote_offset?: number } = {},
): RenderedAnswer {
  const offset = Math.max(0, Math.floor(opts.footnote_offset ?? 0));
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

  const invariant_errors: string[] = [];

  // ── Pass 1: citation occurrences in strict body-traversal order ──────────
  const occurrences: CitationOccurrence[] = [];
  const perBlockCounts: number[] = [];
  for (const block of blocks) {
    const ids = block.type === "heading" ? [] : block.source_ids;
    let count = 0;
    for (const id of ids) {
      const info = infoBySource.get(id);
      if (!info) {
        invariant_errors.push(`block cites unverified source ${id}`);
        continue;
      }
      occurrences.push({
        source_id: id,
        full_citation: formatCitation(info),
        locator: info.locator,
        url: info.url,
      });
      count++;
    }
    perBlockCounts.push(count);
  }

  // ── Pass 2: rule 37 repeat text + chronological numbering ────────────────
  const built = buildOccurrenceFootnotes(occurrences, { offset });
  const footnotes: Footnote[] = built.map((f) => ({
    index: f.index,
    source_id: f.source_id,
    citation: f.citation,
    full_citation: f.full_citation,
    first_occurrence: f.first_occurrence,
    repeat_kind: f.repeat_kind,
    locator: f.locator,
    url: f.url,
  }));

  // ── Pass 3: body with superscript markers only (no definitions) ──────────
  const lines: string[] = [];
  let cursor = 0;
  blocks.forEach((block, i) => {
    const count = perBlockCounts[i] ?? 0;
    const markers = built
      .slice(cursor, cursor + count)
      .map((f) => toSuperscript(f.index))
      .join("");
    cursor += count;
    lines.push(blockToMarkdown(block, markers));
  });

  const answer_markdown = lines.join("\n\n").trim();

  // Invariants: exactly one footnote row per marker, in appearance order.
  for (const f of footnotes) {
    if (!f.citation.trim()) invariant_errors.push(`footnote ${f.index} has empty citation text`);
  }
  const seq = footnotes.map((f) => f.index);
  if (seq.some((n, i) => n !== offset + i + 1)) {
    invariant_errors.push("footnote numbering is not sequential");
  }
  if (/\[\^\d+\]/.test(answer_markdown)) {
    invariant_errors.push("answer contains legacy markdown footnote markers");
  }

  const cited: string[] = [];
  for (const f of footnotes) if (!cited.includes(f.source_id)) cited.push(f.source_id);

  return {
    answer_markdown,
    footnotes,
    cited_source_ids: cited,
    invariant_errors,
  };
}
