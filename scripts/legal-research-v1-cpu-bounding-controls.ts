// CPU-bounding track controls: R01 / P02 / B2 / S1 / B8 (sequential).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  { id: "R01", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל?` },
  { id: "P02", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
  { id: "B2", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל ביחס להקצאת קרקעות למגורים על בסיס לאום?` },
  { id: "S1", query: `מה נקבע בת"א 1234/09 כהן נ' לוי בעניין הפרת חוזה?` },
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
];

const OUT = "reports/cpu-bounding-controls";
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
  const j = await fetch(`${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,completed_stages,error,result&id=eq.${run_id}&limit=1`, { headers });
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
  const identity = dr.specific_case_identity ?? md?.specific_case_identity ?? {};
  const rec = {
    id: q.id,
    run_id: t.run_id,
    total_ms: Date.now() - t0,
    pipeline_total_ms: md?.total_ms ?? null,
    job_status: job?.status ?? null,
    job_error: job?.error ?? null,
    completed_stages: job?.completed_stages ?? null,
    mode: md?.planner?.mode_plan?.mode ?? md?.research_mode ?? null,
    deterministic_branch: dr.deterministic_branch ?? null,
    budget: {
      deadline_ms: budget.deadline_ms ?? null,
      elapsed_ms: budget.elapsed_ms ?? null,
      guard_triggered: budget.guard_triggered ?? null,
      guard_triggered_at: budget.guard_triggered_at ?? null,
      checkpoints: (budget.checkpoints ?? []).map((c: any) => `${c.name}@${c.at_ms}`),
    },
    fast_lane: sc.fast_lane ?? null,
    perplexity_query_count: rt?.perplexity?.query_count ?? null,
    web_retrieval_skipped: rt?.web_retrieval_skipped ?? null,
    exact_docket_source_found: sc.exact_docket_source_found ?? null,
    acquisition_success: sc.acquisition_success ?? null,
    acquired_text_length: sc.acquired_text_length ?? 0,
    final_docket_branch_reason: sc.final_docket_branch_reason ?? null,
    identity_passed: identity.passed ?? null,
    identity_matched_by: identity.matched_by ?? null,
    used_sources_count: (dr.used_sources ?? []).length,
    footnote1: (row.footnotes ?? [])[0] ? { title: (row.footnotes as any[])[0]?.title, url: (row.footnotes as any[])[0]?.url } : null,
    is_stub: String(row.answer ?? "").includes("[stub]"),
    answer_head: String(row.answer ?? "").slice(0, 400),
  };
  rows.push(rec);
  console.log(JSON.stringify(rec, null, 2));
  writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rows, null, 2));
  await new Promise((r) => setTimeout(r, 3000));
}
writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rows, null, 2));
console.log("DONE");
