// P7 Phase E.5 — fresh end-to-end baseline after E.1/E.4a/E.4b.
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const ALL = (await Bun.file("eval/legal-research-v1/fixtures.json").json()).questions as Array<{ id: string; question: string }>;
const IDS = (process.env.E5_IDS ?? "L1,L2,L3,L4,L5,L6").split(",");
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

async function pollByRunId(run_id: string, timeoutMs = 600_000) {
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

function summarize(row: any, fx: { id: string }, run_id: string) {
  const md = row?.metadata || {};
  const stage = md.stage_runs || {};
  const retrieval = md.retrieval || {};
  const local = retrieval.local || {};
  const px = retrieval.perplexity || {};
  const verifier = md.verifier || {};
  const drafter = md.drafter || {};
  const pool = retrieval.pool || {};
  const cands = md.candidates || [];
  const usedSources = drafter.used_sources || drafter.sources_used || [];
  const stub = !drafter.ok || (drafter.footnote_count === 0);

  return {
    fixture_id: fx.id,
    run_id,
    qa_log_id: row?.id ?? null,
    total_ms: md.total_ms,
    stage_ms: {
      analyzer_ms: stage.claim_analyzer?.ms ?? stage.analyzer?.ms ?? null,
      planner_ms: stage.query_planner?.ms ?? stage.planner?.ms ?? null,
      local_retrieval_ms: local.ms ?? stage.local_retrieval?.ms ?? null,
      perplexity_ms: px.ms ?? stage.perplexity?.ms ?? null,
      verifier_ms: verifier.ms ?? stage.verifier?.ms ?? null,
      drafter_ms: drafter.ms ?? stage.drafter?.ms ?? null,
    },
    verifier: {
      batch_count: verifier.batch_count,
      parallel: verifier.parallel,
      concurrency_limit: verifier.concurrency_limit,
      candidates_verified: verifier.candidates_verified,
      usable: verifier.candidates_usable ?? (verifier.usable?.length ?? null),
      dropped: verifier.candidates_dropped ?? (verifier.dropped?.length ?? null),
      escalated_claims: verifier.escalated_claims,
      escalated_batches: verifier.escalated_batches,
      model_initial: verifier.model_initial,
      model_final: verifier.model_final,
      rate_limit_count: verifier.rate_limit_count,
      fallback_to_sequential: verifier.fallback_to_sequential,
    },
    drafter: {
      ok: drafter.ok,
      escalated: drafter.escalated,
      model_initial: drafter.model_initial,
      model_final: drafter.model_final,
      footnote_count: drafter.footnote_count,
      used_sources_count: usedSources.length,
      footnote_eq_used: drafter.footnote_count === usedSources.length,
      marker_validation_ok: drafter.marker_validation?.ok,
      internal_id_leak: drafter.marker_validation?.internal_id_leak ?? null,
    },
    candidate_pool: {
      found: pool.found,
      after_dedup: pool.after_dedup,
      by_origin: pool.counts?.by_origin,
      final_in_metadata: Array.isArray(cands) ? cands.length : null,
    },
    local_aggregate: {
      wall_ms: local.ms,
      text_timeout_count: local.aggregate?.text_timeout_count,
      vector_timeout_count: local.aggregate?.vector_timeout_count,
      slowest_method: local.aggregate?.slowest_method,
      max_query_ms: local.aggregate?.max_query_ms,
    },
    stub_answer: stub,
  };
}

const triggered = await Promise.all(
  FIXTURES.map(async (fx) => {
    const t = await trigger(fx.question);
    console.log(`[${fx.id}] triggered run_id=${t.run_id}`);
    return { fx, run_id: t.run_id };
  }),
);

const results = await Promise.all(
  triggered.map(async ({ fx, run_id }) => {
    const row = await pollByRunId(run_id);
    if (!row) {
      console.error(`[${fx.id}] poll timeout`);
      return { fixture_id: fx.id, run_id, error: "poll_timeout" };
    }
    const s = summarize(row, fx, run_id);
    await Bun.write(`reports/legal-research-v1-p7-phaseE5-${fx.id}.json`, JSON.stringify(s, null, 2));
    console.log(`[${fx.id}] total=${s.total_ms}ms local=${s.stage_ms.local_retrieval_ms} px=${s.stage_ms.perplexity_ms} ver=${s.stage_ms.verifier_ms} draft=${s.stage_ms.drafter_ms} usable=${s.verifier.usable} used=${s.drafter.used_sources_count} markerOK=${s.drafter.marker_validation_ok}`);
    return s;
  }),
);

// Aggregate
const ok = results.filter((r: any) => !r.error && typeof r.total_ms === "number");
const totals = ok.map((r: any) => r.total_ms).sort((a, b) => a - b);
const locals = ok.map((r: any) => r.stage_ms.local_retrieval_ms).filter((x: any) => typeof x === "number");
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => xs.length === 0 ? null : xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
const slowest = ok.slice().sort((a: any, b: any) => b.total_ms - a.total_ms)[0];

const summary = {
  phase: "E.5-baseline",
  ran: ok.length,
  avg_total_ms: ok.length ? Math.round(avg(totals)) : null,
  median_total_ms: median(totals),
  avg_local_retrieval_ms: locals.length ? Math.round(avg(locals)) : null,
  slowest_fixture: slowest ? { id: slowest.fixture_id, total_ms: slowest.total_ms, slowest_stage: Object.entries(slowest.stage_ms).sort((a: any, b: any) => (b[1] || 0) - (a[1] || 0))[0] } : null,
  any_text_timeouts: ok.some((r: any) => (r.local_aggregate.text_timeout_count || 0) > 0),
  any_vector_timeouts: ok.some((r: any) => (r.local_aggregate.vector_timeout_count || 0) > 0),
  any_verifier_escalated: ok.some((r: any) => (r.verifier.escalated_claims || 0) > 0 || (r.verifier.escalated_batches || 0) > 0 || r.verifier.model_final !== r.verifier.model_initial),
  any_drafter_escalated: ok.some((r: any) => r.drafter.escalated || r.drafter.model_final !== r.drafter.model_initial),
  any_stub_answer: ok.some((r: any) => r.stub_answer),
  any_marker_validation_failure: ok.some((r: any) => r.drafter.marker_validation_ok === false),
  any_internal_id_leak: ok.some((r: any) => r.drafter.internal_id_leak === true),
  any_footnote_mismatch: ok.some((r: any) => r.drafter.footnote_eq_used === false),
  fixtures: results,
};
await Bun.write("reports/legal-research-v1-p7-phaseE5-summary.json", JSON.stringify(summary, null, 2));
console.log("\nWROTE summary. avg=", summary.avg_total_ms, "median=", summary.median_total_ms, "avg_local=", summary.avg_local_retrieval_ms);
