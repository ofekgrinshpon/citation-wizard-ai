/**
 * Pure checkout handler (dependencies injected so it is testable outside Deno).
 * Deliberately NOT READY: it never creates an order, calls a payment provider,
 * issues a URL, writes to the database or grants anything. A verified user with
 * a valid allowlisted offer receives 503 CITATION_PASS_CHECKOUT_NOT_READY.
 * There is no fallthrough to legacy credit/top-up logic.
 */
import { findCitationPassOffer } from "../_shared/citationPassOffers.ts";

export const ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  "https://relexlm.com",
  "https://www.relexlm.com",
  "https://citation-wizard-ai.lovable.app",
  "https://id-preview--da75bf03-5ea8-4e5f-a54a-fd6ed2a9c146.lovable.app",
]);

export const BODY_BYTE_CAP = 1024;
export const BODY_TIME_CAP_MS = 3000;

export interface CheckoutDeps {
  /** Must verify the bearer token with the auth server (auth.getUser), never decode locally. */
  getUser: (authorization: string) => Promise<{ id: string } | null>;
  timeCapMs?: number;
}

const ALLOW_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version";

function baseHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Headers"] = ALLOW_HEADERS;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

function json(origin: string | null, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ...body, activated: false }), {
    status,
    headers: { ...baseHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  byteCap: number,
  timeCapMs: number,
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  if (!body) return { ok: false, status: 400, error: "INVALID_REQUEST" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), timeCapMs); });
  try {
    while (true) {
      const next = await Promise.race([reader.read(), timeout]);
      if (next === "timeout") { reader.cancel().catch(() => {}); return { ok: false, status: 408, error: "BODY_TIMEOUT" }; }
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > byteCap) { reader.cancel().catch(() => {}); return { ok: false, status: 413, error: "BODY_TOO_LARGE" }; }
      chunks.push(next.value);
    }
  } catch {
    reader.cancel().catch(() => {});
    return { ok: false, status: 400, error: "INVALID_REQUEST" };
  } finally {
    if (timer) clearTimeout(timer);
  }
  const all = new Uint8Array(bytes);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(all) };
  } catch {
    return { ok: false, status: 400, error: "INVALID_REQUEST" };
  }
}

export async function handleCitationPassCheckout(req: Request, deps: CheckoutDeps): Promise<Response> {
  const origin = req.headers.get("Origin");
  const originAllowed = origin === null || ALLOWED_ORIGINS.includes(origin);

  if (req.method === "OPTIONS") {
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) return json(origin, 403, { error: "ORIGIN_NOT_ALLOWED" });
    return new Response(null, { status: 204, headers: baseHeaders(origin) });
  }
  if (!originAllowed) return json(origin, 403, { error: "ORIGIN_NOT_ALLOWED" });
  if (req.method !== "POST") return json(origin, 405, { error: "METHOD_NOT_ALLOWED" });

  const authorization = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return json(origin, 401, { error: "UNAUTHENTICATED" });
  let user: { id: string } | null = null;
  try { user = await deps.getUser(authorization); } catch { user = null; }
  if (!user || typeof user.id !== "string" || !user.id) return json(origin, 401, { error: "UNAUTHENTICATED" });

  const contentType = (req.headers.get("Content-Type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) return json(origin, 415, { error: "UNSUPPORTED_MEDIA_TYPE" });

  const read = await readBoundedText(req.body, BODY_BYTE_CAP, deps.timeCapMs ?? BODY_TIME_CAP_MS);
  if ("error" in read) return json(origin, read.status, { error: read.error });

  let parsed: unknown;
  try { parsed = JSON.parse((read as { text: string }).text); } catch { return json(origin, 400, { error: "INVALID_JSON" }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(origin, 400, { error: "INVALID_REQUEST" });
  const keys = Object.keys(parsed as Record<string, unknown>);
  // Only the offer id is accepted; price, currency, amount, sources, URLs etc. are never client-supplied.
  if (keys.length !== 1 || keys[0] !== "offerId") return json(origin, 400, { error: "INVALID_REQUEST" });

  const offer = findCitationPassOffer((parsed as Record<string, unknown>).offerId);
  if (!offer) return json(origin, 400, { error: "UNKNOWN_OFFER" });

  return json(origin, 503, {
    error: "CITATION_PASS_CHECKOUT_NOT_READY",
    offer: {
      id: offer.id,
      priceIls: offer.priceIls,
      currency: offer.currency,
      sourceCount: offer.sourceCount,
      term: offer.term,
      billing: offer.billing,
      autoRenew: offer.autoRenew,
    },
  });
}
