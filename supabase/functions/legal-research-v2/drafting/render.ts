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
  type BibliographicMetadata,
  formatAcademicCitation,
  isDiscoveryEndpointUrl,
  sanitizeBibliographic,
} from "../shared/bibliographic.ts";
import {
  buildCompoundFootnotes,
  type CitationOccurrence,
  placeMarkerAfterPunctuation,
  toSuperscript,
} from "../../_shared/footnoteOccurrences.ts";

export interface CitationInfo {
  display_title: string;
  url?: string;
  locator?: string;
  /** Structured academic identity, when the source carries one. */
  bibliographic?: BibliographicMetadata;
}

/** Deterministic Hebrew footnote text for one verified source. */
export function formatCitation(info: CitationInfo): string {
  // An academic source with structured identity cites as scholarship —
  // author, title, journal, year — rather than as a bare page title + URL.
  const safeMeta = sanitizeBibliographic(info.bibliographic, {
    url: info.url,
    title: info.display_title,
  });
  const academic = formatAcademicCitation(
    safeMeta,
    stripInternalIds((info.display_title ?? "").trim()),
  );
  if (academic) {
    const loc = (info.locator ?? "").replace(/\bS\d{1,3}(?:-q\d{1,4})?\b/gu, "").trim();
    const out = loc && !academic.includes(loc) ? `${academic}, ${loc}` : academic;
    // A structured academic citation carries no raw URL in its visible text —
    // the link lives in the footnote's own `url` field.
    return normalizeHebrewNumberRanges(out.replace(/\s+/g, " ").trim());
  }
  let title = stripInternalIds((info.display_title ?? "").trim()).replace(/\s+/g, " ");
  // A URL is never a title: it belongs at the end of the citation, once.
  if (/^https?:\/\//i.test(title)) title = "";
  // A discovery / metadata API endpoint is not scholarship: its generic label
  // ("works", "search") must never be rendered as a document title.
  if (isDiscoveryEndpointUrl(info.url) || /^(works|search|results|items|api)$/i.test(title)) {
    title = "";
  }
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
          bibliographic: s.bibliographic,
        });
      }
    }
  }

  const invariant_errors: string[] = [];

  // ── Pass 1: citation POINTS in strict body-traversal order ───────────────
  // One block = one citation point, however many verified sources support it.
  const groups: CitationOccurrence[][] = [];
  const blockGroupIndex: Array<number | null> = [];
  for (const block of blocks) {
    const ids = block.type === "heading" ? [] : block.source_ids;
    const group: CitationOccurrence[] = [];
    for (const id of ids) {
      const info = infoBySource.get(id);
      if (!info) {
        invariant_errors.push(`block cites unverified source ${id}`);
        continue;
      }
      group.push({
        source_id: id,
        full_citation: formatCitation(info),
        locator: info.locator,
        url: info.url,
      });
    }
    if (group.length) {
      blockGroupIndex.push(groups.length);
      groups.push(group);
    } else {
      blockGroupIndex.push(null);
    }
  }

  // ── Pass 2: rule 37 repeat text + chronological numbering ────────────────
  const built = buildCompoundFootnotes(groups, { offset });
  const footnotes: Footnote[] = built.map((f) => ({
    index: f.index,
    source_id: f.source_id,
    source_ids: f.source_ids,
    citation: f.citation,
    full_citation: f.full_citation,
    first_occurrence: f.first_occurrence,
    repeat_kind: f.repeat_kind,
    locator: f.locator,
    url: f.url,
    sources: f.sources.map((s) => ({
      source_id: s.source_id,
      citation: s.citation,
      full_citation: s.full_citation,
      first_occurrence: s.first_occurrence,
      repeat_kind: s.repeat_kind,
      locator: s.locator,
      url: s.url,
    })),
  }));

  // ── Pass 3: body with exactly ONE superscript marker per citation point ──
  const lines: string[] = [];
  blocks.forEach((block, i) => {
    const gi = blockGroupIndex[i];
    const marker = gi === null || gi === undefined ? "" : toSuperscript(built[gi].index);
    lines.push(blockToMarkdown(block, marker));
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
  if (groups.length !== footnotes.length) {
    invariant_errors.push("footnote rows do not match citation points");
  }

  const cited: string[] = [];
  for (const f of built) {
    for (const id of f.source_ids) if (!cited.includes(id)) cited.push(id);
  }

  return {
    answer_markdown,
    footnotes,
    cited_source_ids: cited,
    invariant_errors,
  };
}
