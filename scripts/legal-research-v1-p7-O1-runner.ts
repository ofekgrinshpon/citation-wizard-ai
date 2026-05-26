// P7 O1 — parallelize Perplexity. Run L1–L6 and capture px telemetry.
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const ALL = (await Bun.file("eval/legal-research-v1/fixtures.json").json()).questions as Array<{ id: string; question: string }>;
const IDS = (process.env.O1_IDS ?? "L1,L2,L3,L4,L5,L6").split(",");
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
  const r = md.retrieval || {};
  const local = r.local || {};
  const px = r.perplexity || {};
  const v = md.verifier || {};
  const dr = md.drafter || {};
  const pool = r.pool || {};
  const used = dr.used_sources || dr.sources_used || [];
  const usableIds = new Set((v.usable || []).map((u: any) => typeof u === 'string' ? u : (u?.candidate_id || u?.id)));
  const usedIds = used.map((u: any) => typeof u === 'string' ? u : (u?.candidate_id || u?.id));
  const used_subset = usedIds.every((id: any) => usableIds.has(id));

  return {
    fixture_id: fx.id,
    run_id,
    qa_log_id: row?.id ?? null,
    total_ms: md.total_ms,
    stages_ms: {
      local: local.ms, perplexity: px.ms, verifier: v.ms ?? v.total_wall_ms, drafter: dr.ms,
    },
    perplexity: {
      wall_ms: px.total_wall_ms ?? px.ms,
      sum_ms: px.total_sum_ms,
      query_count: px.query_count,
      query_ms: px.query_ms,
      parallel: px.parallel,
      concurrency_limit: px.concurrency_limit,
      rate_limit_count: px.rate_limit_count,
      retry_count: px.retry_count,
      fallback_to_sequential: px.fallback_to_sequential,
      merge_order_preserved: px.merge_order_preserved,
      candidates_admitted: px.candidates,
      candidates_dropped: px.dropped,
      slowest_query_ms: Array.isArray(px.query_ms) && px.query_ms.length ? Math.max(...px.query_ms) : null,
      speedup: px.total_sum_ms && (px.total_wall_ms || px.ms) ? +(px.total_sum_ms / (px.total_wall_ms || px.ms)).toFixed(2) : null,
    },
    pool: { after_dedup: pool.after_dedup, by_origin: pool.counts?.by_origin },
    verifier: { batch_count: v.batch_count, parallel: v.parallel, usable: v.candidates_usable, dropped: v.candidates_dropped, verified: v.candidates_verified, escalated_batches: v.escalated_batches },
    drafter: {
      ok: dr.ok, escalated: dr.escalated, model_initial: dr.model_initial, model_final: dr.model_final,
      footnote_count: dr.footnote_count, used_sources_count: used.length,
      footnote_eq_used: dr.footnote_count === used.length,
      marker_ok: dr.marker_validation?.ok,
      internal_id_leak: dr.marker_validation?.internal_id_leak,
      used_subset_of_usable: used_subset,
    },
  };
}

const triggered = await Promise.all(FIXTURES.map(async (fx) => ({ fx, run_id: (await trigger(fx.question)).run_id })));
triggered.forEach((t) => console.log(`[${t.fx.id}] triggered ${t.run_id}`));

const results = await Promise.all(triggered.map(async ({ fx, run_id }) => {
  const row = await pollByRunId(run_id);
  if (!row) return { fixture_id: fx.id, run_id, error: 'poll_timeout' };
  const s = summarize(row, fx, run_id);
  await Bun.write(`reports/legal-research-v1-p7-O1-${fx.id}.json`, JSON.stringify(s, null, 2));
  const p = s.perplexity;
  console.log(`[${fx.id}] total=${s.total_ms} px wall=${p.wall_ms} sum=${p.sum_ms} n=${p.query_count} cap=${p.concurrency_limit} par=${p.parallel} rl=${p.rate_limit_count} order=${p.merge_order_preserved} fb=${p.fallback_to_sequential} speedup=${p.speedup}x adm=${p.candidates_admitted} draftOK=${s.drafter.marker_ok} used=${s.drafter.used_sources_count}/${s.verifier.usable} subset=${s.drafter.used_subset_of_usable}`);
  return s;
}));

const ok = results.filter((r: any) => !r.error && typeof r.total_ms === 'number');
const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a,b)=>a+b,0)/xs.length) : null;
const totals = ok.map((r:any) => r.total_ms).sort((a,b)=>a-b);
const summary = {
  phase: 'O1-parallel-perplexity',
  ran: ok.length,
  avg_total_ms: avg(totals),
  median_total_ms: totals.length ? (totals.length%2 ? totals[(totals.length-1)/2] : (totals[totals.length/2-1]+totals[totals.length/2])/2) : null,
  avg_perplexity_wall_ms: avg(ok.map((r:any) => r.perplexity.wall_ms)),
  avg_perplexity_sum_ms: avg(ok.map((r:any) => r.perplexity.sum_ms || 0)),
  avg_perplexity_speedup: ok.length ? +(ok.reduce((a:number,r:any)=>a+(r.perplexity.speedup||0),0)/ok.length).toFixed(2) : null,
  all_merge_order_preserved: ok.every((r:any) => r.perplexity.merge_order_preserved),
  any_rate_limit: ok.some((r:any) => (r.perplexity.rate_limit_count||0) > 0),
  any_fallback_to_sequential: ok.some((r:any) => r.perplexity.fallback_to_sequential),
  all_marker_ok: ok.every((r:any) => r.drafter.marker_ok),
  all_no_id_leak: ok.every((r:any) => r.drafter.internal_id_leak === false),
  all_used_subset: ok.every((r:any) => r.drafter.used_subset_of_usable),
  all_footnote_eq_used: ok.every((r:any) => r.drafter.footnote_eq_used),
  any_stub: ok.some((r:any) => !r.drafter.ok),
  fixtures: results,
};
await Bun.write('reports/legal-research-v1-p7-O1-summary.json', JSON.stringify(summary, null, 2));
console.log('\nSUMMARY', JSON.stringify({k:{avg_total:summary.avg_total_ms, avg_px:summary.avg_perplexity_wall_ms, speedup:summary.avg_perplexity_speedup, order:summary.all_merge_order_preserved, marker:summary.all_marker_ok}}));
