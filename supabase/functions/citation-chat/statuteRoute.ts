/**
 * Stage 4 — typed statute lookup boundary shared by the production handler
 * (citation-chat/index.ts) and its tests.
 *
 * A typed statute request ALWAYS terminates here with a typed result: missing
 * credentials, thrown/timeout errors, empty or malformed results and invalid
 * requests become honest error states. It never falls through to the generic
 * model, never retries, and never fabricates fields or a success signal.
 * Billing/refund semantics are owned by the caller and unchanged.
 */
import type { ForeignLookupInput, ForeignLookupResult, LookupDeps } from "./foreignLookup.ts";

export const STATUTE_RESPONSE_VERSION = 1 as const;
const MAX_RAW = 2000;
const MAX_FIELD = 500;
const FIELD_ALLOWLIST = new Set(["statuteName", "titleNumber", "code", "section", "sections", "year", "chapter"]);

export type StatuteLookupError =
  | "invalid_statute_request"
  | "missing_perplexity_credentials"
  | "lookup_failed"
  | "empty_result";

export type StatuteLookupResponse = ForeignLookupResult & { statuteResponseVersion: typeof STATUTE_RESPONSE_VERSION };

export function isStatuteLookupRequest(request: unknown): boolean {
  return !!request && typeof request === "object" && (request as { kind?: unknown }).kind === "statute";
}

/** Strict request contract. Returns the validated input or null (invalid). */
export function validateStatuteRequest(request: unknown): ForeignLookupInput | null {
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const r = request as Record<string, unknown>;
  if (r.enabled !== true || r.kind !== "statute" || r.statuteResponseVersion !== STATUTE_RESPONSE_VERSION) return null;
  if (r.jurisdiction !== "US" && r.jurisdiction !== "UK" && r.jurisdiction !== "UNKNOWN") return null;
  if (typeof r.rawInput !== "string" || !r.rawInput.trim() || r.rawInput.length > MAX_RAW) return null;
  if (r.parsedFields !== undefined && (!r.parsedFields || typeof r.parsedFields !== "object" || Array.isArray(r.parsedFields))) return null;
  const parsedFields: Record<string, string> = {};
  for (const [k, v] of Object.entries((r.parsedFields ?? {}) as Record<string, unknown>)) {
    if (!FIELD_ALLOWLIST.has(k)) continue;
    if (typeof v !== "string" || v.length > MAX_FIELD) return null;
    if (v.trim()) parsedFields[k] = v.trim();
  }
  return { kind: "statute", jurisdiction: r.jurisdiction, rawInput: r.rawInput, parsedFields };
}

function typedFailure(input: Pick<ForeignLookupInput, "jurisdiction"> | null, error: StatuteLookupError): StatuteLookupResponse {
  return {
    statuteResponseVersion: STATUTE_RESPONSE_VERSION,
    kind: "statute",
    jurisdiction: input?.jurisdiction ?? "UNKNOWN",
    fields: {}, grounded: {}, provenance: {}, sources: [],
    identity: { matched: false, anchors: [], conflicts: [] },
    diagnostics: { tier1Queried: false, tier2Fired: false },
    error,
  };
}

function wellFormed(r: unknown): r is ForeignLookupResult {
  if (!r || typeof r !== "object") return false;
  const x = r as ForeignLookupResult;
  return x.kind === "statute" && !!x.identity && typeof x.identity.matched === "boolean" &&
    Array.isArray(x.identity.conflicts) && !!x.fields && typeof x.fields === "object";
}

export interface StatuteRouteDeps extends LookupDeps {
  runLookup: (input: ForeignLookupInput, deps?: LookupDeps) => Promise<ForeignLookupResult>;
  /** Called once when the provider outcome is uncertain (thrown/timeout). */
  onProviderUnknown?: () => void;
  onError?: (error: unknown) => void;
}

/** Terminal typed resolution of a statute request. Never throws. */
export async function resolveStatuteLookup(request: unknown, deps: StatuteRouteDeps): Promise<StatuteLookupResponse> {
  const input = validateStatuteRequest(request);
  if (!input) return typedFailure(null, "invalid_statute_request");
  if (!deps.apiKey) return typedFailure(input, "missing_perplexity_credentials");
  let result: ForeignLookupResult | null | undefined;
  try {
    result = await deps.runLookup(input, {
      apiKey: deps.apiKey,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.diagnosticObserver ? { diagnosticObserver: deps.diagnosticObserver } : {}),
    });
  } catch (error) {
    deps.onProviderUnknown?.();
    deps.onError?.(error);
    return typedFailure(input, "lookup_failed");
  }
  if (!wellFormed(result)) return typedFailure(input, "empty_result");
  if (result.error) {
    return { ...typedFailure(input, result.error === "missing_perplexity_credentials" ? result.error : "lookup_failed"), sources: result.sources ?? [] };
  }
  return { ...result, statuteResponseVersion: STATUTE_RESPONSE_VERSION };
}
