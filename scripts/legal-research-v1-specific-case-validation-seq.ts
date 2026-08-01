// Clean SEQUENTIAL specific-case authority resolution validation.
// One case at a time; waits for its qa_logs row before starting the next.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const LABEL = `seq-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const QUERIES = [
  { id: "P01", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל?` },
  { id: "P13", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
  { id: "P02", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
  { id: "B2", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל ביחס להקצאת קרקעות למגורים על בסיס לאום?` },
  { id: "M1", query: `מה נקבע בע"א 6821/93 בנק המזרחי נ' מגדל כפר שיתופי?` },
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
];

const OUT = "reports/specific-case-authority-validation-seq";
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
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

const rows: any[] = [];
for (const q of QUERIES) {
  const t0 = Date.now();
  const t = await trigger(q.query).catch(() => ({} as { run_id?: string }));
  console.log(`[${LABEL}][${q.id}] triggered run_id=${t.run_id}`);
  if (!t.run_id) { rows.push({ id: q.id, query: q.query, error: "trigger_failed" }); continue; }
  const row = await poll(t.run_id);
  if (!row) { rows.push({ id: q.id, query: q.query, run_id: t.run_id, error: "poll_timeout" }); continue; }
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify({ id: q.id, query: q.query, run_id: t.run_id, ...row }, null, 2));
  const md = (row.metadata ?? {}) as any;
  const dr = md?.drafter ?? {};
  const sc = dr.specific_case_resolution ?? md?.retrieval?.specific_case_resolution ?? md?.specific_case_resolution ?? {};
  const rec = {
    id: q.id,
    query: q.query,
    run_id: t.run_id,
    total_ms: Date.now() - t0,
    mode: md?.planner?.mode_plan?.mode ?? md?.research_mode ?? null,
    output_shape: md?.analyzer?.answer_intent?.output_shape ?? null,
    deterministic_branch: dr.deterministic_branch ?? null,
    requested_docket_normalized: sc.requested_docket_normalized ?? null,
    exact_docket_source_found: sc.exact_docket_source_found ?? null,
    exact_docket_source_title: sc.exact_docket_source_title ?? null,
    exact_docket_source_url: sc.exact_docket_source_url ?? null,
    text_acquisition_attempted: sc.text_acquisition_attempted ?? null,
    acquisition_method: sc.acquisition_method ?? null,
    acquisition_success: sc.acquisition_success ?? null,
    acquisition_failure_reason: sc.acquisition_failure_reason ?? null,
    acquired_text_length: sc.acquired_text_length ?? 0,
    final_docket_branch_reason: sc.final_docket_branch_reason ?? null,
    near_match_sources_ignored_count: sc.near_match_sources_ignored_count ?? 0,
    used_sources: (dr.used_sources ?? []).length,
    answer_drafted: !dr.deterministic_branch,
    is_stub: String(row.answer ?? "").includes("[stub]"),
    answer: String(row.answer ?? ""),
  };
  rows.push(rec);
  console.log(JSON.stringify({ ...rec, answer: rec.answer.slice(0, 200) }, null, 2));
  writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rows, null, 2));
  await new Promise((r) => setTimeout(r, 3000));
}

writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rows, null, 2));
console.log("DONE", LABEL);
