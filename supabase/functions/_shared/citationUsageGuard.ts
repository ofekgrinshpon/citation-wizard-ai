import { citationRecoveryInput, citationRecoveryResult, type CitationRecoveryInput, type CitationRecoveryResult } from "./citationRecovery.ts";
import { AsyncLocalStorage } from "node:async_hooks";

// Separate from telemetry: a swallowed provider exception must still prevent a
// later stage's rejection from authorizing a refund for this invocation.
const providerOutcomes = new AsyncLocalStorage<{ unknown: boolean }>();
export function withCitationProviderOutcome<T>(run: () => T): T {
  return providerOutcomes.run({ unknown: false }, run);
}
export function markCitationProviderUnknown(): void {
  const state = providerOutcomes.getStore();
  if (state) state.unknown = true;
}

type ProviderContract = "none" | "formatter" | "lookup" | "search";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasKnownProviderShape(value: unknown, contract: ProviderContract): boolean {
  if (contract === "none") return true;
  if (!isRecord(value)) return false;
  if (contract === "search") return Array.isArray(value.results);
  const choice = Array.isArray(value.choices) ? value.choices[0] : null;
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : null;
  if (!message) return false;
  if (typeof message.refusal === "string" && message.refusal.trim() &&
      (message.content == null || (typeof message.content === "string" && !message.content.trim()))) return true;
  if (typeof message.content !== "string" || !message.content.trim()) return false;
  if (contract === "formatter") return true;
  // Retrieval stages promise structured metadata/no-match, not arbitrary prose.
  // This only governs refund eligibility; parsing/rendering remain unchanged.
  const object = message.content.match(/\{[\s\S]*\}/)?.[0];
  if (!object) return false;
  try {
    const parsed = JSON.parse(object.replace(/([\u0590-\u05FF])"([\u0590-\u05FF])/g, "$1\u05F4$2"));
    if (!isRecord(parsed)) return false;
    return parsed.found === false || (parsed.found === true && Object.keys(parsed).length > 1) ||
      Array.isArray(parsed.results) || typeof parsed.isPublished === "boolean" ||
      ((parsed.confidence === "high" || parsed.confidence === "low") &&
        (typeof parsed.author === "string" || typeof parsed.date === "string"));
  } catch {
    return false;
  }
}

function observeBody(response: Response, contract: ProviderContract): Response {
  return new Proxy(response, {
    get(target, property) {
      if (property === "clone") return () => {
        try { return observeBody(target.clone(), contract); }
        catch (error) { markCitationProviderUnknown(); throw error; }
      };
      if (["json", "text", "arrayBuffer", "blob", "formData"].includes(String(property))) {
        return async (...args: unknown[]) => {
          try {
            const method = Reflect.get(target, property) as (...values: unknown[]) => Promise<unknown>;
            const value = await method.apply(target, args);
            if (property === "json" && target.ok && !hasKnownProviderShape(value, contract)) markCitationProviderUnknown();
            return value;
          } catch (error) {
            markCitationProviderUnknown();
            throw error;
          }
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function observeCitationProviderFetch(run: () => Promise<Response>, contract: ProviderContract = "none"): Promise<Response> {
  try {
    const response = await run();
    // Gateway timeout/proxy failures do not prove that upstream work stopped.
    // This stays sticky even if retrieval catches the failure and continues.
    if ([0, 408, 502, 504].includes(response.status)) markCitationProviderUnknown();
    return observeBody(response, contract);
  } catch (error) {
    markCitationProviderUnknown();
    throw error;
  }
}

/** Server-owned paid execution claim. A ledger replay is never permission to run. */
export interface UsageRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
}

export type UsageOutcome = "succeeded" | "failed" | "unknown";

export interface CitationRefundReceipt {
  status: "refunded" | "retained" | "deferred" | "review_required" | "not_charged" | "not_applicable" | "unconfirmed";
  refunded: boolean;
  units_refunded: number;
  request_id: string;
}

/** Missing or contradictory billing metadata cannot confirm a refund. */
export function citationRefundReceipt(value: unknown): CitationRefundReceipt | undefined {
  if (!isRecord(value) || typeof value.request_id !== "string" || !value.request_id ||
      !["refunded", "retained", "deferred", "review_required", "not_charged", "not_applicable", "unconfirmed"].includes(String(value.status)) ||
      typeof value.refunded !== "boolean" || !Number.isSafeInteger(value.units_refunded) || Number(value.units_refunded) < 0 ||
      value.refunded !== (value.status === "refunded") || value.refunded !== (Number(value.units_refunded) > 0)) return undefined;
  return { status: value.status as CitationRefundReceipt["status"], refunded: value.refunded,
    units_refunded: Number(value.units_refunded), request_id: value.request_id };
}

/** A text-only refusal can flag review, never authorize a refund. */
export function isUnstructuredCitationRefusal(text: string): boolean {
  const value = text.trim();
  if (value.length > 220 || /\d|https?:\/\/|["״]|חוק|סעיף|פקודת|תקנות|בג["״]ץ/.test(value)) return false;
  return /^(?:(?:i\s+)?(?:am\s+)?sorry[,\s]*|מצטער[ת]?[,.\s]*)?(?:אינו יכול לפרש|לא ניתן לפרש|לא ניתן לעבד|לא נמצא טקסט משפטי|הקלט אינו ברור|הבקשה אינה ברורה|לא הצלחתי להבין|אין מספיק מידע|(?:i\s+)?cannot interpret|(?:i\s+am\s+)?unable to interpret|(?:i\s+)?could not interpret)/i.test(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** Bind every input used by this handler, but never billing to observation IDs. */
export async function citationFingerprint(input: {
  messages: unknown;
  rawInput: unknown;
  foreignLookup: unknown;
  batchId: string | null;
}): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson({ version: 1, ...input }));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function resultData(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown> : {};
}

export class CitationUsageGuard {
  private attemptToken: string | null = null;
  private terminal = false;

  constructor(
    private client: UsageRpcClient,
    private userId: string,
    private requestId: string,
  ) {}

  async begin(fingerprint: string, batchId: string | null, retryOfRequestId: string | null, recoveryInput: CitationRecoveryInput): Promise<Record<string, unknown>> {
    const input = citationRecoveryInput(recoveryInput);
    if (!input || input.batchId !== batchId || await citationFingerprint(input) !== fingerprint) {
      return { ok: false, execute: false, error: "INVALID_RECOVERY_INPUT" };
    }
    const { data, error } = await this.client.rpc("begin_citation_request", {
      _user_id: this.userId,
      _request_id: this.requestId,
      _fingerprint: fingerprint,
      _batch_id: batchId,
      _retry_of_request_id: retryOfRequestId,
      _recovery_input: input,
    });
    const result = resultData(data);
    // A timeout/ambiguous RPC result may already have committed a claim. Fail
    // closed, without a compensating refund or a second begin attempt.
    if (error || result.ok !== true) return { ...result, ok: false, execute: false };
    if (result.execute === true && result.status === "in_progress" &&
        result.request_id === this.requestId && result.retry_of_request_id === retryOfRequestId &&
        typeof result.attempt_token === "string" && result.attempt_token.length > 0) {
      this.attemptToken = result.attempt_token;
      return result;
    }
    return { ...result, execute: false };
  }

  async finish(outcome: UsageOutcome, reason: string, response?: CitationRecoveryResult): Promise<{ confirmed: boolean; refunded: boolean; refundReceipt?: CitationRefundReceipt }> {
    if (!this.attemptToken || this.terminal) return { confirmed: false, refunded: false };
    // No second local terminal decision, including if the RPC result is lost.
    this.terminal = true;
    const resultPayload = outcome === "succeeded" ? citationRecoveryResult(response) : null;
    const invalidResult = outcome === "succeeded" && resultPayload === null;
    const effectiveOutcome = invalidResult || (outcome === "failed" && providerOutcomes.getStore()?.unknown) ? "unknown" : outcome;
    try {
      const { data, error } = await this.client.rpc("finish_citation_request", {
        _user_id: this.userId,
        _request_id: this.requestId,
        _attempt_token: this.attemptToken,
        _outcome: effectiveOutcome,
        _reason: invalidResult ? "recovery_result_invalid" : effectiveOutcome !== outcome ? "upstream_provider_outcome_unknown" : reason,
        _result: resultPayload,
      });
      const result = resultData(data);
      const confirmed = !error && result.ok === true && result.status === outcome && effectiveOutcome === outcome &&
        (outcome !== "succeeded" || result.result_stored === true);
      const receipt = confirmed && outcome === "failed" ? citationRefundReceipt(result.refund_receipt) : undefined;
      const consistentReceipt = receipt && receipt.refunded === (result.refunded === true) ? receipt : undefined;
      return { confirmed, refunded: consistentReceipt?.refunded === true,
        ...(consistentReceipt ? { refundReceipt: consistentReceipt } : {}) };
    } catch {
      return { confirmed: false, refunded: false };
    }
  }
}
