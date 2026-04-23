import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const { data: verifyData } = await anon.auth.verifyOtp({ token_hash: linkData.properties.hashed_token, type: "magiclink" });
const jwt = verifyData.session.access_token;
const evalRunId = `funnel-${randomUUID()}`;
const start = Date.now();
const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
  body: JSON.stringify({
    question: "באילו נסיבות ניתן לאכוף תניית אי-תחרות בחוזה עבודה בישראל?",
    taskMode: "research", evalRunId, evalVariant: "structured", requestId: `eval:${evalRunId}`,
  }),
});
console.log(`HTTP ${res.status} in ${Date.now() - start}ms`);
console.log("BODY:", await res.text());
console.log("evalRunId:", evalRunId);
await new Promise(r => setTimeout(r, 5000));
// Look up the most recent qa_log for this admin (regardless of eval tag)
const { data: rows } = await admin
  .from("qa_logs")
  .select("id, created_at, metadata")
  .eq("user_id", ADMIN_USER_ID)
  .order("created_at", { ascending: false })
  .limit(3);
for (const r of rows || []) {
  console.log(`\n--- row ${r.id} (${r.created_at}) ---`);
  const md = r.metadata || {};
  console.log("eval_run_id:", md.eval_run_id);
  console.log("retrieval_funnel:", JSON.stringify(md.retrieval_funnel, null, 2));
  console.log("source_type_counts:", JSON.stringify(md.source_type_counts, null, 2));
}
