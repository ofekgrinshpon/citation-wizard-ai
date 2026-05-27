// Production validation runner for citation cleanup (Phase 1 + Phase 2 + cluster telemetry).
// Runs L1–L6 in parallel against deployed legal-research-v1 and captures:
//   marker_validation.ok, internal_id_leak, footnote_count == used_sources.length,
//   used_sources ⊆ verifier.usable, citation_cleanup.{phase1,phase2,clusters},
//   chronological numbering before/after, runtime delta vs phaseE5 baseline,
//   rollback flag, and source-list-unchanged check.
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const ALL = (await Bun.file("eval/legal-research-v1/fixtures.json").json()).questions as Array<{ id: string; question: string }>;
const IDS = (process.env.CLEANUP_IDS ?? "L1,L2,L3,L4,L5,L6").split(",");
const FIXTURES = ALL.filter((f) => IDS.includes(f.id));

const SUP_TO_DIGIT: Record<string, string> = { "⁰":"0","¹":"1","²":"2","³":"3","⁴":"4","⁵":"5","⁶":"6","⁷":"7","⁸":"8","⁹":"9" };
function extractMarkerOrder(s: string): number[] {
  const out: number[] = [];
  let cur = "";
  for (const ch of s) {
    if (SUP_TO_DIGIT[ch] !== undefined) cur += SUP_TO_DIGIT[ch];
    else if (cur) { out.push(Number(cur)); cur = ""; }
  }
  if (cur) out.push(Number(cur));
  return out;
}
function firstAppearanceOrder(markers: number[]): number[] {
  const seen = new Set<number>(); const out: number[] = [];
  for (const n of markers) if (!seen.has(n)) { seen.add(n); out.push(n); }
  return out;
}
function isChronological(markers: number[]): boolean {
  const fa = firstAppearanceOrder(markers);
  return fa.every((n, i) => n === i + 1);
}
function countClusters(s: string): { count: number; examples: string[] } {
  const m = [...s.matchAll(/[⁰-⁹]{2,}/gu)];
  return { count: m.length, examples: m.slice(0, 5).map((x) => x[0]) };
}

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

// Baseline lookup for runtime delta.
async function loadBaseline(id: string): Promise<number | null> {
  try {
    const j = await Bun.file(`reports/legal-research-v1-p7-phaseE5-${id}.json`).json();
    return j.total_ms ?? null;
  } catch { return null; }
}

function summarize(row: any, fx: { id: string }, run_id: string, baseline_ms: number | null) {
  const md = row?.metadata || {};
  const drafter = md.drafter || {};
  const verifier = md.verifier || {};
  const mv = drafter.marker_validation || {};
  const cleanup = mv.citation_cleanup || null;
  const usedSources = drafter.used_sources || drafter.sources_used || [];
  const answer: string = row?.answer || drafter.answer_markdown || "";
  const markers = extractMarkerOrder(answer);
  const chrono = isChronological(markers);
  const clusters = countClusters(answer);

  const verifierUsable: string[] = (verifier.usable || []).map((u: any) => u.candidate_id ?? u);
  const usedIds: string[] = usedSources.map((u: any) => u.candidate_id).filter(Boolean);
  const subset = usedIds.every((id) => verifierUsable.includes(id));

  const rolled_back =
    cleanup?.phase1?.discarded_reason === "marker_validation_failed" ||
    cleanup?.phase2?.discarded_reason === "marker_validation_failed";

  return {
    fixture_id: fx.id,
    run_id,
    qa_log_id: row?.id ?? null,
    total_ms: md.total_ms,
    baseline_total_ms: baseline_ms,
    runtime_delta_ms: typeof md.total_ms === "number" && typeof baseline_ms === "number" ? md.total_ms - baseline_ms : null,
    hard_gates: {
      marker_validation_ok: mv.ok === true,
      internal_id_leak: mv.internal_id_leak === true,
      footnote_eq_used: (drafter.footnote_count ?? 0) === usedSources.length,
      used_subset_of_usable: subset,
    },
    citation_cleanup: cleanup,
    chronological: {
      chronological_ok: chrono,
      first_appearance_order: firstAppearanceOrder(markers),
      total_marker_count: markers.length,
    },
    clusters_observed: clusters,
    rolled_back,
    source_list: {
      count: usedSources.length,
      ids: usedIds,
    },
    drafter: {
      ok: drafter.ok,
      escalated: drafter.escalated,
      footnote_count: drafter.footnote_count,
      used_sources_count: usedSources.length,
    },
  };
}

console.log(`[runner] triggering ${FIXTURES.length} fixtures in parallel: ${FIXTURES.map((f) => f.id).join(",")}`);

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
    await Bun.write(`reports/legal-research-v1-citation-cleanup-${fx.id}.json`, JSON.stringify(s, null, 2));
    console.log(`[${fx.id}] total=${s.total_ms}ms Δ=${s.runtime_delta_ms}ms markerOK=${s.hard_gates.marker_validation_ok} chrono=${s.chronological.chronological_ok} swaps=${s.citation_cleanup?.phase2?.punct_swaps ?? "?"} clusters=${s.clusters_observed.count} rollback=${s.rolled_back}`);
    return s;
  }),
);

const ok = results.filter((r: any) => !r.error);
const summary = {
  phase: "citation-cleanup-validation",
  ran: ok.length,
  errors: results.length - ok.length,
  hard_gates_all_pass:
    ok.every((r: any) => r.hard_gates.marker_validation_ok) &&
    ok.every((r: any) => r.hard_gates.internal_id_leak === false) &&
    ok.every((r: any) => r.hard_gates.footnote_eq_used) &&
    ok.every((r: any) => r.hard_gates.used_subset_of_usable),
  chronological_all_ok: ok.every((r: any) => r.chronological.chronological_ok),
  any_rollback: ok.some((r: any) => r.rolled_back),
  total_punct_swaps: ok.reduce((s: number, r: any) => s + (r.citation_cleanup?.phase2?.punct_swaps ?? 0), 0),
  total_clusters_remaining: ok.reduce((s: number, r: any) => s + (r.clusters_observed?.count ?? 0), 0),
  runtime_deltas_ms: ok.map((r: any) => ({ id: r.fixture_id, delta: r.runtime_delta_ms })),
  fixtures: results,
};
await Bun.write("reports/legal-research-v1-citation-cleanup-summary.json", JSON.stringify(summary, null, 2));
console.log("\n[runner] WROTE summary. gates_pass=", summary.hard_gates_all_pass, "chrono_ok=", summary.chronological_all_ok, "rollback_any=", summary.any_rollback);
