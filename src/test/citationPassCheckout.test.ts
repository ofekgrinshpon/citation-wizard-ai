import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ALLOWED_ORIGINS, handleCitationPassCheckout } from "../../supabase/functions/citation-pass-checkout/handler";
import { handleTakbullHostedWebhook } from "../../supabase/functions/takbull-hosted-webhook/handler";

const URL_ = "https://example.functions/citation-pass-checkout";
const ORIGIN = "https://relexlm.com";
const okUser = () => vi.fn(async () => ({ id: "00000000-0000-4000-8000-000000000001" }));

function req(init: { method?: string; headers?: Record<string, string>; body?: BodyInit | null } = {}) {
  const { method = "POST", headers = {}, body = JSON.stringify({ offerId: "citation_week_pass_v1" }) } = init;
  return new Request(URL_, {
    method,
    headers: { Origin: ORIGIN, Authorization: "Bearer good-token", "Content-Type": "application/json", ...headers },
    body: method === "GET" || method === "OPTIONS" ? undefined : body,
  });
}
async function call(r: Request, getUser = okUser()) {
  const res = await handleCitationPassCheckout(r, { getUser, timeCapMs: 50 });
  const text = await res.text();
  return { res, getUser, body: text ? JSON.parse(text) : null };
}

describe("citation-pass-checkout (not ready)", () => {
  it("a verified user with the week pass gets 503 NOT_READY with server-side ILS 39 / 100 sources / 7 days", async () => {
    const { res, body, getUser } = await call(req());
    expect(getUser).toHaveBeenCalledWith("Bearer good-token");
    expect(res.status).toBe(503);
    expect(body).toEqual({
      error: "CITATION_PASS_CHECKOUT_NOT_READY", activated: false,
      offer: { id: "citation_week_pass_v1", priceIls: 39, currency: "ILS", sourceCount: 100, term: { unit: "day", count: 7 }, billing: "one_time", autoRenew: false },
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("the month pass is ILS 65 / 250 sources / one calendar month, and is also not ready", async () => {
    const { res, body } = await call(req({ body: JSON.stringify({ offerId: "citation_month_pass_v1" }) }));
    expect(res.status).toBe(503);
    expect(body.offer).toMatchObject({ priceIls: 65, currency: "ILS", sourceCount: 250, term: { unit: "calendar_month", count: 1 } });
    expect(body.activated).toBe(false);
  });

  it("never returns a payment URL or order reference", async () => {
    const { body } = await call(req());
    expect(JSON.stringify(body)).not.toMatch(/https?:|url|order|takbull/i);
  });

  it("missing or malformed Authorization is 401 without calling the auth server", async () => {
    for (const h of [{ Authorization: "" }, { Authorization: "Basic abc" }, { Authorization: "Bearer " }]) {
      const { res, body, getUser } = await call(req({ headers: h }));
      expect(res.status).toBe(401);
      expect(body).toEqual({ error: "UNAUTHENTICATED", activated: false });
      expect(getUser).not.toHaveBeenCalled();
    }
  });

  it("a token the auth server rejects (or an auth error) is 401", async () => {
    expect((await call(req(), vi.fn(async () => null))).res.status).toBe(401);
    expect((await call(req(), vi.fn(async () => { throw new Error("down"); }))).body).toEqual({ error: "UNAUTHENTICATED", activated: false });
  });

  it("unknown, legacy or differently-cased offer ids are rejected", async () => {
    for (const offerId of ["week", "month", "trial", "citation_weekly_v1", "citation_monthly_v1", "CITATION_WEEK_PASS_V1", "", 39, null, ["citation_week_pass_v1"]]) {
      const { res, body } = await call(req({ body: JSON.stringify({ offerId }) }));
      expect(res.status).toBe(400);
      expect(body).toEqual({ error: "UNKNOWN_OFFER", activated: false });
    }
  });

  it("client-supplied price, currency, sources or extra fields are rejected, not trusted", async () => {
    for (const extra of [{ priceIls: 1 }, { currency: "USD" }, { sourceCount: 99999 }, { returnUrl: "https://evil.example" }]) {
      const { res, body } = await call(req({ body: JSON.stringify({ offerId: "citation_week_pass_v1", ...extra }) }));
      expect(res.status).toBe(400);
      expect(body).toEqual({ error: "INVALID_REQUEST", activated: false });
    }
  });

  it("bad JSON, non-object bodies, wrong content type and oversized bodies fail", async () => {
    expect((await call(req({ body: "{nope" }))).body.error).toBe("INVALID_JSON");
    for (const b of ["[]", "null", '"citation_week_pass_v1"', "{}"]) expect((await call(req({ body: b }))).res.status).toBe(400);
    expect((await call(req({ headers: { "Content-Type": "text/plain" } }))).res.status).toBe(415);
    const big = await call(req({ body: JSON.stringify({ offerId: "citation_week_pass_v1", pad: "x".repeat(2000) }) }));
    expect([big.res.status, big.body]).toEqual([413, { error: "BODY_TOO_LARGE", activated: false }]);
  });

  it("a stalled body times out", async () => {
    const stalled = new ReadableStream<Uint8Array>({ start() { /* never enqueues */ } });
    const r = new Request(URL_, { method: "POST", headers: { Origin: ORIGIN, Authorization: "Bearer t", "Content-Type": "application/json" }, body: stalled, duplex: "half" } as RequestInit);
    expect((await call(r)).res.status).toBe(408);
  });

  it("wrong methods are 405 and unknown origins are refused without CORS grant", async () => {
    expect((await call(req({ method: "GET" }))).res.status).toBe(405);
    const evil = await call(req({ headers: { Origin: "https://evil.example" } }));
    expect(evil.res.status).toBe(403);
    expect(evil.res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(evil.getUser).not.toHaveBeenCalled();
  });

  it("preflight is allowed only for production origins", async () => {
    for (const o of ALLOWED_ORIGINS) {
      const { res } = await call(req({ method: "OPTIONS", headers: { Origin: o } }));
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(o);
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    }
    expect((await call(req({ method: "OPTIONS", headers: { Origin: "https://evil.example" } }))).res.status).toBe(403);
    expect(ALLOWED_ORIGINS).toEqual(expect.arrayContaining(["https://relexlm.com", "https://www.relexlm.com", "https://citation-wizard-ai.lovable.app"]));
  });

  it("the handler source has no provider, database, credit or secret access", () => {
    for (const path of ["supabase/functions/citation-pass-checkout/handler.ts", "supabase/functions/citation-pass-checkout/index.ts"]) {
      const src = readFileSync(path, "utf8");
      for (const banned of ["takbull", "fetch(", ".from(", ".rpc(", "SERVICE_ROLE", "credits", "topup", "getClaims", "atob(", "jwtDecode"]) expect(src.toLowerCase()).not.toContain(banned.toLowerCase());
    }
    expect(readFileSync("supabase/functions/citation-pass-checkout/index.ts", "utf8")).toContain("auth.getUser()");
  });
});

describe("takbull-hosted-webhook (closed)", () => {
  it("any request, including an unsigned success-looking event 20, gets 503 and grants nothing", async () => {
    const bodies = [
      JSON.stringify({ event: 20, status: "success", c_id: "123", order_reference: "x", amount: 39 }),
      "event=20&status=1&c_id=123", "",
    ];
    for (const body of bodies) for (const method of ["POST", "GET", "PUT"]) {
      const r = new Request("https://example.functions/takbull-hosted-webhook?event=20&status=success", { method, body: method === "GET" ? undefined : body });
      const res = handleTakbullHostedWebhook(r);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "TAKBULL_WEBHOOK_NOT_READY", activated: false, grantedSources: 0 });
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      if (r.body) expect(r.bodyUsed).toBe(false);
    }
  });

  it("the webhook source never reads, logs or stores the body and uses no secrets", () => {
    for (const path of ["supabase/functions/takbull-hosted-webhook/handler.ts", "supabase/functions/takbull-hosted-webhook/index.ts"]) {
      const src = readFileSync(path, "utf8");
      for (const banned of ["console.", ".json()", ".text()", ".formData()", "Deno.env", "createClient", ".from(", ".rpc(", "fetch("]) expect(src).not.toContain(banned);
    }
  });

  it("existing function auth settings are not loosened for the new functions", () => {
    const toml = readFileSync("supabase/config.toml", "utf8");
    expect(toml).not.toContain("citation-pass-checkout");
    expect(toml).not.toContain("takbull-hosted-webhook");
  });
});
