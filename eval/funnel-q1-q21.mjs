import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

const QUESTIONS = [
  { id: 1, question: "האם הממשלה מוסמכת לפטר את היועצת המשפטית לממשלה, ואם כן באילו מגבלות נורמטיביות ומנהליות?" },
  { id: 6, question: "מהן ההגנות החוקתיות על חופש הביטוי הפוליטי בישראל, ומהן המגבלות עליהן?" },
  { id: 21, question: "מה קובע סעיף 17 לחוק שירות המדינה (מינויים) לעניין פיטורים או הפסקת כהונה?" },
];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function getJwt() {
  const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
  const tokenHash = data?.properties?.hashed_token;
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const v = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  return v.data.session.access_token;
}

async function call(jwt, q) {
  const evalRunId = `funnel-trace:${randomUUID()}`;
  const start = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
    body: JSON.stringify({
      question: q.question,
      taskMode: "research",
      evalRunId,
      evalVariant: "structured",
      requestId: `eval:${evalRunId}`,
    }),
  });
  const txt = await res.text();
  console.log(`Q${q.id}: status=${res.status} wall=${Date.now()-start}ms`);
  return { evalRunId, status: res.status };
}

const jwt = await getJwt();
console.log("JWT acquired");
const results = [];
for (const q of QUESTIONS) {
  console.log(`\n--- Calling Q${q.id} ---`);
  results.push(await call(jwt, q));
}
console.log("\nWaiting 3s for log writes...");
await new Promise(r => setTimeout(r, 3000));

for (const r of results) {
  const { data } = await admin.from("qa_logs")
    .select("question, metadata")
    .eq("user_id", ADMIN_USER_ID)
    .filter("metadata->>eval_run_id", "eq", r.evalRunId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (!data?.[0]) { console.log(`No log for ${r.evalRunId}`); continue; }
  const md = data[0].metadata;
  console.log(`\n=== ${data[0].question.slice(0,70)}... ===`);
  console.log("retrieval_funnel:", JSON.stringify(md.retrieval_funnel, null, 2));
  console.log("source_pack_summary:", JSON.stringify(md.source_pack_summary));
  console.log("source_type_counts:", JSON.stringify(md.source_type_counts));
}
