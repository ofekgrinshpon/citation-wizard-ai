// P7 Phase E.1 — forced 2-batch verifier validation.
// Sends x-verifier-force-split=1 so planBatches yields >=2 batches and the
// parallel orchestration path is actually exercised. Production behavior is
// unchanged when the header is absent.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const FIXTURE = {
  id: "L5",
  question: "מהי עילת הסבירות ומה היקף הביקורת השיפוטית עליה?",
};

async function trigger() {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "x-atomic-markers": "validate",
      "x-verifier-force-split": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question: FIXTURE.question, smoke_user_id: SMOKE_USER_ID }),
  });
  return await r.json();
}

async function pollByRunId(run_id: string, timeoutMs = 360_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,metadata&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`,
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

async function loadPhaseD() {
  try {
    const f = Bun.file(`reports/legal-research-v1-p7-phaseD-${FIXTURE.id}.json`);
    if (!(await f.exists())) return null;
    return await f.json();
  } catch { return null; }
}

const t = await trigger();
console.log(`triggered run_id=${t.run_id}`);
const row = await pollByRunId(t.run_id);
if (!row) { console.error("poll timeout"); process.exit(1); }

const md = row.metadata || {};
const verifier = md.verifier || {};
const drafter = md.drafter || {};
const usedSrc = drafter.used_sources || [];
const usable = verifier.usable || [];
const usableIds = new Set(usable.map((u: any) => u.candidate_id));
const usedIds = new Set(usedSrc.map((u: any) => u.candidate_id));
const subset = [...usedIds].every((id) => usableIds.has(id as string));
const fnCount = Array.isArray(row.footnotes) ? row.footnotes.length : 0;
const baseline = await loadPhaseD();
const baseUsable = new Set((baseline?.verifier_full?.usable ?? []).map((u: any) => u.candidate_id));
const usableEqualsBaseline =
  baseUsable.size === usableIds.size && [...baseUsable].every((id) => usableIds.has(id as string));

const summary = {
  fixture_id: FIXTURE.id,
  run_id: t.run_id,
  qa_log_id: row.id,
  verifier: {
    parallel: verifier.parallel,
    concurrency_limit: verifier.concurrency_limit,
    batch_count: verifier.batch_count,
    batch_ms: verifier.batch_ms,
    total_wall_ms: verifier.total_wall_ms,
    total_sum_ms: verifier.total_sum_ms,
    merge_order_preserved: verifier.merge_order_preserved,
    rate_limit_count: verifier.rate_limit_count,
    fallback_to_sequential: verifier.fallback_to_sequential,
    candidates_verified: verifier.candidates_verified,
    candidates_usable: verifier.candidates_usable,
    candidates_dropped: verifier.candidates_dropped,
    batches_labels: (verifier.batches || []).map((b: any) => b.label),
  },
  drafter: {
    used_sources_count: usedSrc.length,
    marker_validation_ok: drafter.marker_validation?.ok ?? null,
    internal_id_leak: drafter.marker_validation?.internal_id_leak ?? null,
    footnote_count: fnCount,
  },
  gates: {
    batch_count_ge_2: (verifier.batch_count ?? 0) >= 2,
    parallel_true: verifier.parallel === true,
    concurrency_2: verifier.concurrency_limit === 2,
    merge_order_preserved: verifier.merge_order_preserved === true,
    used_sources_subset_of_usable: subset,
    no_rate_limit: (verifier.rate_limit_count ?? 0) === 0,
    no_fallback: verifier.fallback_to_sequential === false,
    wall_close_to_max_not_sum:
      typeof verifier.total_wall_ms === "number" &&
      typeof verifier.total_sum_ms === "number" &&
      verifier.total_wall_ms < verifier.total_sum_ms,
    speedup_ratio:
      typeof verifier.total_wall_ms === "number" && verifier.total_wall_ms > 0
        ? +(verifier.total_sum_ms / verifier.total_wall_ms).toFixed(2)
        : null,
  },
  baseline_phaseD: baseline
    ? {
        usable_count: baseUsable.size,
        usable_equals_baseline: usableEqualsBaseline,
        verifier_wall_ms: baseline?.verifier_full?.total_wall_ms ?? baseline?.verifier_full?.ms ?? null,
      }
    : null,
};

await Bun.write(
  `reports/legal-research-v1-p7-phaseE1-forcesplit-${FIXTURE.id}.json`,
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
