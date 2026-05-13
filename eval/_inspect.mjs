import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await admin.from("qa_logs")
  .select("id, created_at, metadata")
  .eq("user_id", "c6b2fdbf-a50c-411f-9941-41f9dff80eba")
  .order("created_at", { ascending: false }).limit(8);
if (error) { console.error(error); process.exit(1); }
console.log("rows:", data.length);
for (const r of data) {
  const md = r.metadata ?? {};
  console.log("---", r.id, r.created_at, "eval_run_id=", md.eval_run_id, "variant=", md.eval_variant);
  console.log("metadata top keys:", Object.keys(md));
  const sg = md.research_safeguards;
  console.log("safeguards:", sg ? Object.keys(sg) : "MISSING");
  if (sg?.router) console.log("router keys:", Object.keys(sg.router), "route?", !!sg.router.route);
  console.log("stage_runs stages:", (md.stage_runs ?? []).map(s => `${s.stage}:${s.status}`).join(", "));
}
