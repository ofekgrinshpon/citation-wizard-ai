/**
 * Takbull hosted-page callback — UNCONDITIONALLY CLOSED.
 * Callback authenticity and server-created order-reference propagation are not
 * verified, so nothing here is payment proof. The request body is never read,
 * logged or stored; nothing is activated or granted; no secret is used.
 */
export const TAKBULL_WEBHOOK_CLOSED_BODY = Object.freeze({
  error: "TAKBULL_WEBHOOK_NOT_READY",
  activated: false,
  grantedSources: 0,
});

export function handleTakbullHostedWebhook(_req: Request): Response {
  return new Response(JSON.stringify(TAKBULL_WEBHOOK_CLOSED_BODY), {
    status: 503,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
