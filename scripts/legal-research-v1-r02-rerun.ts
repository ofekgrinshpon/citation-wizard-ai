import { mkdirSync, writeFileSync } from "node:fs";
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const QUERY = `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?`;
const OUT = "reports/r02-rerun"; mkdirSync(OUT, { recursive: true });
const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
const t0 = Date.now();
const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, { method: "POST", headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" }, body: JSON.stringify({ question: QUERY, smoke_user_id: SMOKE_USER_ID }) });
const trig: any = await r.json().catch(() => ({}));
const run_id = trig?.run_id;
console.log("TRIGGER", r.status, JSON.stringify(trig).slice(0, 400));
if (!run_id) { console.log("TRIGGER_FAILED"); process.exit(1); }
async function jobRow() {
  const j = await fetch(`${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,completed_stages,error&id=eq.${run_id}&limit=1`, { headers });
  if (!j.ok) return null; const jr = await j.json(); return Array.isArray(jr) ? jr[0] ?? null : null;
}
let job: any = null;
const gate = Date.now() + 120_000;
while (Date.now() < gate) { job = await jobRow(); if (job) break; await new Promise(s => setTimeout(s, 5000)); }
console.log("JOB_GATE", JSON.stringify({ run_id, job, elapsed_s: Math.round((Date.now()-t0)/1000) }));
if (!job) { console.log("JOB_PERSISTENCE_FAILURE"); writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify({ run_id, error: "no_job_row_120s" }, null, 2)); process.exit(2); }
let row: any = null;
const deadline = Date.now() + 900_000;
while (Date.now() < deadline) {
  const q = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
  if (q.ok) { const rows = await q.json(); if (Array.isArray(rows) && rows.length) { row = rows[0]; break; } }
  job = await jobRow();
  if (job?.status === "failed") { row = { failed: job }; break; }
  console.log("POLL", Math.round((Date.now()-t0)/1000)+"s", job?.status, job?.current_stage);
  await new Promise(s => setTimeout(s, 10000));
}
job = await jobRow();
writeFileSync(`${OUT}/RAW.json`, JSON.stringify({ run_id, job, row, total_ms: Date.now()-t0 }, null, 2));
if (!row) { console.log("POLL_TIMEOUT", JSON.stringify(job)); process.exit(3); }
if (row.failed) { console.log("JOB_FAILED", JSON.stringify(job)); process.exit(4); }
const md = row.metadata ?? {}; const dr = md.drafter ?? {}; const rt = md.retrieval ?? {};
const sc = dr.specific_case_resolution ?? rt.specific_case_resolution ?? md.specific_case_resolution ?? {};
const budget = rt.retrieval_budget ?? md.retrieval_budget ?? {};
const identity = dr.specific_case_identity ?? rt.specific_case_identity ?? md.specific_case_identity ?? {};
const fns = (row.footnotes ?? []) as any[];
const rec = { run_id, job_id: job?.id, job_status: job?.status, total_ms: Date.now()-t0, pipeline_total_ms: md.total_ms ?? null,
  mode: md?.planner?.mode_plan?.mode ?? md?.research_mode ?? null,
  deterministic_branch: dr.deterministic_branch ?? null,
  drafted: !dr.deterministic_branch || !/limitation|refus/i.test(String(dr.deterministic_branch)),
  retrieval_elapsed_ms: budget.elapsed_ms ?? null, guard_triggered: budget.guard_triggered ?? null,
  fast_lane: sc.fast_lane ?? md.fast_lane ?? null,
  exact_docket_source_found: sc.exact_docket_source_found ?? null,
  exact_docket_source_usable: sc.exact_docket_source_usable ?? null,
  exact_docket_candidate_id: sc.exact_docket_candidate_id ?? null,
  acquisition_success: sc.acquisition_success ?? null,
  acquired_text_length: sc.acquired_text_length ?? 0,
  final_docket_branch_reason: sc.final_docket_branch_reason ?? null,
  specific_case_identity_passed: identity.specific_case_identity_passed ?? identity.passed ?? null,
  identity_failure_reason: identity.specific_case_identity_failure_reason ?? null,
  used_sources_count: (dr.used_sources ?? []).length,
  footnotes: fns.slice(0,5).map(f => ({ title: f?.title, url: f?.url, type: f?.source_type })),
  is_stub: String(row.answer ?? "").includes("[stub]"),
  verifier: md.verifier?.status ?? null,
  answer_head: String(row.answer ?? "").slice(0, 700) };
writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rec, null, 2));
console.log("RESULT", JSON.stringify(rec, null, 2));
