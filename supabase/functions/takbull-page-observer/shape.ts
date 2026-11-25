// Diagnostic request shape for takbull-page-observer. Logs names, sizes and
// types only — never header values (except a fixed allowlist of non-secret
// transport headers), query values, body values, signatures or keys.
const MAX_BYTES = 16_384;
const SAFE_HEADER_VALUES = new Set(["content-type", "content-encoding", "content-length", "user-agent", "accept"]);
const SIGNATURE_LIKE = /sign|hmac|auth|takbull|webhook|token|secret/i;
const SIG_FORMAT = /^t=[0-9]{10},[ \t]*v1=[0-9a-f]{64}$/;
const name = (s: string) => s.slice(0, 64);
const kind = (v: unknown) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

export type RequestShape = {
  marker: "TAKBULL_PAGE_REQUEST_SHAPE_V1";
  method: string;
  url: string; // origin + path, query values removed
  queryKeys: string[];
  headerNames: string[];
  safeHeaderValues: Record<string, string>;
  signatureLikeHeaders: { name: string; length: number; matchesTakbullFormat: boolean }[];
  body: { bytes: number | null; truncated: boolean; json: boolean; topLevelType: string | null; keys: Record<string, string> };
};

async function readBounded(req: Request, timeoutMs: number) {
  if (!req.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0, truncated = false, timer: ReturnType<typeof setTimeout> | undefined;
  const expire = new Promise<null>(r => { timer = setTimeout(() => r(null), timeoutMs); });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), expire]);
      if (!next) { truncated = true; break; }
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_BYTES) { truncated = true; break; }
      chunks.push(next.value);
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let o = 0; for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  return { bytes: all, truncated, total: length };
}

export async function describeRequest(req: Request, timeoutMs = 2500): Promise<RequestShape> {
  const u = new URL(req.url);
  const headerNames: string[] = [];
  const safeHeaderValues: Record<string, string> = {};
  const signatureLikeHeaders: RequestShape["signatureLikeHeaders"] = [];
  for (const [k, v] of req.headers) {
    const n = name(k.toLowerCase());
    if (headerNames.length < 60) headerNames.push(n);
    if (SAFE_HEADER_VALUES.has(n)) safeHeaderValues[n] = v.slice(0, 120);
    if (SIGNATURE_LIKE.test(n) && signatureLikeHeaders.length < 10) {
      signatureLikeHeaders.push({ name: n, length: v.length, matchesTakbullFormat: SIG_FORMAT.test(v) });
    }
  }
  headerNames.sort();
  const queryKeys = [...new Set([...u.searchParams.keys()].map(name))].slice(0, 30);
  const body: RequestShape["body"] = { bytes: null, truncated: false, json: false, topLevelType: null, keys: {} };
  try {
    const read = await readBounded(req, timeoutMs);
    body.bytes = read.total ?? read.bytes.byteLength;
    body.truncated = read.truncated;
    if (!read.truncated && read.bytes.byteLength) {
      try {
        const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes));
        body.json = true;
        body.topLevelType = kind(parsed);
        if (body.topLevelType === "object") {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>).slice(0, 80)) body.keys[name(k)] = kind(v);
        }
      } catch { /* not JSON */ }
    }
  } catch { /* body unreadable */ }
  return { marker: "TAKBULL_PAGE_REQUEST_SHAPE_V1", method: req.method, url: u.origin + u.pathname, queryKeys, headerNames, safeHeaderValues, signatureLikeHeaders, body };
}
