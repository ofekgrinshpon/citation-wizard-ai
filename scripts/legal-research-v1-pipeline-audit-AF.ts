// Read-only pipeline audit: 6 diagnostic queries A–F. Dumps FULL qa_logs metadata per run.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  { id: "A", category: "case_holding", query: `מה נקבע בע"א 6821/93 בנק המזרחי?` },
  { id: "B", category: "statute_section", query: `מה קובע סעיף 12 לחוק החוזים?` },
  { id: "C", category: "case_law_synthesis", query: `מה הפסיקה אומרת על הלכת יורש אחר יורש?` },
  { id: "D", category: "doctrine", query: `מהי חובת תום הלב במשא ומתן?` },
  { id: "E", category: "practical", query: `מה עושים אם המשכיר לא מחזיר פיקדון?` },
  { id: "F", category: "worker_classification", query: `מהם המבחנים להבחנה בין עובד לקבלן עצמאי?` },
];

const OUT = "reports/pipeline-audit-AF";
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
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

const triggered: Array<{ id: string; category: string; query: string; run_id: string | null }> = [];
for (const q of QUERIES) {
  try {
    const t = await trigger(q.query);
    console.log(`[${q.id}] run_id=${t.run_id}`);
    triggered.push({ ...q, run_id: t.run_id ?? null });
  } catch (e) { console.error(`[${q.id}] trigger err`, e); triggered.push({ ...q, run_id: null }); }
  await new Promise((r) => setTimeout(r, 1500));
}

const results = await Promise.all(triggered.map(async (base) => {
  if (!base.run_id) return { ...base, error: "trigger_failed" };
  const row = await poll(base.run_id);
  if (!row) return { ...base, error: "poll_timeout" };
  const out = { ...base, qa_log_id: row.id, answer: row.answer ?? "", footnotes: row.footnotes ?? [], metadata: row.metadata ?? {} };
  writeFileSync(`${OUT}/${base.id}.json`, JSON.stringify(out, null, 2));
  console.log(`[${base.id}] captured qa_log=${row.id}`);
  return out;
}));

writeFileSync(`${OUT}/_all.json`, JSON.stringify(results, null, 2));
console.log("[pipeline-audit] done ->", OUT);
