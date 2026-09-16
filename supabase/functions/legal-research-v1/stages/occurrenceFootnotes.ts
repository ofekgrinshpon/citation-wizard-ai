// footnote_presentation_rule37_v1 — V1 attachment-path parity layer.
//
// Converts the V1 source-keyed footnote numbering into the same
// OCCURRENCE-based, rule 37 repeat-citation presentation the V2 renderer
// produces. It is a pure presentation pass over ALREADY-APPROVED citation
// occurrences: it never adds, removes or rebinds a source, and never changes
// which marker sits at which sentence.

import {
  buildOccurrenceFootnotes,
  type CitationOccurrence,
  toSuperscript,
} from "../../_shared/footnoteOccurrences.ts";

const SUP_DIGIT_MAP: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};
const MARKER_RUN_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu;

/** Greedy longest-match split of a superscript run into known footnote numbers. */
export function splitMarkerRun(run: string, valid: Set<number>): number[] {
  const digits = run.split("").map((c) => SUP_DIGIT_MAP[c] ?? c).join("");
  const out: number[] = [];
  let i = 0;
  while (i < digits.length) {
    let matched = -1;
    let len = 1;
    for (let l = Math.min(digits.length - i, 4); l >= 1; l--) {
      const n = parseInt(digits.slice(i, i + l), 10);
      if (Number.isFinite(n) && valid.has(n)) {
        matched = n;
        len = l;
        break;
      }
    }
    if (matched > 0) out.push(matched);
    i += len;
  }
  return out;
}

export interface V1FootnoteRow {
  number: number;
  title: string;
  url?: string | null;
  source_type?: string;
  sources?: Array<{ title: string; url?: string | null; source_type?: string }>;
}

export interface V1UsedSourceRow {
  number: number;
  [k: string]: unknown;
}

export interface OccurrenceRenderResult<F extends V1FootnoteRow, U extends V1UsedSourceRow> {
  answer_markdown: string;
  footnotes: F[];
  used_sources: U[];
  occurrence_count: number;
  repeat_count: number;
}

/**
 * Re-render markers chronologically, one footnote per occurrence, with rule 37
 * repeat text (שם / לעיל ה"ש) for repeated authorities.
 */
export function applyOccurrenceFootnotes<
  F extends V1FootnoteRow,
  U extends V1UsedSourceRow,
>(
  answer: string,
  footnotes: F[],
  usedSources: U[],
): OccurrenceRenderResult<F, U> {
  if (footnotes.length === 0) {
    return {
      answer_markdown: answer,
      footnotes,
      used_sources: usedSources,
      occurrence_count: 0,
      repeat_count: 0,
    };
  }

  const valid = new Set(footnotes.map((f) => f.number));
  const byNumber = new Map(footnotes.map((f) => [f.number, f]));

  // Pass 1 — occurrences in body order.
  const occurrences: CitationOccurrence[] = [];
  const runPlan: number[][] = [];
  for (const m of answer.matchAll(MARKER_RUN_RE)) {
    const nums = splitMarkerRun(m[0], valid);
    runPlan.push(nums);
    for (const n of nums) {
      const row = byNumber.get(n)!;
      occurrences.push({
        source_id: `E${n}`,
        full_citation: row.title,
        url: row.url ?? undefined,
      });
    }
  }
  if (occurrences.length === 0) {
    return {
      answer_markdown: answer,
      footnotes,
      used_sources: usedSources,
      occurrence_count: 0,
      repeat_count: 0,
    };
  }

  const built = buildOccurrenceFootnotes(occurrences);

  // Pass 2 — rewrite markers in the same textual positions.
  let cursor = 0;
  let runIndex = 0;
  const answer_markdown = answer.replace(MARKER_RUN_RE, () => {
    const nums = runPlan[runIndex++] ?? [];
    const slice = built.slice(cursor, cursor + nums.length);
    cursor += nums.length;
    return slice.map((f) => toSuperscript(f.index)).join("");
  });

  // Pass 3 — one footnote row per occurrence.
  const newFootnotes = built.map((f) => {
    const origin = byNumber.get(Number(f.source_id.slice(1)))!;
    const isRepeat = f.repeat_kind !== "full";
    return {
      ...origin,
      number: f.index,
      title: f.citation,
      url: isRepeat ? null : (origin.url ?? null),
      sources: isRepeat
        ? [{ title: f.citation, url: null }]
        : (origin.sources ?? [{ title: origin.title, url: origin.url ?? null }]),
    } as F;
  });

  // used_sources keeps distinct-source analytics, remapped onto the first
  // occurrence number of the authority it belongs to.
  const firstOccurrenceOf = new Map<number, number>();
  for (const f of built) {
    const old = Number(f.source_id.slice(1));
    if (!firstOccurrenceOf.has(old)) firstOccurrenceOf.set(old, f.index);
  }
  const used_sources = usedSources
    .filter((u) => firstOccurrenceOf.has(u.number))
    .map((u) => ({ ...u, number: firstOccurrenceOf.get(u.number)! }))
    .sort((a, b) => a.number - b.number) as U[];

  return {
    answer_markdown,
    footnotes: newFootnotes,
    used_sources,
    occurrence_count: built.length,
    repeat_count: built.filter((f) => f.repeat_kind !== "full").length,
  };
}
