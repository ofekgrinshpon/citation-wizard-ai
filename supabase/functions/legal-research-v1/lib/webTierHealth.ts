// research_richness_execution_unblock_v1 — fix 1: web-tier health.
//
// Every outbound web/provider call (Perplexity retrieval, official source
// discovery) is recorded here so a broken web tier fails LOUDLY instead of
// silently degrading into "no results". Nothing in this module retrieves,
// admits or cites anything; it is pure observability plus a deterministic
// error classifier shared by the web stages.

export const WEB_TIER_HEALTH_VERSION = "research_richness_execution_unblock_v1";

export type WebEndpointType = "direct_provider" | "gateway" | "disabled_or_misconfigured";

export type WebFailureClass =
  | "ok"
  | "missing_credentials"
  | "quota_exhausted"
  | "invalid_credentials"
  | "forbidden"
  | "rate_limited"
  | "bad_request"
  | "server_error"
  | "timeout"
  | "network_error"
  | "unknown_error";

/**
 * Deterministic, credential-safe classification of a web-tier outcome.
 * `body` is the provider's error body; it is never stored, only inspected.
 */
export function classifyWebFailure(
  status: number | null | undefined,
  body?: string | null,
): WebFailureClass {
  const b = String(body ?? "").toLowerCase();
  if (status == null || status === 0) {
    if (/abort|timeout|timed out/.test(b)) return "timeout";
    return "network_error";
  }
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 402) {
    if (b.includes("insufficient_quota") || b.includes("exceeded your current quota")) {
      return "quota_exhausted";
    }
    return status === 402 ? "quota_exhausted" : "invalid_credentials";
  }
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "server_error";
  if (status >= 400) return "bad_request";
  return "unknown_error";
}

/** Human-safe one-line explanation. Never contains credentials or URLs. */
export function safeErrorMessage(cls: WebFailureClass): string {
  switch (cls) {
    case "ok":
      return "ok";
    case "missing_credentials":
      return "web_tier_disabled_or_misconfigured: no web provider credential is configured";
    case "quota_exhausted":
      return "web_tier_disabled_or_misconfigured: provider credential is valid but the API quota/credits are exhausted";
    case "invalid_credentials":
      return "web_tier_disabled_or_misconfigured: provider rejected the credential (401)";
    case "forbidden":
      return "web_tier_blocked: provider returned 403";
    case "rate_limited":
      return "web_tier_rate_limited: provider returned 429";
    case "timeout":
      return "web_tier_timeout: provider did not answer in time";
    case "network_error":
      return "web_tier_network_error: the call never reached the provider";
    case "server_error":
      return "web_tier_provider_error: provider returned 5xx";
    case "bad_request":
      return "web_tier_request_error: provider rejected the request payload";
    default:
      return "web_tier_unknown_error";
  }
}

export interface WebTierHealth {
  version: string;
  provider: string;
  endpoint_type: WebEndpointType;
  calls_attempted: number;
  calls_succeeded: number;
  calls_failed: number;
  http_statuses: Record<string, number>;
  failure_classes: Record<string, number>;
  avg_ms: number;
  safe_error_class: WebFailureClass;
  safe_error_message: string;
  /** True when *every* attempted call failed for a credential/quota reason. */
  disabled_or_misconfigured: boolean;
}

interface CallRecord {
  status: number | null;
  ms: number;
  cls: WebFailureClass;
}

const calls: CallRecord[] = [];
let endpointOverride: WebEndpointType | null = null;

export function resetWebTierHealth(): void {
  calls.length = 0;
  endpointOverride = null;
}

export function noteWebEndpointType(t: WebEndpointType): void {
  endpointOverride = t;
}

export function recordWebCall(input: {
  status: number | null;
  ms: number;
  body?: string | null;
  failure_class?: WebFailureClass;
}): WebFailureClass {
  const cls = input.failure_class ?? classifyWebFailure(input.status, input.body);
  calls.push({ status: input.status ?? null, ms: Math.max(0, input.ms | 0), cls });
  return cls;
}

export function currentEndpointType(): WebEndpointType {
  if (endpointOverride) return endpointOverride;
  // The workspace Perplexity connection is a direct (non-gateway) API key:
  // the provider endpoint is called directly with PERPLEXITY_API_KEY.
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  return env?.get("PERPLEXITY_API_KEY") ? "direct_provider" : "disabled_or_misconfigured";
}

export function getWebTierHealth(): WebTierHealth {
  const endpoint_type = currentEndpointType();
  const http_statuses: Record<string, number> = {};
  const failure_classes: Record<string, number> = {};
  let succeeded = 0;
  let totalMs = 0;
  for (const c of calls) {
    const k = c.status == null ? "network" : String(c.status);
    http_statuses[k] = (http_statuses[k] ?? 0) + 1;
    failure_classes[c.cls] = (failure_classes[c.cls] ?? 0) + 1;
    if (c.cls === "ok") succeeded++;
    totalMs += c.ms;
  }
  const attempted = calls.length;
  const failed = attempted - succeeded;
  // Dominant non-ok class, or missing credentials when nothing was even tried.
  let dominant: WebFailureClass = "ok";
  let best = 0;
  for (const [k, n] of Object.entries(failure_classes)) {
    if (k === "ok") continue;
    if (n > best) {
      best = n;
      dominant = k as WebFailureClass;
    }
  }
  if (attempted === 0 && endpoint_type === "disabled_or_misconfigured") {
    dominant = "missing_credentials";
  }
  const credentialClasses: WebFailureClass[] = [
    "missing_credentials",
    "quota_exhausted",
    "invalid_credentials",
  ];
  return {
    version: WEB_TIER_HEALTH_VERSION,
    provider: "perplexity",
    endpoint_type: endpoint_type === "disabled_or_misconfigured"
      ? "disabled_or_misconfigured"
      : (succeeded === 0 && attempted > 0 && credentialClasses.includes(dominant)
        ? "disabled_or_misconfigured"
        : endpoint_type),
    calls_attempted: attempted,
    calls_succeeded: succeeded,
    calls_failed: failed,
    http_statuses,
    failure_classes,
    avg_ms: attempted ? Math.round(totalMs / attempted) : 0,
    safe_error_class: dominant,
    safe_error_message: safeErrorMessage(dominant),
    disabled_or_misconfigured: attempted > 0 && succeeded === 0 &&
        credentialClasses.includes(dominant) ||
      (attempted === 0 && endpoint_type === "disabled_or_misconfigured"),
  };
}

/** True when the web tier is known-unusable — callers must not pretend "no results". */
export function webTierUsable(): boolean {
  const h = getWebTierHealth();
  return !h.disabled_or_misconfigured;
}
