import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;
const evalRunId = `profile-probe-${randomUUID()}`;
console.log("evalRunId:", evalRunId);
const t0 = Date.now();
const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
  method: "POST",
  headers: { "Content-Type":"application/json", Authorization:`Bearer ${jwt}`, apikey: ANON_KEY },
  body: JSON.stringify({
    question: "מה קובע סעיף 17 לחוק שירות המדינה (מינויים) לעניין פיטורים או הפסקת כהונה?",
    taskMode: "research", depth: "fast",
    evalRunId, evalVariant: "structured", requestId: `eval:${evalRunId}`
  })
});
console.log("HTTP status:", res.status, "wall:", Date.now()-t0, "ms");
await new Promise(r => setTimeout(r, 2000));
const { data: rows } = await admin.from("qa_logs")
  .select("id, metadata")
  .eq("user_id", ADMIN_USER_ID)
  .filter("metadata->>eval_run_id", "eq", evalRunId)
  .order("created_at", { ascending: false }).limit(1);
const md = rows?.[0]?.metadata ?? {};
console.log("has profile_used:", !!md.profile_used);
console.log("profile_used:", JSON.stringify(md.profile_used, null, 2));
console.log("drafting_path:", md.drafting_path);
