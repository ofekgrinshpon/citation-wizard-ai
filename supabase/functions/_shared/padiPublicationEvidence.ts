/** Printed-reporter proof only. Never discovers a case or infers its identity/year. */
import { CASE_DOCKET_RE } from "./caseTypePrefixes.ts";

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
