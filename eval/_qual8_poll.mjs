import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const RUNS = [
  ["qual8-1-13bada", 1], ["qual8-2-5eb0a2", 2], ["qual8-3-0f8e7c", 3], ["qual8-4-75552e", 4],
  ["qual8-5-a243a7", 5], ["qual8-6-8c9533", 6], ["qual8-7-8f8a01", 7], ["qual8-8-78ef71", 8],
];

async function fetchAll() {
  const out = [];
  for (const [eid, idx] of RUNS) {
    const { data } = await admin.from("qa_logs")
      .select("id, question, answer, footnotes, metadata, created_at")
      .filter("metadata->>eval_run_id", "eq", eid)
      .order("created_at", { ascending: false }).limit(1);
    out.push({ idx, eid, row: data?.[0] || null });
  }
  return out;
}

const start = Date.now();
let last;
while (Date.now() - start < 15 * 60 * 1000) {
  const rows = await fetchAll();
  const done = rows.filter(r => r.row && r.row.answer);
  console.log(`t=${Math.round((Date.now() - start) / 1000)}s done=${done.length}/8 ` + rows.map(r => r.row?.answer ? '✓' : (r.row ? '·' : '_')).join(''));
  last = rows;
  if (done.length === 8) break;
  await new Promise(r => setTimeout(r, 20000));
}

console.log("\n\n========= RESULTS =========");
for (const { idx, eid, row } of last) {
  console.log(`\n\n##### Q${idx} eid=${eid} #####`);
  if (!row) { console.log("NO ROW"); continue; }
  const md = row.metadata || {};
  const sr = md.core?.source_requirements || {};
  const cq = md.citation_quality || md.core?.citation_quality || {};
  const inj = sr.injection || {};
  const rec = sr.reconciliation || {};
  const reached = [];
  for (const role of Object.keys(inj.roles || {})) {
    if (rec.roles?.[role]?.reached_verifier) reached.push(role);
  }
  console.log("qa_log_id:", row.id);
  console.log("question:", row.question);
  console.log("pipeline_used:", md.pipeline_used);
  console.log("triggered_doctrines:", JSON.stringify(sr.triggered_doctrines || []));
  console.log("roles reached verifier:", JSON.stringify(reached));
  console.log("citation_quality.status:", cq.status);
  console.log("claims_lost_all_support:", md.core?.claims_lost_all_support ?? md.claims_lost_all_support ?? "n/a");
  console.log("footnotes_count:", (row.footnotes || []).length);
  const removed = cq.removed || md.removed_citations || [];
  console.log("removed_citations:", JSON.stringify(removed).slice(0, 800));
  console.log("\n--- ANSWER ---");
  console.log(row.answer || "(empty)");
  console.log("\n--- FOOTNOTES ---");
  (row.footnotes || []).forEach((f, i) => {
    const txt = typeof f === 'string' ? f : (f.text || f.citation || JSON.stringify(f));
    console.log(`[${i + 1}] ${txt}`);
  });
}
