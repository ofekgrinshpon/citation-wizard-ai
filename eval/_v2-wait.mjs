// Wait for a Deep V2 run to finish and report metadata.
// Usage: RUN_ID=<uuid> node eval/_v2-wait.mjs
//    or: EVAL_RUN_ID=v2one-Q2-abcdef node eval/_v2-wait.mjs
// Polls qa_logs up to ~9.5 min then exits (safe under 600s exec cap).
// Re-run with same RUN_ID/EVAL_RUN_ID to keep waiting.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const RUN_ID = process.env.RUN_ID;
const EVAL_RUN_ID = process.env.EVAL_RUN_ID;
if (!RUN_ID && !EVAL_RUN_ID) {
  console.error("Provide RUN_ID=<uuid> or EVAL_RUN_ID=<tag>");
  process.exit(1);
}

async function fetchRow() {
  let q = admin.from("qa_logs")
    .select("id, answer, footnotes, metadata, created_at")
    .eq("user_id", ADMIN_USER_ID)
    .order("created_at", { ascending: false }).limit(1);
  if (RUN_ID) q = q.eq("id", RUN_ID);
  else q = q.filter("metadata->>eval_run_id", "eq", EVAL_RUN_ID);
  const { data } = await q;
  return data?.[0] || null;
}

function isTerminal(r) {
  if (!r) return false;
  const cp = r.metadata?.checkpoint;
  if (cp === "completed" || cp === "failed" || cp === "drafting_failed" || cp === "error") return true;
  if (r.metadata?.fallback) return true;
  if (r.answer && r.answer.length > 100 && (r.metadata?.v2_path || r.metadata?.drafter)) return true;
  return false;
}

const t0 = Date.now();
const MAX_POLLS = 140; // 140 × 4s ≈ 9.3 min
let row = await fetchRow();
let k = 0;
while (!isTerminal(row) && k < MAX_POLLS) {
  await new Promise((r) => setTimeout(r, 4000));
  row = await fetchRow();
  k++;
  if (k % 10 === 0) {
    console.log(`  ...${4 * k}s  checkpoint=${row?.metadata?.checkpoint || "?"} v2_path=${row?.metadata?.v2_path || "?"} ans_len=${row?.answer?.length || 0}`);
  }
}

if (!row) { console.log("⚠ NO ROW found"); process.exit(2); }
const terminal = isTerminal(row);
console.log(`\n── REPORT row=${row.id} terminal=${terminal} wall=${Date.now() - t0}ms`);

const md = row.metadata || {};
const rp = md.research_plan_v2 || {};
const rt = md.retrieval_v2 || {};
const lg = md.ledger_v2 || {};
const dr = md.drafter || {};
const tel = md.retrieval_telemetry || rt.telemetry || {};
const fns = row.footnotes || [];

console.log(`v2_path=${md.v2_path || "(none)"} checkpoint=${md.checkpoint || "(none)"} fallback=${md.fallback ? JSON.stringify(md.fallback) : "none"}`);
console.log(`plan.claim_count=${rp.claim_count ?? "?"}`);
console.log(`retrieval.total_candidates=${rt.total_candidates ?? "?"} claims_with_zero=${rt.claims_with_zero_candidates ?? "?"}`);
console.log(`timeouts: text=${tel.text_timeouts ?? tel.rpc_timeouts ?? 0} vector=${tel.vector_timeouts ?? 0} broken_drops=${tel.broken_title_drops ?? 0}`);
console.log(`ledger: kept=${lg.kept ?? "?"} dropped=${lg.dropped ?? "?"} supported=${lg.supported ?? "?"} partial=${lg.partially_supported ?? "?"}`);
console.log(`drafter: answer_len=${dr.answer_len ?? row.answer?.length ?? 0} footnotes_n=${dr.footnotes_n ?? fns.length} source_ids=${(dr.source_ids_used || []).join(",")}`);
console.log(`footnote_titles (${fns.length}):`);
for (const f of fns) {
  const t = (f.title || f.citation || "").slice(0, 110);
  const flag = /פרטי מסמך|^Home$|^Download$|^פסק דין$|^החלטה$|מרכז המחקר והמידע/.test(t) ? " ⚠JUNK" : "";
  console.log(`  - ${t}${flag}`);
}
if (!terminal) {
  console.log(`\n⏳ NOT TERMINAL yet. Re-run: RUN_ID=${row.id} node eval/_v2-wait.mjs`);
  process.exit(3);
}
console.log("\nWAIT_DONE");
