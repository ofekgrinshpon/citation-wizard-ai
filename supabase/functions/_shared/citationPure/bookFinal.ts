/** Bounded book completion and final-text framing. Pure, shared by server and clients.
 * A frame is a format/version discriminator, NOT proof of authority. Authority
 * comes only from server-owned retention read through the authenticated API. */
import { extractBookWork } from "./bookWorks.ts";
import { acceptCitationCompletion } from "./completion.ts";
import { renderBook, renderBookChapter, type RenderResult } from "./render.ts";
import { escapeCitationLiteral, unescapeCitationLiteral, splitCitationWarnings } from "./segments.ts";
import { guardPastedCitationRequest, suppliedLookupFieldsMatch, rawCitationFingerprint } from "../pastedCitation.ts";
import type { CitationRecoveryInput } from "../citationRecovery.ts";

export function renderBookFields(kind: "book" | "book_chapter", fields: Record<string, unknown>): RenderResult {
  const literal = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === "string" ? escapeCitationLiteral(v) : v]));
  const r = kind === "book" ? renderBook(literal) : renderBookChapter(literal);
  return { ...r, warnings: r.warnings.map(unescapeCitationLiteral),
    ...(r.unrepresented ? { unrepresented: r.unrepresented.map(unescapeCitationLiteral) } : {}) };
}

export function eligibleBookCompletion(type: string | null, raw: string) {
  if (type !== "foreign_book" && type !== "foreign_book_chapter") return null;
  const work = extractBookWork(raw);
  if (!work || work.preserve || work.fields.unparsedRemainder || !work.explicitNew ||
    (work.kind === "book") !== (type === "foreign_book") || !work.fields.authors || !work.fields.bookTitle ||
    (work.kind === "chapter" && !work.fields.chapterTitle)) return null;
  const kind = work.kind === "book" ? "book" : "book_chapter";
  if (!renderBookFields(kind, { ...work.fields }).missing.some(k => k === "year" || k === "edition")) return null;
  const wire: Record<string, string> = {};
  for (const [k, v] of Object.entries(work.fields)) {
    const value = work.suppliedFields?.[k]?.value ?? (typeof v === "string" ? v.trim() : "");
    if (value && k !== "unparsedRemainder" && suppliedLookupFieldsMatch(raw, kind, { [k]: value })) wire[k] = value;
  }
  if (!wire.authors || !wire.bookTitle || (kind === "book_chapter" && !wire.chapterTitle)) return null;
  return { kind, fields: work.fields, wire, suppliedFields: work.suppliedFields };
}

/** The same exact raw/manual/wire checks run before rendering and before replay. */
export function boundBookCompletion(input: CitationRecoveryInput) {
  const request = input.foreignLookup;
  if (!request || !["book", "book_chapter"].includes(String(request.kind)) || request.jurisdiction !== "OTHER" ||
    request.enabled !== true || typeof request.rawInput !== "string") return null;
  const raw = input.rawInput ?? request.rawInput;
  const bound = guardPastedCitationRequest({ messages: input.messages, rawInput: raw, foreignLookup: request });
  if (raw !== request.rawInput || bound.rawInput !== raw || bound.route === "preserve") return null;
  const type = request.kind === "book" ? "foreign_book" : "foreign_book_chapter";
  const local = eligibleBookCompletion(type, raw);
  const wire = request.parsedFields;
  if (!local || local.kind !== request.kind || !wire || typeof wire !== "object" || Array.isArray(wire) ||
    Object.keys(wire).length !== Object.keys(local.wire).length ||
    Object.entries(local.wire).some(([k, v]) => (wire as Record<string, unknown>)[k] !== v)) return null;
  return { request, raw, type, local, bound };
}

const missingLabels: Record<string, Record<string, string>> = {
  foreign_book: { authors: "שמות המחברים – ברישיות מוקטנות (small caps) (כלל 36.6)", bookTitle: "שם הספר – ברישיות מוקטנות (כלל 36.6)", year: "שנת פרסום הספר (כלל 36.6)" },
  foreign_book_chapter: { authors: "שמות המחברים – כללי 36.7 (כלל 36.8)", bookTitle: "שם הספר – ברישיות מוקטנות (כלל 36.6) (כלל 36.8)", firstPage: "עמוד תחילת המאמר בספר (כלל 36.8)", year: "שנת פרסום הספר (כלל 36.8)" },
};
export function bookMissingSummary(type: string, missing: string[]): string {
  const descriptions = missing.map(k => missingLabels[type]?.[k]).filter(Boolean);
  return descriptions.length ? `חסרים ${descriptions.length} רכיבי חובה: ${descriptions.join("، ")}` : "";
}

/** Full-evidence acceptance, exact supplied values, formatting and warnings once. */
export function resolveBookCompletion(request: Record<string, unknown>, raw: string, response: unknown,
  localFields: Record<string, string>, suppliedFields: ReturnType<typeof acceptCitationCompletion>["suppliedFields"], fallbackMissing: string[]) {
  const kind = request.kind === "book" ? "book" : "book_chapter";
  const type = kind === "book" ? "foreign_book" : "foreign_book_chapter";
  const supplied = { ...(request.parsedFields as Record<string, string>), ...localFields };
  const accepted = acceptCitationCompletion({ ...request, parsedFields: supplied }, raw, response);
  if (suppliedFields) accepted.suppliedFields = suppliedFields;
  const messages = {
    binding: "תשובת החיפוש סותרת את הקלט, סוג המקור או השיפוט; הקלט נשמר ללא השלמה.",
    jurisdiction: "פרטי השיפוט שהוחזרו סותרים את ראיות הערכאה או מקור הפרסום שסופקו או עוגנו; הקלט נשמר ללא השלמה.",
    malformed: "תשובת החיפוש אינה בפורמט נתמך; נשמרו רק הפרטים שסופקו.",
    unavailable: "חיפוש פרטי המקור לא היה זמין; נשמרו רק הפרטים שסופקו.",
    identity: "לא אומתה התאמת המקור לפרטים שסופקו או נמצאו פרטים סותרים; נשמרו רק הפרטים שסופקו.",
    chapter_identity: "לא אומתה זהות הפרק המבוקש בנפרד מזהות הספר או האסופה; נשמרו רק הפרטים שסופקו ללא השלמה.",
    ambiguous: "נדרשת בחירה בין כמה פסקי דין",
  };
  const warnings: string[] = accepted.reason ? [messages[accepted.reason]] : [];
  if (accepted.quarantined.length) warnings.push("פרטים סותרים או ללא ראיות מספקות לא שולבו: " + accepted.quarantined.join(", ") + ".");
  const rendered = accepted.identityConfirmed ? renderBookFields(kind, { ...accepted.fields, ...supplied }) : null;
  const fl = response && typeof response === "object" ? response as { identity?: { conflicts?: unknown[] } } : null;
  if (accepted.identityConfirmed && Array.isArray(fl?.identity?.conflicts) && fl.identity.conflicts.length) warnings.push("נמצאו פרטי פרסום סותרים; נשמרו רק השלמות תואמות.");
  if (rendered) {
    warnings.push(...rendered.warnings);
    if (rendered.missing.length) warnings.push(`חסרים פרטים: ${bookMissingSummary(type, rendered.missing)}`);
  }
  const citation = rendered?.citation.trim() || escapeCitationLiteral(raw);
  accepted.missing = rendered?.missing ?? fallbackMissing;
  accepted.completeness = !accepted.identityConfirmed ? "unconfirmed" : accepted.missing.length ? "partial" : "complete";
  const bits = [...new Set(warnings.filter(Boolean))];
  return { citation, reply: citation + (bits.length ? `\n⚠️ ${bits.join(" ")}` : ""), status: bits.length ? "warning" as const : "valid" as const,
    warningMsg: bits[0], sourceType: type as "foreign_book" | "foreign_book_chapter", completion: accepted };
}

const PREFIX = "relex:book-final:2\n";
const LEGACY_PREFIX = "relex:book-final:1\n";
/** Exact JSON-value serialization: object order is immaterial, array order is not.
 * Reject values JSON.stringify would silently drop/coerce or invoke via getters. */
export function canonicalBookContext(value: unknown): string {
  const ancestors = new Set<object>();
  const serialize = (item: unknown): string => {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number" && Number.isFinite(item) && !Object.is(item, -0)) return JSON.stringify(item);
    if (typeof item !== "object" || !item || ancestors.has(item)) throw new TypeError("INVALID_BOOK_CONTEXT_JSON");
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (!array && prototype !== Object.prototype && prototype !== null) throw new TypeError("INVALID_BOOK_CONTEXT_JSON");
    const keys = Reflect.ownKeys(item);
    if (keys.some(key => typeof key !== "string")) throw new TypeError("INVALID_BOOK_CONTEXT_JSON");
    const properties = Object.getOwnPropertyDescriptors(item);
    if (array) {
      if (keys.length !== item.length + 1 || Array.from({ length: item.length }, (_, i) => String(i)).some(key => !properties[key]))
        throw new TypeError("INVALID_BOOK_CONTEXT_JSON");
    }
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = properties[String(key)];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError("INVALID_BOOK_CONTEXT_JSON");
    }
    ancestors.add(item);
    try {
      if (array) return "[" + Array.from({ length: item.length }, (_, i) => serialize(properties[String(i)].value)).join(",") + "]";
      return "{" + Object.keys(properties).sort().map(key => JSON.stringify(key) + ":" + serialize(properties[key].value)).join(",") + "}";
    } finally { ancestors.delete(item); }
  };
  return serialize(value);
}
/** This checksum only binds context / detects version drift; it is NOT a signature. */
function contextKey(input: CitationRecoveryInput, requestId: string) {
  return rawCitationFingerprint(canonicalBookContext([requestId, input.messages, input.rawInput, input.foreignLookup]));
}
export function frameBookFinal(input: CitationRecoveryInput, requestId: string, reply: string): string {
  return PREFIX + JSON.stringify([contextKey(input, requestId), reply]);
}
export function readBookFinal(content: unknown, input: CitationRecoveryInput, requestId: string): { reply: string; citation: string; warnings: string[] } | null {
  if (typeof content !== "string" || (!content.startsWith(PREFIX) && !content.startsWith(LEGACY_PREFIX))) return null;
  try {
    const canonicalKey = contextKey(input, requestId); // Validate JSON shapes for both versions.
    if (!boundBookCompletion(input)) return null;
    const legacy = content.startsWith(LEGACY_PREFIX);
    // v1 accepts only its original exact serialization. Lost insertion order
    // cannot be reconstructed safely; never accept arbitrary v1 mismatches.
    const key = legacy ? rawCitationFingerprint(JSON.stringify([requestId, input.messages, input.rawInput, input.foreignLookup])) : canonicalKey;
    const frame: unknown = JSON.parse(content.slice(legacy ? LEGACY_PREFIX.length : PREFIX.length));
    if (!Array.isArray(frame) || frame.length !== 2 || frame[0] !== key || typeof frame[1] !== "string" || !frame[1].trim()) return null;
    return { reply: frame[1], ...splitCitationWarnings(frame[1]) };
  } catch { return null; }
}
export const hasBookFinalFrame = (content: unknown) => typeof content === "string" && content.startsWith("relex:book-final:");