// P7 Phase D runner — simplified pipeline (no placement-repair, no Rule 37,
// no atomic emit). Validates that marker_validation, used_sources integrity,
// footnote stability, and atomic.validation (telemetry-only) all stay green
// while drafter.ms drops where placement_repair previously fired.
//
// Usage:  bun scripts/legal-research-v1-p7-phaseD-runner.ts

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const TAG = "p7-phaseD";

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

// Try to load Phase C.1 baseline for per-fixture comparison.
async function loadBaseline(id: string): Promise<any | null> {
  try {
    const file = Bun.file(`reports/legal-research-v1-p7-phaseC1-${id}.json`);
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

    // Baseline comparison (source set + drafter.ms).
    const baseline = await loadBaseline(t.id);
    const baseUsed: any[] = baseline?.metadata?.drafter?.used_sources ?? baseline?.row_summary?.used_sources ?? [];
    const baseUsedIds = new Set(baseUsed.map((u: any) => u.candidate_id));
    const curUsedIds = new Set(used.map((u: any) => u.candidate_id));
    const baseDrafterMs = baseline?.metadata?.drafter?.ms ?? null;
    const baseTotalMs = baseline?.metadata?.total_ms ?? null;

    const symmetric = baseUsedIds.size === curUsedIds.size &&
      [...curUsedIds].every((id) => baseUsedIds.has(id));

    const row_summary = {
      fixture_id: t.id,
      marker_validation_ok: !!mv.ok,
      internal_id_leak: !!mv.internal_id_leak,
      used_sources_count: used.length,
      footnote_count: finalFootnotes.length,
      footnote_eq_used: finalFootnotes.length === used.length,
      used_sources_subset_of_usable: usedAllInUsable,
      no_raw_atomic_tokens: !hasRawAtomic,
      no_candidate_id_leak: !hasCandidateIdLeak,
      atomic_mode: atomic?.mode ?? "off",
      atomic_normalize_ok: atomic?.normalize_ok ?? null,
      atomic_validation_ok: atomic?.validation?.ok ?? null,
      atomic_used_sources_byte_equal: atomic?.used_sources_byte_equal ?? null,
      placement_telemetry: {
        ok: pl.ok ?? null,
        cluster_count: pl.cluster_count ?? null,
        out_of_order_count: pl.out_of_order_count ?? null,
        end_paragraph_dump_count: pl.end_paragraph_dump_count ?? null,
      },
      drafter_ms: d.ms ?? null,
      total_ms: md.total_ms ?? null,
      baseline_drafter_ms: baseDrafterMs,
      baseline_total_ms: baseTotalMs,
      drafter_ms_delta: (d.ms != null && baseDrafterMs != null) ? d.ms - baseDrafterMs : null,
      total_ms_delta: (md.total_ms != null && baseTotalMs != null) ? md.total_ms - baseTotalMs : null,
      source_set_equals_baseline: baseline ? symmetric : null,
      source_set_added: baseline ? [...curUsedIds].filter((id) => !baseUsedIds.has(id)) : null,
      source_set_removed: baseline ? [...baseUsedIds].filter((id) => !curUsedIds.has(id)) : null,
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
          atomic,
          placement: pl,
          answer_preview: finalAnswer.slice(0, 800),
          footnotes: finalFootnotes,
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
    source_set_matches_baseline: f.filter((x: any) => x.source_set_equals_baseline === true).length,
    mean_drafter_ms: Math.round(f.reduce((s: number, x: any) => s + (x.drafter_ms ?? 0), 0) / Math.max(1, f.length)),
    mean_baseline_drafter_ms: Math.round(
      f.filter((x: any) => x.baseline_drafter_ms != null).reduce((s: number, x: any) => s + x.baseline_drafter_ms, 0) /
      Math.max(1, f.filter((x: any) => x.baseline_drafter_ms != null).length),
    ),
    mean_total_ms: Math.round(f.reduce((s: number, x: any) => s + (x.total_ms ?? 0), 0) / Math.max(1, f.length)),
    mean_baseline_total_ms: Math.round(
      f.filter((x: any) => x.baseline_total_ms != null).reduce((s: number, x: any) => s + x.baseline_total_ms, 0) /
      Math.max(1, f.filter((x: any) => x.baseline_total_ms != null).length),
    ),
  };
  await Bun.write(
    `reports/legal-research-v1-${TAG}-summary.json`,
    JSON.stringify(summary, null, 2),
  );
  console.log("\n=== Phase D summary ===");
  console.log(JSON.stringify(summary.aggregate, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
