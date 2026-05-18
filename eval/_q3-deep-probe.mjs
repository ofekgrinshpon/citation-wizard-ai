import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;
const evalRunId = `q3-ledger-cap-${randomUUID().slice(0,8)}`;
const question = "מבחנים לפסילת חוק בלתי חוקתי";
const start = Date.now();
const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
  body: JSON.stringify({
    question, taskMode: "research", depth: "deep",
    evalRunId, requestId: `eval:${evalRunId}`,
  }),
});
console.log("status", r.status, "wall", Date.now()-start, "ms");
const json = await r.json();
console.log("footnotes", (json.footnotes||[]).length);
await new Promise(r => setTimeout(r, 2500));
const { data } = await admin.from("qa_logs")
  .select("id, metadata")
  .eq("user_id", ADMIN_USER_ID)
  .filter("metadata->>eval_run_id", "eq", evalRunId)
  .order("created_at", { ascending: false }).limit(1);
const row = data?.[0];
if (!row) { console.log("NO ROW"); process.exit(0); }
const md = row.metadata || {};
console.log("v2_path:", md.v2_path);
console.log("research_plan_v2:", JSON.stringify(md.research_plan_v2));
console.log("retrieval_v2:", JSON.stringify(md.retrieval_v2));
console.log("ledger_v2:", JSON.stringify(md.ledger_v2));
console.log("verification_v2 statuses:", (md.verification_v2?.runs||md.verification_v2||[]).map?.(r => ({ stage: r.stage, status: r.status, ms: r.duration_ms })) ?? md.verification_v2);
console.log("total_footnotes:", md.total_footnotes);
console.log("row id:", row.id);
