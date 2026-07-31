// Judgment typing + authority-role labeling validation (read-only).
// C2 = case-law synthesis target; C1/M1/M2/B8/B2 = controls.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  { id: "C2", query: `מה הפסיקה אומרת על הלכת השיתוף?` },
  { id: "C1", query: `מה הפסיקה אומרת על הלכת יורש אחר יורש?` },
  { id: "M1", query: `מה נקבע בע"א 6821/93 בנק המזרחי נ' מגדל כפר שיתופי?` },
  { id: "M2", query: `מה קובע סעיף 6 לחוק החברות?` },
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
  { id: "B2", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל ביחס להקצאת קרקעות למגורים על בסיס לאום?` },
];

const OUT = "reports/synthesis-snippet-budget";
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

const triggered: Array<{ id: string; query: string; run_id: string | null }> = [];
for (const q of QUERIES) {
  const t = await trigger(q.query).catch(() => ({} as { run_id?: string }));
  console.log(`[${q.id}] run_id=${t.run_id}`);
  triggered.push({ ...q, run_id: t.run_id ?? null });
  await new Promise((r) => setTimeout(r, 1500));
}

const rows = await Promise.all(triggered.map(async ({ id, query, run_id }) => {
  if (!run_id) return { id, query, error: "trigger_failed" };
  const row = await poll(run_id);
  if (!row) return { id, query, run_id, error: "poll_timeout" };
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify({ id, query, run_id, ...row }, null, 2));
  const md = (row.metadata ?? {}) as any;
  const si = md?.retrieval?.source_integrity ?? md?.source_integrity ?? {};
  const dr = md?.drafter ?? {};
  const summary = {
    id,
    run_id,
    research_mode: md?.planning?.research_mode ?? md?.research_mode ?? null,
    pool_judgments: si.judgment_documents ?? null,
    pool_judgments_with_holding: si.judgments_with_holding_text ?? null,
    citable_counts: si.citable_counts ?? null,
    synthesis_role_counts: si.synthesis_role_counts ?? null,
    synthesis_role_overrides: si.synthesis_role_overrides ?? null,
    pack: dr.synthesis_pack ?? null,
    used_sources: (dr.used_sources ?? []).map((u: any) => ({
      n: u.number, title: (u.title ?? "").slice(0, 70), citable_as: u.citable_as,
      tier: u.authority_tier, usability: u.text_usability, synthesis_role: u.synthesis_role,
    })),
    snippet_budget: dr.snippet_budget ?? null,
    answer_len: (row.answer ?? "").length,
    answer_head: (row.answer ?? "").slice(0, 300),
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}));

writeFileSync(`${OUT}/_all.json`, JSON.stringify(rows, null, 2));
console.log("[snippet-budget] done ->", OUT);
