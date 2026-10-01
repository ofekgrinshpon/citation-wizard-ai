/**
 * Privacy-safe, per-provider-attempt cost telemetry for the citation pipelines.
 *
 * - One event per actual paid-provider HTTP attempt (Perplexity chat/search,
 *   Lovable AI Gateway). Other hosts (public pages) pass through untracked.
 * - Zero-work events (cache hits, deterministic/no-provider paths) are
 *   metadata-only: event_kind != provider_attempt, provider = "none".
 * - Per-request context lives in AsyncLocalStorage — never a module global.
 * - Only bounded scalars are stored: no prompts, answers, URLs, titles,
 *   headers, error bodies or user identity.
 * - Unknown usage/cost stays null (never coerced to 0). estimated_usd is a
 *   list-price ESTIMATE; provider_reported_usd is what the provider's response
 *   reported — neither is an invoice-reconciled bill.
 * - Telemetry ids are deliberately separate from the legacy billing `batchId`.
 * - Telemetry reads only a CLONE of the response, bounded by bytes and time;
 *   on a cap only the clone is cancelled. Writes are grouped once per request
 *   via EdgeRuntime.waitUntil, with a deadline and bounded retries using the
 *   same stable event ids (ignore-duplicates), and can never fail or delay the
 *   user's response.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const COST_FEATURES = ["uniform_citation", "footnotes", "bibliography", "refill", "unknown"] as const;
export type CostFeature = (typeof COST_FEATURES)[number];

/**
 * Price table version.
 * - Perplexity Sonar / Sonar Pro chat: NO estimate. Per
 *   https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview
 *   Sonar support ended 2026-09-27 and calls are being reformulated as Agent
 *   API; current applicable billing is unverified → null / incomplete.
 *   usage.cost.total_cost is still kept as provider_reported_usd.
 * - Perplexity Search: $0.005 per successful POST /search request (not per
 *   query; up to 5 queries/request; failed/rate-limited not billed), per
 *   https://docs.perplexity.ai/docs/getting-started/pricing
 * - Gemini (via Lovable AI Gateway): Google standard text list prices from
 *   https://ai.google.dev/gemini-api/docs/pricing (verified by reviewer
 *   2026-10-01). Gateway billing is based on provider costs but exact billed
 *   equivalence is unproven → always estimate_complete = false.
 */
export const PRICE_VERSION = "list-2026-10-01-v2";
const MAX_EVENTS_PER_REQUEST = 200;
export const BODY_BYTE_CAP = 4 * 1024 * 1024;
export const BODY_TIME_CAP_MS = 120_000;
export const FLUSH_DEADLINE_MS = 10_000;
export const WRITE_TIMEOUT_MS = 5_000;
export const WRITE_MAX_RETRIES = 2;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_RE = /^[a-z0-9][a-z0-9._\/-]{0,63}$/i;
const PROVIDER_REQ_ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;

/** Bounded stage enum: actual call sites only. */
export const COST_STAGES = [
  "classifier", "formatter", "verify_source",
  "case_retrieval_tier1", "case_retrieval_tier2",
  "case_party_retrieval_tier1", "case_party_retrieval_tier2",
  "case_publication_check", "case_date_check", "old_docket_retry",
  "legislation_retrieval", "regulation_retrieval",
  "book_retrieval_tier1", "book_retrieval_tier2",
  "article_retrieval_tier1", "article_retrieval_tier2",
  "decision_retrieval_tier1", "decision_retrieval_tier2",
  "author_check", "biblio_fallback",
  "foreign_search_tier1", "foreign_search_tier2",
  "refill_tier1", "refill_tier2",
  // zero-work layers
  "client_verified_store", "server_verified_store", "local_foreign_formatter", "footnote_import",
  "unspecified",
] as const;
export type CostStage = (typeof COST_STAGES)[number];
export const ZERO_WORK_LAYERS = ["client_verified_store", "server_verified_store", "local_foreign_formatter", "footnote_import"] as const;
export type ZeroWorkLayer = (typeof ZERO_WORK_LAYERS)[number];

export type CaptureStatus =
  | "complete" | "body_byte_cap" | "body_time_cap" | "parse_error" | "read_error"
  | "error_body_unread" | "stream_unread" | "flush_deadline" | "not_applicable";

export interface CostEvent {
  id: string;
  function_name: string;
  feature: CostFeature;
  telemetry_request_id: string | null;
  telemetry_batch_id: string | null;
  attempt_seq: number;
  stage: CostStage;
  event_kind: "provider_attempt" | "cache_hit" | "deterministic";
  origin: "server_observed" | "client_reported";
  provider: "perplexity" | "lovable_gateway" | "none";
  endpoint: "chat_completions" | "search" | "none";
  model: string | null;
  requested_model: string | null;
  response_model: string | null;
  outcome: "ok" | "http_error" | "network_error" | "parse_error" | "capture_incomplete";
  http_status: number | null;
  /** Time to response headers (legacy column; kept NOT NULL). */
  latency_ms: number;
  header_latency_ms: number | null;
  /** Full upstream completion incl. body; null when not captured. */
  completion_latency_ms: number | null;
  latency_complete: boolean;
  capture_status: CaptureStatus;
  provider_request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  citation_tokens: number | null;
  /** Provider-reported number of search queries (null if not reported). */
  search_queries: number | null;
  /** Billable request count (search: 1 per successful POST). */
  request_count: number | null;
  search_context_size: "low" | "medium" | "high" | null;
  price_version: string;
  estimated_usd: number | null;
  estimate_complete: boolean;
  provider_reported_usd: number | null;
}

interface Pending {
  fallback: CostEvent;
  promise: Promise<CostEvent | null>;
}

interface Ctx {
  functionName: string;
  feature: CostFeature;
  requestId: string | null;
  batchId: string | null;
  seq: number;
  pending: Pending[];
  dropped: number;
}

const als = new AsyncLocalStorage<Ctx>();

export function sanitizeFeature(v: unknown): CostFeature {
  return typeof v === "string" && (COST_FEATURES as readonly string[]).includes(v) ? (v as CostFeature) : "unknown";
}
export function sanitizeUuid(v: unknown): string | null {
  return typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : null;
}
export function sanitizeStage(v: unknown): CostStage {
  return typeof v === "string" && (COST_STAGES as readonly string[]).includes(v) ? (v as CostStage) : "unspecified";
}

/**
 * Attach telemetry ids from a parsed request body to the current context.
 * Callers without telemetry ids stay feature "unknown" (no default guessing).
 */
export function setTelemetryFromBody(body: unknown, defaultFeature: CostFeature = "unknown"): void {
  try {
    const ctx = als.getStore();
    if (!ctx || !body || typeof body !== "object") return;
    const b = body as Record<string, unknown>;
    ctx.requestId = sanitizeUuid(b.telemetryRequestId);
    ctx.batchId = sanitizeUuid(b.telemetryBatchId);
    const f = sanitizeFeature(b.telemetryFeature);
    // A default feature only applies when the caller actually sent telemetry ids.
    ctx.feature = f !== "unknown" ? f : ctx.requestId ? defaultFeature : "unknown";
  } catch { /* never throw into the handler */ }
}

type Writer = (rows: CostEvent[]) => Promise<void>;
type RawWriter = (rows: CostEvent[], signal: AbortSignal) => Promise<{ ok: boolean; status: number }>;

const defaultRawWriter: RawWriter = async (rows, signal) => {
  // deno-lint-ignore no-explicit-any
  const env = (globalThis as any).Deno?.env;
  const url = env?.get("SUPABASE_URL");
  const key = env?.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return { ok: true, status: 0 };
  const r = await fetch(`${url}/rest/v1/ai_cost_events?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
    signal,
  });
  await r.body?.cancel().catch(() => {});
  return { ok: r.ok, status: r.status };
};

let rawWriter: RawWriter = defaultRawWriter;
let retryDelayMs = 250;

/**
 * Deadline-bounded write with at most WRITE_MAX_RETRIES transient retries.
 * Same rows (same stable ids) on every retry; the table ignores duplicates.
 */
export async function writeWithRetry(rows: CostEvent[]): Promise<{ attempts: number; ok: boolean }> {
  let attempts = 0;
  for (let i = 0; i <= WRITE_MAX_RETRIES; i++) {
    attempts++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WRITE_TIMEOUT_MS);
    let transient = false;
    try {
      const r = await Promise.race([
        rawWriter(rows, ctrl.signal),
        new Promise<never>((_, rej) => ctrl.signal.addEventListener("abort", () => rej(new Error("timeout")))),
      ]);
      if (r.ok) return { attempts, ok: true };
      transient = r.status === 429 || r.status >= 500;
      console.warn("[cost-telemetry] write failed status", r.status);
    } catch {
      transient = true;
      console.warn("[cost-telemetry] write error/timeout");
    } finally {
      clearTimeout(timer);
    }
    if (!transient) break;
    if (i < WRITE_MAX_RETRIES) await new Promise((r) => setTimeout(r, retryDelayMs * (i + 1)));
  }
  return { attempts, ok: false };
}

let writer: Writer = async (rows) => { await writeWithRetry(rows); };
/** Test hooks. */
export function __setCostWriter(w: Writer | null) {
  writer = w ?? (async (rows) => { await writeWithRetry(rows); });
}
export function __setRawWriter(w: RawWriter | null, delayMs = 250) {
  rawWriter = w ?? defaultRawWriter;
  retryDelayMs = delayMs;
}

export async function flushEvents(pending: Pending[], deadlineMs = FLUSH_DEADLINE_MS): Promise<void> {
  try {
    if (!pending.length) return;
    const results: (CostEvent | null)[] = pending.map(() => null);
    const done = pending.map(() => false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(pending.map((p, i) => p.promise.then(
        (v) => { results[i] = v; done[i] = true; },
        () => { done[i] = true; },
      ))),
      new Promise<void>((r) => { timer = setTimeout(r, deadlineMs); }),
    ]);
    if (timer) clearTimeout(timer);
    // Never silently drop: unresolved/failed captures are recorded as incomplete.
    const rows = pending.map((p, i) => results[i] ?? { ...p.fallback, capture_status: done[i] ? "read_error" : "flush_deadline" } as CostEvent);
    await writer(rows);
  } catch (e) {
    console.warn("[cost-telemetry] flush failed", e instanceof Error ? e.name : "error");
  }
}

function schedule(p: Promise<void>) {
  try {
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt && typeof rt.waitUntil === "function") rt.waitUntil(p);
    else void p;
  } catch { /* ignore */ }
}

/** Run a request handler with an isolated telemetry context; flush after. */
export async function withCostTelemetry<T>(
  functionName: string,
  fn: () => Promise<T>,
  opts?: { onFlush?: (p: Promise<void>) => void },
): Promise<T> {
  const ctx: Ctx = { functionName, feature: "unknown", requestId: null, batchId: null, seq: 0, pending: [], dropped: 0 };
  try {
    return await als.run(ctx, fn);
  } finally {
    if (ctx.dropped) console.warn("[cost-telemetry] events over cap", ctx.dropped);
    const p = flushEvents(ctx.pending);
    (opts?.onFlush ?? schedule)(p);
  }
}

function classify(url: string): { provider: "perplexity" | "lovable_gateway"; endpoint: "chat_completions" | "search" } | null {
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

function safeModel(m: unknown): string | null {
  return typeof m === "string" && MODEL_RE.test(m) ? m : null;
}
function modelFromBody(body: unknown): string | null {
  if (typeof body !== "string" || body.length > 2_000_000) return null;
  try {
    return safeModel((JSON.parse(body) as Record<string, unknown>)?.model);
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

/** Google list prices (USD per 1M tokens). Output INCLUDES thinking tokens. */
const GEMINI_PRICES: Record<string, { inPerM: number; outPerM: number; cachedPerM: number }> = {
  "google/gemini-2.5-flash": { inPerM: 0.30, outPerM: 2.50, cachedPerM: 0.03 },
  "google/gemini-3-flash-preview": { inPerM: 0.50, outPerM: 3.00, cachedPerM: 0.05 },
};
const SEARCH_USD_PER_REQUEST = 0.005;

export interface ParsedUsage {
  provider_request_id: string | null;
  response_model: string | null;
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

export const EMPTY_USAGE: ParsedUsage = {
  provider_request_id: null, response_model: null, input_tokens: null, output_tokens: null, total_tokens: null,
  cached_input_tokens: null, reasoning_tokens: null, citation_tokens: null, search_queries: null,
  search_context_size: null, provider_reported_usd: null,
};

export function parseUsage(json: unknown): ParsedUsage {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const u = (j.usage && typeof j.usage === "object" ? j.usage : {}) as Record<string, unknown>;
  const ptd = (u.prompt_tokens_details && typeof u.prompt_tokens_details === "object" ? u.prompt_tokens_details : {}) as Record<string, unknown>;
  const ctd = (u.completion_tokens_details && typeof u.completion_tokens_details === "object" ? u.completion_tokens_details : {}) as Record<string, unknown>;
  const cost = (u.cost && typeof u.cost === "object" ? u.cost : {}) as Record<string, unknown>;
  const ctx = u.search_context_size;
  const id = j.id;
  return {
    provider_request_id: typeof id === "string" && PROVIDER_REQ_ID_RE.test(id) ? id : null,
    response_model: safeModel(j.model),
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
  const none = { estimated_usd: null, estimate_complete: false };
  if (!ok) return none;
  if (provider === "perplexity" && endpoint === "search") {
    // Request-priced; independent of reported query count.
    return { estimated_usd: SEARCH_USD_PER_REQUEST, estimate_complete: true };
  }
  if (provider === "lovable_gateway" && model && GEMINI_PRICES[model]) {
    const p = GEMINI_PRICES[model];
    if (u.input_tokens === null || u.output_tokens === null) return none;
    // completion_tokens already include reasoning — never add reasoning again.
    const cached = u.cached_input_tokens !== null ? Math.min(u.cached_input_tokens, u.input_tokens) : 0;
    const usd = ((u.input_tokens - cached) * p.inPerM + cached * p.cachedPerM + u.output_tokens * p.outPerM) / 1_000_000;
    return { estimated_usd: Math.round(usd * 1e8) / 1e8, estimate_complete: false };
  }
  // Perplexity Sonar chat and anything else: unverified current billing.
  return none;
}

/** Read a response clone bounded by bytes and time; cancels only the clone. */
export async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  byteCap = BODY_BYTE_CAP,
  timeCapMs = BODY_TIME_CAP_MS,
): Promise<{ status: "complete" | "body_byte_cap" | "body_time_cap" | "read_error"; text: string | null }> {
  if (!body) return { status: "complete", text: "" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), timeCapMs); });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), timeout]);
      if (next === "timeout") {
        reader.cancel().catch(() => {});
        return { status: "body_time_cap", text: null };
      }
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > byteCap) {
        reader.cancel().catch(() => {});
        return { status: "body_byte_cap", text: null };
      }
      chunks.push(next.value);
    }
    const all = new Uint8Array(bytes);
    let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.byteLength; }
    return { status: "complete", text: new TextDecoder().decode(all) };
  } catch {
    reader.cancel().catch(() => {});
    return { status: "read_error", text: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pushPending(ctx: Ctx, p: Pending) {
  if (ctx.pending.length < MAX_EVENTS_PER_REQUEST) ctx.pending.push(p);
  else ctx.dropped++;
}

/**
 * Record a zero-provider (cache / deterministic) event on the server. Never
 * creates provider calls; does not alter results.
 */
export function recordZeroWork(layer: ZeroWorkLayer, kind: "cache_hit" | "deterministic" = "cache_hit"): void {
  try {
    const ctx = als.getStore();
    if (!ctx) return;
    const ev = zeroWorkEvent({
      functionName: ctx.functionName, feature: ctx.feature, requestId: ctx.requestId, batchId: ctx.batchId,
      seq: ++ctx.seq, layer, kind, origin: "server_observed",
    });
    pushPending(ctx, { fallback: ev, promise: Promise.resolve(ev) });
  } catch { /* ignore */ }
}

export function zeroWorkEvent(a: {
  id?: string; functionName: string; feature: CostFeature; requestId: string | null; batchId: string | null;
  seq: number; layer: ZeroWorkLayer; kind: "cache_hit" | "deterministic"; origin: CostEvent["origin"];
}): CostEvent {
  return {
    id: a.id ?? crypto.randomUUID(), function_name: a.functionName, feature: a.feature,
    telemetry_request_id: a.requestId, telemetry_batch_id: a.batchId, attempt_seq: a.seq,
    stage: a.layer, event_kind: a.kind, origin: a.origin, provider: "none", endpoint: "none",
    model: null, requested_model: null, response_model: null, outcome: "ok", http_status: null,
    latency_ms: 0, header_latency_ms: null, completion_latency_ms: null, latency_complete: false,
    capture_status: "not_applicable", ...EMPTY_USAGE, request_count: 0, price_version: PRICE_VERSION,
    estimated_usd: 0, estimate_complete: true,
  } as CostEvent;
}

/**
 * Drop-in fetch replacement. Records one event per attempt for paid providers
 * when called inside withCostTelemetry; otherwise behaves exactly like fetch.
 * Telemetry failures never alter the returned Response or throw.
 */
export async function trackedFetch(
  input: string | URL | Request,
  init?: RequestInit,
  opts?: { stage?: CostStage },
): Promise<Response> {
  let ctx: Ctx | undefined;
  let kind: ReturnType<typeof classify> = null;
  try {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    ctx = als.getStore();
    kind = ctx ? classify(url) : null;
  } catch { kind = null; }
  if (!ctx || !kind) return fetch(input, init);

  let base: Omit<CostEvent, "id"> | null = null;
  const started = Date.now();
  try {
    const seq = ++ctx.seq;
    const requested = kind.endpoint === "search" ? null : modelFromBody(init?.body);
    base = {
      function_name: ctx.functionName, feature: ctx.feature,
      telemetry_request_id: ctx.requestId, telemetry_batch_id: ctx.batchId,
      attempt_seq: seq, stage: sanitizeStage(opts?.stage), event_kind: "provider_attempt",
      origin: "server_observed", provider: kind.provider, endpoint: kind.endpoint,
      model: requested, requested_model: requested, response_model: null,
      outcome: "capture_incomplete", http_status: null, latency_ms: 0, header_latency_ms: null,
      completion_latency_ms: null, latency_complete: false, capture_status: "read_error",
      ...EMPTY_USAGE, request_count: null, price_version: PRICE_VERSION,
      estimated_usd: null, estimate_complete: false,
    };
  } catch { base = null; }

  let resp: Response;
  try {
    resp = await fetch(input, init);
  } catch (e) {
    if (base) {
      const ev = { id: crypto.randomUUID(), ...base, outcome: "network_error", latency_ms: Date.now() - started, capture_status: "not_applicable" } as CostEvent;
      pushPending(ctx, { fallback: ev, promise: Promise.resolve(ev) });
    }
    throw e;
  }
  if (!base) return resp;

  try {
    const headerLatency = Date.now() - started;
    const hdrId = resp.headers.get("x-request-id");
    const headerReqId = hdrId && PROVIDER_REQ_ID_RE.test(hdrId) ? hdrId : null;
    const id = crypto.randomUUID();
    const b = { ...base, http_status: resp.status, latency_ms: headerLatency, header_latency_ms: headerLatency, provider_request_id: headerReqId };

    if (!resp.ok) {
      // Never read error bodies. Not billed → request_count 0 for search.
      const ev = { id, ...b, outcome: "http_error", capture_status: "error_body_unread", request_count: kind.endpoint === "search" ? 0 : null } as CostEvent;
      pushPending(ctx, { fallback: ev, promise: Promise.resolve(ev) });
      return resp;
    }

    const fallback = { id, ...b } as CostEvent;
    const isStream = (resp.headers.get("content-type") ?? "").includes("text/event-stream");
    if (isStream) {
      pushPending(ctx, { fallback, promise: Promise.resolve({ ...fallback, outcome: "ok", capture_status: "stream_unread" } as CostEvent) });
      return resp;
    }
    let clone: Response | null = null;
    try { clone = resp.clone(); } catch { clone = null; }
    const k = kind;
    const promise = (async (): Promise<CostEvent> => {
      if (!clone) return fallback;
      const read = await readBounded(clone.body);
      if (read.status !== "complete" || read.text === null) {
        return { ...fallback, capture_status: read.status };
      }
      const completion = Date.now() - started;
      let usage = EMPTY_USAGE;
      let parsed = true;
      try { usage = parseUsage(JSON.parse(read.text)); } catch { parsed = false; }
      if (!usage.provider_request_id && headerReqId) usage = { ...usage, provider_request_id: headerReqId };
      // Search billing depends on HTTP success, not on our ability to parse.
      const est = estimateUsd(k.provider, k.endpoint, b.requested_model, usage, k.endpoint === "search" ? true : parsed);
      return {
        ...fallback, ...usage,
        outcome: parsed ? "ok" : "parse_error",
        capture_status: parsed ? "complete" : "parse_error",
        completion_latency_ms: completion, latency_complete: true,
        request_count: k.endpoint === "search" ? 1 : null,
        ...est,
      } as CostEvent;
    })().catch(() => fallback);
    pushPending(ctx, { fallback, promise });
  } catch { /* telemetry never affects the response */ }
  return resp;
}
