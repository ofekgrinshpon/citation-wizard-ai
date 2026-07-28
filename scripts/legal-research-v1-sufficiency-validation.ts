// Source-sufficiency gate validation: A–E + safety (B8 canonical quote, B2 missing docket).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  { id: "A", query: `מה נקבע בע"א 6821/93 בנק המזרחי?` },
  { id: "B", query: `מה קובע סעיף 12 לחוק החוזים?` },
  { id: "C", query: `מה הפסיקה אומרת על הלכת יורש אחר יורש?` },
  { id: "D", query: `מהי חובת תום הלב במשא ומתן?` },
  { id: "E", query: `מה עושים אם המשכיר לא מחזיר פיקדון?` },
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
  { id: "B2", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל ביחס להקצאת קרקעות למגורים על בסיס לאום?` },
];

const OUT = "reports/sufficiency-validation";
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

const triggered: Array<{ id: string; query: string; run_id: string | null }> = [];
for (const q of QUERIES) {
  const t = await trigger(q.query).catch(() => ({} as { run_id?: string }));
  console.log(`[${q.id}] run_id=${t.run_id}`);
  triggered.push({ ...q, run_id: t.run_id ?? null });
  await new Promise((r) => setTimeout(r, 1500));
}

const results = await Promise.all(triggered.map(async ({ id, query, run_id }) => {
  const base: any = { id, query, run_id };
  if (!run_id) return { ...base, error: "trigger_failed" };
  const row = await poll(run_id);
  if (!row) return { ...base, error: "poll_timeout" };
  const md: any = row.metadata ?? {};
  const d: any = md.drafter ?? {};
  return {
    ...base,
    shape: md?.analyzer?.answer_intent?.output_shape ?? d?.lead_ref?.shape ?? null,
    deterministic_branch: d.deterministic_branch ?? null,
    insufficient_fired: d.insufficient_sources_limitation_fired ?? false,
    sufficiency: d.source_sufficiency ?? null,
    lead_ref: d.lead_ref ?? null,
    sources_passed: d.sources_passed ?? null,
    sources_used: d.sources_used ?? null,
    answer: row.answer ?? "",
    footnotes: row.footnotes ?? [],
  };
}));

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
for (const r of results as any[]) {
  console.log("=".repeat(70));
  console.log(`${r.id} | branch=${r.deterministic_branch} | shape=${r.shape} | suff=${r.sufficiency ? r.sufficiency.sufficient + "/" + r.sufficiency.reason : "n/a"} | used=${r.sources_used}`);
  console.log((r.answer || r.error || "").slice(0, 900));
}
