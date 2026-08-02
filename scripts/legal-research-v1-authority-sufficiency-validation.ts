// Authority-type-aware sufficiency validation (10 queries, sequential).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const ALL = [
  { id: "P08", query: `מהם השלבים המעשיים להגשת תביעה קטנה בישראל, כולל סכום התביעה המרבי ואגרות?` },
  { id: "P12", query: `מה עושים אם המשכיר לא מחזיר את הפיקדון בתום תקופת השכירות?` },
  { id: "P10", query: `מהו הדין לגבי צוואות הדדיות לפי סעיף 8א לחוק הירושה?` },
  { id: "P14", query: `מתי בית המשפט מרים את מסך ההתאגדות בחברות משפחתיות?` },
  { id: "P07", query: `מהי דוקטרינת הבטלות היחסית במשפט המנהלי?` },
  { id: "P05", query: `מהי חובת תום הלב במשא ומתן לפי סעיף 12 לחוק החוזים?` },
  { id: "C2", query: `מה הפסיקה אומרת על הלכת השיתוף?` },
  { id: "P02", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
  { id: "P01", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל?` },
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const QUERIES = only.length ? ALL.filter((q) => only.includes(q.id)) : ALL;

const OUT = "reports/authority-sufficiency";
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
  const suf = dr.source_sufficiency ?? md?.source_sufficiency ?? null;
  const rec = {
    id: q.id,
    run_id: t.run_id,
    total_ms: Date.now() - t0,
    research_mode: md?.research_mode ?? md?.planner?.mode_plan?.mode ?? null,
    shape: md?.analyzer?.answer_intent?.output_shape ?? null,
    deterministic_branch: dr.deterministic_branch ?? null,
    sufficiency_profile: md?.sufficiency_profile ?? suf?.sufficiency_profile ?? null,
    authority_type_sufficiency_passed: md?.authority_type_sufficiency_passed ?? suf?.authority_type_sufficiency_passed ?? null,
    sufficiency_authority_basis: md?.sufficiency_authority_basis ?? suf?.sufficiency_authority_basis ?? null,
    statute_only_answer: md?.statute_only_answer ?? suf?.statute_only_answer ?? null,
    case_law_required: md?.case_law_required ?? suf?.case_law_required ?? null,
    case_law_missing_but_not_required: md?.case_law_missing_but_not_required ?? suf?.case_law_missing_but_not_required ?? null,
    sufficiency_reason: suf?.reason ?? null,
    used_sources: (dr.used_sources ?? []).length,
    is_stub: String(row.answer ?? "").includes("[stub]"),
    answer: String(row.answer ?? ""),
  };
  rows.push(rec);
  console.log(JSON.stringify({ ...rec, answer: rec.answer.slice(0, 400) }, null, 2));
  writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rows, null, 2));
  await new Promise((r) => setTimeout(r, 3000));
}
writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(rows, null, 2));
console.log("DONE");
