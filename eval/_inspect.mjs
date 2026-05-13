import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data } = await admin.from("qa_logs")
  .select("id, created_at, metadata")
  .eq("user_id", "c6b2fdbf-a50c-411f-9941-41f9dff80eba")
  .filter("metadata->>eval_variant", "eq", "router-phase1")
  .order("created_at", { ascending: false }).limit(5);
for (const r of data) {
  console.log("---", r.id, r.created_at);
  const sg = r.metadata?.research_safeguards;
  console.log("safeguards keys:", sg ? Object.keys(sg) : "MISSING");
  console.log("router:", JSON.stringify(sg?.router, null, 2));
}
