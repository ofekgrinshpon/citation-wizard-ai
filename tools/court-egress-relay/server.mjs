/**
 * official_court_egress_path_v1 — minimal relay.
 *
 * Run this on a host whose IP the Israeli courts server answers (a small VPS,
 * ideally with an Israeli IP). It fetches ONE public official court document
 * URL per request and streams the bytes back. Nothing else.
 *
 *   PORT=8787 RELAY_TOKEN=<long-random-string> node server.mjs
 *
 * Guarantees enforced here as well as on the ReLex side:
 *   - only https URLs on *.court.gov.il;
 *   - bearer-token required;
 *   - GET only, 25 MB cap, 30 s timeout, 1 in-flight request, ≥1 s spacing;
 *   - no cookies, no login, no CAPTCHA solving, no crawling, no link following.
 */
import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.RELAY_TOKEN || "";
const ALLOW = /(^|\.)court\.gov\.il$/i;
const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const MIN_SPACING_MS = 1_000;

if (!TOKEN) {
  console.error("RELAY_TOKEN is required");
  process.exit(1);
}

let busy = false;
let lastAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const deny = (res, code, msg) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: msg }));
};

http.createServer(async (req, res) => {
  if (req.method !== "GET") return deny(res, 405, "method_not_allowed");

  const reqUrl = new URL(req.url, "http://localhost");
  if (reqUrl.pathname !== "/fetch") return deny(res, 404, "not_found");

  const auth = req.headers["authorization"] || "";
  if (auth !== `Bearer ${TOKEN}`) return deny(res, 401, "unauthorized");

  const target = reqUrl.searchParams.get("url") || "";
  let u;
  try {
    u = new URL(target);
  } catch {
    return deny(res, 400, "bad_url");
  }
  if (u.protocol !== "https:" || !ALLOW.test(u.hostname)) {
    return deny(res, 403, "host_not_allowlisted");
  }

  if (busy) return deny(res, 429, "busy");
  busy = true;
  try {
    const since = Date.now() - lastAt;
    if (since < MIN_SPACING_MS) await sleep(MIN_SPACING_MS - since);
    lastAt = Date.now();

    // Forward the browser-like profile headers ReLex sends under X-Fwd-*.
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase().startsWith("x-fwd-")) headers[k.slice(6)] = v;
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(target, { redirect: "follow", headers, signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_BYTES) return deny(res, 413, "too_large");

    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Content-Length": String(buf.length),
      "X-Upstream-Status": String(upstream.status),
    });
    res.end(buf);
    console.log(`[relay] ${upstream.status} ${buf.length}B ${u.hostname}`);
  } catch (err) {
    console.error("[relay] error", err?.message);
    deny(res, 502, `upstream_error:${String(err?.message || err).slice(0, 120)}`);
  } finally {
    busy = false;
  }
}).listen(PORT, () => console.log(`court-egress relay on :${PORT}`));
