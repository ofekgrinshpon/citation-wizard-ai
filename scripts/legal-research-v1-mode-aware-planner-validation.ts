// Mode-aware planner validation: 7 research-mode queries, planner-plan focus.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  { id: "M1-specific-case", query: `מה נקבע בע"א 6821/93 בנק המזרחי?` },
  { id: "M2-statute-section", query: `מה קובע סעיף 12 לחוק החוזים?` },
  { id: "M3-synthesis", query: `מה הפסיקה אומרת על הלכת השיתוף?` },
  { id: "M4-doctrine", query: `מהי חובת תום הלב במשא ומתן?` },
  { id: "M5-practical", query: `מה עושים אם המשכיר לא מחזיר פיקדון?` },
  { id: "M6-quote", query: `צטט את סעיף 1 לחוק-יסוד: כבוד האדם וחירותו` },
  { id: "M7-false-doctrine", query: `מה הפסיקה אומרת על הלכת יורש אחר יורש?` },
];

const OUT = "reports/mode-aware-planner";
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

const triggered: Array<{ id: string; query: string; run_id: string | null }> = [];
for (const q of QUERIES) {
  const t = await trigger(q.query).catch(() => ({} as { run_id?: string }));
  console.log(`[${q.id}] run_id=${t.run_id}`);
  triggered.push({ ...q, run_id: t.run_id ?? null });
  await new Promise((r) => setTimeout(r, 1500));
}

const results = await Promise.all(triggered.map(async ({ id, query, run_id }) => {
  if (!run_id) return { id, query, error: "trigger_failed" };
  const row = await poll(run_id);
  if (!row) return { id, query, run_id, error: "poll_timeout" };
  const md = (row.metadata ?? {}) as Record<string, any>;
  const out = {
    id, query, run_id, qa_log_id: row.id,
    research_mode: md.planning?.research_mode ?? null,
    mode_plan: md.planning?.planner?.mode_plan ?? null,
    queries: md.planning?.queries ?? md.retrieval?.queries ?? null,
    answer_head: String(row.answer ?? "").slice(0, 400),
    metadata: md,
  };
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify(out, null, 2));
  const mp = out.mode_plan;
  console.log(`[${id}] mode=${mp?.mode} unsat=${JSON.stringify(mp?.audit?.unsatisfied)} widened=${mp?.target_enforcement?.widened_query_count}`);
  return out;
}));

writeFileSync(`${OUT}/_all.json`, JSON.stringify(results, null, 2));
console.log("[mode-aware-planner] done ->", OUT);
