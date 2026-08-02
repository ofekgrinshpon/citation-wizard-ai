// Confirmation run: P01 (real docket) + P02 (fake docket) only.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  { id: "P01", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל?` },
  { id: "P02", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
];

const OUT = "reports/specific-case-p01-p02-confirm";
mkdirSync(OUT, { recursive: true });

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string };
}

async function poll(run_id: string, timeoutMs = 900_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
    if (r.ok) { const rows = await r.json(); if (Array.isArray(rows) && rows.length) return rows[0]; }
    const j = await fetch(`${SUPABASE_URL}/rest/v1/legal_research_jobs?select=status,current_stage,error&run_id=eq.${run_id}&limit=1`, { headers });
    if (j.ok) { const jr = await j.json(); if (Array.isArray(jr) && jr[0]?.status === "failed") return { failed: jr[0] }; }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

const rows: any[] = [];
for (const q of QUERIES) {
  const t0 = Date.now();
  const t = await trigger(q.query).catch(() => ({} as { run_id?: string }));
  console.log(`[${q.id}] run_id=${t.run_id}`);
  if (!t.run_id) { rows.push({ id: q.id, error: "trigger_failed" }); continue; }
  const row: any = await poll(t.run_id);
  if (!row) { rows.push({ id: q.id, run_id: t.run_id, error: "poll_timeout" }); continue; }
  if (row.failed) { rows.push({ id: q.id, run_id: t.run_id, error: "job_failed", detail: row.failed }); continue; }
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify({ id: q.id, query: q.query, run_id: t.run_id, ...row }, null, 2));
  const md = (row.metadata ?? {}) as any;
  const dr = md?.drafter ?? {};
  const sc = dr.specific_case_resolution ?? md?.retrieval?.specific_case_resolution ?? md?.specific_case_resolution ?? {};
  const rec = {
    id: q.id,
    run_id: t.run_id,
    total_ms: Date.now() - t0,
    mode: md?.planner?.mode_plan?.mode ?? md?.research_mode ?? null,
    deterministic_branch: dr.deterministic_branch ?? null,
    exact_docket_source_found: sc.exact_docket_source_found ?? null,
    exact_docket_source_url: sc.exact_docket_source_url ?? null,
    acquisition_methods_attempted: sc.acquisition_methods_attempted ?? [],
    acquired_text_length: sc.acquired_text_length ?? 0,
    acquisition_success: sc.acquisition_success ?? null,
    acquisition_method_successful: sc.acquisition_method_successful ?? null,
    acquisition_failure_reasons: sc.acquisition_failure_reasons ?? [],
    last_acquisition_failure_reason: sc.last_acquisition_failure_reason ?? null,
    final_docket_branch_reason: sc.final_docket_branch_reason ?? null,
    allow_case_holding_answer: sc.allow_case_holding_answer ?? null,
    used_sources: (dr.used_sources ?? []).length,
    is_stub: String(row.answer ?? "").includes("[stub]"),
    answer: String(row.answer ?? ""),
  };
  rows.push(rec);
  console.log(JSON.stringify(rec, null, 2));
  writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rows, null, 2));
  await new Promise((r) => setTimeout(r, 3000));
}
writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rows, null, 2));
console.log("DONE");
