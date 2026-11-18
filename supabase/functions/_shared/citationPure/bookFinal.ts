import { hasBookModelEvidence, readBookModelEvidence, bookModelProofKey } from "./bookModelAdapter.ts";
import { buildBookEditionChoice, selectedBookEditionResponse, type BookEditionChoice } from "./bookEditionChoice.ts";
import { extractBookPublicationEvidence } from "./bookPublicationEvidence.ts";
export type { BookEditionChoice, BookEditionChoiceOption } from "./bookEditionChoice.ts";
/** Bounded book completion and final-text framing. Pure, shared by server and clients.
 * A frame is a format/version discriminator, NOT proof of authority. Authority
 * comes only from server-owned retention read through the authenticated API. */
import { prepareFreeformHandoff } from "./freeformInterpret.ts";
import { extractBookIsbn } from "./bookIsbn.ts";
import { extractBookWork } from "./bookWorks.ts";
import { acceptCitationCompletion } from "./completion.ts";
import { renderBook, renderBookChapter, type RenderResult } from "./render.ts";
import { escapeCitationLiteral, unescapeCitationLiteral, splitCitationWarnings } from "./segments.ts";
import { guardPastedCitationRequest, suppliedLookupFieldsMatch, rawCitationFingerprint } from "../pastedCitation.ts";
import { citationRecoveryResult, recoveryObject, type CitationRecoveryInput } from "../citationRecovery.ts";

export function renderBookFields(kind: "book" | "book_chapter", fields: Record<string, unknown>): RenderResult {
  const literal = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === "string" ? escapeCitationLiteral(v) : v]));
  const r = kind === "book" ? renderBook(literal) : renderBookChapter(literal);
  return { ...r, warnings: r.warnings.map(unescapeCitationLiteral),
    ...(r.unrepresented ? { unrepresented: r.unrepresented.map(unescapeCitationLiteral) } : {}) };
}

export function eligibleBookCompletion(type: string | null, raw: string) {
  if (type !== "foreign_book" && type !== "foreign_book_chapter") return null;
  const identifier = type === "foreign_book" ? extractBookIsbn(raw) : null;
  if (identifier && !identifier.isbn) return null;
  if (identifier && !identifier.text) return { kind: "book" as const, fields: {}, wire: {}, suppliedFields: undefined };
  const work = extractBookWork(identifier?.text ?? raw);
  // The deterministic free-form planner also emits typed missing-year books.
  // Rebuild exactly those fields for final rendering/replay; do not reinterpret
  // a recognized formal work, a chapter, or a model-only free-form handoff.
  if (!identifier && !work && type === "foreign_book") {
    const handoff = prepareFreeformHandoff(raw);
    if (handoff?.mode === "search" && handoff.request.kind === "book" && handoff.request.jurisdiction === "OTHER") {
      const wire = handoff.request.parsedFields;
      if (!wire.year && wire.authors && wire.bookTitle && suppliedLookupFieldsMatch(raw, "book", wire)) {
        return { kind: "book" as const, fields: { ...wire }, wire: { ...wire }, suppliedFields: undefined };
      }
    }
  }

  if (identifier && (!work || work.preserve || work.fields.unparsedRemainder || !work.explicitNew)) {
    const handoff = prepareFreeformHandoff(identifier.text);
    if (handoff?.mode !== "search" || handoff.request.kind !== "book") return null;
    const wire = handoff.request.parsedFields;
    if (!wire.authors || !wire.bookTitle || !suppliedLookupFieldsMatch(raw, "book", wire)) return null;
    return { kind: "book" as const, fields: wire, wire, suppliedFields: undefined };
  }
  if (!work || work.preserve || work.fields.unparsedRemainder || !work.explicitNew ||
    (work.kind === "book") !== (type === "foreign_book") || !work.fields.authors || !work.fields.bookTitle ||
    (work.kind === "chapter" && !work.fields.chapterTitle)) return null;
  const kind = work.kind === "book" ? "book" : "book_chapter";
  if (!identifier && !renderBookFields(kind, { ...work.fields }).missing.some(k => k === "year" || k === "edition")) return null;
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
  // Preserve all labels accepted by the legacy caller contract, even for optional
  // components explicitly passed as missing. These labels do not define eligibility.
  foreign_book: { authors: "שמות המחברים – ברישיות מוקטנות (small caps) (כלל 36.6)", bookTitle: "שם הספר – ברישיות מוקטנות (כלל 36.6)", year: "שנת פרסום הספר (כלל 36.6)",
    volume: "מספר הכרך – לפני שם המחבר (כלל 36.6)", subtitle: "שם משני (אחרי נקודתיים) (כלל 36.6)", pinpoint: "הפניה ספציפית – לפני הסוגריים (כלל 36.6)", edition: "פרטי מהדורה (3d ed. וכו') (כלל 36.6)", editor: "שם העורך – לפני eds. (כלל 36.6)", translator: "שם המתרגם – לפני trans. (כלל 36.6)", publisher: "מוציא לאור – רק אם פורסם לפני 1900 או על ידי גורם שאינו המוציא לאור המקורי (כלל 36.6)" },
  foreign_book_chapter: { authors: "שמות המחברים – כללי 36.7 (כלל 36.8)", bookTitle: "שם הספר – ברישיות מוקטנות (כלל 36.6) (כלל 36.8)", firstPage: "עמוד תחילת המאמר בספר (כלל 36.8)", year: "שנת פרסום הספר (כלל 36.8)",
    articleTitle: "שם המאמר – באותיות מוטות (כלל 36.7) (כלל 36.8)", pinpoint: "הפניה ספציפית (אחרי פסיק) (כלל 36.8)", editor: "שמות עורכי הספר (כלל 36.8)" },
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
  // Search snippets may identify a work without proving its publication year.
  for (const key of ["year", "edition"]) {
    const p = accepted.provenance[key] as Record<string, unknown> | undefined;
    if (!p || p.basis !== "search_result_explicit") continue;
    const sources = (response as { sources?: Array<{ url: string; title?: string; snippet?: string }> })?.sources ?? [];
    const source = sources.find(s => s.url === p.sourceUrl);
    const facts = extractBookPublicationEvidence([source?.title ?? "", source?.snippet ?? ""].join(kind === "book" ? "\n" : " "), supplied.bookTitle ?? "",
      kind === "book" ? supplied.authors : undefined, { bookChapterContainer: kind === "book_chapter" });
    if (facts[key as "year" | "edition"] !== accepted.fields[key]) {
      delete accepted.fields[key]; delete accepted.provenance[key]; accepted.quarantined.push(key);
    }
  }
  // An experimental envelope is terminal, including empty/invalid evidence.
  // Never fall back to an unvalidated legacy year or edition alongside it.
  let renderSuppliedBook = false;
  if (hasBookModelEvidence(response)) {
    for (const key of ["year", "edition"]) { delete accepted.fields[key]; delete accepted.provenance[key]; }
    const evidence = readBookModelEvidence(request, raw, response, localFields);
    // A clean pilot abstention still permits formatting facts supplied by the
    // user. This does not verify identity, fill a year, or accept provider fields.
    const local = kind === "book" && !supplied.year ? eligibleBookCompletion(type, raw) : null;
    const modelIdentity = (response as { identity?: { matched?: unknown; conflicts?: unknown } })?.identity;
    renderSuppliedBook = !!local && !!evidence && evidence.result.records.length === 0 && evidence.result.rejected.length === 0 &&
      modelIdentity?.matched === false && Array.isArray(modelIdentity.conflicts) && modelIdentity.conflicts.length === 0 &&
      (accepted.reason === "identity" || accepted.reason === "unavailable") &&
      Object.keys(supplied).length === Object.keys(local.wire).length &&
      Object.entries(local.wire).every(([key, value]) => supplied[key] === value);

    if (accepted.identityConfirmed && evidence?.result.options.length === 1 && !supplied.year) {
      const record = evidence.result.options[0].records[0];
      accepted.fields.year = record.year;
      accepted.provenance.year = { value: record.year, sourceUrl: evidence.urls.get(record.sourceId), basis: "model_quoted_publication", quote: record.quote, isbn: record.isbn };
      accepted.quarantined = accepted.quarantined.filter(key => key !== "year");
    }
  }
  const bookEditionChoice = buildBookEditionChoice(request, raw, response, localFields, suppliedFields, fallbackMissing);

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
  const rendered = accepted.identityConfirmed ? renderBookFields(kind, { ...accepted.fields, ...supplied })
    : renderSuppliedBook ? renderBookFields("book", supplied) : null;
  const fl = response && typeof response === "object" ? response as { identity?: { conflicts?: unknown[] } } : null;
  if (accepted.identityConfirmed && Array.isArray(fl?.identity?.conflicts) && fl.identity.conflicts.length) {
    const marker = fl.identity.conflicts.find(c => typeof c === "string" && /^year:editions:(?:\d{4},){1,3}\d{4}$/.test(c)) as string | undefined;
    warnings.push(marker ? `נמצאו רשומות לשנים ${marker.slice("year:editions:".length).replace(/,/g, ", ")}. לא נבחרה מהדורה אוטומטית.${bookEditionChoice ? "" : " הוסיפו שנה או ISBN כדי לזהות את המהדורה."}` : "נמצאו פרטי פרסום סותרים; נשמרו רק השלמות תואמות.");
  }
  if (rendered) {
    warnings.push(...rendered.warnings);
    if (rendered.missing.length) warnings.push(`חסרים פרטים: ${bookMissingSummary(type, rendered.missing)}`);
  }
  const citation = rendered?.citation.trim() || escapeCitationLiteral(raw);
  accepted.missing = rendered?.missing ?? fallbackMissing;
  accepted.completeness = !accepted.identityConfirmed ? "unconfirmed" : accepted.missing.length ? "partial" : "complete";
  const bits = [...new Set(warnings.filter(Boolean))];
  return { citation, reply: citation + (bits.length ? `\n⚠️ ${bits.join(" ")}` : ""), status: bits.length ? "warning" as const : "valid" as const,
    warningMsg: bits[0], sourceType: type as "foreign_book" | "foreign_book_chapter", completion: accepted, ...(bookEditionChoice ? { bookEditionChoice } : {}) };
}

/** Local choice only. Revalidate original evidence and exact input, never fetch. */
export function selectBookEditionChoice(choice: BookEditionChoice, optionId: string, currentRaw: string): ReturnType<typeof resolveBookCompletion> | null {
  if (choice.version !== 1 || choice.rawInput !== currentRaw || choice.fingerprint !== rawCitationFingerprint(currentRaw)) return null;
  if (hasBookModelEvidence(choice.response) && choice.modelProofKey !== bookModelProofKey(choice.response)) return null;
  const validated = buildBookEditionChoice(choice.request, currentRaw, choice.response, choice.localFields, choice.localSourceFields, choice.fallbackMissing);
  if (!validated) return null;
  if (optionId === "keep-missing") {
    const result = resolveBookCompletion(validated.request, currentRaw, validated.response, validated.localFields, validated.localSourceFields, validated.fallbackMissing);
    delete result.bookEditionChoice;
    result.warningMsg = "שנת המהדורה נשארה חסרה לפי בחירתכם; לא בוצע חיפוש נוסף.";
    result.reply = result.citation + "\n⚠️ " + result.warningMsg; result.status = "warning";
    return result;
  }
  const selected = selectedBookEditionResponse(validated, optionId, currentRaw);
  if (!selected) return null;
  const result = resolveBookCompletion(validated.request, currentRaw, selected.response, validated.localFields, validated.localSourceFields, validated.fallbackMissing);
  if (!result.completion.fields.year) return null;
  delete result.bookEditionChoice;
  return result;
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

/** Finalize a server-produced response before status is written. The pilot's
 * evidence may be transient; a user-visible citation or warning must not be. */
export function prepareBookAwareCitationDelivery(
  body: Record<string, unknown>, input: CitationRecoveryInput | null, requestId: string | null, guardedRaw?: string,
) {
  const foreign = recoveryObject(body.foreignLookup) ? body.foreignLookup : null;
  const isBook = foreign?.kind === "book" || foreign?.kind === "book_chapter";
  const pilot = foreign?.kind === "book" && "bookModelEvidence" in foreign;
  const sources = foreign?.sources;
  // This projection is only for known service-produced book evidence. Other
  // unexpected shapes still fail the approved retention validator.
  const knownSources = isBook && Array.isArray(sources) && sources.every(source =>
    recoveryObject(source) &&
    Object.keys(source).every(key => ["url", "title", "tier", "snippet", "strong"].includes(key)) &&
    (!("snippet" in source) || typeof source.snippet === "string") &&
    (!("strong" in source) || typeof source.strong === "boolean"));
  const retainedForeign = { ...foreign };
  if (pilot && recoveryObject(foreign?.bookModelEvidence) && foreign.bookModelEvidence.version === 1)
    delete retainedForeign.bookModelEvidence;
  const retainedBody = knownSources ? { ...body, foreignLookup: { ...retainedForeign,
    sources: sources.map((source: Record<string, unknown>) => ({
      url: source.url, ...("title" in source ? { title: source.title } : {}), tier: source.tier,
    })),
  } } : body;

  const result = citationRecoveryResult(retainedBody);
  const book = input && boundBookCompletion(input);
  const pilotBound = book?.request.kind === foreign?.kind && book?.request.jurisdiction === foreign?.jurisdiction;
  if (result && book && input && requestId && isBook && (!pilot || pilotBound)) {
    const localFields = Object.fromEntries(Object.entries(book.local.fields).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const final = resolveBookCompletion(book.request, book.raw, foreign, localFields, book.local.suppliedFields, book.bound.missing);
    // Compute with full evidence; retain framed final text, not the proofs.
    const framed = citationRecoveryResult({ ...result, content: frameBookFinal(input, requestId, final.reply) });
    if (!pilot || (framed && final.reply.trim())) {
      return { body: { ...body, content: final.reply }, result: framed };
    }
  }
  if (pilot) {
    // A rejected or unbindable pilot result may neither claim an edition nor
    // settle a blank success. Keep only the guarded input and a visible warning.
    const raw = guardedRaw?.trim();
    const content = (raw ? escapeCitationLiteral(raw) + "\n" : "") +
      "⚠️ לא ניתן היה לאמת את תוצאת החיפוש לספר; לא הושלמו פרטי פרסום.";
    const fallback: Record<string, unknown> = { ...body, content };
    delete fallback.foreignLookup;
    return { body: fallback, result: citationRecoveryResult({ content }) };
  }
  return { body, result };
}
