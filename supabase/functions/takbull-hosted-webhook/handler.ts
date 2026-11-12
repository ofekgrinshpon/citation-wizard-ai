/**
 * Takbull hosted-page callback — ALWAYS CLOSED.
 * Callback authenticity and server-created order-reference propagation are not
 * verified, so nothing here is payment proof. Every response is the same 503 with
 * activated:false and grantedSources:0; nothing is stored, activated or granted.
 *
 * Optional dormant observation (see observe.ts): only when the injected config
 * holds a valid window that is open now does the handler read one bounded JSON
 * body and log one sanitized allowlisted projection, and only if the window is
 * still open after that read. Without it the body is never read and nothing is logged.
 */
import { isWindowOpen, observeRequest, parseObserveConfig } from "./observe.ts";

export const TAKBULL_WEBHOOK_CLOSED_BODY = Object.freeze({
  error: "TAKBULL_WEBHOOK_NOT_READY",
  activated: false,
  grantedSources: 0,
});

export interface WebhookObserveDeps {
  readConfig: () => string | undefined | null;
  log: (line: string) => void;
  now?: () => number;
  limits?: { maxBytes: number; timeoutMs: number };
}

function closed(): Response {
  return new Response(JSON.stringify(TAKBULL_WEBHOOK_CLOSED_BODY), {
    status: 503,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handleTakbullHostedWebhook(req: Request, deps?: WebhookObserveDeps): Promise<Response> {
  if (!deps) return closed();
  try {
    let raw: string | undefined | null;
    try { raw = deps.readConfig(); } catch { return closed(); }
    const now = deps.now ?? Date.now;
    const cfg = parseObserveConfig(raw, now());
    if (!cfg) return closed();
    const line = await observeRequest(req, cfg, deps.limits);
    // Recheck after the bounded read: if the window closed (or the clock is bad) while reading, discard the line.
    if (!isWindowOpen(cfg, now())) return closed();
    try { deps.log(line); } catch { /* logging failure never changes the response */ }
  } catch {
    /* fail closed */
  }
  return closed();
}
