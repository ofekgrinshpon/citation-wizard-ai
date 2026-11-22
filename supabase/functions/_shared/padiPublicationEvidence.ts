/** Printed-reporter proof only. Never discovers a case or infers its identity/year. */
import { CASE_DOCKET_RE, CASE_TYPE_PREFIXES } from "./caseTypePrefixes.ts";

export const PADI_EVIDENCE_DOMAINS = ["nevo.co.il", "court.gov.il", "supreme.court.gov.il", "psakdin.co.il", "gov.il", "knesset.gov.il"];
export interface PadiTarget { caseType: string; caseNumber: string; party1: string; party2: string; decisionYear: string }
export interface PadiPublication { padi_volume: string; padi_part: string; padi_page: string; year: string }
const normalize = (text: string) => text.normalize("NFKC").replace(/[\u200e\u200f\u202a-\u202e]/g, "")
  .replace(/["״׳'’.,*]/g, "").replace(/\s+/g, " ").trim();
const trusted = (url: unknown): boolean => {
  if (typeof url !== "string") return false;
  try { const u = new URL(url); return u.protocol === "https:" && !u.username && !u.password &&
    PADI_EVIDENCE_DOMAINS.some(host => u.hostname === host || u.hostname.endsWith(`.${host}`)); } catch { return false; }
};
/** Search snippets are untrusted quotations: require the complete citation in
 * one bounded snippet, not a model JSON answer, URL inference or mixed results.
 * A conflicting grounded tuple/year rejects the entire second-pass upgrade. */
export function verifiedPadiPublication(target: PadiTarget, payload: unknown): PadiPublication | null {
  if (!/^\d{1,6}\/\d{2,4}$/.test(target.caseNumber) || !/^(19|20)\d{2}$/.test(target.decisionYear) ||
      !target.caseType || normalize(target.party1).length < 2 || normalize(target.party2).length < 2) return null;
  const data = payload as { search_results?: unknown } | null;
  if (!Array.isArray(data?.search_results) || data.search_results.length > 30) return null;
  const accepted = new Map<string, PadiPublication>();
  for (const result of data.search_results) {
    if (!result || typeof result !== "object" || !trusted(result.url) || typeof result.snippet !== "string" || result.snippet.length > 12000) continue;
    // Do not join title/snippet, distinct snippets, or arbitrary page fragments.
    const text = result.snippet.replace(/[\u200e\u200f\u202a-\u202e]/g, "");
    const citations = [...text.matchAll(new RegExp(CASE_DOCKET_RE.source, "g"))];
    for (let i = 0; i < citations.length; i++) {
      const cite = citations[i];
      if (normalize(cite[1]) !== normalize(target.caseType) || cite[2] !== target.caseNumber) continue;
      const start = (cite.index ?? 0) + cite[0].length;
      const block = text.slice(start, Math.min(start + 700, citations[i + 1]?.index ?? text.length));
      const pub = /פ["״]ד\s+([א-ת]{1,4})\s*(?:\(\s*([1-9])\s*\))?\s+([1-9]\d{0,3})\s*\(\s*((?:19|20)\d{2})\s*\)/.exec(block);
      if (!pub) continue;
      const caption = normalize(block.slice(0, pub.index));
      const exactCaptions = ["נ", "נגד"].map(v => normalize(`${target.party1} ${v} ${target.party2}`));
      if (!exactCaptions.includes(caption)) continue;
      // A complete but inconsistent citation is a conflict, not evidence to ignore.
      if (pub[4] !== target.decisionYear) return null;
      const value = { padi_volume: pub[1], padi_part: pub[2] ?? "", padi_page: pub[3], year: pub[4] };
      accepted.set(JSON.stringify(value), value);
    }
  }
  return accepted.size === 1 ? [...accepted.values()][0] : null;
}

/** Stronger evidence contract for a typed two-part Supreme Court docket only.
 * Legacy party-name and other citation routes continue using the verifier above. */
export interface TypedPadiTarget extends Omit<PadiTarget, "decisionYear"> {
  filingYear: number | null;
}
export type TypedPadiEvidence =
  | { kind: "none" | "conflict" }
  | { kind: "verified"; publication: PadiPublication; date: string | null };

export function typedSupremeFilingYear(suffix: string, currentYear = new Date().getUTCFullYear()): number | null {
  if (!/^(?:\d{2}|\d{4})$/.test(suffix)) return null;
  const years = suffix.length === 4 ? [+suffix] : [1900 + +suffix, 2000 + +suffix];
  const plausible = years.filter((y) => y >= 1948 && y <= currentYear);
  return plausible.length === 1 ? plausible[0] : null;
}

function typedCitationText(text: string): string {
  return text.normalize("NFKC")
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[־‐‑‒–—]/g, "-")
    .replace(/\s*-\s*/g, " - ");
}

const typedCaption = (text: string) => normalize(typedCitationText(text));
const typedCaseType = (text: string) => typedCaption(text).replace(/\s/g, "");
const typedProcPrefixes = new Set(CASE_TYPE_PREFIXES.map(typedCaseType));
// Every proceeding-like token is a boundary, even if not itself admissible.
const typedDocketMatches = () => /(?<![\p{L}\p{N}])([א-ת]{1,5}(?:["״'׳][א-ת]{0,4})?)\s+(\d{1,6})\s*\/\s*(\d{4}|\d{2})(?![\d/\s]*\/|\d)/gu;

export function readTypedDecisionDate(raw: unknown): { year: string; date: string } | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const iso = /^(19\d{2}|20\d{2})-(\d{2})-(\d{2})$/.exec(s);
  const local = /^(\d{1,2})\.(\d{1,2})\.(19\d{2}|20\d{2})$/.exec(s);
  if (!iso && !local) return null;
  const year = iso ? iso[1] : local![3];
  const month = +(iso ? iso[2] : local![2]);
  const day = +(iso ? iso[3] : local![1]);
  const date = new Date(Date.UTC(+year, month - 1, day));
  return month >= 1 && month <= 12 && day >= 1 && date.getUTCFullYear() === +year &&
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? { year, date: `${day}.${month}.${year}` }
    : null;
}

export function mergeTypedPadiEvidence(a: TypedPadiEvidence, b: TypedPadiEvidence): TypedPadiEvidence {
  if (a.kind === "conflict" || b.kind === "conflict") return { kind: "conflict" };
  if (a.kind !== "verified") return b;
  if (b.kind !== "verified") return a;
  if (JSON.stringify(a.publication) !== JSON.stringify(b.publication) || (a.date && b.date && a.date !== b.date)) {
    return { kind: "conflict" };
  }
  return { ...a, date: a.date ?? b.date };
}

/** The decision year/full date is part of the same source citation, not a
 * separate same-docket search-result date or a model's suggested value. */
function scanTypedPadiEvidence(target: TypedPadiTarget, snippets: readonly string[]): TypedPadiEvidence {
  const docket = /^(\d{1,6})\/(\d{2}|\d{4})$/.exec(target.caseNumber);
  const type = typedCaseType(target.caseType);
  const left = typedCaption(target.party1), right = typedCaption(target.party2);
  if (!docket || !typedProcPrefixes.has(type) || left.length < 2 || right.length < 2) return { kind: "none" };
  const exactCaptions = [`${left} נ ${right}`, `${left} נגד ${right}`];
  let evidence: TypedPadiEvidence = { kind: "none" };
  for (const snippet of snippets) {
    const source = typedCitationText(snippet);
    const matches = [...source.matchAll(typedDocketMatches())];
    for (let i = 0; i < matches.length; i++) {
      const here = matches[i];
      const bareYear = target.filingYear !== null && String(target.filingYear).slice(-2) === here[3];
      const fullYear = target.filingYear !== null && String(target.filingYear) === here[3];
      const sourceType = typedCaseType(here[1]);
      // Hebrew cites commonly attach a single bet (בע״א); do not strip
      // a genuine distinct procedure such as בע״מ to make it match ע״מ.
      const exactType = sourceType === type ||
        ((type === "עא" || type === "בגץ") && !typedProcPrefixes.has(sourceType) && sourceType === `ב${type}`);
      if (!exactType || Number(here[2]) !== Number(docket[1]) ||
          (here[3] !== docket[2] && !bareYear && !fullYear)) continue;
      const start = (here.index ?? 0) + here[0].length;
      const block = source.slice(start, Math.min(start + 700, matches[i + 1]?.index ?? source.length));
      const reporter = /פ["״]ד\s+([א-ת](?:["״'׳]?[א-ת]){0,3})\s*(?:\(\s*([1-9])\s*\))?(?:\s*,\s*|\s+)(?:(?:עמ[׳'״"]|עמוד)\s*)?([1-9]\d{0,3})(?:\s*,\s*[1-9]\d{0,3}(?:\s*-\s*[1-9]\d{0,3})?)?\s*,?\s*\(\s*((?:19|20)\d{2}|\d{1,2}\.\d{1,2}\.(?:19|20)\d{2})\s*\)/.exec(block);
      if (!reporter || !exactCaptions.includes(typedCaption(block.slice(0, reporter.index)))) continue;
      const reportedDate = readTypedDecisionDate(reporter[4]);
      const year = reportedDate?.year ?? (/^(19|20)\d{2}$/.test(reporter[4]) ? reporter[4] : null);
      if (!year) continue;
      // Permit an immediately attached, explicitly labelled decision date,
      // never dates separated by prose, another docket, or result metadata.
      const following = block.slice(reporter.index + reporter[0].length);
      const labelled = /^\s*,?\s*(?:ניתן|ניתנה) ביום\s+(\d{1,2}\.\d{1,2}\.(?:19|20)\d{2})(?!\d)/.exec(following);
      const attachedDate = readTypedDecisionDate(labelled?.[1]);
      if (attachedDate && (attachedDate.year !== year || reportedDate && reportedDate.date !== attachedDate.date)) {
        return { kind: "conflict" };
      }
      const date = reportedDate ?? attachedDate;
      evidence = mergeTypedPadiEvidence(evidence, {
        kind: "verified",
        publication: { padi_volume: typedCaption(reporter[1]), padi_part: reporter[2] ?? "", padi_page: reporter[3], year },
        date: date?.date ?? null,
      });
      if (evidence.kind === "conflict") return evidence;
    }
  }
  return evidence;
}

export function findTypedPadiEvidence(target: TypedPadiTarget, payload: unknown): TypedPadiEvidence {
  const candidates = (payload as { search_results?: unknown } | null)?.search_results;
  if (!Array.isArray(candidates) || candidates.length > 60) return { kind: "none" };
  const snippets = candidates.flatMap((row) =>
    row && typeof row === "object" && trusted(row.url) &&
    typeof row.snippet === "string" && row.snippet.length <= 12000 ? [row.snippet] : []);
  return scanTypedPadiEvidence(target, snippets);
}

// This tests a draft against independently bound source evidence. Draft text
// itself is never evidence. Unverified routes may still format database cases.
export const typedPadiMarker = /פ\s*["״“”]\s*ד|פד["״“”]י/gu;
export function typedPadiDraftMatches(
  target: TypedPadiTarget, evidence: TypedPadiEvidence, draft: string,
): boolean {
  if (evidence.kind === "conflict") return false;
  // Rule labels are not citation data; let the existing formatter display them.
  const lines = draft.split("\n").filter((line) => line.trim() && !/^\s*📐/u.test(line));
  const count = [...lines.join("\n").matchAll(typedPadiMarker)].length;
  if (evidence.kind !== "verified") return count === 0;
  if (count !== 1 || lines.length !== 1 || draft.length > 12000) return false;
  // A date elsewhere in the draft cannot contradict or augment the bound date.
  for (const token of lines[0].matchAll(/(?<!\d)(?:\d{1,2}\.\d{1,2}\.(?:19|20)\d{2}|(?:19|20)\d{2}-\d{2}-\d{2})(?!\d)/g)) {
    if (!evidence.date || readTypedDecisionDate(token[0])?.date !== evidence.date) return false;
  }
  // Formatting may add a user's paragraph/judge pinpoint after the first
  // page. It isn't source evidence and must not be mistaken for that page.
  const check = lines[0].replace(/,\s*(?:פס['׳]|פיסקה|פסקה|פסקאות)\s*[1-9]\d{0,3}(?:\s*[-–—]\s*[1-9]\d{0,3})?(?:\s+לפסק\s+דינ[וה]\s+של\s+(?:השופט(?:ת)?|הנשיא(?:ה)?)\s+[א-ת]['׳״" .א-ת־-]{0,35})?(?=\s*\((?:19|20)\d{2}\))/u, "");
  const parsed = scanTypedPadiEvidence({ ...target, filingYear: null }, [check]);
  return parsed.kind === "verified" &&
    JSON.stringify(parsed.publication) === JSON.stringify(evidence.publication) &&
    (!parsed.date || parsed.date === evidence.date);
}
