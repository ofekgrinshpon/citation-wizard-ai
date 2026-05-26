// P7 Phase E.1 runner — parallel verifier batches (cap=2).
// Validates that all Phase D correctness gates remain green and that
// L6 verifier wall time materially improves via parallelization, while
// per-fixture usable/dropped sets stay equivalent (mod LLM noise).
//
// Usage:  bun scripts/legal-research-v1-p7-phaseE1-runner.ts

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const TAG = "p7-phaseE1";

const FIXTURES: Array<{ id: string; question: string }> = [
  { id: "L1", question: "מהם התנאים למתן צו מניעה זמני?" },
  { id: "L2", question: "מהי דוקטרינת ההבטחה המנהלית?" },
  { id: "L3", question: "מתי בית המשפט יפחית פיצוי מוסכם לפי סעיף 15 לחוק החוזים תרופות?" },
  { id: "L4", question: "מהי דוקטרינת השתק פלוגתא?" },
  { id: "L5", question: "מהי עילת הסבירות ומה היקף הביקורת השיפוטית עליה?" },
  { id: "L6", question: "רשות מקומית נתנה הבטחה מנהלית לאזרח אשר הסתמך עליה, ולאחר מכן חל שינוי נסיבות מהותי. מהם השיקולים והכללים החלים על אכיפת ההבטחה אל מול שינוי הנסיבות, ומה היחס בין סמכות הרשות, אינטרס ההסתמכות של האזרח, והאינטרס הציבורי?" },
];

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
  const j = await r.json();
  return { status: r.status, ...j };
}

async function pollByRunId(run_id: string, timeoutMs = 360_000): Promise<any | null> {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url =
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,metadata&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`;
    const r = await fetch(url, { headers });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) return rows[0];
    }
    await new Promise((res) => setTimeout(res, 4000));
  }
  return null;
}

async function loadPhaseD(id: string): Promise<any | null> {
  try {
    const file = Bun.file(`reports/legal-research-v1-p7-phaseD-${id}.json`);
    if (!(await file.exists())) return null;
    return await file.json();
  } catch { return null; }
}

async function main() {
  if (!SUPABASE_URL || !SR_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const triggered: Array<{ id: string; run_id: string; question: string }> = [];
  const summary: { tag: string; generated_at: string; fixtures: any[]; aggregate?: any } = {
    tag: TAG,
    generated_at: new Date().toISOString(),
    fixtures: [],
  };
  for (const fx of FIXTURES) {
    const t = await trigger(fx.question);
    console.log(`triggered ${fx.id} status=${t.status} run_id=${t.run_id}`);
    if (!t.run_id) { console.error(`Failed to trigger ${fx.id}:`, t); continue; }
    triggered.push({ id: fx.id, run_id: t.run_id, question: fx.question });
  }

  for (const t of triggered) {
    console.log(`\nPolling for ${t.id} run_id=${t.run_id}...`);
    const row = await pollByRunId(t.run_id, 360_000);
    if (!row) { console.error(`TIMEOUT ${t.id}`); continue; }
    const md = row.metadata ?? {};
    const d = md.drafter ?? {};
    const mv = d.marker_validation ?? {};
    const pl = mv.placement ?? {};
    const v = md.verifier ?? {};
    const atomic = d.atomic ?? null;
    const usableIds = new Set((v.usable ?? []).map((u: any) => u.candidate_id));
    const used = d.used_sources ?? [];
    const usedAllInUsable = used.every((u: any) => usableIds.has(u.candidate_id));
    const finalAnswer = row.answer ?? "";
    const finalFootnotes = row.footnotes ?? [];
    const hasRawAtomic = /\[\[fn:/.test(finalAnswer);
    const hasCandidateIdLeak = /candidate_id|cand_/i.test(finalAnswer);

    // Phase D comparison: source set, verifier wall, usable/dropped counts.
    const baseline = await loadPhaseD(t.id);
    const baseV = baseline?.row_summary ?? {};
    const baseUsableCount = baseV.used_sources_count ?? null; // proxy: used==usable subset
    const baseDrafterMs = baseV.drafter_ms ?? null;
    const baseTotalMs = baseV.total_ms ?? null;

    const curUsedIds = new Set(used.map((u: any) => u.candidate_id));
    const baseUsedIds = new Set<string>(
      (baseline?.row_summary?.source_set_added ?? []).map((x: string) => x),
    );
    const setEq = baseUsedIds.size === curUsedIds.size &&
      [...curUsedIds].every((id) => baseUsedIds.has(id));

    const row_summary = {
      fixture_id: t.id,
      // Correctness gates (must match Phase D 6/6)
      marker_validation_ok: !!mv.ok,
      internal_id_leak: !!mv.internal_id_leak,
      used_sources_count: used.length,
      footnote_count: finalFootnotes.length,
      footnote_eq_used: finalFootnotes.length === used.length,
      used_sources_subset_of_usable: usedAllInUsable,
      no_raw_atomic_tokens: !hasRawAtomic,
      no_candidate_id_leak: !hasCandidateIdLeak,
      atomic_validation_ok: atomic?.validation?.ok ?? null,
      // Verifier parallel telemetry
      verifier: {
        parallel: v.parallel ?? null,
        concurrency_limit: v.concurrency_limit ?? null,
        batch_count: v.batch_count ?? null,
        batch_ms: v.batch_ms ?? null,
        total_wall_ms: v.total_wall_ms ?? null,
        total_sum_ms: v.total_sum_ms ?? null,
        escalated_batches: v.escalated_batches ?? null,
        merge_order_preserved: v.merge_order_preserved ?? null,
        rate_limit_count: v.rate_limit_count ?? null,
        retry_count: v.retry_count ?? null,
        fallback_to_sequential: v.fallback_to_sequential ?? null,
        candidates_verified: v.candidates_verified ?? null,
        candidates_usable: v.candidates_usable ?? null,
        candidates_dropped: v.candidates_dropped ?? null,
        batches_labels: (v.batches ?? []).map((b: any) => b.label),
      },
      // Baseline comparison
      drafter_ms: d.ms ?? null,
      total_ms: md.total_ms ?? null,
      baseline_drafter_ms: baseDrafterMs,
      baseline_total_ms: baseTotalMs,
      total_ms_delta: (md.total_ms != null && baseTotalMs != null) ? md.total_ms - baseTotalMs : null,
      baseline_used_sources_count: baseUsableCount,
      used_sources_count_delta: (baseUsableCount != null) ? used.length - baseUsableCount : null,
      source_set_equals_baseline: baseline ? setEq : null,
      source_set_added: baseline ? [...curUsedIds].filter((id) => !baseUsedIds.has(id)) : null,
      source_set_removed: baseline ? [...baseUsedIds].filter((id) => !curUsedIds.has(id)) : null,
      placement_telemetry: {
        ok: pl.ok ?? null,
        cluster_count: pl.cluster_count ?? null,
        end_paragraph_dump_count: pl.end_paragraph_dump_count ?? null,
      },
    };
    summary.fixtures.push(row_summary);

    console.log(`=== ${t.id} ===`);
    console.log(JSON.stringify(row_summary, null, 2));

    const reportPath = `reports/legal-research-v1-${TAG}-${t.id}.json`;
    await Bun.write(
      reportPath,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          fixture: { id: t.id, question: t.question },
          qa_log_id: row.id,
          run_id: t.run_id,
          row_summary,
          verifier_full: v,
          atomic,
          placement: pl,
          answer_preview: finalAnswer.slice(0, 600),
        },
        null,
        2,
      ),
    );
    console.log(`wrote ${reportPath}`);
  }

  const f = summary.fixtures;
  summary.aggregate = {
    count: f.length,
    marker_ok: f.filter((x: any) => x.marker_validation_ok).length,
    no_leak: f.filter((x: any) => !x.internal_id_leak).length,
    all_used_in_usable: f.filter((x: any) => x.used_sources_subset_of_usable).length,
    footnote_eq_used: f.filter((x: any) => x.footnote_eq_used).length,
    no_raw_atomic: f.filter((x: any) => x.no_raw_atomic_tokens).length,
    no_candidate_id_leak: f.filter((x: any) => x.no_candidate_id_leak).length,
    atomic_validation_ok: f.filter((x: any) => x.atomic_validation_ok === true).length,
    parallel_true: f.filter((x: any) => x.verifier.parallel === true).length,
    merge_order_preserved: f.filter((x: any) => x.verifier.merge_order_preserved === true).length,
    rate_limit_count_total: f.reduce((s: number, x: any) => s + (x.verifier.rate_limit_count ?? 0), 0),
    fallback_to_sequential_count: f.filter((x: any) => x.verifier.fallback_to_sequential === true).length,
  };
  await Bun.write(
    `reports/legal-research-v1-${TAG}-summary.json`,
    JSON.stringify(summary, null, 2),
  );
  console.log("\n=== Phase E.1 summary ===");
  console.log(JSON.stringify(summary.aggregate, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
