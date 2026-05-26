// P7 Phase E.2 — continuation: run L2-L6 in parallel.
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const ALL = (await Bun.file("eval/legal-research-v1/fixtures.json").json()).questions as Array<{ id: string; question: string }>;
const IDS = (process.env.E2_IDS ?? "L1,L2,L3,L4,L5,L6").split(",");
const FIXTURES = ALL.filter((f) => IDS.includes(f.id));

async function trigger(question: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "x-atomic-markers": "validate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, smoke_user_id: SMOKE_USER_ID }),
  });
  return await r.json();
}

async function pollByRunId(run_id: string, timeoutMs = 480_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`,
      { headers },
    );
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) return rows[0];
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

function compact(row: any, fx: { id: string }, run_id: string) {
  const md = row?.metadata || {};
  const local = md.retrieval?.local || {};
  const pq = (local.per_query || []) as any[];
  const per_query_compact = pq.map((p) => ({
    claim_id: p.claim_id, role: p.role,
    query_he: p.original_query_he, compact_query_he: p.compact_query_he,
    total_query_ms: p.ms,
    exact: { ms: p.diag?.exact_ms, status: p.diag?.exact_status, hits: p.exact_hits, error: p.diag?.exact_error },
    text: { ms: p.diag?.text_ms, status: p.diag?.text_status, hits: p.text_hits, error: p.diag?.text_error },
    vector: { embedding_ms: p.diag?.embedding_ms, rpc_ms: p.diag?.vector_ms, status: p.diag?.vector_status, hits: p.vector_hits, error: p.diag?.vector_error },
    parallel_batch_ms: p.diag?.parallel_batch_ms,
    kept: p.kept,
  }));
  return {
    fixture_id: fx.id, run_id, qa_log_id: row?.id ?? null,
    local_retrieval: {
      wall_ms: local.ms, candidates: local.candidates,
      aggregate: local.aggregate || null,
      per_query: per_query_compact,
    },
  };
}

const results = await Promise.all(
  FIXTURES.map(async (fx) => {
    const t = await trigger(fx.question);
    console.log(`[${fx.id}] triggered run_id=${t.run_id}`);
    const row = await pollByRunId(t.run_id);
    if (!row) {
      console.error(`[${fx.id}] poll timeout`);
      return { fixture_id: fx.id, run_id: t.run_id, error: "poll_timeout" };
    }
    const summary = compact(row, fx, t.run_id);
    await Bun.write(`reports/legal-research-v1-p7-phaseE4b-${fx.id}.json`, JSON.stringify(summary, null, 2));
    const agg = summary.local_retrieval.aggregate;
    console.log(`[${fx.id}] wall=${summary.local_retrieval.wall_ms}ms queries=${agg?.queries_executed} maxQ=${agg?.max_query_ms} text_to=${agg?.text_timeout_count} vec_to=${agg?.vector_timeout_count} slowest=${agg?.slowest_method} bottleneck=${agg?.bottleneck_hypothesis}`);
    return summary;
  }),
);

// merge with existing E2 reports if any
const all: any[] = [];
for (const fx of ALL) {
  try {
    const f = Bun.file(`reports/legal-research-v1-p7-phaseE4b-${fx.id}.json`);
    if (await f.exists()) all.push(await f.json());
  } catch {}
}
await Bun.write(`reports/legal-research-v1-p7-phaseE4b-summary.json`, JSON.stringify(all, null, 2));
console.log(`\nwrote ${all.length} fixtures + summary`);
