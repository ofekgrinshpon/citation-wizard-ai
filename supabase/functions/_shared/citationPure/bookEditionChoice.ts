import { acceptCitationCompletion } from "./completion.ts";
import { authorEvidenceStatus } from "./authorNames.ts";
import { extractBookPublicationEvidence } from "./bookPublicationEvidence.ts";
import { rawCitationFingerprint, suppliedLookupFieldsMatch } from "../pastedCitation.ts";
export interface BookEditionChoiceOption { id: string; label: string; year: string; url: string; edition?: string }
export interface BookEditionChoice {
  version: 1; rawInput: string; fingerprint: string; options: BookEditionChoiceOption[];
  request: Record<string, unknown>; response: unknown; localFields: Record<string, string>;
  localSourceFields: ReturnType<typeof acceptCitationCompletion>["suppliedFields"]; fallbackMissing: string[];
}
const obj = (v: unknown): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
function ordinal(v: string) {
  const words = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  const n = v.match(/^(\d+)(?:st|nd|rd|th|d)\s+ed/i);
  return n ? Number(n[1]) : words.indexOf(v.toLowerCase().split(/\s+/)[0]) + 1 || null;
}
export function buildBookEditionChoice(request: Record<string, unknown>, raw: string, response: unknown,
  localFields: Record<string, string>, localSourceFields: BookEditionChoice["localSourceFields"], fallbackMissing: string[]): BookEditionChoice | null {
  const supplied = { ...obj(request.parsedFields), ...localFields }, r = obj(response);
  if (request.kind !== "book" || request.rawInput !== raw || supplied.year || supplied.isbn || !supplied.authors || !supplied.bookTitle ||
      !suppliedLookupFieldsMatch(raw, "book", { authors: supplied.authors, bookTitle: supplied.bookTitle }) ||
      !acceptCitationCompletion({ ...request, parsedFields: supplied }, raw, response).identityConfirmed) return null;
  const conflicts = obj(r.identity).conflicts;
  if (!Array.isArray(conflicts) || conflicts.length !== 1 || typeof conflicts[0] !== "string" || !/^year:editions:(?:\d{4},){1,3}\d{4}$/.test(conflicts[0])) return null;
  const years = conflicts[0].slice("year:editions:".length).split(",");
  if (new Set(years).size !== years.length || !Array.isArray(r.sources)) return null;
  const grouped = new Map<string, Array<{ year: string; edition?: string; url: string }>>();
  for (const s of r.sources.map(obj)) {
    try { const url = new URL(s.url); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue; } catch { continue; }
    if (s.strong !== true) continue;
    const statuses = [s.title, s.snippet].filter(x => typeof x === "string").map(x => authorEvidenceStatus(supplied.authors, x));
    if (statuses.includes("conflict") || !statuses.includes("match")) continue;
    const facts = extractBookPublicationEvidence(`${s.title ?? ""} ${s.snippet ?? ""}`, supplied.bookTitle);
    if (!facts.year || !years.includes(facts.year) || (supplied.edition && (!facts.edition || !ordinal(supplied.edition) || ordinal(facts.edition) !== ordinal(supplied.edition)))) continue;
    grouped.set(facts.year, [...(grouped.get(facts.year) ?? []), { ...facts, year: facts.year, url: s.url }]);
  }
  if (years.some(y => !grouped.has(y))) return null;
  const options = years.map(year => {
    const rows = grouped.get(year)!;
    const edition = new Set(rows.map(r => r.edition)).size === 1 ? rows[0].edition : undefined;
    return { id: `book-year-${year}`, label: edition ? `${year} (${edition})` : year, year, url: rows[0].url, ...(edition ? { edition } : {}) };
  });
  return { version: 1, rawInput: raw, fingerprint: rawCitationFingerprint(raw), options, request, response, localFields, localSourceFields, fallbackMissing };
}
export function selectedBookEditionResponse(choice: BookEditionChoice, optionId: string, currentRaw: string): { choice: BookEditionChoice; response: unknown } | null {
  if (choice.version !== 1 || choice.rawInput !== currentRaw || choice.fingerprint !== rawCitationFingerprint(currentRaw)) return null;
  const validated = buildBookEditionChoice(choice.request, currentRaw, choice.response, choice.localFields, choice.localSourceFields, choice.fallbackMissing);
  const option = validated?.options.find(o => o.id === optionId);
  if (!validated || !option) return null;
  const r = obj(validated.response), source = r.sources.find((s: any) => s.url === option.url);
  const fields = { year: option.year, ...(option.edition ? { edition: option.edition } : {}) };
  return { choice: validated, response: { ...r, fields, grounded: Object.fromEntries(Object.keys(fields).map(k => [k, true])),
    provenance: Object.fromEntries(Object.entries(fields).map(([k, value]) => [k, { value, sourceUrl: source.url, sourceTitle: source.title, basis: "search_result_explicit" }])),
    sources: [source], identity: { ...r.identity, conflicts: [] } } };
}
