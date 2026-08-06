// Validation for the derived-URL silent-hang fix.
// Runs G02 then R02 strictly sequentially and records the terminal job state.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const OUT = "reports/hang-fix-validation";
mkdirSync(OUT, { recursive: true });
const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };

const FIXTURES: Array<{ id: string; query: string }> = [
  {
    id: "G02",
    query:
      `מה נקבע בע"א 6821/93 בנק המזרחי נ' מגדל כפר שיתופי ביחס לסמכות בית המשפט לבטל חוק הסותר חוק יסוד?`,
  },
  { id: "R02", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
];

const only = process.argv[2];

async function jobRow(jobId: string) {
  const j = await fetch(
    `${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,completed_stages,error,result,created_at,updated_at&id=eq.${jobId}&limit=1`,
    { headers },
  );
  if (!j.ok) return null;
  const jr = await j.json();
  return Array.isArray(jr) ? jr[0] ?? null : null;
}

async function run(f: { id: string; query: string }) {
  const t0 = Date.now();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question: f.query, smoke_user_id: SMOKE_USER_ID }),
  });
  const trig: any = await r.json().catch(() => ({}));
  const run_id = trig?.run_id;
  const job_id = trig?.job_id ?? run_id;
  console.log(`[${f.id}] TRIGGER`, r.status, JSON.stringify({ run_id, job_id }));
  if (!job_id) return { id: f.id, error: "trigger_failed", trig };

  let job: any = null;
  const deadline = Date.now() + 720_000;
  while (Date.now() < deadline) {
    job = await jobRow(job_id);
    if (job && job.status !== "running" && job.status !== "queued") break;
    const cps = job?.result?.retrieval_checkpoints ?? [];
    console.log(
      `[${f.id}] POLL`,
      Math.round((Date.now() - t0) / 1000) + "s",
      job?.status,
      job?.current_stage,
      "last_cp=" + (cps.length ? cps[cps.length - 1].name : "-"),
    );
    await new Promise((s) => setTimeout(s, 10000));
  }
  job = await jobRow(job_id);

  const q = await fetch(
    `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`,
    { headers },
  );
  const rows = q.ok ? await q.json() : [];
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  const md = row?.metadata ?? {};
  const rt = md.retrieval ?? {};
  const dr = md.drafter ?? {};
  const sc = dr.specific_case_resolution ?? rt.specific_case_resolution ??
    md.limitation?.specific_case ?? {};
  const budget = rt.retrieval_budget ?? {};

  const rec = {
    id: f.id,
    run_id,
    job_id,
    wall_ms: Date.now() - t0,
    job_status: job?.status ?? null,
    job_error: job?.error ?? null,
    terminal: job?.status === "done" || job?.status === "error" || job?.status === "failed",
    stuck_running_with_null_error: job?.status === "running" && !job?.error,
    phase: md.phase ?? null,
    limitation_reason: md.limitation?.reason ?? null,
    retrieval_elapsed_ms: budget.elapsed_ms ?? null,
    guard_triggered: budget.guard_triggered ?? null,
    checkpoints: (budget.checkpoints ?? []).map((c: any) => `${c.name}@${c.at_ms}`),
    derived_urls_probed: sc.derived_urls_probed ?? null,
    derived_url_resolved: sc.derived_url_resolved ?? null,
    budget_exceeded: sc.budget_exceeded ?? null,
    probe_stages: (sc.probe_stages ?? []).map((s: any) => `${s.name}@${s.at_ms}`),
    acquisition_success: sc.acquisition_success ?? null,
    acquisition_failure_reasons: sc.acquisition_failure_reasons ?? null,
    exact_docket_source_usable: sc.exact_docket_source_usable ?? null,
    footnotes_count: (row?.footnotes ?? []).length,
    answer_head: String(row?.answer ?? "").slice(0, 400),
  };
  writeFileSync(`${OUT}/${f.id}.json`, JSON.stringify(rec, null, 2));
  console.log(`[${f.id}] DONE`, JSON.stringify({
    status: rec.job_status,
    error: rec.job_error,
    stuck: rec.stuck_running_with_null_error,
    acq: rec.acquisition_success,
  }));
  return rec;
}

const results = [];
for (const f of FIXTURES) {
  if (only && f.id !== only) continue;
  results.push(await run(f));
}
writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(results, null, 2));
console.log("SUMMARY", JSON.stringify(results.map((r: any) => ({
  id: r.id,
  status: r.job_status,
  error: r.job_error,
  stuck: r.stuck_running_with_null_error,
})), null, 2));
