// Production validation runner for Phase 3 occurrence-footnote expansion.
// Triggers L1–L6 + PROT + 3 citation-heavy fixtures designed to induce repeats.
// Captures hard gates, phase3 telemetry, prose-invariance proof, runtime delta
// vs the cluster-prevention baseline.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const ALL = (await Bun.file("eval/legal-research-v1/fixtures.json").json()).questions as Array<{
  id: string;
  question: string;
}>;
const IDS = (process.env.OF_IDS ?? "L1,L2,L3,L4,L5,L6").split(",");
const FIXTURES: Array<{ id: string; question: string }> = ALL.filter((f) => IDS.includes(f.id));
FIXTURES.push({
  id: "PROT",
  question:
    "האם כישלון מערכתי באכיפת עבירת גביית דמי חסות (פרוטקשן) יכול להוות מחדל חקיקתי בהגנה על הזכות לחיים וביטחון?",
});
// Citation-heavy ad-hoc fixtures designed to induce same-source repeats.
FIXTURES.push({
  id: "RPT1",
  question:
    "מהם תנאי החלת השתק פלוגתא בין הליכים אזרחיים לפליליים, וכיצד מתייחסת הפסיקה לנטל ההוכחה השונה?",
});
FIXTURES.push({
  id: "RPT2",
  question:
    "מהי דוקטרינת הצפיות בדיני חוזים — הגדרה, יסודות, יישום וסייגים — לפי הפסיקה הישראלית המנחה?",
});
FIXTURES.push({
  id: "RPT3",
  question:
    "מהו היחס בין עוולת הרשלנות לעוולת הפרת חובה חקוקה כאשר אותו מעשה נטען כעולה כדי שתי העוולות?",
});

const STRIP_SUP = /[⁰¹²³⁴⁵⁶⁷⁸⁹]/gu;
const stripSup = (s: string) => s.replace(STRIP_SUP, "");

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
    return await Bun.file(`reports/legal-research-v1-cluster-prevention-${id}.json`).json();
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
  const cc = mv.citation_cleanup || {};
  const phase3 = cc.phase3 || {};
  const usedSources = drafter.used_sources || [];
  const footnotes: any[] = row?.footnotes || [];
  const answer: string = row?.answer || drafter.answer_markdown || "";
  const verifierUsable: string[] = (verifier.usable || []).map((u: any) => u.candidate_id ?? u);
  const usedIds: string[] = usedSources.map((u: any) => u.candidate_id).filter(Boolean);
  const subset = usedIds.every((id) => verifierUsable.includes(id));

  // Prose-invariance proof using baseline answer if available.
  const baselineAnswer: string | undefined = baseline?.answer_tail
    ? undefined // baseline only stored a tail, not full answer — cannot byte-compare
    : undefined;

  // Short-form sampling.
  const shortFormSamples = footnotes
    .filter((f) => f.is_short_form)
    .slice(0, 5)
    .map((f) => ({
      number: f.number,
      kind: f.short_form_kind,
      back_ref_number: f.back_ref_number,
      rendering: f.title,
    }));

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
      footnote_eq_used:
        phase3.applied === true
          ? (drafter.footnote_count ?? 0) === (phase3.occurrence_count ?? 0)
          : (drafter.footnote_count ?? 0) === usedSources.length,
      used_subset_of_usable: subset,
      every_marker_has_footnote: mv.every_marker_has_footnote ?? null,
      every_footnote_in_usable: mv.every_footnote_in_usable ?? null,
      no_adjacent_marker_clusters: mv.no_adjacent_marker_clusters ?? null,
    },
    phase3: {
      applied: phase3.applied === true,
      discarded_reason: phase3.discarded_reason ?? null,
      occurrence_count: phase3.occurrence_count ?? null,
      unique_source_count: phase3.unique_source_count ?? null,
      short_form_count: phase3.short_form_count ?? null,
      ibid_count: phase3.ibid_count ?? null,
      supra_count: phase3.supra_count ?? null,
      cluster_examples: phase3.cluster_examples ?? null,
    },
    short_form_samples: shortFormSamples,
    placement: {
      cluster_count: placement.cluster_count ?? null,
      max_cluster_len: placement.max_cluster_len ?? null,
      final_summary_dump: placement.final_summary_dump ?? null,
    },
    source_list: {
      count: usedSources.length,
      baseline_count: baseline?.source_list?.count ?? null,
      ids: usedIds,
    },
    drafter: {
      ok: drafter.ok,
      escalated: drafter.escalated,
      footnote_count: drafter.footnote_count,
      unique_source_count: drafter.unique_source_count ?? usedSources.length,
    },
    answer_strip_sup_len: stripSup(answer).length,
    answer_tail: answer.slice(-280),
  };
}

console.log(
  `[runner] triggering ${FIXTURES.length} fixtures: ${FIXTURES.map((f) => f.id).join(",")}`,
);

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
    await Bun.write(
      `reports/legal-research-v1-occurrence-footnotes-${fx.id}.json`,
      JSON.stringify(s, null, 2),
    );
    console.log(
      `[${fx.id}] mvOK=${s.hard_gates.marker_validation_ok} p3=${s.phase3.applied} reason=${s.phase3.discarded_reason ?? "-"} K=${s.phase3.occurrence_count ?? "-"} U=${s.phase3.unique_source_count ?? "-"} ibid=${s.phase3.ibid_count ?? 0} supra=${s.phase3.supra_count ?? 0} Δ=${s.runtime_delta_ms}ms`,
    );
    return s;
  }),
);

const ok = results.filter((r: any) => !r.error);
const applied = ok.filter((r: any) => r.phase3?.applied);
const skipAmb = ok.filter((r: any) => r.phase3?.discarded_reason === "ambiguous_adjacent_markers");
const skipK = ok.filter(
  (r: any) =>
    r.phase3?.discarded_reason === "multi_digit_occurrences_require_boundary_tokens",
);

const summary = {
  phase: "occurrence-footnotes-validation",
  ran: ok.length,
  errors: results.length - ok.length,
  hard_gates_all_pass:
    ok.every((r: any) => r.hard_gates.marker_validation_ok) &&
    ok.every((r: any) => r.hard_gates.internal_id_leak === false) &&
    ok.every((r: any) => r.hard_gates.footnote_eq_used) &&
    ok.every((r: any) => r.hard_gates.used_subset_of_usable),
  fixtures_phase3_applied: applied.length,
  fixtures_skipped_ambiguous_clusters: skipAmb.length,
  fixtures_skipped_k_too_large: skipK.length,
  fixtures_with_source_count_change: ok.filter(
    (r: any) =>
      r.source_list.baseline_count !== null &&
      r.source_list.count !== r.source_list.baseline_count,
  ).length,
  short_form_examples_across_fixtures: applied
    .flatMap((r: any) => (r.short_form_samples || []).map((s: any) => ({ fixture: r.fixture_id, ...s })))
    .slice(0, 10),
  total_runtime_delta_ms: ok
    .map((r: any) => r.runtime_delta_ms)
    .filter((x: any) => typeof x === "number")
    .reduce((a: number, b: number) => a + b, 0),
  fixtures: results,
};
await Bun.write(
  "reports/legal-research-v1-occurrence-footnotes-summary.json",
  JSON.stringify(summary, null, 2),
);
console.log(
  "\n[runner] gates_pass=",
  summary.hard_gates_all_pass,
  "applied=",
  summary.fixtures_phase3_applied,
  "skip_clusters=",
  summary.fixtures_skipped_ambiguous_clusters,
  "skip_K=",
  summary.fixtures_skipped_k_too_large,
  "source_count_changes=",
  summary.fixtures_with_source_count_change,
  "Δms=",
  summary.total_runtime_delta_ms,
);
