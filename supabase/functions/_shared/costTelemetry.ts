/**
 * Privacy-safe, per-provider-attempt cost telemetry for the citation pipelines.
 *
 * - One event per actual paid-provider HTTP attempt (Perplexity chat/search,
 *   Lovable AI Gateway). Other hosts (public pages) pass through untracked.
 * - Per-request context lives in AsyncLocalStorage — never a module global —
 *   so concurrent requests in one isolate never mix.
 * - Only bounded scalars are stored: no prompts, answers, URLs, titles,
 *   headers, error bodies or user identity.
 * - Unknown usage/cost stays null (never coerced to 0).
 * - Telemetry ids are deliberately separate from the legacy billing `batchId`.
 * - Writes are batched once per request via EdgeRuntime.waitUntil and can
 *   never fail or delay the user's response.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const COST_FEATURES = ["uniform_citation", "footnotes", "bibliography", "refill", "unknown"] as const;
export type CostFeature = (typeof COST_FEATURES)[number];

export const PRICE_VERSION = "list-2026-10-v1";
const MAX_EVENTS_PER_REQUEST = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_RE = /^[a-z0-9][a-z0-9._\/-]{0,63}$/i;
const PROVIDER_REQ_ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const STAGE_RE = /^[a-z0-9_]{1,40}$/;

export interface CostEvent {
  id: string;
  function_name: string;
  feature: CostFeature;
  telemetry_request_id: string | null;
  telemetry_batch_id: string | null;
  attempt_seq: number;
  stage: string;
  provider: "perplexity" | "lovable_gateway";
  endpoint: "chat_completions" | "search";
  model: string | null;
  outcome: "ok" | "http_error" | "network_error" | "parse_error";
  http_status: number | null;
  latency_ms: number;
  provider_request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  citation_tokens: number | null;
  search_queries: number | null;
  search_context_size: "low" | "medium" | "high" | null;
  price_version: string;
  estimated_usd: number | null;
  estimate_complete: boolean;
  provider_reported_usd: number | null;
}

interface Ctx {
  functionName: string;
  feature: CostFeature;
  requestId: string | null;
  batchId: string | null;
  seq: number;
  pending: Promise<CostEvent | null>[];
}

const als = new AsyncLocalStorage<Ctx>();

export function sanitizeFeature(v: unknown): CostFeature {
  return typeof v === "string" && (COST_FEATURES as readonly string[]).includes(v) ? (v as CostFeature) : "unknown";
}
export function sanitizeUuid(v: unknown): string | null {
  return typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : null;
}

/** Attach telemetry ids from a parsed request body to the current context. */
export function setTelemetryFromBody(body: unknown, defaultFeature: CostFeature = "unknown"): void {
  const ctx = als.getStore();
  if (!ctx || !body || typeof body !== "object") return;
  const b = body as Record<string, unknown>;
  const f = sanitizeFeature(b.telemetryFeature);
  ctx.feature = f === "unknown" ? defaultFeature : f;
  ctx.requestId = sanitizeUuid(b.telemetryRequestId);
  ctx.batchId = sanitizeUuid(b.telemetryBatchId);
}

type Writer = (rows: CostEvent[]) => Promise<void>;

async function defaultWriter(rows: CostEvent[]): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || rows.length === 0) return;
  const r = await fetch(`${url}/rest/v1/ai_cost_events?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) console.warn("[cost-telemetry] write failed status", r.status);
  await r.body?.cancel().catch(() => {});
}

let writer: Writer = defaultWriter;
/** Test hook. */
export function __setCostWriter(w: Writer | null) {
  writer = w ?? defaultWriter;
}

export async function flushEvents(pending: Promise<CostEvent | null>[]): Promise<void> {
  try {
    const settled = await Promise.allSettled(pending);
    const rows = settled
      .map((s) => (s.status === "fulfilled" ? s.value : null))
      .filter((r): r is CostEvent => r !== null);
    if (rows.length) await writer(rows);
  } catch (e) {
    console.warn("[cost-telemetry] flush failed", e instanceof Error ? e.name : "error");
  }
}

function schedule(p: Promise<void>) {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(p);
  else void p;
}

/** Run a request handler with an isolated telemetry context; flush after. */
export async function withCostTelemetry<T>(
  functionName: string,
  fn: () => Promise<T>,
  opts?: { onFlush?: (p: Promise<void>) => void },
): Promise<T> {
  const ctx: Ctx = { functionName, feature: "unknown", requestId: null, batchId: null, seq: 0, pending: [] };
  try {
    return await als.run(ctx, fn);
  } finally {
    const p = flushEvents(ctx.pending);
    (opts?.onFlush ?? schedule)(p);
  }
}

function classify(url: string): { provider: CostEvent["provider"]; endpoint: CostEvent["endpoint"] } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname === "api.perplexity.ai") {
    if (u.pathname.startsWith("/search")) return { provider: "perplexity", endpoint: "search" };
    if (u.pathname.startsWith("/chat/completions")) return { provider: "perplexity", endpoint: "chat_completions" };
    return null;
  }
  if (u.hostname === "ai.gateway.lovable.dev" && u.pathname.includes("/chat/completions")) {
    return { provider: "lovable_gateway", endpoint: "chat_completions" };
  }
  return null;
}

function modelFromBody(body: unknown): string | null {
  if (typeof body !== "string" || body.length > 2_000_000) return null;
  try {
    const m = (JSON.parse(body) as Record<string, unknown>)?.model;
    return typeof m === "string" && MODEL_RE.test(m) ? m : null;
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e12 ? v : null;
}
function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

/** Public list prices (USD). null = unknown → estimate stays null/incomplete. */
const PRICES: Record<string, { inPerM: number; outPerM: number; reqPer1k: Record<"low" | "medium" | "high", number> }> = {
  sonar: { inPerM: 1, outPerM: 1, reqPer1k: { low: 5, medium: 8, high: 12 } },
  "sonar-pro": { inPerM: 3, outPerM: 15, reqPer1k: { low: 6, medium: 10, high: 14 } },
};
const SEARCH_API_PER_1K = 5;

export interface ParsedUsage {
  provider_request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  citation_tokens: number | null;
  search_queries: number | null;
  search_context_size: CostEvent["search_context_size"];
  provider_reported_usd: number | null;
}

export function parseUsage(json: unknown): ParsedUsage {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const u = (j.usage && typeof j.usage === "object" ? j.usage : {}) as Record<string, unknown>;
  const ptd = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const ctd = (u.completion_tokens_details ?? {}) as Record<string, unknown>;
  const cost = (u.cost && typeof u.cost === "object" ? u.cost : {}) as Record<string, unknown>;
  const ctx = u.search_context_size;
  const id = j.id;
  return {
    provider_request_id: typeof id === "string" && PROVIDER_REQ_ID_RE.test(id) ? id : null,
    input_tokens: int(u.prompt_tokens),
    output_tokens: int(u.completion_tokens),
    total_tokens: int(u.total_tokens),
    cached_input_tokens: int(ptd.cached_tokens),
    reasoning_tokens: int(ctd.reasoning_tokens ?? u.reasoning_tokens),
    citation_tokens: int(u.citation_tokens),
    search_queries: int(u.num_search_queries),
    search_context_size: ctx === "low" || ctx === "medium" || ctx === "high" ? ctx : null,
    provider_reported_usd: num(cost.total_cost),
  };
}

export function estimateUsd(
  provider: CostEvent["provider"],
  endpoint: CostEvent["endpoint"],
  model: string | null,
  u: ParsedUsage,
  ok: boolean,
): { estimated_usd: number | null; estimate_complete: boolean } {
  if (provider === "perplexity" && endpoint === "search") {
    return ok ? { estimated_usd: SEARCH_API_PER_1K / 1000, estimate_complete: true } : { estimated_usd: null, estimate_complete: false };
  }
  if (provider !== "perplexity" || !model || !PRICES[model] || !ok) return { estimated_usd: null, estimate_complete: false };
  const p = PRICES[model];
  if (u.input_tokens === null || u.output_tokens === null) return { estimated_usd: null, estimate_complete: false };
  let usd = (u.input_tokens * p.inPerM + u.output_tokens * p.outPerM) / 1_000_000;
  let complete = true;
  if (u.search_context_size) usd += p.reqPer1k[u.search_context_size] / 1000;
  else complete = false; // request fee tier unknown
  return { estimated_usd: Math.round(usd * 1e8) / 1e8, estimate_complete: complete };
}

function safeStage(s: string | undefined, fallback: string): string {
  return s && STAGE_RE.test(s) ? s : fallback;
}

/**
 * Drop-in fetch replacement. Records one event per attempt for paid providers
 * when called inside withCostTelemetry; otherwise behaves exactly like fetch.
 */
export async function trackedFetch(
  input: string | URL | Request,
  init?: RequestInit,
  opts?: { stage?: string },
): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const ctx = als.getStore();
  const kind = ctx ? classify(url) : null;
  if (!ctx || !kind) return fetch(input, init);

  const seq = ++ctx.seq;
  const started = Date.now();
  const model = kind.endpoint === "search" ? null : modelFromBody(init?.body);
  const stage = safeStage(opts?.stage, kind.endpoint === "search" ? "search" : (model ?? "unknown").replace(/[^a-z0-9_]/gi, "_").toLowerCase());
  const base = {
    function_name: ctx.functionName,
    feature: ctx.feature,
    telemetry_request_id: ctx.requestId,
    telemetry_batch_id: ctx.batchId,
    attempt_seq: seq,
    stage,
    provider: kind.provider,
    endpoint: kind.endpoint,
    model,
    price_version: PRICE_VERSION,
  };
  const empty: ParsedUsage = {
    provider_request_id: null, input_tokens: null, output_tokens: null, total_tokens: null,
    cached_input_tokens: null, reasoning_tokens: null, citation_tokens: null, search_queries: null,
    search_context_size: null, provider_reported_usd: null,
  };
  const push = (p: Promise<CostEvent | null>) => {
    if (ctx.pending.length < MAX_EVENTS_PER_REQUEST) ctx.pending.push(p);
  };

  let resp: Response;
  try {
    resp = await fetch(input, init);
  } catch (e) {
    push(Promise.resolve({
      id: crypto.randomUUID(), ...base, outcome: "network_error", http_status: null,
      latency_ms: Date.now() - started, ...empty, estimated_usd: null, estimate_complete: false,
    } as CostEvent));
    throw e;
  }
  const latency = Date.now() - started;
  const status = resp.status;
  const headerReqId = resp.headers.get("x-request-id");

  if (!resp.ok) {
    // Never read error bodies.
    push(Promise.resolve({
      id: crypto.randomUUID(), ...base, outcome: "http_error", http_status: status, latency_ms: latency,
      ...empty, provider_request_id: headerReqId && PROVIDER_REQ_ID_RE.test(headerReqId) ? headerReqId : null,
      estimated_usd: null, estimate_complete: false,
    } as CostEvent));
    return resp;
  }

  const ct = resp.headers.get("content-type") ?? "";
  const isStream = ct.includes("text/event-stream");
  const clone = isStream ? null : resp.clone();
  push((async () => {
    let usage = empty;
    let outcome: CostEvent["outcome"] = "ok";
    if (clone) {
      try {
        usage = parseUsage(await clone.json());
      } catch {
        outcome = "parse_error";
      }
    }
    if (!usage.provider_request_id && headerReqId && PROVIDER_REQ_ID_RE.test(headerReqId)) {
      usage = { ...usage, provider_request_id: headerReqId };
    }
    if (kind.endpoint === "search" && usage.search_queries === null && outcome === "ok") {
      usage = { ...usage, search_queries: 1 };
    }
    const est = estimateUsd(kind.provider, kind.endpoint, model, usage, outcome === "ok");
    return { id: crypto.randomUUID(), ...base, outcome, http_status: status, latency_ms: latency, ...usage, ...est } as CostEvent;
  })());
  return resp;
}
