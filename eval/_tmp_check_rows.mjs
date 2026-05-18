import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ids = ["a2557386-9a8e-4062-be08-8c79c37fd19d","e1046f8c-2fd3-4859-8d7b-247420e019fd","0be99c59-7f90-4d84-b3af-5a89bfe2422a"];
const { data } = await admin.from("qa_logs").select("id, created_at, total_footnotes, metadata, answer").in("id", ids);
for (const r of data) {
  const md = r.metadata || {};
  console.log("\n---", r.id);
  console.log("  checkpoint:", md.checkpoint, "checkpoint_at:", md.checkpoint_at, "async_run:", md.async_run);
  console.log("  answer_len:", (r.answer||"").length, "total_footnotes:", r.total_footnotes);
  console.log("  metadata keys:", Object.keys(md).join(","));
}
