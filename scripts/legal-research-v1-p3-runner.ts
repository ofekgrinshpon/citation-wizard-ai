// P3.3 smoke runner — service-role only. Triggers L3 + L4 in background mode
// against legal-research-v1, then polls qa_logs for the resulting metadata
// blob and writes JSON reports to reports/.
//
// Usage:  bun scripts/legal-research-v1-p3-runner.ts
//
// Required env (already present in dev sandbox):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SMOKE_USER_ID   (admin user UUID, defaults to known admin)

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const FIXTURES: Array<{ id: string; question: string }> = [
  { id: "L3", question: "מתי בית המשפט יפחית פיצוי מוסכם לפי סעיף 15 לחוק החוזים תרופות?" },
  { id: "L4", question: "מהי דוקטרינת השתק פלוגתא?" },
];

async function trigger(question: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, smoke_user_id: SMOKE_USER_ID }),
  });
  const j = await r.json();
  return { status: r.status, ...j };
}

async function pollByRunId(run_id: string, timeoutMs = 240_000): Promise<any | null> {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`;
    const r = await fetch(url, { headers });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) return rows[0];
    } else {
      await r.text();
    }
    await new Promise((res) => setTimeout(res, 4000));
  }
  return null;
}

function summarise(fixtureId: string, qaRow: any) {
  const md = qaRow?.metadata ?? {};
  const retrieval = md.retrieval ?? {};
  const local = retrieval.local ?? {};
  const pplx = retrieval.perplexity ?? {};
  const pool = retrieval.pool ?? {};
  const localPq = local.per_query ?? [];
  const exactHits = localPq.reduce((s: number, q: any) => s + (q.exact_hits ?? 0), 0);
  const textHits = localPq.reduce((s: number, q: any) => s + (q.text_hits ?? 0), 0);
  const vecHits = localPq.reduce((s: number, q: any) => s + (q.vector_hits ?? 0), 0);
  const pplxAdmitted = (pplx.per_query ?? []).reduce((s: number, q: any) => s + (q.admitted ?? 0), 0);
  const cands = md.candidates ?? [];
  console.log(`\n=== ${fixtureId} ===`);
  console.log(`run_id=${md.run_id} qa_log_id=${qaRow.id}`);
  console.log(`wall_ms=${md.total_ms}`);
  console.log(`analyzer_ms=${md.planning?.analyzer?.ms} planner_ms=${md.planning?.planner?.ms} retrieval_ms=${retrieval.ms}`);
  console.log(`exact=${exactHits} text=${textHits} vector=${vecHits} pplx_admitted=${pplxAdmitted} pool=${pool.after_dedup}`);
  console.log(`Top candidates:`);
  for (const c of cands.slice(0, 8)) {
    console.log(`  - [${c.origin}/${c.retrieval_method}] role=${c.role} src=${c.source_type} title="${(c.title || "").slice(0, 70)}"`);
  }
}

async function main() {
  if (!SUPABASE_URL || !SR_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const triggered: Array<{ id: string; run_id: string; question: string }> = [];
  for (const fx of FIXTURES) {
    const t = await trigger(fx.question);
    console.log(`triggered ${fx.id} status=${t.status} run_id=${t.run_id}`);
    if (!t.run_id) {
      console.error(`Failed to trigger ${fx.id}:`, t);
      continue;
    }
    triggered.push({ id: fx.id, run_id: t.run_id, question: fx.question });
  }

  for (const t of triggered) {
    console.log(`\nPolling for ${t.id} run_id=${t.run_id}...`);
    const row = await pollByRunId(t.run_id, 240_000);
    if (!row) {
      console.error(`TIMEOUT ${t.id}`);
      continue;
    }
    summarise(t.id, row);
    const reportPath = `reports/legal-research-v1-p3.3-${t.id}.json`;
    await Bun.write(reportPath, JSON.stringify({
      generated_at: new Date().toISOString(),
      fixture: { id: t.id, question: t.question },
      qa_log_id: row.id,
      run_id: t.run_id,
      metadata: row.metadata,
    }, null, 2));
    console.log(`wrote ${reportPath}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
