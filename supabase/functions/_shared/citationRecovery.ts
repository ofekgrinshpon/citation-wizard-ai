/** Pure, bounded recovery wire contract. No credentials, provider traces or UI state. */
export const CITATION_RECOVERY_INPUT_BYTES = 128 * 1024;
export const CITATION_RECOVERY_RESULT_BYTES = 256 * 1024;
export const CITATION_RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
export const CITATION_FIELD_KEYS = [
  "caseName", "volume", "reporter", "firstPage", "pinpoint", "paragraph", "court", "year", "docket",
  "databaseIdentifier", "starPinpoint", "decisionDate", "reporterVolume", "neutral", "ukVolume", "ukSeries", "parallel", "unparsedRemainder",
  "authors", "author", "articleTitle", "journal", "bookTitle", "edition", "editors", "translators", "chapterTitle",
  "doi", "sourceUrl", "title", "jurisdiction", "division", "number", "section", "clause", "statuteName",
  "titleNumber", "code", "subsection", "chapter", "regnalYear", "monarch", "site", "date", "url",
] as const;
const kinds = ["case", "journal_article", "book", "book_chapter"];
const jurisdictions = ["US", "UK", "OTHER", "UNKNOWN"];
const bases = ["official_record", "structured_metadata", "publisher_metadata", "repository_metadata", "search_result_explicit", "document_inspection"];
export function recoveryObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keysOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function optionalString(value: Record<string, unknown>, key: string): boolean {
  return !(key in value) || typeof value[key] === "string";
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function fields(value: unknown, type: "string" | "boolean" = "string"): boolean {
  return recoveryObject(value) && keysOnly(value, CITATION_FIELD_KEYS) && Object.values(value).every((item) => typeof item === type);
}
function bounded(value: unknown, bytes: number): boolean {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= bytes; } catch { return false; }
}
export interface CitationRecoveryInput {
  messages: Array<{ role: string; content: string }>;
  rawInput: string | null;
  foreignLookup: Record<string, unknown> | null;
  batchId: string | null;
}
export interface CitationRecoveryResult { content?: string; foreignLookup?: Record<string, unknown> }

/** Reject extra execution fields instead of silently changing fingerprint semantics. */
export function citationRecoveryInput(value: unknown): CitationRecoveryInput | null {
  if (!recoveryObject(value) || !keysOnly(value, ["messages", "rawInput", "foreignLookup", "batchId"]) ||
      !Array.isArray(value.messages) || !value.messages.length || value.messages.length > 100 || value.messages.some((item) =>
        !recoveryObject(item) || !keysOnly(item, ["role", "content"]) || typeof item.role !== "string" || !["system", "user", "assistant"].includes(item.role) || typeof item.content !== "string") ||
      !(value.rawInput === null || typeof value.rawInput === "string") ||
      !(value.batchId === null || (typeof value.batchId === "string" && value.batchId.length >= 8 && value.batchId.length <= 200))) return null;
  const foreign = value.foreignLookup;
  if (foreign !== null && (!recoveryObject(foreign) ||
      !keysOnly(foreign, ["enabled", "kind", "jurisdiction", "rawInput", "parsedFields", "articleResponseVersion"]) ||
      !(typeof foreign.enabled === "boolean") || !optionalString(foreign, "rawInput") ||
      ("kind" in foreign && !kinds.includes(String(foreign.kind))) ||
      ("jurisdiction" in foreign && !jurisdictions.includes(String(foreign.jurisdiction))) ||
      ("parsedFields" in foreign && !fields(foreign.parsedFields)) ||
      ("articleResponseVersion" in foreign && foreign.articleResponseVersion !== 1))) return null;
  if (!bounded(value, CITATION_RECOVERY_INPUT_BYTES)) return null;
  return structuredClone(value) as unknown as CitationRecoveryInput;
}

/** Validate the published typed foreign result, never a raw provider envelope. */
function validForeignResult(value: unknown): value is Record<string, unknown> {
  if (!recoveryObject(value) || !keysOnly(value, ["kind", "jurisdiction", "fields", "grounded", "provenance", "sources", "identity", "disambiguation", "diagnostics", "error", "articleResolution"]) ||
      !kinds.includes(String(value.kind)) || !jurisdictions.includes(String(value.jurisdiction)) || !fields(value.fields) || !fields(value.grounded, "boolean") ||
      !recoveryObject(value.provenance) || !keysOnly(value.provenance, CITATION_FIELD_KEYS) ||
      !Object.values(value.provenance).every((entry) => recoveryObject(entry) && keysOnly(entry, ["value", "sourceUrl", "sourceTitle", "basis"]) &&
        typeof entry.value === "string" && bases.includes(String(entry.basis)) && optionalString(entry, "sourceUrl") && optionalString(entry, "sourceTitle")) ||
      !Array.isArray(value.sources) || !value.sources.every((entry) => recoveryObject(entry) && keysOnly(entry, ["url", "title", "tier"]) &&
        typeof entry.url === "string" && optionalString(entry, "title") && ["tier1", "tier2"].includes(String(entry.tier)))) return false;
  const identity = value.identity;
  if (!recoveryObject(identity) || !keysOnly(identity, ["matched", "anchors", "conflicts", "jurisdiction", "jurisdictionDiscovered", "court", "year"]) ||
      typeof identity.matched !== "boolean" || !strings(identity.anchors) || !strings(identity.conflicts) ||
      ("jurisdiction" in identity && !["US", "UK"].includes(String(identity.jurisdiction))) ||
      ("jurisdictionDiscovered" in identity && typeof identity.jurisdictionDiscovered !== "boolean") ||
      !optionalString(identity, "court") || !optionalString(identity, "year")) return false;
  if ("disambiguation" in value && (!Array.isArray(value.disambiguation) || !value.disambiguation.every((entry) =>
    recoveryObject(entry) && keysOnly(entry, ["jurisdiction", "label", "url"]) && ["US", "UK"].includes(String(entry.jurisdiction)) &&
    typeof entry.label === "string" && typeof entry.url === "string"))) return false;
  const diagnostics = value.diagnostics;
  return recoveryObject(diagnostics) && keysOnly(diagnostics, ["tier1Queried", "tier2Fired", "jurisdictionResolvedBy"]) &&
    typeof diagnostics.tier1Queried === "boolean" && typeof diagnostics.tier2Fired === "boolean" && optionalString(diagnostics, "jurisdictionResolvedBy") &&
    optionalString(value, "error") && (!("articleResolution" in value) || ["resolved", "incomplete", "conflict"].includes(String(value.articleResolution)));
}

/** Deliberate projection strips diagnostic/auth/provider envelopes before storage. */
export function citationRecoveryResult(value: unknown): CitationRecoveryResult | null {
  if (!recoveryObject(value)) return null;
  const result: CitationRecoveryResult = {};
  if ("content" in value) {
    if (typeof value.content !== "string") return null;
    result.content = value.content;
  }
  if ("foreignLookup" in value) {
    if (!validForeignResult(value.foreignLookup)) return null;
    result.foreignLookup = structuredClone(value.foreignLookup);
  }
  // Structured-only and empty-text + structured results are valid deliveries.
  if (!(result.content?.trim() || result.foreignLookup) || !bounded(result, CITATION_RECOVERY_RESULT_BYTES)) return null;
  return result;
}

export interface CitationRecoveryQuery { requestId?: string; parentRequestId?: string; cursor?: string; limit: number }
export function citationRecoveryQuery(value: unknown): CitationRecoveryQuery | null {
  if (!recoveryObject(value) || !keysOnly(value, ["requestId", "parentRequestId", "cursor", "limit"])) return null;
  for (const key of ["requestId", "parentRequestId"] as const) {
    if (key in value && !(typeof value[key] === "string" && value[key].length >= 8 && value[key].length <= 200)) return null;
  }
  if (value.requestId && value.parentRequestId) return null;
  if ("cursor" in value && !(typeof value.cursor === "string" && value.cursor.length >= 8 && value.cursor.length <= 200)) return null;
  if ((value.requestId || value.parentRequestId) && "cursor" in value) return null;
  const limit = "limit" in value ? value.limit : 20;
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 50) return null;
  return { ...value, limit } as CitationRecoveryQuery;
}
