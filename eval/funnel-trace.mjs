import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const tokenHash = linkData?.properties?.hashed_token;
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const { data: verifyData } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
const jwt = verifyData?.session?.access_token;
console.log("JWT acquired");

const evalRunId = `funnel-trace-${randomUUID()}`;
const start = Date.now();
const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${jwt}`,
    apikey: ANON_KEY,
  },
  body: JSON.stringify({
    question: "באילו נסיבות ניתן לאכוף תניית אי-תחרות בחוזה עבודה בישראל?",
    taskMode: "research",
    evalRunId,
    evalVariant: "structured",
    requestId: `eval:${evalRunId}`,
  }),
});
console.log(`HTTP ${res.status} in ${Date.now() - start}ms`);
const body = await res.text();
console.log(`Response length: ${body.length}`);

// Wait + fetch qa_logs row
await new Promise(r => setTimeout(r, 3000));
const { data: rows } = await admin
  .from("qa_logs")
  .select("id, created_at, metadata")
  .eq("user_id", ADMIN_USER_ID)
  .filter("metadata->>eval_run_id", "eq", evalRunId)
  .order("created_at", { ascending: false })
  .limit(1);
const row = rows?.[0];
if (!row) {
  console.log("NO qa_logs row found");
  process.exit(1);
}
const md = row.metadata || {};
console.log("\n=== retrieval_funnel ===");
console.log(JSON.stringify(md.retrieval_funnel, null, 2));
console.log("\n=== source_type_counts ===");
console.log(JSON.stringify(md.source_type_counts, null, 2));
console.log("\n=== source_pack_summary ===");
console.log(JSON.stringify(md.source_pack_summary, null, 2));
console.log(`\nqa_logs.id = ${row.id}`);
