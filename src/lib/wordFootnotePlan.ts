import type { DocxFootnote } from "./docxFootnoteRoundtrip";
export interface ExplanationSpan { start: number; end: number }
export type WordFootnotePlan =
  | { kind: "candidate"; start: number; end: number; input: string; crossesRuns: boolean }
  | { kind: "protected" | "unresolved"; reason: string };

/** Conservative ambiguity screen, NOT a source parser or proof of source identity.
 * The existing engine returns one citation, without source-to-document offsets.
 * Never split a mixed note by punctuation and pretend the pieces are verified sources.
 */
const DOCKET = String.raw`\d{1,7}[-/]\d{2,4}(?:[-/]\d{2,4})?`;
const PROCEEDING = String.raw`[א-ת]{1,4}["״׳'][א-ת]{1,3}`;
/** One Israeli caption heard together: "ע"א 6821/93, רע"א 1908/94 ... X נ' Y" — one list of dockets, one party pair. */
const CONSOLIDATED_DOCKETS = new RegExp(String.raw`^\s*(?:${PROCEEDING}\s+)?${DOCKET}(?:\s*(?:,|ו-?)\s*(?:${PROCEEDING}\s+)?${DOCKET})+(?![\d/-])`, "u");

/** Count docket numbers, treating one leading consolidated docket list of a single caption as one. */
function docketCount(text: string): number {
  const all = text.match(new RegExp(String.raw`\b${DOCKET}\b`, "g"))?.length ?? 0;
  const lead = text.match(CONSOLIDATED_DOCKETS);
  if (!lead) return all;
  const rest = text.slice(lead[0].length);
  const restDockets = rest.match(new RegExp(String.raw`\b${DOCKET}\b`, "g"))?.length ?? 0;
  const partyPairs = rest.match(/\sנ['׳]\s|\sנגד\s/gu)?.length ?? 0;
  return restDockets === 0 && partyPairs <= 1 ? 1 : all;
}

export function hasMultipleSourceSignals(text: string): boolean {
  return /[;؛\n\r]/u.test(text.trim().replace(/[;؛]+$/u, ""))
    // A docket part such as "1908/94" is not a year.
    || (text.match(/(?<![\w/])(?:18|19|20)\d{2}(?!\w|\/\d)/g)?.length ?? 0) > 1
    || (text.match(/https?:\/\/|\bdoi\s*:/gi)?.length ?? 0) > 1
    || docketCount(text) > 1
    || /(?:ראו גם|וכן ראו|להשוואה ראו|see also|but see|accord)\s/iu.test(text);
}
/** The runner has no document antecedent/numbering contract. Never resolve
 * an existing short reference using neighbouring text or a guessed source key.
 */
export function isUnboundRepeatReference(text: string): boolean {
  return /^(?:שם(?:[.,\s]|$)|ibid\b|ibidem\b|id\.)/iu.test(text.trim())
    || /לעיל\s+(?:ה["״׳']?ש|הערה)|\b(?:supra|infra)\s+(?:note|n\.)/iu.test(text);
}
export function planWordFootnote(note: DocxFootnote, protectedSpans: readonly ExplanationSpan[]): WordFootnotePlan {
  const spans = [...protectedSpans].sort((a,b) => a.start-b.start);
  let cursor = 0;
  const gaps: ExplanationSpan[] = [];
  for (const span of spans) {
    const splitsPair = (at: number) => at > 0 && at < note.text.length && /[\uD800-\uDBFF]/u.test(note.text[at-1]) && /[\uDC00-\uDFFF]/u.test(note.text[at]);
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < cursor || span.end <= span.start || span.end > note.text.length || splitsPair(span.start) || splitsPair(span.end))
      throw new Error("סימוני ההסבר חופפים או אינם תואמים לטקסט המקורי.");
    gaps.push({start:cursor,end:span.start}); cursor = span.end;
  }
  gaps.push({start:cursor,end:note.text.length});
  // Keep boundary whitespace and separator punctuation in their ORIGINAL positions.
  const meaningful = gaps.map(gap => {
    const raw = note.text.slice(gap.start,gap.end);
    const left = raw.match(/^[\s,;؛:–—-]*/u)![0].length;
    const right = raw.slice(left).match(/[\s,;؛:–—-]*$/u)![0].length;
    return {start:gap.start+left,end:gap.end-right,input:raw};
  }).filter(gap => gap.end > gap.start);
  if (!meaningful.length) return {kind:"protected",reason:"כל תוכן ההערה מוגן או ריק. לא תישלח בקשה וההערה תישאר ללא שינוי."};
  if (meaningful.length !== 1) return {kind:"unresolved",reason:"נותרו כמה קטעים נפרדים סביב ההסברים. המנוע מחזיר אזכור אחד ואינו ממפה כמה מקורות למקומם במסמך. ההערה לא תישלח ותישאר ללא שינוי."};
  const gap = meaningful[0];
  const content = note.text.slice(gap.start,gap.end);
  if (isUnboundRepeatReference(content)) return {kind:"unresolved",reason:"זו הפניה למקור קודם. אין עדיין קישור מאומת בין ההפניה למקור ולמספור שלו במסמך; ההערה לא תישלח ותישאר ללא שינוי."};
  if (hasMultipleSourceSignals(content)) return {kind:"unresolved",reason:"ייתכן שיש כאן כמה מקורות או פסקאות. עדיין אין מיפוי בטוח של כמה תוצאות למקומן בהערה; ההערה לא תישלח ותישאר ללא שינוי."};
  const ranges = note.editableRanges.filter(range => range.end > gap.start && range.start < gap.end);
  if (!ranges.length || gap.start < ranges[0].start || gap.end > ranges[ranges.length-1].end || ranges.some((range,i) => i > 0 && range.start !== ranges[i-1].end))
    return {kind:"unresolved",reason:"לא ניתן להחליף את התוכן בתוך פסקה אחת בבטחה. ההערה תישאר ללא שינוי."};
  return {kind:"candidate",...gap,crossesRuns:ranges.length>1};
}
