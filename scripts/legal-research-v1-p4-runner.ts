// P4 smoke runner — service-role only. Triggers L3 + L4 against
// legal-research-v1, polls qa_logs for the resulting metadata blob (which
// now includes the verifier block), and writes JSON reports to reports/.
//
// Usage:  bun scripts/legal-research-v1-p4-runner.ts

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

async function pollByRunId(run_id: string, timeoutMs = 300_000): Promise<any | null> {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url =
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`;
    const r = await fetch(url, { headers });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) return rows[0];
    }
    await new Promise((res) => setTimeout(res, 4000));
  }
  return null;
}

function summarise(fixtureId: string, qaRow: any) {
  const md = qaRow?.metadata ?? {};
  const v = md.verifier ?? {};
  console.log(`\n=== ${fixtureId} ===`);
  console.log(`run_id=${md.run_id} qa_log_id=${qaRow.id}  phase=${md.phase}`);
  console.log(`wall_ms=${md.total_ms} verifier_ms=${v.ms}`);
  console.log(
    `verdicts=${(v.verdicts ?? []).length} ` +
      `direct=${v.counts?.by_support?.direct ?? 0} partial=${v.counts?.by_support?.partial ?? 0} ` +
      `tangential=${v.counts?.by_support?.tangential ?? 0} unrelated=${v.counts?.by_support?.unrelated ?? 0}`,
  );
  console.log(
    `candidates_verified=${v.candidates_verified} usable=${v.candidates_usable} dropped=${v.candidates_dropped}`,
  );
  const candById = new Map((md.candidates ?? []).map((c: any) => [c.candidate_id, c]));
  console.log("Usable:");
  for (const u of v.usable ?? []) {
    const c = candById.get(u.candidate_id) as any;
    console.log(
      `  [${u.best_support}/role_match=${u.role_match}] ${c?.origin}/${c?.retrieval_method} role=${c?.role} ` +
        `title="${(c?.title || "").slice(0, 70)}"`,
    );
  }
  console.log("Dropped:");
  for (const d of v.dropped ?? []) {
    console.log(
      `  [${d.worst_support}] ${d.origin}/${d.retrieval_method} role=${d.role} ` +
        `title="${(d.title || "").slice(0, 70)}" reason="${(d.reason || "").slice(0, 90)}"`,
    );
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
    const row = await pollByRunId(t.run_id, 300_000);
    if (!row) {
      console.error(`TIMEOUT ${t.id}`);
      continue;
    }
    summarise(t.id, row);
    const reportPath = `reports/legal-research-v1-p4-${t.id}.json`;
    await Bun.write(
      reportPath,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          fixture: { id: t.id, question: t.question },
          qa_log_id: row.id,
          run_id: t.run_id,
          metadata: row.metadata,
        },
        null,
        2,
      ),
    );
    console.log(`wrote ${reportPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
