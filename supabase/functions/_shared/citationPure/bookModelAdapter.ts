import { extractBookIsbn } from "./bookIsbn.ts";
import { validateBookModelEvidence, type BookEvidenceResult } from './bookModelEvidence.ts';
import { suppliedLookupFieldsMatch, rawCitationFingerprint } from '../pastedCitation.ts';
const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
export const hasBookModelEvidence = (r: unknown) => Object.prototype.hasOwnProperty.call(obj(r), 'bookModelEvidence');
export function bookModelProofKey(response: unknown): string {
  try { return rawCitationFingerprint(JSON.stringify(obj(response).bookModelEvidence) ?? 'invalid'); }
  catch { return 'invalid'; }
}
/** Rebuild target from supplied input, never accept a model-provided target. */
export function readBookModelEvidence(request: Record<string, unknown>, raw: string, response: unknown, local: Record<string, string>):
  { result: BookEvidenceResult; urls: Map<string, string> } | null {
  const r = obj(response), e = obj(r.bookModelEvidence), supplied = { ...obj(request.parsedFields), ...local };
  if (extractBookIsbn(raw) || request.kind !== 'book' || request.jurisdiction !== 'OTHER' || request.rawInput !== raw ||
    r.kind !== 'book' || r.jurisdiction !== 'OTHER' || (r.rawInput !== undefined && r.rawInput !== raw) ||
    !supplied.bookTitle || !supplied.authors || !suppliedLookupFieldsMatch(raw, 'book', supplied) ||
    e.version !== 1 || !Array.isArray(e.records) || e.records.length > 4 || !Array.isArray(e.sources) || e.sources.length > 4) return null;
  // Translator/editor constraints are not representable in this experimental schema.
  if (supplied.translators || supplied.editors) return null;
  const urls = new Map<string, string>(); let total = 0;
  for (const s of e.sources) {
    if (!s || typeof s.id !== 'string' || !s.id || urls.has(s.id) || typeof s.url !== 'string' || typeof s.text !== 'string' || s.text.length > 1500) return null;
    try { const u = new URL(s.url); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null; } catch { return null; }
    total += s.text.length; urls.set(s.id, s.url);
  }
  if (total > 6000) return null;
  const packet: any = { title: supplied.bookTitle, author: supplied.authors, sources: e.sources.map((s: any) => ({ id: s.id, text: s.text })) };
  for (const key of ['year', 'isbn', 'edition', 'format', 'language', 'version']) if (supplied[key] !== undefined) packet[key] = supplied[key];
  const result = validateBookModelEvidence(e.records, packet);
  return { result, urls };
}
