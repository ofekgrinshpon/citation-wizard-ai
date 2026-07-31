// Named-doctrine premise/framing validation.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  { id: "C1-false-doctrine", query: `מה הפסיקה אומרת על הלכת יורש אחר יורש?` },
  { id: "C2-real-doctrine", query: `מה הפסיקה אומרת על הלכת השיתוף?` },
  { id: "D1-apropim", query: `מהי הלכת אפרופים?` },
  { id: "D2-generic-doctrine", query: `מהי חובת תום הלב במשא ומתן?` },
  { id: "B8-canonical-quote", query: `צטט את סעיף 1 לחוק יסוד: כבוד האדם וחירותו` },
  { id: "B2-missing-docket", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ. מינהל מקרקעי ישראל?` },
  { id: "M2-statute-section", query: `מה קובע סעיף 12 לחוק החוזים?` },
];

const OUT = "reports/named-doctrine-framing-validation";
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
    const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,metadata,answer&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
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
  const md: any = row.metadata ?? {};
  const d: any = md.drafter ?? {};
  const answer: string = row.answer ?? d.answer_markdown ?? "";
  return {
    id, query, run_id, qa_log_id: row.id,
    research_mode: md.planning?.research_mode ?? null,
    output_shape: d.output_shape ?? null,
    deterministic_branch: d.deterministic_branch ?? md.deterministic_branch ?? null,
    sufficiency: md.source_sufficiency ?? null,
    named_doctrine_framing: d.named_doctrine_framing ?? md.named_doctrine_framing ?? null,
    framing_correction_required: d.framing_correction_required ?? md.framing_correction_required ?? null,
    answer_head: answer.slice(0, 700),
    answer_len: answer.length,
  };
}));

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
for (const r of results as any[]) {
  console.log("\n===", r.id, "===");
  console.log("branch:", r.deterministic_branch, "| shape:", r.output_shape, "| mode:", r.research_mode);
  console.log("framing:", JSON.stringify(r.named_doctrine_framing));
  console.log("head:", (r.answer_head ?? "").slice(0, 400));
}
