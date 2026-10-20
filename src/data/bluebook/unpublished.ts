/**
 * Stage 5 batch 2 — unpublished manuscripts and dissertations/theses only
 * (general Bluebook 21 R17.2.1–17.2.2). Strict supplied-syntax parsing: a work
 * is recognised only by an explicit work-type parenthetical after the title /
 * date position, never by a title word or a repository host. All text stays
 * verbatim (no title-case changes, no abbreviation), typography is roman.
 */
import type { ForeignUnpublishedFields } from "./types";

const DATE = String.raw`(?:(?:Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(?:\d{1,2},\s*)?)?(?:1[5-9]|20)\d{2}`;
const PIN = String.raw`\d+(?:\s*[–\-]\s*\d+)?(?:\s+n\.\s*\d+)?`;
const PINS = String.raw`${PIN}(?:\s*,\s*${PIN})*`;
const MANUSCRIPT_TYPE = /^unpublished (?:manuscript|comment)$/i;
const THESIS_TYPE = /^(?:(?:Ph\.\s?D\.|J\.S\.D\.|S\.J\.D\.|D\.Phil\.|LL\.M\.|LL\.D\.|M\.Phil\.|M\.A\.|M\.S\.|B\.A\.|doctoral|master['’]s|honors|senior|undergraduate)\s+)?(?:dissertation|thesis)$/i;
const LOCATION = /^(?:on file (?:with|at)|available (?:at|in|from)|archived (?:at|in))\b/i;

export type UnpublishedKind = "unpublished_manuscript" | "thesis";

/** Parse the clear R17.2.1/17.2.2 shape only. Returns null for anything else. */
export function extractUnpublishedWork(raw: string, want?: UnpublishedKind): { kind: UnpublishedKind; fields: ForeignUnpublishedFields } | null {
  const text = raw.trim().replace(/\.$/, "");
  // Split trailing parentheticals (non-nested) from the head.
  const parens: string[] = [];
  let head = text;
  let tail = "";
  const url = head.match(/,?\s*(https?:\/\/\S+)$/);
  if (url) { tail = url[0]; head = head.slice(0, -url[0].length).trim(); }
  for (;;) {
    const m = head.match(/\s*\(([^()]*)\)$/);
    if (!m) break;
    parens.unshift(m[1].trim());
    head = head.slice(0, -m[0].length).trim();
  }
  if (!head || !parens.length && !want) return null;
  // Hebrew authors/titles are governed by the Israeli rules, not this batch.
  if (/[\u0590-\u05FF]/.test(head)) return null;
  // Order after head: [date] (type[, institution]) [(location)]
  let i = 0;
  const f: ForeignUnpublishedFields = {};
  if (parens[i] && new RegExp(`^${DATE}$`).test(parens[i])) { f.date = parens[i]; i++; }
  let kind: UnpublishedKind | undefined;
  const typeParen = parens[i];
  if (typeParen !== undefined) {
    const [typePart, ...instParts] = typeParen.split(/,\s*/);
    if (MANUSCRIPT_TYPE.test(typeParen)) { kind = "unpublished_manuscript"; f.workType = typeParen; i++; }
    else if (THESIS_TYPE.test(typePart)) {
      kind = "thesis"; f.workType = typePart;
      if (instParts.length) f.institution = instParts.join(", ");
      i++;
    }
  }
  if (!kind) {
    if (!want) return null;
    kind = want;
    f.typeFromSelection = true;
  }
  if (parens[i] !== undefined && LOCATION.test(parens[i])) { f.location = parens[i]; i++; }
  const leftover = parens.slice(i).map((p) => `(${p})`).join(" ");

  // Head: "Author(s), Title[ pins]". No comma → author not supplied.
  const comma = head.indexOf(", ");
  let title = head;
  if (comma > 0 && /^[\p{Lu}]/u.test(head) && !/\d/.test(head.slice(0, comma))) {
    f.authors = head.slice(0, comma).trim();
    title = head.slice(comma + 2).trim();
  }
  const pin = title.match(new RegExp(String.raw`\s+(${PINS})$`));
  if (pin) {
    const value = pin[1];
    // A lone 4-digit number may be part of the title (e.g. "... 2020"): keep it there.
    if (/^(?:1[5-9]|20)\d{2}$/.test(value)) f.ambiguousTrailingNumber = true;
    else { f.pinpoint = value.replace(/\s*[–\-]\s*/g, "–").replace(/\s*,\s*/g, ", "); title = title.slice(0, -pin[0].length).trim(); }
  }
  if (title) f.title = title;
  const rest = `${leftover}${tail}`.trim();
  if (rest) f.unparsedRemainder = rest;
  return { kind, fields: f };
}

/** Explicit work-type label in the input, regardless of other structure. */
export function explicitUnpublishedKind(raw: string): UnpublishedKind | null {
  return extractUnpublishedWork(raw)?.kind ?? null;
}
