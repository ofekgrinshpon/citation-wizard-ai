// P7 Phase E.2 — local retrieval instrumentation report.
// Telemetry only. Runs L1–L6 sequentially, extracts metadata.retrieval.local.aggregate
// and per_query from each qa_logs row, writes per-fixture + summary reports.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const FIXTURES = (await Bun.file("eval/legal-research-v1/fixtures.json").json()).questions as Array<{
  id: string;
  question: string;
}>;

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

async function pollByRunId(run_id: string, timeoutMs = 420_000) {
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
    await new Promise((res) => setTimeout(res, 4000));
  }
  return null;
}

const allSummaries: any[] = [];

for (const fx of FIXTURES) {
  console.log(`\n=== ${fx.id} ===`);
  const t = await trigger(fx.question);
  console.log(`triggered run_id=${t.run_id}`);
  const row = await pollByRunId(t.run_id);
  if (!row) {
    console.error(`[${fx.id}] poll timeout`);
    allSummaries.push({ fixture_id: fx.id, run_id: t.run_id, error: "poll_timeout" });
    continue;
  }
  const md = row.metadata || {};
  const retrieval = md.retrieval || {};
  const local = retrieval.local || {};
  const pq = (local.per_query || []) as any[];
  const agg = local.aggregate || null;

  const per_query_compact = pq.map((p) => ({
    claim_id: p.claim_id,
    role: p.role,
    query_he: p.original_query_he,
    compact_query_he: p.compact_query_he,
    total_query_ms: p.ms,
    exact: { ms: p.diag?.exact_ms, status: p.diag?.exact_status, hits: p.exact_hits, error: p.diag?.exact_error },
    text: { ms: p.diag?.text_ms, status: p.diag?.text_status, hits: p.text_hits, error: p.diag?.text_error },
    vector: {
      embedding_ms: p.diag?.embedding_ms,
      rpc_ms: p.diag?.vector_ms,
      status: p.diag?.vector_status,
      hits: p.vector_hits,
      error: p.diag?.vector_error,
    },
    parallel_batch_ms: p.diag?.parallel_batch_ms,
    kept: p.kept,
  }));

  const summary = {
    fixture_id: fx.id,
    run_id: t.run_id,
    qa_log_id: row.id,
    local_retrieval: {
      wall_ms: local.ms,
      candidates: local.candidates,
      aggregate: agg,
      per_query: per_query_compact,
    },
  };
  await Bun.write(
    `reports/legal-research-v1-p7-phaseE2-${fx.id}.json`,
    JSON.stringify(summary, null, 2),
  );

  console.log(
    JSON.stringify(
      {
        id: fx.id,
        wall_ms: local.ms,
        queries: agg?.queries_executed,
        dup: agg?.duplicate_query_count,
        text_timeouts: agg?.text_timeout_count,
        vector_timeouts: agg?.vector_timeout_count,
        max_query_ms: agg?.max_query_ms,
        sum_query_ms: agg?.sum_query_ms,
        slowest_method: agg?.slowest_method,
        method_total_ms: agg?.method_total_ms,
        bottleneck: agg?.bottleneck_hypothesis,
      },
      null,
      2,
    ),
  );

  allSummaries.push(summary);
}

await Bun.write(
  `reports/legal-research-v1-p7-phaseE2-summary.json`,
  JSON.stringify(allSummaries, null, 2),
);
console.log(`\nwrote ${allSummaries.length} fixtures + summary`);
