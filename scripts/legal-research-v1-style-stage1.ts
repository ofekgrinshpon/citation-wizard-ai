// Style validation Stage 1: re-run L1-L6 against new drafter prompt; capture hard gates + answer length.
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const ALL = (await Bun.file("eval/legal-research-v1/fixtures.json").json()).questions as Array<{ id: string; question: string }>;
const FIXTURES = ALL.filter((f) => ["L1","L2","L3","L4","L5","L6"].includes(f.id));

// Baselines from phaseE5 reports (answer length: we read baseline qa_log_id answers below)
const BASELINE_QA_LOG_IDS: Record<string,string> = {
  L1: "", // not stored; we'll just rely on per-fixture baseline length from current run vs prior reports' drafter sizing if available
};

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
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,total_footnotes,metadata&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`,
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

// Baseline lengths (chars) pulled by separately querying the prior baseline qa_log_ids from E.5 reports
// We hardcode IDs from reports/legal-research-v1-p7-phaseE5-L*.json
const BASELINE_IDS: Record<string,string> = {
  L2: "16cf8aea-3f52-4f84-ba94-ad05e0f13a56",
};
// For L1/L3/L4/L5/L6 we read from per-fixture E5 JSONs at runtime
async function loadBaselineQaIds() {
  const ids: Record<string,string> = {};
  for (const id of ["L1","L2","L3","L4","L5","L6"]) {
    try {
      const j = await Bun.file(`reports/legal-research-v1-p7-phaseE5-${id}.json`).json();
      if (j?.qa_log_id) ids[id] = j.qa_log_id;
    } catch {}
  }
  return ids;
}

async function fetchAnswerLen(qa_log_id: string): Promise<number | null> {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=answer&id=eq.${qa_log_id}`, { headers });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0]?.answer ? String(rows[0].answer).length : null;
}

const baselineIds = await loadBaselineQaIds();
const baselineLens: Record<string, number | null> = {};
for (const [id, qid] of Object.entries(baselineIds)) {
  baselineLens[id] = await fetchAnswerLen(qid);
}
console.log("baseline lens:", baselineLens);

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
    const md = row.metadata || {};
    const drafter = md.drafter || {};
    const verifier = md.verifier || {};
    const usedSources = drafter.used_sources || drafter.sources_used || [];
    const usableArr = verifier.usable || [];
    const usableIds = new Set(Array.isArray(usableArr) ? usableArr.map((u:any) => u?.candidate_id ?? u?.id ?? u) : []);
    const usedIds = Array.isArray(usedSources) ? usedSources.map((u:any) => u?.candidate_id ?? u?.id ?? u) : [];
    const used_subset_of_usable = usableIds.size === 0 ? null : usedIds.every((id:any) => usableIds.has(id));
    const answer = row.answer || "";
    const len = String(answer).length;
    const base = baselineLens[fx.id];
    const lenRatio = base ? len / base : null;
    const lenWithinBand = base ? lenRatio! >= 0.75 && lenRatio! <= 1.25 : null;

    const summary = {
      fixture_id: fx.id,
      run_id,
      qa_log_id: row.id,
      total_ms: md.total_ms,
      drafter_ms: drafter.ms ?? md.stage_runs?.drafter?.ms,
      marker_validation_ok: drafter.marker_validation?.ok,
      internal_id_leak: drafter.marker_validation?.internal_id_leak,
      footnote_count: drafter.footnote_count,
      used_sources_count: usedSources.length,
      footnote_eq_used: drafter.footnote_count === usedSources.length,
      used_subset_of_usable,
      drafter_ok: drafter.ok,
      stub_answer: !drafter.ok || drafter.footnote_count === 0,
      verifier_usable: verifier.candidates_usable ?? usableArr.length ?? null,
      answer_len_chars: len,
      baseline_len_chars: base,
      len_ratio: lenRatio ? Number(lenRatio.toFixed(2)) : null,
      len_within_25pct: lenWithinBand,
      answer_preview: String(answer).slice(0, 400),
    };
    await Bun.write(`reports/legal-research-v1-style-stage1-${fx.id}.json`, JSON.stringify({ ...summary, answer_full: answer }, null, 2));
    console.log(`[${fx.id}] markerOK=${summary.marker_validation_ok} leak=${summary.internal_id_leak} fc=${summary.footnote_count}/${summary.used_sources_count} sub=${summary.used_subset_of_usable} stub=${summary.stub_answer} len=${len} (base=${base} ratio=${summary.len_ratio})`);
    return summary;
  }),
);

const gates = {
  any_marker_fail: results.some((r:any) => r.marker_validation_ok === false),
  any_id_leak: results.some((r:any) => r.internal_id_leak === true),
  any_fc_mismatch: results.some((r:any) => r.footnote_eq_used === false),
  any_not_subset: results.some((r:any) => r.used_subset_of_usable === false),
  any_stub: results.some((r:any) => r.stub_answer === true),
  any_len_out_of_band: results.some((r:any) => r.len_within_25pct === false),
  any_poll_timeout: results.some((r:any) => r.error === "poll_timeout"),
};
const passed = !Object.values(gates).some(Boolean);
await Bun.write("reports/legal-research-v1-style-stage1-summary.json", JSON.stringify({ gates, passed, results }, null, 2));
console.log("\nGATES:", gates, "PASSED:", passed);
