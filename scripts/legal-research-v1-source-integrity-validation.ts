// Source-integrity / authority-tier admission validation (4 representative modes).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  { id: "M1-specific-case", query: `מה נקבע בע"א 6821/93 בנק המזרחי?` },
  { id: "M2-statute-section", query: `מה קובע סעיף 12 לחוק החוזים?` },
  { id: "C2-synthesis", query: `מה הפסיקה אומרת על הלכת השיתוף?` },
  { id: "C1-false-doctrine", query: `מה הפסיקה אומרת על הלכת יורש אחר יורש?` },
];

const OUT = "reports/source-integrity-validation";
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
  const si: any = md.retrieval?.source_integrity ?? md.source_integrity ?? {};
  return {
    id, query, run_id, qa_log_id: row.id,
    research_mode: md.planning?.research_mode ?? null,
    output_shape: d.output_shape ?? null,
    lead_ref: d.lead_ref ?? null,
    sufficiency: md.source_sufficiency ?? null,
    integrity_rejects: si.rejects ?? null,
    tier_counts: si.tier_counts ?? null,
    citable_counts: si.citable_counts ?? null,
    role_unsatisfied: si.role_unsatisfied ?? null,
    used_sources: (d.used_sources ?? []).map((s: any) => ({ n: s.number, t: s.title, url: s.url, type: s.source_type })),
    answer_head: String(row.answer ?? "").slice(0, 400),
  };
}));

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
for (const r of results as any[]) {
  console.log("\n===", r.id, r.error ?? "");
  console.log("mode:", r.research_mode, "| shape:", r.output_shape, "| lead:", JSON.stringify(r.lead_ref));
  console.log("integrity rejects:", r.integrity_rejects, "tiers:", JSON.stringify(r.tier_counts), "citable:", JSON.stringify(r.citable_counts));
  console.log("used:", (r.used_sources ?? []).map((s: any) => `${s.type}:${s.url}`).join("\n      "));
}
