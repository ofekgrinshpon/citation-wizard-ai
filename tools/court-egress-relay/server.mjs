/**
 * official_court_egress_path_v1 — minimal relay (curl-based fetch path).
 *
 * Run this on a host whose IP the Israeli courts server answers (a small VPS,
 * ideally with an Israeli IP). It fetches ONE public official court document
 * URL per request and streams the bytes back. Nothing else.
 *
 *   PORT=8787 RELAY_TOKEN=<long-random-string> node server.mjs
 *
 * Why curl and not Node fetch: undici (Node's fetch) fails against
 * supremedecisions.court.gov.il with a bare "fetch failed" (TLS/ALPN/HTTP
 * quirk) on the exact same host where `curl -L` returns the real PDF.
 * So the internal fetch path shells out to curl with no shell interpolation.
 *
 * Guarantees enforced here as well as on the ReLex side:
 *   - only https URLs on *.court.gov.il;
 *   - bearer-token required;
 *   - GET only, 25 MB cap, 30 s timeout, 1 in-flight request, ≥1 s spacing;
 *   - HTML exception/error pages are rejected, not relayed as documents;
 *   - no cookies, no login, no CAPTCHA solving, no crawling, no link following.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

/**
 * Fetch `target` with curl. Returns { status, contentType, body(Buffer), finalUrl }.
 * Arguments are passed as an argv array — never through a shell.
 */
async function curlFetch(target, headers) {
  const dir = await mkdtemp(path.join(tmpdir(), "court-egress-"));
  const bodyPath = path.join(dir, "body.bin");
  try {
    const args = [
      "-sS",
      "-L",
      "--max-redirs", "5",
      "--max-time", String(Math.ceil(TIMEOUT_MS / 1000)),
      "--max-filesize", String(MAX_BYTES),
      "--compressed",
      "-o", bodyPath,
      "-w", "%{http_code}\\n%{content_type}\\n%{url_effective}\\n%{size_download}\\n",
    ];
    for (const [k, v] of Object.entries(headers)) {
      if (v == null || v === "") continue;
      args.push("-H", `${k}: ${v}`);
    }
    args.push("--url", target);

    const { code, stdout, stderr } = await new Promise((resolve, reject) => {
      const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const killer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS + 5_000);
      child.stdout.on("data", (d) => { out += d.toString(); });
      child.stderr.on("data", (d) => { err += d.toString(); });
      child.on("error", (e) => { clearTimeout(killer); reject(e); });
      child.on("close", (c) => { clearTimeout(killer); resolve({ code: c, stdout: out, stderr: err }); });
    });

    if (code !== 0) {
      throw new Error(`curl_exit_${code}:${stderr.trim().slice(0, 160)}`);
    }

    const [statusRaw, ctypeRaw, finalUrl] = stdout.trim().split("\n");
    const size = (await stat(bodyPath)).size;
    if (size > MAX_BYTES) throw new Error("too_large");

    return {
      status: Number(statusRaw) || 0,
      contentType: (ctypeRaw || "application/octet-stream").trim(),
      finalUrl: (finalUrl || target).trim(),
      body: await readFile(bodyPath),
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Reject HTML exception/error pages instead of relaying them as documents. */
function rejectionReason(result) {
  const ct = result.contentType.toLowerCase();
  const isHtml = ct.includes("text/html");
  if (/\/Exception\//i.test(result.finalUrl)) return "upstream_exception_page";
  if (!isHtml) return null;
  const head = result.body.subarray(0, 4096).toString("utf8");
  if (/ExceptionView|<HTML|<html/i.test(head) && result.body.length < 64 * 1024) {
    return "upstream_html_error_page";
  }
  return "upstream_html_not_document";
}

http.createServer(async (req, res) => {
  if (req.method !== "GET") return deny(res, 405, "method_not_allowed");

  const reqUrl = new URL(req.url, "http://localhost");
  if (reqUrl.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, busy }));
  }
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

    // Forward only the browser-like profile headers ReLex sends under X-Fwd-*.
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase().startsWith("x-fwd-")) {
        const name = k.slice(6);
        headers[name] = Array.isArray(v) ? v[0] : v;
      }
    }

    const result = await curlFetch(target, headers);

    if (result.status >= 400) {
      console.log(`[relay] upstream ${result.status} ${result.contentType} ${result.body.length}B ${u.hostname}`);
      return deny(res, 502, `upstream_status_${result.status}`);
    }

    const bad = rejectionReason(result);
    if (bad) {
      console.log(`[relay] reject ${bad} ${result.status} ${result.contentType} ${result.body.length}B ${u.hostname}`);
      return deny(res, 502, bad);
    }

    res.writeHead(result.status, {
      "Content-Type": result.contentType || "application/octet-stream",
      "Content-Length": String(result.body.length),
      "X-Upstream-Status": String(result.status),
    });
    res.end(result.body);
    console.log(`[relay] ${result.status} ${result.contentType} ${result.body.length}B ${u.hostname}`);
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 160);
    console.error(`[relay] error ${msg}`);
    deny(res, 502, `upstream_error:${msg}`);
  } finally {
    busy = false;
  }
}).listen(PORT, () => console.log(`court-egress relay (curl path) on :${PORT}`));
