// specific_case judgment identity + title recovery validation (sequential).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  { id: "R02", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
  { id: "R01", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל?` },
  { id: "P02", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
  { id: "B2", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל ביחס להקצאת קרקעות למגורים על בסיס לאום?` },
  { id: "S1", query: `מה נקבע בת"א 1234/09 כהן נ' לוי בעניין הפרת חוזה?` },
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
];

const OUT = "reports/specific-case-identity-validation";
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
    const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
    if (r.ok) { const rows = await r.json(); if (Array.isArray(rows) && rows.length) return rows[0]; }
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
  const row = await poll(t.run_id);
  if (!row) { rows.push({ id: q.id, run_id: t.run_id, error: "poll_timeout" }); continue; }
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify({ id: q.id, query: q.query, run_id: t.run_id, ...row }, null, 2));
  const md = (row.metadata ?? {}) as any;
  const dr = md?.drafter ?? {};
  const idn = md?.retrieval?.specific_case_identity ?? md?.specific_case_identity ?? {};
  const sc = md?.retrieval?.specific_case_resolution ?? {};
  const fns = (row.footnotes ?? []) as any[];
  const rec = {
    id: q.id,
    query: q.query,
    run_id: t.run_id,
    total_ms: Date.now() - t0,
    mode: md?.planner?.mode_plan?.mode ?? null,
    shape: md?.analyzer?.answer_intent?.output_shape ?? null,
    deterministic_branch: dr.deterministic_branch ?? null,
    identity: {
      required: idn.specific_case_identity_required ?? null,
      requested_docket: idn.requested_docket ?? null,
      requested_case_title: idn.requested_case_title ?? null,
      matched_judgment_ref: idn.matched_judgment_ref ?? null,
      matched_by: idn.matched_by ?? null,
      title_recovery_attempted: idn.title_recovery_attempted ?? null,
      title_recovery_success: idn.title_recovery_success ?? null,
      recovered_title: idn.recovered_title ?? null,
      generic_title_detected: idn.generic_title_detected ?? null,
      passed: idn.specific_case_identity_passed ?? null,
      failure_reason: idn.specific_case_identity_failure_reason ?? null,
      title_recoveries: idn.title_recoveries ?? [],
    },
    acquisition_success: sc.acquisition_success ?? null,
    used_sources_count: (dr.used_sources ?? []).length,
    footnote1: fns[0] ? { title: fns[0].title ?? fns[0].display_title ?? null, url: fns[0].url ?? null } : null,
    used_sources: (dr.used_sources ?? []).map((u: any) => u.title),
    is_stub: String(row.answer ?? "").includes("[stub]"),
    answer_head: String(row.answer ?? "").slice(0, 400),
  };
  rows.push(rec);
  console.log(JSON.stringify(rec, null, 2));
  writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rows, null, 2));
}

writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rows, null, 2));
console.log("DONE");
