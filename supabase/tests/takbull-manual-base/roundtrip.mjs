// Disposable end-to-end accounting test. Inputs are synthetic; no network,
 // merchant calls, live users, money or credentials. See README for prerequisites.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [pglitePath, compiledHandler, ...sql] = process.argv.slice(2);
const { PGlite } = await import(pathToFileURL(resolve(pglitePath)));
const { handleTakbullManualBase } = await import(pathToFileURL(resolve(compiledHandler)));
const db = new PGlite();
const buyer = "10000000-0000-4000-a000-100000000001";
const admin = "20000000-0000-4000-a000-200000000002";
const other = "30000000-0000-4000-a000-300000000003";
const identities = new Map([["Bearer buyer",buyer],["Bearer admin",admin],["Bearer other",other]]);
const call = async (token, body) => {
  const req = new Request("https://isolated.invalid", { method: "POST", headers: { Authorization: "Bearer "+token }, body: JSON.stringify(body) });
  const res = await handleTakbullManualBase(req, {
    enabled: true,
    getUser: async (authorization) => identities.get(authorization) ?? null,
    rpc: async (name,args) => {
      try {
        const keys = Object.keys(args);
        // Use named arguments exactly as the RPC adapter does.
        const { rows } = await db.query(`SELECT public.${name}(${keys.map((k,i)=>k+"=>$"+(i+1)).join(",")}) AS data`, keys.map(k=>args[k]));
        return { data: rows[0].data, error: null };
      } catch (error) { return { data: null, error }; }
    },
  });
  return { http: res.status, ...(await res.json()) };
};

try {
  for(const path of sql) await db.exec(await readFile(path,"utf8"));
  await db.exec(`CREATE OR REPLACE FUNCTION private.has_role(uuid,public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT $1='${admin}' AND $2='admin'$$;
    INSERT INTO profiles(id) VALUES ('${buyer}'),('${admin}'),('${other}');
    UPDATE private.takbull_pilot_config SET enabled=true,verified_merchant_ref='synthetic';
    SELECT set_config('lab.role','service_role',false);`);
  assert.equal((await call("other",{ action:"queue",actor:admin })).http,403);
  assert.equal((await call("buyer",{ action:"request",offer:"citation_source_topup_50_v1" })).http,400);
  for (const [n, offer, price, count] of [[1,"citation_week_pass_v1",3900,100],[2,"citation_month_pass_v1",6500,250]]) {
    const request = await call("buyer",{ action:"request",offer, owner:other, amountMinor:1 });
    assert.equal(request.status,"requested");
    assert.equal(request.amount_minor,price);
    assert.equal(request.sources_remaining,null);
    assert.equal((await call("other",{ action:"status",owner:buyer })).status,"none");
    assert.equal((await call("buyer",{ action:"request",offer })).order_id,request.order_id);
    const evidence = { order:request.order_id, attest:true, merchant:"synthetic", demand:"demand"+n, amountMinor:price, currency:"ILS" };
    const charge = { ...evidence, action:"settle",transaction:"transaction"+n,document:"document"+n };
    const now = () => new Date().toISOString();
    // Pin fixture request at least one millisecond earlier than the provider's
    // synthetic timestamp; Postgres stores more precision than JavaScript.
    await db.query("UPDATE private.takbull_pilot_orders SET requested_at=clock_timestamp()-interval '1 second' WHERE id=$1",[request.order_id]);
    assert.equal((await call("buyer",{ ...evidence, action:"issue", at:now() })).http,403);
    assert.equal((await call("admin",{ ...charge,at:now() })).ok,false);
    assert.equal((await call("admin",{ ...evidence,action:"issue",at:now() })).ok,true);
    assert.equal((await call("buyer",{ action:"status" })).status,"demand_issued");
    const paid = { ...charge, at:now() };
    assert.equal((await call("admin",{ ...paid,demand:"wrong" })).ok,false);
    assert.equal((await call("admin",paid)).fulfilled,true);
    const active = await call("buyer",{ action:"status" });
    assert.equal(active.status,"active");
    assert.equal(active.sources_remaining,count);
    assert.equal(active.sources_included,count);
    const duplicate = await call("admin",paid);
    assert.equal(duplicate.replayed,true);
    assert.equal(Date.parse(duplicate.expires_at),Date.parse(active.expires_at));
    await db.query("SELECT set_config('lab.uid',$1,false)",[buyer]);
    const { rows } = await db.query("SELECT public.get_citation_trial_status() AS meter");
    assert.equal(rows[0].meter.remaining,count);
    const debited = await db.query("SELECT public.consume_local_citation_trial($1,$2,$3) AS meter",["source-"+n,"a".repeat(64),buyer]);
    assert.equal(debited.rows[0].meter.remaining,count-1);
    assert.equal((await call("buyer",{ action:"status" })).sources_remaining,count-1);
    assert.equal((await call("admin",{ action:"refund",order:request.order_id,attest:true,merchant:"synthetic",
      transaction:paid.transaction, refund:"refund"+n,document:"credit"+n })).ok,true);
    const refunded = await call("buyer",{ action:"status" });
    assert.equal(refunded.status,"refunded");
    assert.equal(refunded.sources_remaining,null);
    assert.equal((await call("admin",paid)).ok,false);
  }
  console.log("PASS: 100/250 buyer→admin→payment→quota debit→refund, replay, wrong owner and auth, no top-up");
} finally {
  await db.close();
}
