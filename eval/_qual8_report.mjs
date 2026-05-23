import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const RUNS = [
  ["17b82c90-ccf9-4bc4-9463-cfd159db7373", 1],
  ["5a190c2b-bc7a-4c8a-9107-e6ce11a5adda", 2],
  ["a55b154e-522d-4aee-ae6a-45f62a1c9869", 3],
  ["07170ee0-4b11-4bce-a192-03410c37c311", 4],
  ["a666c9ee-d761-4d00-9ef1-6b96489d989b", 5],
  ["8a0f245d-f625-4b37-a80b-84948b5bf8a8", 6],
  ["f9c361f0-b2c5-4081-a87a-ed06bcc9d38d", 7],
  ["30c6a3f5-99bd-4c40-960f-cf7d160640e4", 8],
];
const { data } = await admin.from("qa_logs")
  .select("id, question, answer, footnotes, metadata, total_footnotes, created_at")
  .in("id", RUNS.map(r=>r[0]));
const byId = new Map(data.map(d=>[d.id,d]));
for (const [id, idx] of RUNS) {
  const r = byId.get(id);
  console.log(`\n\n##### Q${idx}  id=${id} #####`);
  if (!r) { console.log("MISSING"); continue; }
  const md = r.metadata || {};
  const sr = md.core?.source_requirements || {};
  const cq = md.citation_quality || md.core?.citation_quality || {};
  const inj = sr.injection || {};
  const rec = sr.reconciliation || {};
  const reached = [];
  for (const role of Object.keys(inj.roles || {})) {
    if (rec.roles?.[role]?.reached_verifier) reached.push(role);
  }
  console.log("QUESTION:", r.question);
  console.log("pipeline_used:", md.pipeline_used);
  console.log("triggered_doctrines:", JSON.stringify(sr.triggered_doctrines || []));
  console.log("roles reached verifier:", JSON.stringify(reached));
  console.log("citation_quality.status:", cq.status);
  console.log("claims_lost_all_support:", md.core?.claims_lost_all_support ?? md.claims_lost_all_support ?? "n/a");
  console.log("footnotes_count:", r.total_footnotes, "/", (r.footnotes||[]).length);
  const removed = cq.removed || md.removed_citations || [];
  console.log("removed_citations:", JSON.stringify(removed).slice(0, 600));
  console.log("drafter_failure:", JSON.stringify(md.drafter_failure || null));
  console.log("\n--- ANSWER ---");
  console.log(r.answer || "(empty)");
  console.log("\n--- FOOTNOTES ---");
  (r.footnotes || []).forEach((f, i) => {
    const txt = typeof f === 'string' ? f : (f.text || f.citation || JSON.stringify(f));
    console.log(`[${i + 1}] ${txt}`);
  });
}
