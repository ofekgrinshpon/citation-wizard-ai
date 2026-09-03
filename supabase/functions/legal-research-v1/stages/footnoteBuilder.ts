// V2.1 — deterministic footnote builder.
// Input: a validated StructuredDraft + the same DrafterInputSource[] passed
// to the model. Output: Hebrew markdown with superscript markers placed by
// code, plus footnotes and used_sources lists.
//
// Guarantees by construction:
//   * answer_markdown contains exactly one superscript marker per cited
//     paragraph/list_item segment (compound footnote when multiple sources).
//   * No two markers are adjacent (each marker sits on its own line/segment
//     because we emit at most one per block).
//   * Marker is placed AFTER trailing punctuation.
//   * Every footnote maps to ≥1 verified source.
//   * used_sources[].candidate_id ⊆ verifier.usable (because allowedRefs are
//     derived from inputSources, which themselves are built from
//     verifier.usable).
//   * Numbering is chronological by first appearance.

import { unrelatedCompoundCompanions } from "./nonAcademicBinding.ts";
import type { Footnote, UsedSource } from "../lib/types.ts";
import type { DrafterInputSource } from "./drafter.ts";
import type { StructuredBlock, StructuredDraft } from "./structuredValidation.ts";
import {
  compareHierarchy,
  hierarchyClassOf,
  hierarchyTierOf,
  statuteIdentityKey,
  statuteMirrorRank,
  tierRank,
  type HierarchyTier,
} from "./sourceHierarchy.ts";

const SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
function toSuperscript(n: number): string {
  return String(n).split("").map((d) => SUP_DIGITS[Number(d)] ?? d).join("");
}

const TRAILING_PUNCT_RE = /[.!?:;,]$/u;

export interface HierarchyReport {
  hierarchy_order_applied: true;
  used_sources_hierarchy_counts: Record<string, number>;
  first_primary_position: number | null;
  first_secondary_position: number | null;
  primary_before_secondary_passed: boolean;
  mixed_hierarchy_footnotes_count: number;
  mixed_hierarchy_footnotes_split: number;
  commentary_head_count: number;
  commentary_head5_count: number;
  primary_head5_count: number;
  head_cap_passed: boolean;
  statute_identity_dedup_count: number;
  usable_primary_count: number;
}

export interface FootnoteRenderReport {
  version: "footnote_rendering_invariant_v1";
  inline_marker_count: number;
  footnotes_length: number;
  used_sources_length: number;
  dangling_marker_count: number;
  orphan_source_row_count: number;
  invariant_passed: boolean;
  renumbered: boolean;
}

export interface BuildResult {
  answer_markdown: string;
  footnotes: Footnote[];
  used_sources: UsedSource[];
  hierarchy_report: HierarchyReport;
  footnote_render_report: FootnoteRenderReport;

  builder_report: {
    paragraph_count: number;
    list_item_count: number;
    heading_count: number;
    cited_segment_count: number;
    compound_segment_count: number;
    unrelated_compound_companions_pruned?: number;
    marker_count: number;
    distinct_source_count: number;
    compound_footnote_count: number;
    adjacent_marker_count: number; // invariant: must be 0
    avg_sources_per_cited_segment: number;
  };
}

interface MarkerEntry {
  // key for de-dup: single source uses candidate_id; compound uses sorted joined ids
  key: string;
  number: number;
  // for footnote rendering
  title: string;
  url: string | null;
  source_type: string;
  // for used_sources mapping
  source_candidate_ids: string[];
  source_inputs: DrafterInputSource[];
  /** first appearance index (block order) — stable tie-break */
  first_seen: number;
}


function placeMarker(text: string, marker: string): string {
  // Place marker AFTER trailing punctuation if present, otherwise after a
  // period we append. Keeps Hebrew prose readable.
  if (TRAILING_PUNCT_RE.test(text)) return text + marker;
  return text + "." + marker;
}

export function buildFootnotedAnswer(
  draft: StructuredDraft,
  inputSources: DrafterInputSource[],
  opts?: { referenceOnlyRefs?: string[] },
): BuildResult {
  // academic_utilization_stabilization_v1 — refs kept as reading pointers only.
  const referenceOnlyRefs = new Set(opts?.referenceOnlyRefs ?? []);
  const referenceOnlyIds = new Set(
    inputSources.filter((s) => referenceOnlyRefs.has(s.ref)).map((s) => s.candidate_id),
  );

  // ── Statute identity dedup (legal identity, not URL) ─────────────────────
  // Collapse mirrors of the same statute/regulation; keep the best mirror
  // (official_primary > statute_mirror > other mirror), then remap every ref
  // of a collapsed mirror onto the winner.
  const bestByIdentity = new Map<string, DrafterInputSource>();
  for (const s of inputSources) {
    const key = statuteIdentityKey(s);
    if (!key) continue;
    const cur = bestByIdentity.get(key);
    if (!cur || statuteMirrorRank(s) > statuteMirrorRank(cur)) bestByIdentity.set(key, s);
  }
  const canonicalOf = (s: DrafterInputSource): DrafterInputSource => {
    const key = statuteIdentityKey(s);
    if (!key) return s;
    return bestByIdentity.get(key) ?? s;
  };
  const collapsedIds = new Set<string>();
  for (const s of inputSources) {
    const key = statuteIdentityKey(s);
    if (!key) continue;
    const winner = bestByIdentity.get(key)!;
    if (winner.candidate_id !== s.candidate_id) collapsedIds.add(s.candidate_id);
  }
  const statute_identity_dedup_count = collapsedIds.size;

  const inputByRef = new Map(inputSources.map((s) => [s.ref, s]));

  let unrelated_compound_companions_pruned = 0;
  let mixed_hierarchy_footnotes_count = 0;
  let mixed_hierarchy_footnotes_split = 0;
  // Counters are gathered on the first (entry-collection) pass only; the
  // render pass re-resolves the same blocks.
  let counting = true;

  // Resolve one block's refs into the final, hierarchy-clean source list:
  //   * refs → sources, statute mirrors collapsed, de-duped
  //   * no mixed compound footnotes: when a segment cites both primary
  //     authority and secondary scholarship/commentary, the secondary sources
  //     are dropped from that citation (explanatory only).
  const resolveBlockSources = (refs: string[]): DrafterInputSource[] => {
    const resolved = refs
      .map((r) => inputByRef.get(r))
      .filter((s): s is DrafterInputSource => !!s)
      .map(canonicalOf);
    const seen = new Set<string>();
    let distinct: DrafterInputSource[] = [];
    for (const s of resolved) {
      if (seen.has(s.candidate_id)) continue;
      seen.add(s.candidate_id);
      distinct.push(s);
    }
    if (distinct.length > 1) {
      const primary = distinct.filter(
        (s) => hierarchyClassOf(hierarchyTierOf(s)) === "primary",
      );
      const secondary = distinct.filter(
        (s) => hierarchyClassOf(hierarchyTierOf(s)) === "secondary",
      );
      if (primary.length > 0 && secondary.length > 0) {
        if (counting) {
          mixed_hierarchy_footnotes_count++;
          mixed_hierarchy_footnotes_split++;
        }
        distinct = distinct.filter(
          (s) => hierarchyClassOf(hierarchyTierOf(s)) !== "secondary",
        );
      }
      // non_academic_source_binding_and_csm_v1 — a marker may not merge
      // unrelated sources into one concatenated label. Companions that share
      // no subject vocabulary with the leader are dropped.
      const unrelated = unrelatedCompoundCompanions(distinct);
      if (unrelated.length > 0) {
        if (counting) unrelated_compound_companions_pruned += unrelated.length;
        distinct = distinct.filter((s) => !unrelated.includes(s));
      }
      // Within a footnote, order sub-sources by hierarchy too.
      distinct = distinct
        .map((s, i) => ({ s, i }))
        .sort((a, b) => compareHierarchy(a.s, a.i, b.s, b.i))
        .map((x) => x.s);
    }
    return distinct;
  };

  // Allocate entries by first appearance; numbering happens afterwards in
  // hierarchy order.
  const keyToEntry = new Map<string, MarkerEntry>();
  const entriesInOrder: MarkerEntry[] = [];

  // First pass: collect distinct footnote entries.
  draft.blocks.forEach((b, blockIndex) => {
    if (b.kind === "heading") return;
    if (b.source_refs.length === 0) return;
    const distinct = resolveBlockSources(b.source_refs);
    if (distinct.length === 0) return;
    const sortedIds = [...distinct.map((s) => s.candidate_id)].sort();
    const key = sortedIds.join("|");
    if (keyToEntry.has(key)) return;
    // Reading-pointer footnotes are labelled as such, so a bibliography-only
    // item is never read as an authority for the sentence it follows.
    const pointerOnly = distinct.length > 0 &&
      distinct.every((s) => referenceOnlyIds.has(s.candidate_id));
    const rawTitle = distinct.length === 1
      ? distinct[0].title
      : distinct.map((s) => s.title).join("; ");
    const entry: MarkerEntry = {
      key,
      number: 0,
      title: pointerOnly ? `לדיון נוסף ראו: ${rawTitle}` : rawTitle,

      // Footnote hygiene: even for compound footnotes, expose the first
      // sub-source URL as the top-level URL so downstream consumers/reports
      // never render `None`/`null`. Full per-source URL list remains in
      // `source_inputs`/`sources`.
      url: distinct.length === 1
        ? distinct[0].url
        : (distinct.find((s) => s.url)?.url ?? null),
      source_type: distinct.length === 1 ? distinct[0].source_type : "compound",
      source_candidate_ids: distinct.map((s) => s.candidate_id),
      source_inputs: distinct,
      first_seen: blockIndex,
    };
    keyToEntry.set(key, entry);
    entriesInOrder.push(entry);
  });

  // ── Hierarchy ordering: primary authority first, then secondary, then the
  // rest. Numbering follows this order, so footnote 1 / used_sources[0] is the
  // most authoritative source actually used.
  const entryTier = (e: MarkerEntry): HierarchyTier => {
    let best: HierarchyTier = "other";
    let bestRank = Infinity;
    for (const s of e.source_inputs) {
      const t = hierarchyTierOf(s);
      if (tierRank(t) < bestRank) {
        bestRank = tierRank(t);
        best = t;
      }
    }
    return best;
  };
  entriesInOrder.sort((a, b) => {
    const ta = tierRank(entryTier(a));
    const tb = tierRank(entryTier(b));
    if (ta !== tb) return ta - tb;
    const c = compareHierarchy(a.source_inputs[0], 0, b.source_inputs[0], 0);
    if (c !== 0) return c;
    return a.first_seen - b.first_seen;
  });
  entriesInOrder.forEach((e, i) => {
    e.number = i + 1;
  });

  counting = false;

  // Second pass: render markdown.
  const out: string[] = [];
  let paragraph_count = 0;
  let list_item_count = 0;
  let heading_count = 0;
  let cited_segment_count = 0;
  let compound_segment_count = 0;
  let marker_count = 0;

  const renderSegment = (block: Extract<StructuredBlock, { source_refs: string[] }>): string => {
    const text = block.text.trim();
    if (block.source_refs.length === 0) return text;
    const distinct = resolveBlockSources(block.source_refs);
    if (distinct.length === 0) return text;
    const sortedIds = [...distinct.map((s) => s.candidate_id)].sort();
    const key = sortedIds.join("|");
    const entry = keyToEntry.get(key);
    if (!entry) return text;
    cited_segment_count++;
    if (distinct.length > 1) compound_segment_count++;
    marker_count++;
    return placeMarker(text, toSuperscript(entry.number));
  };


  for (const b of draft.blocks) {
    if (b.kind === "heading") {
      heading_count++;
      out.push(`**${b.text.trim()}**`);
    } else if (b.kind === "paragraph") {
      paragraph_count++;
      out.push(renderSegment(b));
    } else if (b.kind === "list_item") {
      list_item_count++;
      out.push(`- ${renderSegment(b)}`);
    }
  }

  // Group consecutive list_items together (no blank line between), but
  // separate paragraphs/headings with a blank line.
  const joined: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const line = out[i];
    const isList = line.startsWith("- ");
    const prevIsList = i > 0 && out[i - 1].startsWith("- ");
    if (isList && prevIsList) {
      joined[joined.length - 1] = joined[joined.length - 1] + "\n" + line;
    } else {
      joined.push(line);
    }
  }
  const answer_markdown = joined.join("\n\n");

  // Footnotes (chronological).
  const footnotes: Footnote[] = entriesInOrder.map((e) => ({
    number: e.number,
    title: e.title,
    url: e.url,
    source_type: e.source_type,
    sources: e.source_inputs.map((s) => ({
      title: s.title,
      url: s.url,
      source_type: s.source_type,
    })),
  }));

  // used_sources: one entry per (candidate_id) with the number of the entry
  // that first carries it. (For compound footnotes, multiple candidate_ids
  // share the same number — this matches V2's compound semantics.)
  const usedSeen = new Set<string>();
  const used_sources: UsedSource[] = [];
  for (const e of entriesInOrder) {
    for (const s of e.source_inputs) {
      if (usedSeen.has(s.candidate_id)) continue;
      usedSeen.add(s.candidate_id);
      used_sources.push({
        candidate_id: s.candidate_id,
        number: e.number,
        title: s.title,
        url: s.url,
        source_type: s.source_type,
        origin: s.origin as UsedSource["origin"],
        authority_tier: s.authority_tier,
        citable_as: s.citable_as,
        text_usability: s.text_usability,
        integrity_flags: s.integrity_flags,
        is_judgment_document: s.is_judgment_document,
        has_holding_text: s.has_holding_text,
        can_satisfy_authority_role: s.can_satisfy_authority_role,
        synthesis_role: s.synthesis_role,
      });
    }
  }

  // ── footnote_rendering_invariant_v1 ──────────────────────────────────────
  // The user-facing source list is rendered from `footnotes` (one row per
  // footnote number, sub-sources nested). Guarantee here that the markers in
  // the answer and the footnote rows are in exact 1:1 correspondence:
  //   * a marker with no footnote row is stripped   (dangling_marker_count)
  //   * a footnote row with no marker is dropped    (orphan_source_row_count)
  //   * survivors are renumbered 1..N in first-appearance order
  // used_sources is remapped onto the final numbering (analytics array only).
  const SUP_DIGIT_MAP: Record<string, string> = {
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  };
  const MARKER_RUN_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu;
  const validNumbers = new Set(footnotes.map((f) => f.number));

  /** Greedy longest-match split of a superscript run into footnote numbers.
   *  -1 marks a digit that matches no known footnote (dangling). */
  const splitRun = (run: string): number[] => {
    const digits = run.split("").map((c) => SUP_DIGIT_MAP[c] ?? c).join("");
    const out: number[] = [];
    let i = 0;
    while (i < digits.length) {
      let matched = -1;
      let matchedLen = 1;
      for (let len = Math.min(digits.length - i, 4); len >= 1; len--) {
        const n = parseInt(digits.slice(i, i + len), 10);
        if (Number.isFinite(n) && validNumbers.has(n)) {
          matched = n;
          matchedLen = len;
          break;
        }
      }
      out.push(matched);
      i += matchedLen;
    }
    return out;
  };

  let inline_marker_count = 0;
  let dangling_marker_count = 0;
  const appearanceOrder: number[] = [];
  const seenMarkers = new Set<number>();
  for (const m of answer_markdown.matchAll(MARKER_RUN_RE)) {
    for (const n of splitRun(m[0])) {
      inline_marker_count++;
      if (n < 0) {
        dangling_marker_count++;
        continue;
      }
      if (!seenMarkers.has(n)) {
        seenMarkers.add(n);
        appearanceOrder.push(n);
      }
    }
  }

  const orphan_source_row_count = footnotes.filter((f) => !seenMarkers.has(f.number)).length;
  const needsRebuild =
    dangling_marker_count > 0 ||
    orphan_source_row_count > 0 ||
    footnotes.length !== seenMarkers.size;

  let finalAnswer = answer_markdown;
  let finalFootnotes = footnotes;
  let finalUsedSources = used_sources;

  if (needsRebuild) {
    // Renumber survivors while PRESERVING the hierarchy numbering order
    // (footnote 1 = most authoritative), only closing the gaps left by
    // dropped orphan rows.
    const remap = new Map<number, number>();
    footnotes
      .filter((f) => seenMarkers.has(f.number))
      .map((f) => f.number)
      .sort((a, b) => a - b)
      .forEach((oldNum, i) => remap.set(oldNum, i + 1));


    finalAnswer = answer_markdown.replace(MARKER_RUN_RE, (run) => {
      const nums = splitRun(run)
        .map((n) => (n >= 0 ? remap.get(n) : undefined))
        .filter((n): n is number => typeof n === "number");
      return nums.map((n) => toSuperscript(n)).join("");
    });

    finalFootnotes = footnotes
      .filter((f) => remap.has(f.number))
      .map((f) => ({ ...f, number: remap.get(f.number)! }))
      .sort((a, b) => a.number - b.number);

    finalUsedSources = used_sources
      .filter((u) => remap.has(u.number))
      .map((u) => ({ ...u, number: remap.get(u.number)! }))
      .sort((a, b) => a.number - b.number);
  }

  // Recount markers on the final text for the invariant.
  let finalMarkerCount = 0;
  let maxMarker = 0;
  const finalValid = new Set(finalFootnotes.map((f) => f.number));
  for (const m of finalAnswer.matchAll(MARKER_RUN_RE)) {
    const digits = m[0].split("").map((c) => SUP_DIGIT_MAP[c] ?? c).join("");
    let i = 0;
    while (i < digits.length) {
      let matched = -1;
      let len = 1;
      for (let l = Math.min(digits.length - i, 4); l >= 1; l--) {
        const n = parseInt(digits.slice(i, i + l), 10);
        if (Number.isFinite(n) && finalValid.has(n)) {
          matched = n;
          len = l;
          break;
        }
      }
      if (matched > 0) {
        finalMarkerCount++;
        if (matched > maxMarker) maxMarker = matched;
      }
      i += len;
    }
  }

  const invariant_passed =
    finalFootnotes.length === 0 ? maxMarker === 0 : maxMarker === finalFootnotes.length;

  const footnote_render_report: FootnoteRenderReport = {
    version: "footnote_rendering_invariant_v1",
    inline_marker_count,
    footnotes_length: finalFootnotes.length,
    used_sources_length: finalUsedSources.length,
    dangling_marker_count,
    orphan_source_row_count,
    invariant_passed,
    renumbered: needsRebuild,
  };



  // Adjacent marker invariant check (telemetry only — must be 0).
  // A "marker" is a maximal superscript run (so multi-digit numerals like
  // ¹⁰, ¹¹, ¹² count as ONE marker, not two). Adjacency means two such
  // markers separated by nothing but whitespace — which the builder cannot
  // produce by construction, because every emitted marker is followed by
  // either a block boundary or body text from the next segment.
  const SUP_RUN_RE = /[\u2070-\u209F\u00B2\u00B3\u00B9]+/gu;
  let adjacent_marker_count = 0;
  let prevEnd = -1;
  for (const m of finalAnswer.matchAll(SUP_RUN_RE)) {
    const start = (m.index ?? 0);
    if (prevEnd >= 0) {
      const between = finalAnswer.slice(prevEnd, start);
      if (/^\s*$/.test(between)) adjacent_marker_count++;
    }
    prevEnd = start + m[0].length;
  }

  const totalRefs = entriesInOrder.reduce((s, e) => s + e.source_candidate_ids.length, 0);
  const compound_footnote_count = entriesInOrder.filter((e) => e.source_candidate_ids.length > 1).length;

  // ── Hierarchy telemetry + local invariants ───────────────────────────────
  const used_sources_hierarchy_counts: Record<string, number> = {};
  let first_primary_position: number | null = null;
  let first_secondary_position: number | null = null;
  finalUsedSources.forEach((u, i) => {
    const tier = hierarchyTierOf(u as never);
    used_sources_hierarchy_counts[tier] = (used_sources_hierarchy_counts[tier] ?? 0) + 1;
    const klass = hierarchyClassOf(tier);
    if (klass === "primary" && first_primary_position === null) first_primary_position = i + 1;
    if (klass === "secondary" && first_secondary_position === null) first_secondary_position = i + 1;
  });
  const usable_primary_count = finalUsedSources.filter(
    (u) => hierarchyClassOf(hierarchyTierOf(u as never)) === "primary",
  ).length;
  const primary_before_secondary_passed =
    first_primary_position === null ||
    first_secondary_position === null ||
    (first_primary_position as number) < (first_secondary_position as number);
  const head = finalUsedSources.slice(0, 3);
  const head5 = finalUsedSources.slice(0, 5);
  const commentary_head_count = head.filter(
    (u) => hierarchyClassOf(hierarchyTierOf(u as never)) === "secondary",
  ).length;
  const commentary_head5_count = head5.filter(
    (u) => hierarchyClassOf(hierarchyTierOf(u as never)) === "secondary",
  ).length;
  const primary_head5_count = head5.filter(
    (u) => hierarchyClassOf(hierarchyTierOf(u as never)) === "primary",
  ).length;
  const head_cap_passed =
    usable_primary_count < 2
      ? primary_before_secondary_passed
      : commentary_head_count <= 1 && primary_head5_count >= commentary_head5_count;

  const hierarchy_report: HierarchyReport = {
    hierarchy_order_applied: true,
    used_sources_hierarchy_counts,
    first_primary_position,
    first_secondary_position,
    primary_before_secondary_passed,
    mixed_hierarchy_footnotes_count,
    mixed_hierarchy_footnotes_split,
    commentary_head_count,
    commentary_head5_count,
    primary_head5_count,
    head_cap_passed,
    statute_identity_dedup_count,
    usable_primary_count,
  };

  return {
    answer_markdown: finalAnswer,
    footnotes: finalFootnotes,
    used_sources: finalUsedSources,
    hierarchy_report,
    footnote_render_report,

    builder_report: {
      paragraph_count,
      list_item_count,
      heading_count,
      cited_segment_count,
      compound_segment_count,
      unrelated_compound_companions_pruned,
      marker_count,
      distinct_source_count: finalUsedSources.length,
      compound_footnote_count,
      adjacent_marker_count,
      avg_sources_per_cited_segment:
        cited_segment_count > 0 ? totalRefs / entriesInOrder.length : 0,
    },
  };
}
