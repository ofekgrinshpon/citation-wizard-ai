// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { CITATION_PASS_OFFERS } from "../../supabase/functions/_shared/citationPassOffers";
import { handleCitationPassCheckout } from "../../supabase/functions/citation-pass-checkout/handler";
import { createTakbullPageObserver } from "../../supabase/functions/takbull-page-observer/handler";
import { settleAuthenticatedPagePayment } from "../../supabase/functions/_shared/takbullPageSettlement";

const userA = "00000000-0000-4000-8000-000000000001";
const userB = "00000000-0000-4000-8000-000000000002";
const week = "citation_week_pass_v1", month = "citation_month_pass_v1";
let db: PGlite;
async function scalar(sql: string, args: unknown[] = []) {
  return (await db.query<{ value: any }>(sql, args)).rows[0]?.value;
}
async function create(userId = userA, offerId = week) {
  return scalar("select public.create_citation_pass_order($1,$2) as value", [userId, offerId]);
}
async function settle(reference: string, txn = "101", order = "8", amount = 39, currency: string | null = null, status: number | null = 2, code = 0) {
  return scalar("select public.settle_citation_pass_order($1,$2,$3,$4,$5,$6,$7) as value", [reference, txn, order, amount, currency, status, code]);
}
async function claim(requestId: string, userId = userA, batchId: string | null = null, retry: string | null = null) {
  return scalar("select public.begin_citation_request($1,$2,$3,$4,$5,$6::jsonb) as value", [userId, requestId, "a".repeat(64), batchId, retry, JSON.stringify({ ...(batchId ? { batchId } : {}) })]);
}
async function finish(requestId: string, token: string, outcome: string) {
  return scalar("select public.finish_citation_request($1,$2,$3,$4,$5,$6::jsonb) as value", [userA, requestId, token, outcome, "local-test", outcome === "succeeded" ? "{}" : null]);
}
async function remaining(reference: string) {
  return scalar("select sources_remaining as value from public.citation_pass_orders where reference=$1", [reference]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("src/test/fixtures/citationPassBaseline.sql", "utf8"));
  // pg_get_functiondef formatting differs across PostgreSQL versions. The
  // exact-definition drift gate stays intact in the production draft.
  const migration = readFileSync("supabase/migration-drafts/20261124180000_citation_pass_checkout.sql", "utf8").replace(/DO \$gate\$[\s\S]*?\$gate\$;/, "");
  await db.exec(migration);
  await db.exec(readFileSync("supabase/migration-drafts/20261125195300_takbull_page_completed_status.sql", "utf8"));
  await db.exec(readFileSync("supabase/migration-drafts/20261124181500_citation_pass_owner_pilot.sql", "utf8"));
  await db.exec(readFileSync("supabase/migration-drafts/20261125220000_takbull_settle_paid_package.sql", "utf8"));
  await db.exec("INSERT INTO public.citation_pass_config(singleton) VALUES(true);");
}, 30000);
beforeEach(async () => {
  await db.exec("BEGIN; select set_config('test.role','service_role',false);");
  await db.query("select set_config('test.uid',$1,false)", [userA]);
  await db.query("insert into public.profiles(id) values($1),($2)", [userA, userB]);
  await db.exec("update public.citation_pass_config set checkout_enabled=true,settlement_enabled=true;");
});
afterEach(async () => { await db.exec("ROLLBACK;"); });
afterAll(async () => { await db?.close(); });

describe("atomic one-time purchase and paid source ledger (real local PostgreSQL)", () => {
  it("monthly intent → signed weekly payment → own account read-back → resend → paid citation works end-to-end locally", async () => {
    const checkout = await handleCitationPassCheckout(new Request("https://synthetic.test/checkout", {
      method: "POST", headers: { Authorization: "Bearer synthetic-auth-token", "Content-Type": "application/json", Origin: "https://relexlm.com" }, body: JSON.stringify({ offerId: month }),
    }), {
      getUser: async () => ({ id: userA }), getConfig: async () => ({ enabled: true, pageUrl: "https://paypage.takbull.co.il/3CxDl" }),
      createOrder: async (userId, offerId) => { const o = await create(userId, offerId); return { reference: o.reference, orderId: o.order_id, pageUrl: o.page_url }; },
    });
    const result = await checkout.json();
    expect(result.activated).toBe(false);
    const reference = new URL(result.checkoutUrl).searchParams.get("c_id");
    if (!reference) throw new Error("Missing local order reference");
    const payload = { ExternalCustomerId: reference, TransactionId: 101, OrderNumber: 8, OrderTotalSum: 39, OrderStatus: 3, StatusCode: 0, Action: null };
    const keyText = "local-synthetic-key-not-a-real-merchant-secret";
    const t = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify(payload);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(keyText), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)))].map(x => x.toString(16).padStart(2, "0")).join("");
    const observer = createTakbullPageObserver({ readActive: () => true, readPageKey: () => keyText, record: () => {},
      settle: value => settleAuthenticatedPagePayment(value, { enabled: async () => true,
        settle: payment => settle(payment.reference, payment.transactionId, payment.orderNumber, payment.amountIls, payment.currency, payment.orderStatus, payment.statusCode) }),
    });
    const callback = (withSignature = true) => new Request("https://synthetic.test/webhook", { method: "POST", headers: { "Content-Type": "application/json", ...(withSignature ? { "x-takbull-signature": `t=${t},v1=${mac}` } : {}) }, body });
    expect((await observer(callback(false))).status).toBe(401);
    expect((await scalar("select public.get_citation_pass_status() as value")).passes[0]).toMatchObject({ offer_id: month, status: "pending" });
    expect((await observer(callback())).status).toBe(204);
    expect((await scalar("select public.get_citation_pass_status() as value")).passes[0]).toMatchObject({ offer_id: week, status: "active", used_ratio: 0 });
    expect((await observer(callback())).status).toBe(204);
    expect(await remaining(reference)).toBe(100);
    expect((await claim("end-to-end-source")).execute).toBe(true);
    expect(await remaining(reference)).toBe(99);
  });
  it("creates a different immutable reference for each purchase by the same user", async () => {
    const a = await create(), b = await create();
    expect(a.reference).toMatch(/^rlx_[0-9a-f]{32}$/);
    expect(a.reference).not.toBe(b.reference);
    expect(a.page_url).toBe("https://paypage.takbull.co.il/3CxDl");
  });
  it("uses exact server-owned prices and allowances from the catalogue", async () => {
    for (const offer of CITATION_PASS_OFFERS) {
      const o = await create(userA, offer.id);
      expect(await scalar("select jsonb_build_array(amount_ils,source_count,sources_remaining) as value from public.citation_pass_orders where reference=$1", [o.reference])).toEqual([offer.priceIls, offer.sourceCount, offer.sourceCount]);
    }
  });
  it("grants the 39/100 weekly purchase exactly once on an exact resend", async () => {
    const o = await create();
    expect(await settle(o.reference)).toEqual({ ok: true, replayed: false });
    await db.query("update public.citation_pass_orders set sources_remaining=99 where reference=$1", [o.reference]);
    const original = await scalar("select jsonb_build_array(activated_at,expires_at) as value from public.citation_pass_orders where reference=$1", [o.reference]);
    expect(await settle(o.reference)).toEqual({ ok: true, replayed: true });
    expect(await remaining(o.reference)).toBe(99);
    expect(await scalar("select jsonb_build_array(activated_at,expires_at) as value from public.citation_pass_orders where reference=$1", [o.reference])).toEqual(original);
  });
  it("grants exactly 250 sources for the 65 ILS monthly purchase", async () => {
    const o = await create(userA, month);
    expect((await settle(o.reference, "102", "9", 65, "ILS")).ok).toBe(true);
    expect(await remaining(o.reference)).toBe(250);
  });
  it("a weekly pass lasts 168 hours even across a clock change", async () => {
    expect(await scalar("select extract(epoch from (public.citation_pass_expiry('2027-03-25T12:00Z',$1)-'2027-03-25T12:00Z'::timestamptz))::integer as value", [week])).toBe(7 * 24 * 3600);
  });
  it("a calendar month from January 31 ends February 28, not 30 days later", async () => {
    expect(await scalar("select to_char(public.citation_pass_expiry('2027-01-31T10:00Z',$1) AT TIME ZONE 'Asia/Jerusalem','YYYY-MM-DD HH24:MI') as value", [month])).toBe("2027-02-28 12:00");
  });
  it("does not match an unknown old reference to a new account purchase", async () => {
    const o = await create();
    expect((await settle(`rlx_${"b".repeat(32)}`)).error).toBe("ORDER_NOT_FOUND");
    expect(await scalar("select status as value from public.citation_pass_orders where reference=$1", [o.reference])).toBe("pending");
  });
  it.each([[week, 65, month, 250], [month, 39, week, 100]] as const)(
    "reconciles %s when %i ILS was paid, audits the intent, and never resets a settled pass",
    async (intent, amount, offer, quota) => {
      const o = await create(userA, intent);
      expect(await settle(o.reference, "101", "8", amount, "ILS", 3)).toEqual({ ok: true, replayed: false });
      const row = () => scalar(`select jsonb_build_array(status,offer_id,original_offer_id,amount_ils,source_count,sources_remaining,
        expires_at=public.citation_pass_expiry(activated_at,$2)) as value from public.citation_pass_orders where reference=$1`, [o.reference, offer]);
      expect(await row()).toEqual(["settled", offer, intent, amount, quota, quota, true]);
      expect((await claim("one-reconciled-source")).execute).toBe(true);
      expect(await settle(o.reference, "101", "8", amount, "ILS", 3)).toEqual({ ok: true, replayed: true });
      expect((await settle(o.reference, "101", "8", amount === 39 ? 65 : 39, "ILS", 3)).error).toBe("SETTLEMENT_CONFLICT");
      expect(await row()).toEqual(["settled", offer, intent, amount, quota, quota - 1, true]);
    },
  );
  it("rejects a non-catalogue price without changing the pending order", async () => {
    const o = await create();
    expect((await settle(o.reference, "101", "8", 50)).error).toBe("PAYMENT_REJECTED");
    expect(await scalar("select status as value from public.citation_pass_orders where reference=$1", [o.reference])).toBe("pending");
  });
  it("rejects non-success status, conflicting currency, or missing transaction", async () => {
    const o = await create();
    for (const args of [[o.reference, "101", "8", 39, "USD", 2, 0], [o.reference, "101", "8", 39, null, 0, 0], [o.reference, "101", "8", 39, null, 2, 1], [o.reference, "101", "8", 39, null, 3, 1], [o.reference, "101", "8", 39, null, null, 0], [o.reference, "", "8", 39, null, 2, 0]] as const) {
      expect((await settle(args[0], args[1], args[2], args[3], args[4], args[5], args[6])).error).toBe("PAYMENT_REJECTED");
    }
  });
  it("cannot grant the same transaction or order number to a second account", async () => {
    const a = await create(), b = await create(userB);
    await settle(a.reference);
    expect((await settle(b.reference, "101", "9")).error).toBe("TRANSACTION_ALREADY_USED");
    expect((await settle(b.reference, "102", "8")).error).toBe("TRANSACTION_ALREADY_USED");
  });
  it("one order cannot be overwritten with another transaction", async () => {
    const o = await create(); await settle(o.reference);
    expect((await settle(o.reference, "102", "9")).error).toBe("SETTLEMENT_CONFLICT");
  });
  it("claims one paid source once and replay never authorizes another execution", async () => {
    const o = await create(); await settle(o.reference);
    expect((await claim("source-1")).execute).toBe(true);
    expect((await claim("source-1")).execute).toBe(false);
    expect(await remaining(o.reference)).toBe(99);
    expect(await scalar("select included_credits_remaining as value from public.profiles where id=$1", [userA])).toBe(5);
  });
  it("every batch source costs one paid source, not one unit per five-source group", async () => {
    const o = await create(); await settle(o.reference);
    for (let n = 0; n < 5; n++) expect((await claim(`batch-source-${n}`, userA, "batch-1")).execute).toBe(true);
    expect(await remaining(o.reference)).toBe(95);
  });
  it("a failed source restores exactly one unit and a repeated finish does not restore again", async () => {
    const o = await create(); await settle(o.reference);
    const c = await claim("source-failure");
    expect((await finish("source-failure", c.attempt_token, "failed")).refunded).toBe(true);
    expect(await remaining(o.reference)).toBe(100);
    await finish("source-failure", c.attempt_token, "failed");
    expect(await remaining(o.reference)).toBe(100);
    expect((await claim("source-retry", userA, null, "source-failure")).execute).toBe(true);
    expect(await remaining(o.reference)).toBe(99);
  });
  it("uncertain execution retains its source and cannot become a failed refund later", async () => {
    const o = await create(); await settle(o.reference);
    const c = await claim("source-unknown");
    await finish("source-unknown", c.attempt_token, "unknown");
    expect((await finish("source-unknown", c.attempt_token, "failed")).error).toBe("TERMINAL_STATE_CONFLICT");
    expect(await remaining(o.reference)).toBe(99);
  });
  it("successful execution stores recovery and retains the paid unit", async () => {
    const o = await create(); await settle(o.reference);
    const c = await claim("source-success");
    expect((await finish("source-success", c.attempt_token, "succeeded")).result_stored).toBe(true);
    expect(await remaining(o.reference)).toBe(99);
    expect(await scalar("select result as value from public.citation_recovery_payloads where request_id='source-success'")).toEqual({});
  });
  it("an exhausted active pass blocks new paid work without debiting the old trial", async () => {
    const o = await create(); await settle(o.reference);
    await db.query("update public.citation_pass_orders set sources_remaining=0 where reference=$1", [o.reference]);
    expect((await claim("source-exhausted")).block_reason).toBe("pass_exhausted");
    expect(await scalar("select count(*)::integer as value from public.citation_trial_sources")).toBe(0);
  });
  it("accounts without an active paid pass retain the original trial path", async () => {
    expect((await claim("legacy-source")).trial).toBe(true);
    expect(await scalar("select count(*)::integer as value from public.citation_trial_sources")).toBe(1);
  });
  it("expired paid sources are never spent", async () => {
    const o = await create(); await settle(o.reference);
    await db.query("update public.citation_pass_orders set expires_at=now()-interval '1 second' where reference=$1", [o.reference]);
    expect((await claim("source-expired")).citation_pass).not.toBe(true);
    expect(await remaining(o.reference)).toBe(100);
  });
  it("only server service callers can create or settle purchases", async () => {
    const o = await create();
    await db.exec("select set_config('test.role','authenticated',false);");
    await expect(create()).rejects.toThrow("Service required");
    await db.exec("ROLLBACK; BEGIN; select set_config('test.role','authenticated',false);");
    await expect(settle(o.reference)).rejects.toThrow("Service required");
  });
  it("account status returns only that account's passes and no references, transaction IDs or raw balances", async () => {
    await create(); await create(userB);
    const status = await scalar("select public.get_citation_pass_status() as value");
    expect(status.passes).toHaveLength(1);
    expect(status.passes[0].status).toBe("pending");
    expect(Object.keys(status.passes[0]).sort()).toEqual(["activated_at", "expires_at", "id", "offer_id", "status", "used_ratio"]);
  });
  it("checkout and settlement both fail closed when disabled", async () => {
    const o = await create();
    await db.exec("update public.citation_pass_config set checkout_enabled=false,settlement_enabled=false;");
    expect((await create()).error).toBe("CHECKOUT_CLOSED");
    expect(await settle(o.reference)).toEqual({ ok: false, disabled: true });
  });
  it("non-admin accounts cannot open a purchase while public checkout is closed", async () => {
    await db.exec("update public.citation_pass_config set checkout_enabled=false,settlement_enabled=true;");
    expect((await scalar("select public.get_citation_checkout_status() as value")).enabled).toBe(false);
    expect((await create()).error).toBe("CHECKOUT_CLOSED");
  });
  it("server-recognized admins can run the pilot without opening public checkout", async () => {
    await db.exec("update public.citation_pass_config set checkout_enabled=false,settlement_enabled=true; select set_config('test.admin','true',true);");
    expect((await scalar("select public.get_citation_checkout_status() as value")).enabled).toBe(true);
    expect((await create()).ok).toBe(true);
    expect((await create(userB)).error).toBe("CHECKOUT_CLOSED");
  });
  it("public and authenticated callers cannot access the private payment ledger", async () => {
    for (const table of ["citation_pass_orders", "citation_pass_config", "citation_pass_usage"]) {
      expect(await scalar("select has_table_privilege('authenticated',$1,'SELECT') as value", [`public.${table}`])).toBe(false);
      expect(await scalar("select has_table_privilege('anon',$1,'INSERT') as value", [`public.${table}`])).toBe(false);
      expect(await scalar("select relrowsecurity as value from pg_class where oid=$1::regclass", [`public.${table}`])).toBe(true);
    }
  });
});