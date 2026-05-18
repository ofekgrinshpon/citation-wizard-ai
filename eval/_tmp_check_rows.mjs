import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ids = ["a2557386-9a8e-4062-be08-8c79c37fd19d","e1046f8c-2fd3-4859-8d7b-247420e019fd","0be99c59-7f90-4d84-b3af-5a89bfe2422a"];
const { data } = await admin.from("qa_logs").select("id, created_at, total_footnotes, metadata, answer").in("id", ids);
for (const r of data) {
  const md = r.metadata || {};
  console.log("\n---", r.id, "created:", r.created_at, "footnotes:", r.total_footnotes);
  console.log("  v3_path:", md.v3_path, "v2_path:", md.v2_path, "drafting_path:", md.drafting_path);
  console.log("  has v3_legal_research_plan:", !!md.v3_legal_research_plan, "has v3_anchor_fallback:", !!md.v3_anchor_fallback);
  console.log("  has retrieval_v2:", !!md.retrieval_v2, "ledger_v2:", !!md.ledger_v2, "verification_v2:", !!md.verification_v2);
  console.log("  answer_len:", (r.answer||"").length);
  console.log("  metadata keys:", Object.keys(md).slice(0,30).join(","));
}
