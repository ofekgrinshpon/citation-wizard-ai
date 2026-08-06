// Fast-lane persistence fix validation: R01 / B2 / R02 (sequential, no code changes).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  { id: "R01", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל?` },
  { id: "B2", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל ביחס להקצאת קרקעות למגורים על בסיס לאום?` },
  { id: "R02", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
];

const OUT = "reports/fastlane-persistence-validation";
mkdirSync(OUT, { recursive: true });
const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string };
}

async function poll(run_id: string, timeoutMs = 900_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
    if (r.ok) { const rows = await r.json(); if (Array.isArray(rows) && rows.length) return rows[0]; }
    const j = await fetch(`${SUPABASE_URL}/rest/v1/legal_research_jobs?select=status,current_stage,error,result&id=eq.${run_id}&limit=1`, { headers });
    if (j.ok) { const jr = await j.json(); if (Array.isArray(jr) && jr[0]?.status === "failed") return { failed: jr[0] }; }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

async function jobRow(run_id: string) {
  const j = await fetch(`${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,completed_stages,error&id=eq.${run_id}&limit=1`, { headers });
  if (!j.ok) return null;
  const jr = await j.json();
  return Array.isArray(jr) ? jr[0] ?? null : null;
}

const rows: any[] = [];
for (const q of QUERIES) {
  const t0 = Date.now();
  const t = await trigger(q.query).catch(() => ({} as { run_id?: string }));
  console.log(`[${q.id}] run_id=${t.run_id}`);
  if (!t.run_id) { rows.push({ id: q.id, error: "trigger_failed" }); continue; }
  const row: any = await poll(t.run_id);
  const job = await jobRow(t.run_id);
  if (!row) { rows.push({ id: q.id, run_id: t.run_id, error: "poll_timeout", job }); writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rows, null, 2)); continue; }
  if (row.failed) { rows.push({ id: q.id, run_id: t.run_id, error: "job_failed", detail: row.failed }); writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rows, null, 2)); continue; }
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify({ id: q.id, query: q.query, run_id: t.run_id, job, ...row }, null, 2));
  const md = (row.metadata ?? {}) as any;
  const dr = md?.drafter ?? {};
  const rt = md?.retrieval ?? {};
  const sc = dr.specific_case_resolution ?? rt.specific_case_resolution ?? md?.specific_case_resolution ?? {};
  const budget = rt.retrieval_budget ?? md?.retrieval_budget ?? {};
  const identity = dr.specific_case_identity ?? rt.specific_case_identity ?? md?.specific_case_identity ?? {};
  const fns = (row.footnotes ?? []) as any[];
  const rec = {
    id: q.id,
    run_id: t.run_id,
    total_ms: Date.now() - t0,
    pipeline_total_ms: md?.total_ms ?? null,
    job_status: job?.status ?? null,
    job_error: job?.error ?? null,
    mode: md?.planner?.mode_plan?.mode ?? md?.research_mode ?? null,
    deterministic_branch: dr.deterministic_branch ?? null,
    drafted: !dr.deterministic_branch || !/limitation|refus/i.test(String(dr.deterministic_branch)),
    retrieval_elapsed_ms: budget.elapsed_ms ?? null,
    guard_triggered: budget.guard_triggered ?? null,
    fast_lane: sc.fast_lane ?? md?.fast_lane ?? null,
    exact_docket_source_found: sc.exact_docket_source_found ?? null,
    exact_docket_source_usable: sc.exact_docket_source_usable ?? null,
    exact_docket_candidate_id: sc.exact_docket_candidate_id ?? md?.exact_docket_candidate_id ?? null,
    injected_candidate_id: sc.injected_candidate_id ?? null,
    specific_case_forced_usable: md?.specific_case_forced_usable ?? dr.specific_case_forced_usable ?? null,
    acquisition_success: sc.acquisition_success ?? null,
    acquired_text_length: sc.acquired_text_length ?? 0,
    final_docket_branch_reason: sc.final_docket_branch_reason ?? null,
    specific_case_identity_passed: identity.specific_case_identity_passed ?? identity.passed ?? null,
    identity_failure_reason: identity.specific_case_identity_failure_reason ?? null,
    used_sources_count: (dr.used_sources ?? []).length,
    footnotes: fns.slice(0, 4).map((f) => ({ title: f?.title, url: f?.url, type: f?.source_type })),
    is_stub: String(row.answer ?? "").includes("[stub]"),
    verifier_failure: md?.verifier?.recovery_applied ?? md?.verifier?.failure ?? null,
    answer_head: String(row.answer ?? "").slice(0, 700),
  };
  rows.push(rec);
  console.log(JSON.stringify(rec, null, 2));
  writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rows, null, 2));
  await new Promise((r) => setTimeout(r, 3000));
}
writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rows, null, 2));
console.log("DONE");
