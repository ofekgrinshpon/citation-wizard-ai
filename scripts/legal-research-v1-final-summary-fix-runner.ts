// Validation runner for the drafter-prompt "no final-summary citation dump" fix.
// Re-runs T1 (אפרופים), T2 (חניון חיפה), T3 (פסקת ההגבלה) and PROT,
// and reports final-paragraph marker stats in addition to phase3 telemetry.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const FIXTURES: Array<{ id: string; question: string }> = [
  { id: "T1", question: "מהי הלכת אפרופים בפרשנות חוזים, וכיצד יושמה הלכה זו בפסיקה מאוחרת יותר?" },
  { id: "T2", question: "מהו המבחן להגשת בקשת רשות ערעור לבית המשפט העליון בגלגול שלישי לפי הלכת חניון חיפה?" },
  { id: "T3", question: "מהי פסקת ההגבלה בחוק יסוד: כבוד האדם וחירותו ומה הם ארבעת תנאיה?" },
  { id: "PROT", question: "האם כישלון מערכתי באכיפת עבירת גביית דמי חסות (פרוטקשן) יכול להוות מחדל חקיקתי בהגנה על הזכות לחיים וביטחון?" },
];

const SUP = /[⁰¹²³⁴⁵⁶⁷⁸⁹]/gu;
const SUP_RUN = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu;
const stripSup = (s: string) => s.replace(SUP, "");

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

function analyzeFinalParagraph(answer: string) {
  const paragraphs = answer.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const finalParagraph = paragraphs[paragraphs.length - 1] ?? "";
  // Last "sentence" — split on . ! ? or Hebrew/Arabic full stop; take final non-empty.
  const sentences = finalParagraph
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lastSentence = sentences[sentences.length - 1] ?? finalParagraph;

  const finalRuns = finalParagraph.match(SUP_RUN) || [];
  const lastSentenceRuns = lastSentence.match(SUP_RUN) || [];
  const finalMarkerCount = finalRuns.reduce((a, r) => a + r.length, 0);
  const lastSentenceMarkerCount = lastSentenceRuns.reduce((a, r) => a + r.length, 0);
  const longestLastSentenceRun = lastSentenceRuns.reduce((m, r) => Math.max(m, r.length), 0);

  // Heuristic "summary dump": any superscript run of length >= 4 in the last sentence,
  // OR last sentence contains >= 4 distinct superscript characters.
  const distinctInLastSentence = new Set(lastSentence.match(SUP) || []).size;
  const finalSummaryDumpHeuristic =
    longestLastSentenceRun >= 4 || distinctInLastSentence >= 4;

  return {
    final_paragraph_preview: finalParagraph.slice(-220),
    last_sentence_preview: lastSentence.slice(-220),
    final_paragraph_marker_count: finalMarkerCount,
    final_paragraph_runs: finalRuns,
    final_paragraph_last_sentence_marker_count: lastSentenceMarkerCount,
    final_paragraph_last_sentence_runs: lastSentenceRuns,
    final_paragraph_last_sentence_longest_run: longestLastSentenceRun,
    final_summary_dump_heuristic: finalSummaryDumpHeuristic,
  };
}

function summarize(row: any, fx: { id: string }, run_id: string) {
  const md = row?.metadata || {};
  const drafter = md.drafter || {};
  const verifier = md.verifier || {};
  const mv = drafter.marker_validation || {};
  const placement = mv.placement || {};
  const cc = mv.citation_cleanup || {};
  const phase3 = cc.phase3 || {};
  const usedSources = drafter.used_sources || [];
  const answer: string = row?.answer || drafter.answer_markdown || "";
  const verifierUsable: string[] = (verifier.usable || []).map((u: any) => u.candidate_id ?? u);
  const usedIds: string[] = usedSources.map((u: any) => u.candidate_id).filter(Boolean);
  const subset = usedIds.every((id) => verifierUsable.includes(id));
  const tokenLeakCount = (answer.match(/\[\[fn:\d+\]\]/g) || []).length;

  return {
    fixture_id: fx.id,
    run_id,
    qa_log_id: row?.id ?? null,
    total_ms: md.total_ms,
    hard_gates: {
      marker_validation_ok: mv.ok === true,
      internal_id_leak: mv.internal_id_leak === true,
      footnote_eq_used:
        phase3.applied === true
          ? (drafter.footnote_count ?? 0) === (phase3.occurrence_count ?? 0)
          : (drafter.footnote_count ?? 0) === usedSources.length,
      used_subset_of_usable: subset,
    },
    phase3: {
      applied: phase3.applied === true,
      discarded_reason: phase3.discarded_reason ?? null,
      occurrence_count: phase3.occurrence_count ?? null,
      unique_source_count: phase3.unique_source_count ?? null,
      ibid_count: phase3.ibid_count ?? null,
      supra_count: phase3.supra_count ?? null,
      ambiguous_run_samples: phase3.ambiguous_run_samples ?? null,
    },
    placement: {
      cluster_count: placement.cluster_count ?? null,
      max_cluster_len: placement.max_cluster_len ?? null,
      final_summary_dump: placement.final_summary_dump ?? null,
    },
    final_paragraph: analyzeFinalParagraph(answer),
    source_set: {
      count: usedSources.length,
      ids: usedIds,
    },
    drafter: {
      ok: drafter.ok,
      footnote_count: drafter.footnote_count,
      unique_source_count: drafter.unique_source_count ?? usedSources.length,
    },
    token_leak_count: tokenLeakCount,
    answer_strip_sup_len: stripSup(answer).length,
    answer_tail: answer.slice(-320),
  };
}

console.log(`[final-summary-fix] triggering ${FIXTURES.length} fixtures: ${FIXTURES.map((f) => f.id).join(",")}`);

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
    const row = await pollByRunId(run_id);
    if (!row) return { fixture_id: fx.id, run_id, error: "poll_timeout" };
    const s = summarize(row, fx, run_id);
    await Bun.write(
      `reports/legal-research-v1-final-summary-fix-${fx.id}.json`,
      JSON.stringify(s, null, 2),
    );
    console.log(
      `[${fx.id}] mvOK=${s.hard_gates.marker_validation_ok} dump_heur=${s.final_paragraph.final_summary_dump_heuristic} lastSentMarkers=${s.final_paragraph.final_paragraph_last_sentence_marker_count} p3=${s.phase3.applied} reason=${s.phase3.discarded_reason ?? "-"} leak=${s.token_leak_count}`,
    );
    return s;
  }),
);

const ok = results.filter((r: any) => !r.error);
const summary = {
  phase: "drafter-prompt-final-summary-fix",
  ran: ok.length,
  errors: results.length - ok.length,
  any_final_summary_dump: ok.some((r: any) => r.final_paragraph?.final_summary_dump_heuristic),
  fixtures_with_dump: ok.filter((r: any) => r.final_paragraph?.final_summary_dump_heuristic).map((r: any) => r.fixture_id),
  phase3_applied_count: ok.filter((r: any) => r.phase3?.applied).length,
  phase3_applied_fixtures: ok.filter((r: any) => r.phase3?.applied).map((r: any) => r.fixture_id),
  hard_gates_all_pass:
    ok.every((r: any) => r.hard_gates.marker_validation_ok) &&
    ok.every((r: any) => r.hard_gates.internal_id_leak === false) &&
    ok.every((r: any) => r.hard_gates.footnote_eq_used) &&
    ok.every((r: any) => r.hard_gates.used_subset_of_usable),
  total_token_leaks: ok.reduce((a: number, r: any) => a + (r.token_leak_count || 0), 0),
  fixtures: results,
};
await Bun.write("reports/legal-research-v1-final-summary-fix-summary.json", JSON.stringify(summary, null, 2));
console.log(
  "\n[final-summary-fix] gates=",
  summary.hard_gates_all_pass,
  "anyDump=",
  summary.any_final_summary_dump,
  "dumpedFx=",
  summary.fixtures_with_dump,
  "applied=",
  summary.phase3_applied_count,
  "appliedFx=",
  summary.phase3_applied_fixtures,
  "leaks=",
  summary.total_token_leaks,
);
