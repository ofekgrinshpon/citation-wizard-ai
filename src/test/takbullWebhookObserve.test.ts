import { describe, expect, it, vi } from "vitest";
import { handleTakbullHostedWebhook } from "../../supabase/functions/takbull-hosted-webhook/handler";
import { OBSERVE_LOG_MARKER, REF_ALIASES, isWindowOpen, parseObserveConfig, projectPayload } from "../../supabase/functions/takbull-hosted-webhook/observe";

const CLOSED = { error: "TAKBULL_WEBHOOK_NOT_READY", activated: false, grantedSources: 0 };
const NOW = Date.parse("2026-11-12T10:10:00.000Z");
const RUN = "run_20261112_a";
const REF = "ord_8f3a2c1d9e";
const cfgRaw = (over: Record<string, unknown> = {}) => JSON.stringify({
  start: "2026-11-12T10:00:00Z", end: "2026-11-12T10:30:00Z", runMarker: RUN, expectedPageId: "3CxDl", expectedOrderRef: REF, ...over,
});
const cfg = parseObserveConfig(cfgRaw(), NOW)!;

const SENSITIVE = {
  name: "Dana Levi Secretname", email: "dana.secret@example.com", phone: "0541234567", address: "12 Herzl St Secretcity",
  card: "4580123412341234", cvv: "987", token: "tok_SECRETTOKEN123", idNumber: "039999999", bank: "IL620108000000099999999",
  url: "https://evil.example/steal?x=1", ref: REF, txn: "TXN-778899-SECRET",
};
const callbackBody = JSON.stringify({
  event: 20, status: "1", amount: "1.00", currency: "ILS", pageId: "3CxDl", order_reference: SENSITIVE.ref,
  transactionInternalNumber: SENSITIVE.txn, customerName: SENSITIVE.name, CustomerEmail: SENSITIVE.email, phone: SENSITIVE.phone,
  address: SENSITIVE.address, cardNumber: SENSITIVE.card, cvv: SENSITIVE.cvv, token: SENSITIVE.token, idNumber: SENSITIVE.idNumber,
  iban: SENSITIVE.bank, redirectUrl: SENSITIVE.url, "__proto__": { polluted: true },
  data: { status: 2, cardNumber: SENSITIVE.card, deep: { email: SENSITIVE.email, status: 99 } },
  [`evil_${SENSITIVE.email}`]: SENSITIVE.token,
});

function post(body: BodyInit | null, headers: Record<string, string> = { "Content-Type": "application/json" }, method = "POST") {
  return new Request("https://example.functions/takbull-hosted-webhook?status=success&email=" + encodeURIComponent(SENSITIVE.email), {
    method, headers: { Authorization: `Bearer ${SENSITIVE.token}`, Cookie: SENSITIVE.token, ...headers }, body: method === "GET" ? undefined : body,
  });
}
async function run(r: Request, raw: string | undefined = cfgRaw(), extra: Partial<Parameters<typeof handleTakbullHostedWebhook>[1]> = {}) {
  const log = vi.fn();
  const res = await handleTakbullHostedWebhook(r, { readConfig: () => raw, log, now: () => NOW, limits: { maxBytes: 16 * 1024, timeoutMs: 50 }, ...extra });
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual(CLOSED);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  return log;
}
const parsedLine = (log: ReturnType<typeof vi.fn>) => {
  expect(log).toHaveBeenCalledTimes(1);
  const line = log.mock.calls[0][0] as string;
  expect(line.startsWith(`${OBSERVE_LOG_MARKER} ${RUN} {`)).toBe(true);
  return { line, obj: JSON.parse(line.slice(`${OBSERVE_LOG_MARKER} ${RUN} `.length)) };
};
const assertNoSensitive = (line: string) => {
  for (const v of Object.values(SENSITIVE)) expect(line).not.toContain(v);
  for (const k of ["customerName", "CustomerEmail", "cardNumber", "evil_", "polluted", "deep", "Bearer", "redirectUrl", "order_reference", "transactionInternalNumber"]) expect(line).not.toContain(k);
};

describe("takbull-hosted-webhook observation: dormant by default", () => {
  it("without deps or config: no body read, no log, closed response", async () => {
    const r1 = post(callbackBody);
    const res = await handleTakbullHostedWebhook(r1);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(CLOSED);
    expect(r1.bodyUsed).toBe(false);
    for (const raw of [undefined, "", "null"]) {
      const r = post(callbackBody);
      const log = await run(r, undefined, { readConfig: () => raw });
      expect(log).not.toHaveBeenCalled();
      expect(r.bodyUsed).toBe(false);
    }
  });

  it("future, expired, malformed and overlong windows stay dormant", async () => {
    const bad = [
      cfgRaw({ start: "2026-11-12T10:20:00Z", end: "2026-11-12T10:40:00Z" }), // future
      cfgRaw({ start: "2026-11-12T09:00:00Z", end: "2026-11-12T09:30:00Z" }), // expired
      cfgRaw({ start: "2026-11-12T10:00:00Z", end: "2026-11-12T10:10:00Z" }), // end == now is closed
      cfgRaw({ start: "2026-11-12T10:00:00Z", end: "2026-11-12T10:30:01Z" }), // > 30 minutes
      cfgRaw({ start: "2026-11-12T10:30:00Z", end: "2026-11-12T10:00:00Z" }), // reversed
      cfgRaw({ start: "2026-11-12 10:00", end: "2026-11-12T10:30:00Z" }),
      cfgRaw({ start: "2026-02-30T10:00:00Z", end: "2026-02-30T10:20:00Z" }),
      cfgRaw({ expectedPageId: "other" }), cfgRaw({ expectedPageId: undefined }),
      cfgRaw({ runMarker: "bad marker!" }), cfgRaw({ runMarker: "short" }), cfgRaw({ runMarker: "x".repeat(41) }),
      cfgRaw({ expectedOrderRef: "has space ref" }), cfgRaw({ extra: 1 }),
      "{not json", "[]", "x".repeat(2000),
    ];
    for (const raw of bad) {
      expect(parseObserveConfig(raw, NOW)).toBeNull();
      const r = post(callbackBody);
      const log = await run(r, raw);
      expect(log).not.toHaveBeenCalled();
      expect(r.bodyUsed).toBe(false);
    }
  });

  it("a throwing config reader stays closed with no read or log", async () => {
    const r = post(callbackBody);
    const log = await run(r, undefined, { readConfig: () => { throw new Error(SENSITIVE.token); } });
    expect(log).not.toHaveBeenCalled();
    expect(r.bodyUsed).toBe(false);
  });
});

describe("takbull-hosted-webhook observation: armed", () => {
  it("projects only allowlisted fields; sensitive values, keys, headers and URL never appear", async () => {
    const { line, obj } = parsedLine(await run(post(callbackBody)));
    assertNoSensitive(line);
    expect(obj.outcome).toBe("projected");
    expect(obj.method).toBe("POST");
    expect(obj.contentType).toBe("json");
    expect(obj.note).toContain("not payment proof");
    const f = obj.projection.fields;
    expect(f.event).toEqual({ type: "number", code: 20 });
    expect(f.status).toEqual({ type: "string", code: 1 });
    expect(f.amount).toEqual({ type: "string", amount: 1 });
    expect(f.currency).toEqual({ type: "string", currency: "ILS" });
    expect(f.pageId).toEqual({ type: "string", equalsExpected: true });
    expect(f.orderReference).toEqual({ type: "string", equalsExpected: true });
    expect(f.transactionId).toEqual({ type: "string" });
    expect(f["data.status"]).toEqual({ type: "number", code: 2 });
    expect(Object.keys(f).sort()).toEqual(["amount", "currency", "data.status", "event", "orderReference", "pageId", "status", "transactionId"]);
    expect(obj.projection.wrappers).toEqual(["data"]);
    expect(obj.projection.unknownKeyCount).toBeGreaterThan(5);
  });

  it("odd values are reduced to type only or 'unrecognized'", () => {
    const p = projectPayload({ status: SENSITIVE.email, amount: "1e3", currency: SENSITIVE.token, pageId: 3, orderRef: "ord_other_123", event: 1.5 }, cfg);
    expect(p.fields.status).toEqual({ type: "string" });
    expect(p.fields.amount).toEqual({ type: "string" });
    expect(p.fields.currency).toEqual({ type: "string", currency: "unrecognized" });
    expect(p.fields.pageId).toEqual({ type: "number", equalsExpected: false });
    expect(p.fields.orderRef).toEqual({ type: "string", equalsExpected: false });
    expect(p.fields.event).toEqual({ type: "number" });
    const noRef = projectPayload({ orderRef: REF }, parseObserveConfig(cfgRaw({ expectedOrderRef: undefined }), NOW)!);
    expect(noRef.fields.orderRef).toEqual({ type: "string" });
  });

  it("arrays, scalars and huge key sets are bounded", () => {
    expect(projectPayload([1, 2], cfg)).toMatchObject({ shape: "array", fields: {}, unknownKeyCount: 0 });
    expect(projectPayload("x", cfg).shape).toBe("scalar");
    const many = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`k${i}`, SENSITIVE.email]));
    const p = projectPayload(many, cfg);
    expect(p.unknownKeyCount).toBe(999);
    expect(JSON.stringify(p)).not.toContain(SENSITIVE.email);
  });

  it("wrong method and non-JSON content types log an outcome without reading the body", async () => {
    const g = post(null, {}, "GET");
    expect(parsedLine(await run(g)).obj).toMatchObject({ outcome: "method_not_post", method: "GET", projection: null });
    const form = post("event=20&email=" + SENSITIVE.email, { "Content-Type": "application/x-www-form-urlencoded" });
    const { line, obj } = parsedLine(await run(form));
    expect(obj).toMatchObject({ outcome: "not_json_content_type", contentType: "form", bytes: null });
    expect(form.bodyUsed).toBe(false);
    assertNoSensitive(line);
    const put = post(callbackBody, { "Content-Type": "application/json" }, "PUT");
    expect(parsedLine(await run(put)).obj.outcome).toBe("method_not_post");
    expect(put.bodyUsed).toBe(false);
  });

  it("oversize, stalled, malformed, empty and invalid UTF-8 bodies log only the outcome", async () => {
    const big = JSON.stringify({ event: 20, pad: "a".repeat(17 * 1024), email: SENSITIVE.email });
    expect(parsedLine(await run(post(big))).obj.outcome).toBe("too_large");
    const declared = post(callbackBody, { "Content-Type": "application/json", "Content-Length": "999999" });
    expect(parsedLine(await run(declared)).obj.outcome).toBe("too_large");

    const enc = new TextEncoder();
    const chunked = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(enc.encode("a".repeat(4096))); } });
    const streamBig = new Request("https://x/", { method: "POST", headers: { "Content-Type": "application/json" }, body: chunked, duplex: "half" } as RequestInit);
    expect(parsedLine(await run(streamBig)).obj.outcome).toBe("too_large");

    const stalled = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(`{"email":"${SENSITIVE.email}"`)); } });
    const stalledReq = new Request("https://x/", { method: "POST", headers: { "Content-Type": "application/json" }, body: stalled, duplex: "half" } as RequestInit);
    const s = parsedLine(await run(stalledReq));
    expect(s.obj.outcome).toBe("timeout");
    assertNoSensitive(s.line);

    const bad = parsedLine(await run(post(`{"email":"${SENSITIVE.email}",`)));
    expect(bad.obj).toMatchObject({ outcome: "invalid_json", projection: null });
    assertNoSensitive(bad.line);
    expect(parsedLine(await run(post(""))).obj.outcome).toBe("empty");
    expect(parsedLine(await run(post(new Uint8Array([0x7b, 0xff, 0x7d])))).obj.outcome).toBe("invalid_utf8");
  });

  it("logging failure still returns the exact closed response", async () => {
    const log = vi.fn(() => { throw new Error("log sink down"); });
    await run(post(callbackBody), cfgRaw(), { log });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("replayed callbacks are harmless: every delivery is 503, grants 0 and only adds a line", async () => {
    const log = vi.fn();
    for (let i = 0; i < 3; i++) await run(post(callbackBody), cfgRaw(), { log });
    expect(log).toHaveBeenCalledTimes(3);
    expect(new Set(log.mock.calls.map((c) => c[0])).size).toBe(1);
  });
});

describe("takbull-hosted-webhook observation: distinct reference aliases", () => {
  const CID = "cust_55667788";
  const ORDER_ID = "TK-20261112-0042";

  it("c_id, orderId and order_reference keep separate fixed labels; one matches, two do not", async () => {
    const body = JSON.stringify({ c_id: CID, orderId: ORDER_ID, order_reference: REF, event: 20 });
    const { line, obj } = parsedLine(await run(post(body)));
    const f = obj.projection.fields;
    expect(f.cId).toEqual({ type: "string", equalsExpected: false });
    expect(f.orderId).toEqual({ type: "string", equalsExpected: false });
    expect(f.orderReference).toEqual({ type: "string", equalsExpected: true });
    expect(f.orderRef).toBeUndefined();
    expect(obj.projection.repeatedKnownKeys).toBe(0);
    expect(obj.projection.unknownKeyCount).toBe(0);
    for (const v of [CID, ORDER_ID, REF, "c_id", "order_reference"]) expect(line).not.toContain(v);
  });

  it("the match follows whichever alias carries the expected reference", () => {
    const p = projectPayload({ c_id: REF, orderId: ORDER_ID, order_reference: CID }, cfg);
    expect(p.fields.cId.equalsExpected).toBe(true);
    expect(p.fields.orderId.equalsExpected).toBe(false);
    expect(p.fields.orderReference.equalsExpected).toBe(false);
  });

  it("every allowlisted alias has its own label; different spellings of one alias are duplicates", () => {
    const labels = REF_ALIASES.map(([l]) => l);
    expect(new Set(labels).size).toBe(labels.length);
    const all = projectPayload(Object.fromEntries(REF_ALIASES.map(([, k]) => [k, ORDER_ID])), cfg);
    expect(Object.keys(all.fields).sort()).toEqual([...labels].sort());
    expect(all.repeatedKnownKeys).toBe(0);
    const dup = projectPayload({ order_reference: REF, OrderReference: CID, "order-reference": CID }, cfg);
    expect(Object.keys(dup.fields)).toEqual(["orderReference"]);
    expect(dup.fields.orderReference.equalsExpected).toBe(true);
    expect(dup.repeatedKnownKeys).toBe(2);
  });

  it("malicious unknown keys near the aliases are counted, never emitted", async () => {
    const evil = {
      c_id_evil: REF, cid2: REF, "orderId<script>": REF, [`orderId_${SENSITIVE.email}`]: REF, order_reference_x: REF,
      constructor: REF, toString: REF, hasOwnProperty: REF, ["x".repeat(80)]: REF, ["__proto__"]: { orderId: REF },
    };
    const { line, obj } = parsedLine(await run(post(JSON.stringify(evil))));
    expect(obj.projection.fields).toEqual({});
    expect(obj.projection.unknownKeyCount).toBe(Object.keys(JSON.parse(JSON.stringify(evil))).length);
    for (const k of ["c_id_evil", "cid2", "<script>", SENSITIVE.email, "order_reference_x", "constructor", "toString", "hasOwnProperty", "xxxxxxxx", "proto", REF]) expect(line).not.toContain(k);
  });
});

describe("takbull-hosted-webhook observation: window rechecked after the body read", () => {
  const END = Date.parse("2026-11-12T10:30:00.000Z");
  const enc = new TextEncoder();
  // Body arrives in two chunks; the clock moves to `after` between them, i.e. during the read.
  function slowBody(clock: { t: number }, after: number) {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent === 0) { c.enqueue(enc.encode(`{"order_reference":"${REF}",`)); sent++; return; }
        clock.t = after;
        c.enqueue(enc.encode(`"event":20}`));
        c.close();
      },
    });
    return new Request("https://x/", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  }

  it("a read that crosses the end time logs nothing and returns the closed 503", async () => {
    for (const after of [END, END + 1, END + 60_000]) {
      const clock = { t: END - 1 };
      const r = slowBody(clock, after);
      const log = await run(r, cfgRaw(), { now: () => clock.t });
      expect(r.bodyUsed).toBe(true);
      expect(log).not.toHaveBeenCalled();
    }
  });

  it("a read that finishes just before the end time still logs", async () => {
    const clock = { t: END - 10 };
    const log = await run(slowBody(clock, END - 1), cfgRaw(), { now: () => clock.t });
    expect(parsedLine(log).obj.projection.fields.orderReference).toEqual({ type: "string", equalsExpected: true });
  });

  it("a bad clock after the read (NaN, backwards before start, throwing) logs nothing", async () => {
    const clocks: Array<() => number> = [
      () => Number.NaN, () => Number.POSITIVE_INFINITY, () => Date.parse("2026-11-12T09:59:59.000Z"),
      () => { throw new Error("clock down"); },
    ];
    for (const second of clocks) {
      let calls = 0;
      const log = await run(post(callbackBody), cfgRaw(), { now: () => (calls++ === 0 ? NOW : second()) });
      expect(calls).toBe(2);
      expect(log).not.toHaveBeenCalled();
    }
    expect(isWindowOpen(cfg, "1" as unknown)).toBe(false);
  });

  it("the recheck also applies to outcomes that never read the body", async () => {
    let calls = 0;
    const log = await run(post(null, {}, "GET"), cfgRaw(), { now: () => (calls++ === 0 ? NOW : END) });
    expect(log).not.toHaveBeenCalled();
  });
});
