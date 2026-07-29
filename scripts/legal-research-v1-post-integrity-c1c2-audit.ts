// Post-integrity quality audit: C1 + C2 only. Read-only diagnostic.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  { id: "C2", query: `מה הפסיקה אומרת על הלכת השיתוף?` },
  { id: "C1", query: `מה הפסיקה אומרת על הלכת יורש אחר יורש?` },
];

const OUT = "reports/post-integrity-c1c2-audit";
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
    const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
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
  const out = {
    id, query, run_id, qa_log_id: row.id,
    research_mode: md.planning?.research_mode ?? null,
    mode_plan: md.planning?.planner?.mode_plan ?? null,
    output_shape: d.output_shape ?? md?.analyzer?.answer_intent?.output_shape ?? null,
    deterministic_branch: d.deterministic_branch ?? null,
    insufficient_fired: d.insufficient_sources_limitation_fired ?? false,
    source_sufficiency: d.source_sufficiency ?? md.source_sufficiency ?? null,
    lead_ref: d.lead_ref ?? null,
    integrity: { rejects: si.rejects ?? null, tier_counts: si.tier_counts ?? null, citable_counts: si.citable_counts ?? null, role_unsatisfied: si.role_unsatisfied ?? null },
    used_sources: (d.used_sources ?? md.used_sources ?? []).map((s: any) => ({
      n: s.number, title: s.title, url: s.url, type: s.source_type,
      tier: s.authority_tier, citable_as: s.citable_as, support: s.verified_support,
    })),
    footnotes: row.footnotes ?? [],
    answer: row.answer ?? "",
    metadata: md,
  };
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify(out, null, 2));
  return out;
}));

writeFileSync(`${OUT}/_all.json`, JSON.stringify(results, null, 2));
for (const r of results as any[]) {
  console.log("=".repeat(70));
  console.log(`${r.id} mode=${r.research_mode} shape=${r.output_shape} branch=${r.deterministic_branch} insuff=${r.insufficient_fired}`);
  console.log(" suff:", JSON.stringify(r.source_sufficiency));
  console.log(" obligations:", JSON.stringify(r.mode_plan?.audit ?? null));
  console.log(" integrity:", JSON.stringify(r.integrity));
  console.log(" used:", (r.used_sources ?? []).map((s: any) => `${s.tier}|${s.citable_as}|${s.type}|${s.support}|${s.url}`).join("\n       "));
  console.log(" answer:\n", r.answer);
}
console.log("done ->", OUT);
