// Research Core v1 — Deliverable 6.2: Footnote Builder with Rule 37.
//
// Every [cite:LS#] occurrence gets its OWN sequential footnote number in
// first-appearance order. First use of an LS emits the full canonical
// citation; repeated uses emit a Rule 37 short form (שם / לעיל ה"ש N), with
// Rule 37.5 blocking לעיל ה"ש for legislation.

import type {
  Footnote,
  LedgerSourceCitation,
  LedgerSourceId,
  MarkerToFootnote,
} from "./types.ts";
import { cleanCitationText } from "./citationCleanup.ts";

const CITE_RE = /\[cite:(LS\d+)\]/g;
const SUPERS = ["⁰","¹","²","³","⁴","⁵","⁶","⁷","⁸","⁹"];

function toSuperscript(n: number): string {
  return String(n).split("").map((d) => SUPERS[+d] ?? d).join("");
}

function withBetPrefix(suffix: string): string {
  const t = suffix.trim();
  if (!t) return "";
  if (/^(בעמ['״]|בס['״]|בפס['״])/.test(t)) return t;
  if (/^עמ['״]/.test(t)) return t.replace(/^עמ/, "בעמ");
  if (/^סעיף\b/.test(t)) return t.replace(/^סעיף\s*/, "בס' ");
  if (/^ס['׳]\s+/.test(t)) return t.replace(/^ס['׳]\s+/, "בס' ");
  if (/^פסקה\b/.test(t)) return t.replace(/^פסקה\s*/, "בפס' ");
  return t;
}

export interface BuildFootnotesArgs {
  answer: string;
  citations: Map<LedgerSourceId, LedgerSourceCitation>;
}

export interface BuildFootnotesResult {
  rendered_answer: string;
  footnotes: Footnote[];
  marker_to_footnote: MarkerToFootnote[];
  warnings: string[];
}

export function buildFootnotes(args: BuildFootnotesArgs): BuildFootnotesResult {
  const { answer, citations } = args;
  const warnings: string[] = [];

  // Scan all marker occurrences in document order.
  const occurrences: Array<{ ls_id: LedgerSourceId; index: number; len: number }> = [];
  for (const m of answer.matchAll(CITE_RE)) {
    occurrences.push({
      ls_id: m[1] as LedgerSourceId,
      index: m.index ?? 0,
      len: m[0].length,
    });
  }

  const footnotes: Footnote[] = [];
  // INVARIANT: one entry per occurrence, indexed by occurrence position.
  // `footnote_number` is undefined for skipped (unknown / no-citation) markers
  // so the replacement loop below cannot misalign indices.
  const marker_to_footnote: MarkerToFootnote[] = [];
  const seen = new Map<LedgerSourceId, { first_footnote_number: number; prev_footnote_number: number }>();
  let prev_ls_id: LedgerSourceId | null = null;
  let nextNum = 1;

  occurrences.forEach((occ, i) => {
    const cit = citations.get(occ.ls_id);
    const ls_id = occ.ls_id;

    if (!cit) {
      // Defensive: QA Phase A should have stripped this already.
      warnings.push(`marker_${ls_id}_has_no_citation`);
      marker_to_footnote.push({
        occurrence_index: i,
        ls_id,
        footnote_number: undefined,
        is_repeated: false,
      } as MarkerToFootnote);
      return;
    }

    const num = nextNum++;
    const prior = seen.get(ls_id);
    const isFirst = !prior;
    const isAdjacent = prev_ls_id === ls_id;

    let text: string;
    if (isFirst) {
      text = cit.canonical_citation || "(ציטוט חסר)";
      seen.set(ls_id, { first_footnote_number: num, prev_footnote_number: num });
    } else {
      text = buildRule37Short(cit, prior!.first_footnote_number, isAdjacent);
      prior!.prev_footnote_number = num;
    }

    // Apply deterministic cleanup to footnote text (canonical first-use form).
    // Rule-37 short forms are already constructed deterministically; cleanup
    // is idempotent and safe on them too.
    text = cleanCitationText(text);

    const fn: Footnote = {
      number: num,
      ls_id,
      text,
      is_repeated: !isFirst,
      first_footnote_number: isFirst ? undefined : prior!.first_footnote_number,
      repeated_citation_text: isFirst ? undefined : text,
      source_type: cit.source_type,
    };
    footnotes.push(fn);
    marker_to_footnote.push({
      occurrence_index: i,
      ls_id,
      footnote_number: num,
      is_repeated: !isFirst,
      first_footnote_number: isFirst ? undefined : prior!.first_footnote_number,
    });
    prev_ls_id = ls_id;
  });

  // Replace markers with superscripts (right-to-left to preserve indices).
  // marker_to_footnote is guaranteed to be aligned with `occurrences`.
  let rendered = answer;
  for (let i = occurrences.length - 1; i >= 0; i--) {
    const fnNum = marker_to_footnote[i]?.footnote_number;
    const sup = fnNum ? toSuperscript(fnNum) : "";
    const o = occurrences[i];
    rendered = rendered.slice(0, o.index) + sup + rendered.slice(o.index + o.len);
  }
  rendered = rendered.replace(/ {2,}/g, " ").replace(/\s+\n/g, "\n");

  // Sanity: drafter shouldn't have written its own שם / לעיל outside markers.
  const proseSupra = rendered.match(/לעיל ה["״]ש/g);
  if (proseSupra) warnings.push(`prose_contains_legal_supra:${proseSupra.length}`);

  return { rendered_answer: rendered, footnotes, marker_to_footnote, warnings };
}

function buildRule37Short(
  cit: LedgerSourceCitation,
  first_footnote_number: number,
  isAdjacent: boolean,
): string {
  const sf = cit.short_form_inputs;
  const section = sf.default_section;
  const pinpointSuffix = sf.default_pinpoint ? withBetPrefix(sf.default_pinpoint) : "";

  if (sf.is_legislation) {
    // Rule 37.5 — NEVER use לעיל ה"ש for legislation.
    if (isAdjacent) {
      return section ? `שם, בס' ${section}.` : `שם.`;
    }
    if (section && sf.law_name) return `ס' ${section} ל${sf.law_name}.`;
    if (sf.law_name) return `${sf.law_name}.`;
    return `שם.`;
  }

  // Caselaw / scholarship / passthrough
  if (isAdjacent) {
    return pinpointSuffix ? `שם, ${pinpointSuffix}.` : `שם.`;
  }
  const label = sf.short_label || sf.law_name || "המקור";
  const tail = pinpointSuffix ? `, ${pinpointSuffix}` : "";
  return `${label}, לעיל ה"ש ${first_footnote_number}${tail}.`;
}
