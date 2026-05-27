// Production validation runner for cluster-prevention phase (prompt-only + telemetry).
// Triggers L1–L6 + the protection-money question (PROT) in parallel against deployed
// legal-research-v1 and captures hard gates, placement telemetry (incl. new fields),
// source counts, and runtime deltas vs the existing citation-cleanup baseline.
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const ALL = (await Bun.file("eval/legal-research-v1/fixtures.json").json()).questions as Array<{ id: string; question: string }>;
const IDS = (process.env.CLP_IDS ?? "L1,L2,L3,L4,L5,L6").split(",");
const FIXTURES: Array<{ id: string; question: string }> = ALL.filter((f) => IDS.includes(f.id));
FIXTURES.push({
  id: "PROT",
  question:
    "האם כישלון מערכתי באכיפת עבירת גביית דמי חסות (פרוטקשן) יכול להוות מחדל חקיקתי בהגנה על הזכות לחיים וביטחון?",
});

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

async function pollByRunId(run_id: string, timeoutMs = 540_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`,
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

async function loadBaseline(id: string): Promise<any | null> {
  try {
    return await Bun.file(`reports/legal-research-v1-citation-cleanup-${id}.json`).json();
  } catch {
    return null;
  }
}

function summarize(row: any, fx: { id: string }, run_id: string, baseline: any | null) {
  const md = row?.metadata || {};
  const drafter = md.drafter || {};
  const verifier = md.verifier || {};
  const mv = drafter.marker_validation || {};
  const placement = mv.placement || {};
  const usedSources = drafter.used_sources || drafter.sources_used || [];
  const answer: string = row?.answer || drafter.answer_markdown || "";
  const verifierUsable: string[] = (verifier.usable || []).map((u: any) => u.candidate_id ?? u);
  const usedIds: string[] = usedSources.map((u: any) => u.candidate_id).filter(Boolean);
  const subset = usedIds.every((id) => verifierUsable.includes(id));

  return {
    fixture_id: fx.id,
    run_id,
    qa_log_id: row?.id ?? null,
    total_ms: md.total_ms,
    baseline_total_ms: baseline?.total_ms ?? null,
    runtime_delta_ms:
      typeof md.total_ms === "number" && typeof baseline?.total_ms === "number"
        ? md.total_ms - baseline.total_ms
        : null,
    hard_gates: {
      marker_validation_ok: mv.ok === true,
      internal_id_leak: mv.internal_id_leak === true,
      footnote_eq_used: (drafter.footnote_count ?? 0) === usedSources.length,
      used_subset_of_usable: subset,
    },
    placement: {
      cluster_count: placement.cluster_count ?? null,
      cluster_run_count: placement.cluster_run_count ?? null,
      max_cluster_len: placement.max_cluster_len ?? null,
      end_paragraph_dump_count: placement.end_paragraph_dump_count ?? null,
      final_paragraph_marker_count: placement.final_paragraph_marker_count ?? null,
      final_paragraph_last_sentence_marker_count:
        placement.final_paragraph_last_sentence_marker_count ?? null,
      final_summary_dump: placement.final_summary_dump ?? null,
      final_summary_dump_count: placement.final_summary_dump_count ?? null,
      cluster_samples: (placement.cluster_samples ?? []).slice(0, 5),
      end_dump_samples: (placement.end_dump_samples ?? []).slice(0, 5),
    },
    baseline_placement: baseline
      ? {
          // Older runs didn't carry the new fields; show what was recorded.
          cluster_count: baseline?.placement?.cluster_count ?? null,
          end_paragraph_dump_count: baseline?.placement?.end_paragraph_dump_count ?? null,
        }
      : null,
    source_list: { count: usedSources.length, ids: usedIds },
    drafter: {
      ok: drafter.ok,
      escalated: drafter.escalated,
      footnote_count: drafter.footnote_count,
      used_sources_count: usedSources.length,
    },
    answer_tail: answer.slice(-280),
  };
}

console.log(`[runner] triggering ${FIXTURES.length} fixtures: ${FIXTURES.map((f) => f.id).join(",")}`);

const triggered = await Promise.all(
  FIXTURES.map(async (fx) => {
    try {
      const t = await trigger(fx.question);
      console.log(`[${fx.id}] triggered run_id=${t.run_id}`);
      return { fx, run_id: t.run_id };
    } catch (e) {
      console.error(`[${fx.id}] trigger error`, e);
      return { fx, run_id: null };
    }
  }),
);

const results = await Promise.all(
  triggered.map(async ({ fx, run_id }) => {
    if (!run_id) return { fixture_id: fx.id, error: "trigger_failed" };
    const baseline = await loadBaseline(fx.id);
    const row = await pollByRunId(run_id);
    if (!row) {
      console.error(`[${fx.id}] poll timeout`);
      return { fixture_id: fx.id, run_id, error: "poll_timeout" };
    }
    const s = summarize(row, fx, run_id, baseline);
    await Bun.write(`reports/legal-research-v1-cluster-prevention-${fx.id}.json`, JSON.stringify(s, null, 2));
    console.log(
      `[${fx.id}] markerOK=${s.hard_gates.marker_validation_ok} used=${s.source_list.count} clusters=${s.placement.cluster_count} maxLen=${s.placement.max_cluster_len} finalDump=${s.placement.final_summary_dump} Δ=${s.runtime_delta_ms}ms`,
    );
    return s;
  }),
);

const ok = results.filter((r: any) => !r.error);
const summary = {
  phase: "cluster-prevention-validation",
  ran: ok.length,
  errors: results.length - ok.length,
  hard_gates_all_pass:
    ok.every((r: any) => r.hard_gates.marker_validation_ok) &&
    ok.every((r: any) => r.hard_gates.internal_id_leak === false) &&
    ok.every((r: any) => r.hard_gates.footnote_eq_used) &&
    ok.every((r: any) => r.hard_gates.used_subset_of_usable),
  total_clusters: ok.reduce((s: number, r: any) => s + (r.placement?.cluster_count ?? 0), 0),
  total_cluster_runs: ok.reduce((s: number, r: any) => s + (r.placement?.cluster_run_count ?? 0), 0),
  max_cluster_len_any: ok.reduce((s: number, r: any) => Math.max(s, r.placement?.max_cluster_len ?? 0), 0),
  total_final_summary_dumps: ok.reduce(
    (s: number, r: any) => s + (r.placement?.final_summary_dump_count ?? 0),
    0,
  ),
  fixtures: results,
};
await Bun.write("reports/legal-research-v1-cluster-prevention-summary.json", JSON.stringify(summary, null, 2));
console.log(
  "\n[runner] summary gates_pass=",
  summary.hard_gates_all_pass,
  "total_clusters=",
  summary.total_clusters,
  "max_cluster_len=",
  summary.max_cluster_len_any,
  "final_dumps=",
  summary.total_final_summary_dumps,
);
