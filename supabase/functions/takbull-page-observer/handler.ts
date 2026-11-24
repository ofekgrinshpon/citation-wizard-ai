const MAX_BYTES = 16_384;
const MAX_AGE_MS = 300_000;
const MAX_FUTURE_MS = 30_000;
const encoder = new TextEncoder();

type Observation = {
  marker: "TAKBULL_PAGE_OBSERVATION_V1";
  flatReference: boolean;
  transactionId: boolean;
  orderId: boolean;
  amount: "39" | "65" | "other" | "absent";
  currency: "ILS" | "other" | "absent";
  statusFields: boolean;
};
type Deps = {
  readActive: () => boolean;
  readPageKey: () => string | undefined;
  record: (entry: Observation) => void;
  now?: () => number;
  timeoutMs?: number;
};

const reply = (status: number) => new Response(null, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

function parseHeader(value: string | null) {
  if (!value || value.length > 128) return null;
  const m = /^t=([0-9]{10}),[ \t]*v1=([0-9a-f]{64})$/.exec(value);
  if (!m) return null;
  const mac = new Uint8Array(32);
  for (let i = 0; i < 32; i++) mac[i] = Number.parseInt(m[2].slice(i * 2, i * 2 + 2), 16);
  return { t: m[1], signedAt: Number(m[1]) * 1000, mac };
}

async function readBody(req: Request, timeout: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const len = req.headers.get("content-length");
  if (!req.body || (len !== null && (!/^\d{1,6}$/.test(len) || Number(len) > MAX_BYTES))) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const expire = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeout); });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), expire]);
      if (!next) { void reader.cancel().catch(() => {}); return null; }
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_BYTES) { void reader.cancel().catch(() => {}); return null; }
      chunks.push(next.value);
    }
    if (!length || (len !== null && length !== Number(len))) return null;
    const all = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
    return all;
  } finally { if (timer !== undefined) clearTimeout(timer); reader.releaseLock(); }
}

function classify(x: unknown): Observation | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const has = (k: string) => Object.hasOwn(o, k);
  return {
    marker: "TAKBULL_PAGE_OBSERVATION_V1",
    flatReference: typeof o.ExternalCustomerId === "string" && /^rlx_[0-9a-f]{32}$/.test(o.ExternalCustomerId),
    transactionId: has("TransactionId"),
    orderId: has("OrderNumber"),
    amount: !has("OrderTotalSum") ? "absent" : o.OrderTotalSum === 39 ? "39" : o.OrderTotalSum === 65 ? "65" : "other",
    currency: !has("Currency") ? "absent" : o.Currency === "ILS" ? "ILS" : "other",
    statusFields: has("OrderStatus") && has("StatusCode"),
  };
}

export function createTakbullPageObserver(deps: Deps) {
  // Warm-isolate bounded diagnostics only. Not durable event dedupe/settlement.
  const observed = new Set<string>();
  const now = deps.now ?? Date.now;
  const fresh = (t: number) => {
    const instant = now();
    return Number.isFinite(instant) && instant - t <= MAX_AGE_MS && t - instant <= MAX_FUTURE_MS;
  };
  return async (req: Request): Promise<Response> => {
    try {
      if (deps.readActive() !== true) return reply(404);
      const key = deps.readPageKey();
      if (typeof key !== "string" || key.length < 32 || key.length > 256) return reply(404);
      if (req.method !== "POST") return reply(405);
      if (req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" ||
          ![null, "identity"].includes(req.headers.get("content-encoding"))) return reply(415);
      const entry = parseHeader(req.headers.get("x-takbull-signature"));
      if (!entry || !fresh(entry.signedAt)) return reply(401);
      const bytes = await readBody(req, deps.timeoutMs ?? 2500);
      if (!bytes || !fresh(entry.signedAt)) return reply(401);
      const prefix = encoder.encode(entry.t + ".");
      const signed = new Uint8Array(prefix.length + bytes.length);
      signed.set(prefix); signed.set(bytes, prefix.length);
      const verifier = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
      if (!await crypto.subtle.verify("HMAC", verifier, entry.mac, signed) || !fresh(entry.signedAt)) return reply(401);
      if (deps.readActive() !== true || deps.readPageKey() !== key) return reply(404);
      let projected: Observation | null;
      try { projected = classify(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes))); }
      catch { return reply(400); }
      if (projected) {
        const category = JSON.stringify(projected);
        if (observed.size < 64 && !observed.has(category)) {
          observed.add(category);
          try { deps.record(projected); } catch { /* no retries based on logging */ }
        }
      }
      // Authenticated delivery ack only. Never an order, access grant, or receipt verification.
      return reply(204);
    } catch { return reply(503); }
  };
}
