/** Temporary citation observation: fixed enums/counts only, no I/O or text payloads. */
export const CITATION_DIAGNOSTIC_VERSION = 1 as const;
export const CITATION_DIAGNOSTIC_FIELDS = ["authors", "articleTitle", "journal", "volume", "firstPage", "year", "pinpoint"] as const;
export type CitationDiagnosticField = typeof CITATION_DIAGNOSTIC_FIELDS[number];
export type CitationDiagnosticTier = "tier1" | "tier2";
export const CITATION_DIAGNOSTIC_COUNT_LIMIT = 1000;

const SEARCH_STATUSES = ["not_started", "ok", "http_error", "json_error", "invalid_shape", "fetch_error", "timeout"] as const;
const PAGE_STATUSES = ["not_attempted", "no_candidate", "skipped_records_present", "blocked_url", "http_error", "fetch_error", "timeout", "read_error", "empty", "no_record", "record_accepted", "record_rejected"] as const;
const STOP_REASONS = ["not_finished", "missing_credentials", "missing_title", "tier1_records_present", "tier2_exhausted", "lookup_exception"] as const;
const RESOLUTIONS = ["not_finished", "resolved", "incomplete", "conflict", "unavailable"] as const;
type SearchStatus = typeof SEARCH_STATUSES[number];
type PageStatus = typeof PAGE_STATUSES[number];
type StopReason = typeof STOP_REASONS[number];
type Resolution = typeof RESOLUTIONS[number];

export interface CitationDiagnosticSearch {
  status: SearchStatus;
  httpStatus: number | null;
  resultCount: number;
  strongHostCount: number;
  weakHostCount: number;
  missingUrlCount: number;
  noRecordCount: number;
  parsedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  parsedFields: CitationDiagnosticField[];
  acceptedFields: CitationDiagnosticField[];
}
export interface CitationDiagnostic {
  version: typeof CITATION_DIAGNOSTIC_VERSION;
  suppliedFields: CitationDiagnosticField[];
  searches: { tier1: CitationDiagnosticSearch; tier2: CitationDiagnosticSearch };
  page: {
    tier: CitationDiagnosticTier | null;
    status: PageStatus;
    httpStatus: number | null;
    parsedCount: number;
    acceptedCount: number;
    rejectedCount: number;
    parsedFields: CitationDiagnosticField[];
    acceptedFields: CitationDiagnosticField[];
  };
  stopReason: StopReason;
  final: {
    resolution: Resolution;
    identityMatched: boolean;
    presentFields: CitationDiagnosticField[];
    missingFields: CitationDiagnosticField[];
    conflictFields: CitationDiagnosticField[];
  };
}

/** Call sites must pass only enumerated facts, never source/input objects. */
export type CitationDiagnosticEvent =
  | { type: "input"; fields: CitationDiagnosticField[] }
  | { type: "search"; tier: CitationDiagnosticTier; status: SearchStatus; httpStatus: number | null; resultCount: number }
  | { type: "sources"; tier: CitationDiagnosticTier; strongHostCount: number; weakHostCount: number; missingUrlCount: number; noRecordCount: number }
  | { type: "record"; tier: CitationDiagnosticTier; origin: "snippet" | "page"; accepted: boolean; fields: CitationDiagnosticField[]; conflicts: CitationDiagnosticField[] }
  | { type: "page"; tier: CitationDiagnosticTier; status: PageStatus; httpStatus?: number | null }
  | { type: "stop"; reason: StopReason }
  | { type: "final"; resolution: Resolution; identityMatched: boolean; presentFields: CitationDiagnosticField[]; missingFields: CitationDiagnosticField[]; conflictFields: CitationDiagnosticField[] };
export type CitationDiagnosticObserver = (event: CitationDiagnosticEvent) => void;

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
const count = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? Math.min(CITATION_DIAGNOSTIC_COUNT_LIMIT, Math.max(0, Math.floor(value))) : 0;
const httpStatus = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const enumValue = <T extends string>(values: readonly T[], value: unknown, fallback: T): T => values.includes(value as T) ? value as T : fallback;
const fields = (value: unknown): CitationDiagnosticField[] => Array.isArray(value)
  ? CITATION_DIAGNOSTIC_FIELDS.filter((field) => value.includes(field)) : [];
const union = (a: CitationDiagnosticField[], b: unknown) => fields([...a, ...fields(b)]);

/** Reads only fixed field names; the returned array cannot carry field values. */
export function citationDiagnosticPresentFields(value: Record<string, unknown>): CitationDiagnosticField[] {
  try { return CITATION_DIAGNOSTIC_FIELDS.filter((field) => Boolean(value[field])); } catch { return []; }
}

function search(value: unknown): CitationDiagnosticSearch {
  const source = object(value);
  return {
    status: enumValue(SEARCH_STATUSES, source.status, "not_started"), httpStatus: httpStatus(source.httpStatus),
    resultCount: count(source.resultCount), strongHostCount: count(source.strongHostCount), weakHostCount: count(source.weakHostCount),
    missingUrlCount: count(source.missingUrlCount), noRecordCount: count(source.noRecordCount), parsedCount: count(source.parsedCount),
    acceptedCount: count(source.acceptedCount), rejectedCount: count(source.rejectedCount),
    parsedFields: fields(source.parsedFields), acceptedFields: fields(source.acceptedFields),
  };
}

/** Reconstructs the complete wire shape, dropping unknown keys and all free text. */
export function sanitizeCitationDiagnostic(value: unknown): CitationDiagnostic | null {
  try {
    const source = object(value);
    if (source.version !== CITATION_DIAGNOSTIC_VERSION) return null;
    const searches = object(source.searches), page = object(source.page), final = object(source.final);
    return {
      version: CITATION_DIAGNOSTIC_VERSION, suppliedFields: fields(source.suppliedFields),
      searches: { tier1: search(searches.tier1), tier2: search(searches.tier2) },
      page: {
        tier: page.tier === "tier1" || page.tier === "tier2" ? page.tier : null,
        status: enumValue(PAGE_STATUSES, page.status, "not_attempted"), httpStatus: httpStatus(page.httpStatus),
        parsedCount: count(page.parsedCount), acceptedCount: count(page.acceptedCount), rejectedCount: count(page.rejectedCount),
        parsedFields: fields(page.parsedFields), acceptedFields: fields(page.acceptedFields),
      },
      stopReason: enumValue(STOP_REASONS, source.stopReason, "not_finished"),
      final: {
        resolution: enumValue(RESOLUTIONS, final.resolution, "not_finished"), identityMatched: final.identityMatched === true,
        presentFields: fields(final.presentFields), missingFields: fields(final.missingFields), conflictFields: fields(final.conflictFields),
      },
    };
  } catch { return null; }
}

/** Observers cannot affect lookup acceptance, retries, results or exceptions. */
export function safeObserveCitationDiagnostic(observer: CitationDiagnosticObserver | undefined, event: CitationDiagnosticEvent): void {
  try {
    const pending: unknown = observer?.(event);
    // A mistakenly async observer must not create an unhandled rejection either.
    if (pending && typeof (pending as PromiseLike<unknown>).then === "function") {
      void Promise.resolve(pending).catch(() => { /* Observation is always fail-open. */ });
    }
  } catch { /* Observation is always fail-open. */ }
}

export function createCitationDiagnosticCollector(): { observe: CitationDiagnosticObserver; snapshot: () => CitationDiagnostic } {
  const state = sanitizeCitationDiagnostic({ version: CITATION_DIAGNOSTIC_VERSION })!;
  const observe: CitationDiagnosticObserver = (event) => {
    try {
      switch (event.type) {
        case "input": state.suppliedFields = fields(event.fields); break;
        case "search": {
          if (event.tier !== "tier1" && event.tier !== "tier2") break;
          const target = state.searches[event.tier];
          target.status = enumValue(SEARCH_STATUSES, event.status, "not_started");
          target.httpStatus = httpStatus(event.httpStatus); target.resultCount = count(event.resultCount);
          break;
        }
        case "sources": {
          if (event.tier !== "tier1" && event.tier !== "tier2") break;
          const target = state.searches[event.tier];
          target.strongHostCount = count(event.strongHostCount); target.weakHostCount = count(event.weakHostCount);
          target.missingUrlCount = count(event.missingUrlCount); target.noRecordCount = count(event.noRecordCount);
          break;
        }
        case "record": {
          if (event.tier !== "tier1" && event.tier !== "tier2") break;
          if (event.origin !== "snippet" && event.origin !== "page") break;
          const target = event.origin === "page" ? state.page : state.searches[event.tier];
          target.parsedCount = count(target.parsedCount + 1);
          target.parsedFields = union(target.parsedFields, event.fields);
          if (event.accepted === true) {
            target.acceptedCount = count(target.acceptedCount + 1);
            target.acceptedFields = union(target.acceptedFields, event.fields);
          } else target.rejectedCount = count(target.rejectedCount + 1);
          state.final.conflictFields = union(state.final.conflictFields, event.conflicts);
          break;
        }
        case "page":
          state.page.tier = event.tier === "tier1" || event.tier === "tier2" ? event.tier : null;
          state.page.status = enumValue(PAGE_STATUSES, event.status, "not_attempted");
          if (event.httpStatus !== undefined) state.page.httpStatus = httpStatus(event.httpStatus);
          break;
        case "stop": state.stopReason = enumValue(STOP_REASONS, event.reason, "not_finished"); break;
        case "final":
          state.final = {
            resolution: enumValue(RESOLUTIONS, event.resolution, "not_finished"), identityMatched: event.identityMatched === true,
            presentFields: fields(event.presentFields), missingFields: fields(event.missingFields),
            conflictFields: union(state.final.conflictFields, event.conflictFields),
          };
          break;
      }
    } catch { /* Malformed observations never affect the caller. */ }
  };
  return { observe, snapshot: () => sanitizeCitationDiagnostic(state)! };
}
