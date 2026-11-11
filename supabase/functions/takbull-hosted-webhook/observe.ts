/**
 * Dormant, time-bounded OBSERVATION of a Takbull callback's shape.
 *
 * This is NOT payment verification. An observation line cannot authenticate a
 * payment, never grants access, and duplicate or replayed deliveries simply
 * produce more lines (there are no DB, provider or entitlement side effects).
 *
 * Off unless a single server config value holds a valid window that is open
 * right now (start <= now < end, at most 30 minutes long). Otherwise the caller
 * must not read the body or log anything.
 *
 * While armed, at most one bounded JSON body is read and reduced to a strict
 * allowlisted projection: our own fixed field labels, value types, normalized
 * numeric codes, a canonical amount, a recognized currency, and booleans for
 * "page id equals the expected page" / "reference equals the expected one".
 * Attacker-supplied key names and string values are never emitted; unknown
 * keys become a bounded count. Headers, URLs and the raw body are never used.
 */

export const OBSERVE_LOG_MARKER = "TAKBULL_OBSERVE_V1";
export const OBSERVE_EXPECTED_PAGE_ID = "3CxDl";
export const OBSERVE_MAX_WINDOW_MS = 30 * 60 * 1000;
export const OBSERVE_MAX_BODY_BYTES = 16 * 1024;
export const OBSERVE_READ_TIMEOUT_MS = 3000;
const MAX_CONFIG_CHARS = 1024;
const MAX_KEYS_SCANNED = 200;
const MAX_UNKNOWN_COUNT = 999;

export interface ObserveConfig {
  startMs: number;
  endMs: number;
  runMarker: string;
  expectedPageId: typeof OBSERVE_EXPECTED_PAGE_ID;
  expectedOrderRef: string | null;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const RUN_MARKER = /^[A-Za-z0-9_-]{8,40}$/;
const ORDER_REF = /^[A-Za-z0-9_-]{8,128}$/;
const CONFIG_KEYS = new Set(["start", "end", "runMarker", "expectedPageId", "expectedOrderRef"]);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Parses the raw config. Any malformed, future, expired or overlong window returns null. */
export function parseObserveConfig(raw: unknown, nowMs: number): ObserveConfig | null {
  try {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_CONFIG_CHARS) return null;
    if (!Number.isFinite(nowMs)) return null;
    const v: unknown = JSON.parse(raw);
    if (!isPlainObject(v)) return null;
    for (const k of Object.keys(v)) if (!CONFIG_KEYS.has(k)) return null;
    const { start, end, runMarker, expectedPageId, expectedOrderRef } = v;
    if (typeof start !== "string" || typeof end !== "string" || !ISO_UTC.test(start) || !ISO_UTC.test(end)) return null;
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
    if (new Date(startMs).toISOString().slice(0, 19) !== start.slice(0, 19)) return null; // rejects 2026-02-30 etc.
    if (new Date(endMs).toISOString().slice(0, 19) !== end.slice(0, 19)) return null;
    if (endMs <= startMs || endMs - startMs > OBSERVE_MAX_WINDOW_MS) return null;
    if (nowMs < startMs || nowMs >= endMs) return null;
    if (typeof runMarker !== "string" || !RUN_MARKER.test(runMarker)) return null;
    if (expectedPageId !== OBSERVE_EXPECTED_PAGE_ID) return null;
    let ref: string | null = null;
    if (expectedOrderRef !== undefined) {
      if (typeof expectedOrderRef !== "string" || !ORDER_REF.test(expectedOrderRef)) return null;
      ref = expectedOrderRef;
    }
    return { startMs, endMs, runMarker, expectedPageId: OBSERVE_EXPECTED_PAGE_ID, expectedOrderRef: ref };
  } catch {
    return null;
  }
}

export type ReadOutcome =
  | { ok: true; text: string; bytes: number }
  | { ok: false; outcome: "too_large" | "timeout" | "read_error" | "invalid_utf8" | "empty" };

/** Reads at most maxBytes from the body within timeoutMs. Never returns partial content on failure. */
export async function readBoundedBody(req: Request, maxBytes: number, timeoutMs: number): Promise<ReadOutcome> {
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^\d{1,9}$/.test(declared) || Number(declared) > maxBytes)) return { ok: false, outcome: "too_large" };
  if (!req.body) return { ok: false, outcome: "empty" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
  try {
    for (;;) {
      const step = await Promise.race([reader.read(), deadline]);
      if (step === "timeout") { reader.cancel().catch(() => {}); return { ok: false, outcome: "timeout" }; }
      if (step.done) break;
      total += step.value.byteLength;
      if (total > maxBytes) { reader.cancel().catch(() => {}); return { ok: false, outcome: "too_large" }; }
      chunks.push(step.value);
    }
  } catch {
    return { ok: false, outcome: "read_error" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (total === 0) return { ok: false, outcome: "empty" };
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(buf), bytes: total };
  } catch {
    return { ok: false, outcome: "invalid_utf8" };
  }
}

type FieldKind = "code" | "amount" | "currency" | "pageId" | "orderRef" | "txnId";

/** Normalized key (lowercase, no _ - or spaces) -> our own fixed label + kind. */
const FIELD_MAP: Record<string, { label: string; kind: FieldKind }> = (() => {
  const m: Record<string, { label: string; kind: FieldKind }> = {};
  const add = (label: string, kind: FieldKind, keys: string[]) => { for (const k of keys) m[k] = { label, kind }; };
  add("event", "code", ["event", "eventtype", "eventid", "eventcode"]);
  add("status", "code", ["status", "statuscode", "statusid", "transactionstatus", "dealstatus"]);
  add("responseCode", "code", ["responsecode", "resultcode", "returncode", "errorcode"]);
  add("amount", "amount", ["amount", "sum", "total", "totalamount", "dealamount", "transactionamount"]);
  add("currency", "currency", ["currency", "currencycode", "coin"]);
  add("pageId", "pageId", ["pageid", "hostedpageid", "pagecode", "pageuniqid", "paymentpageid"]);
  add("orderRef", "orderRef", ["orderreference", "orderref", "orderid", "ordernumber", "reference", "customerreference", "externalid", "uniqid", "cid"]);
  add("transactionId", "txnId", ["transactionid", "transactioninternalnumber", "transactionnumber", "dealid", "dealnumber"]);
  return m;
})();

/** Bounded wrapper keys whose direct children are also projected (one level only). */
const WRAPPERS: Record<string, string> = { data: "data", transaction: "transaction", order: "order", payload: "payload", result: "result" };

const CURRENCIES: Record<string, string> = { ils: "ILS", nis: "ILS", "376": "ILS", usd: "USD", "840": "USD", eur: "EUR", "978": "EUR", gbp: "GBP", "826": "GBP" };

const normKey = (k: string) => (k.length > 64 ? "" : k.toLowerCase().replace(/[\s_-]/g, ""));
const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v);

function projectValue(kind: FieldKind, v: unknown, cfg: ObserveConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { type: typeOf(v) };
  if (kind === "code") {
    const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : "") : typeof v === "string" ? v.trim() : "";
    if (/^-?\d{1,6}$/.test(s)) out.code = Number(s);
  } else if (kind === "amount") {
    const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : typeof v === "string" ? v.trim() : "";
    if (/^\d{1,7}(\.\d{1,2})?$/.test(s)) out.amount = Number(s);
  } else if (kind === "currency") {
    const s = typeof v === "number" && Number.isInteger(v) ? String(v) : typeof v === "string" ? v.trim().toLowerCase() : "";
    out.currency = s.length <= 4 && Object.prototype.hasOwnProperty.call(CURRENCIES, s) ? CURRENCIES[s] : "unrecognized";
  } else if (kind === "pageId") {
    out.equalsExpected = typeof v === "string" && v === cfg.expectedPageId;
  } else if (kind === "orderRef") {
    if (cfg.expectedOrderRef !== null) {
      const s = typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
      out.equalsExpected = s !== null && s === cfg.expectedOrderRef;
    }
  }
  // txnId: presence/type only.
  return out;
}

export interface Projection {
  shape: "object" | "array" | "scalar";
  fields: Record<string, Record<string, unknown>>;
  wrappers: string[];
  repeatedKnownKeys: number;
  unknownKeyCount: number;
}

export function projectPayload(value: unknown, cfg: ObserveConfig): Projection {
  const p: Projection = { shape: isPlainObject(value) ? "object" : Array.isArray(value) ? "array" : "scalar", fields: {}, wrappers: [], repeatedKnownKeys: 0, unknownKeyCount: 0 };
  if (!isPlainObject(value)) return p;
  let scanned = 0;
  const visit = (obj: Record<string, unknown>, prefix: string, allowWrappers: boolean) => {
    for (const key of Object.keys(obj)) {
      if (++scanned > MAX_KEYS_SCANNED) { p.unknownKeyCount++; continue; }
      const nk = normKey(key);
      const child = obj[key];
      const wrapper = allowWrappers && Object.prototype.hasOwnProperty.call(WRAPPERS, nk) ? WRAPPERS[nk] : null;
      if (wrapper && isPlainObject(child) && !p.wrappers.includes(wrapper)) {
        p.wrappers.push(wrapper);
        visit(child, `${wrapper}.`, false);
        continue;
      }
      const f = Object.prototype.hasOwnProperty.call(FIELD_MAP, nk) ? FIELD_MAP[nk] : null;
      if (!f) { p.unknownKeyCount++; continue; }
      const label = prefix + f.label;
      if (p.fields[label]) { p.repeatedKnownKeys++; continue; }
      p.fields[label] = projectValue(f.kind, child, cfg);
    }
  };
  visit(value, "", true);
  p.unknownKeyCount = Math.min(p.unknownKeyCount, MAX_UNKNOWN_COUNT);
  return p;
}

export type ObserveOutcome =
  | "projected" | "method_not_post" | "not_json_content_type" | "too_large" | "timeout"
  | "read_error" | "invalid_utf8" | "empty" | "invalid_json";

const methodLabel = (m: string) => (["GET", "POST", "PUT", "HEAD", "OPTIONS"].includes(m) ? m : "OTHER");
export function contentTypeLabel(ct: string | null): "json" | "form" | "multipart" | "text" | "other" | "absent" {
  if (ct === null || ct.trim() === "") return "absent";
  const base = ct.split(";")[0].trim().toLowerCase();
  if (base === "application/json" || base.endsWith("+json")) return "json";
  if (base === "application/x-www-form-urlencoded") return "form";
  if (base === "multipart/form-data") return "multipart";
  if (base === "text/plain") return "text";
  return "other";
}

/** Builds the single sanitized log line. Only fixed labels, enums, numbers and booleans. */
export function buildObserveLine(cfg: ObserveConfig, method: string, contentType: string | null, outcome: ObserveOutcome, bytes: number | null, projection: Projection | null): string {
  return `${OBSERVE_LOG_MARKER} ${cfg.runMarker} ` + JSON.stringify({
    marker: OBSERVE_LOG_MARKER,
    run: cfg.runMarker,
    note: "observation only; not payment proof; grants nothing; duplicates possible",
    method: methodLabel(method),
    contentType: contentTypeLabel(contentType),
    outcome,
    bytes,
    projection,
  });
}

/** Full armed observation for one request. Returns the line to log (never throws). */
export async function observeRequest(req: Request, cfg: ObserveConfig, limits = { maxBytes: OBSERVE_MAX_BODY_BYTES, timeoutMs: OBSERVE_READ_TIMEOUT_MS }): Promise<string> {
  const ct = req.headers.get("content-type");
  if (req.method !== "POST") return buildObserveLine(cfg, req.method, ct, "method_not_post", null, null);
  if (contentTypeLabel(ct) !== "json") return buildObserveLine(cfg, req.method, ct, "not_json_content_type", null, null);
  const read = await readBoundedBody(req, limits.maxBytes, limits.timeoutMs);
  if (read.ok === false) return buildObserveLine(cfg, req.method, ct, read.outcome, null, null);
  let parsed: unknown;
  try { parsed = JSON.parse(read.text); } catch { return buildObserveLine(cfg, req.method, ct, "invalid_json", read.bytes, null); }
  return buildObserveLine(cfg, req.method, ct, "projected", read.bytes, projectPayload(parsed, cfg));
}
