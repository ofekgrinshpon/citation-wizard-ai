// Targeted Phase 3 apply-path runner.
// Narrow, low-density questions designed to produce clean, separated repeats
// with 2–5 sources and no adjacent superscript clusters / ambiguous runs.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const FIXTURES: Array<{ id: string; question: string }> = [
  {
    // Narrow, single-doctrine question with a small canonical source set.
    id: "T1",
    question:
      "מהי הלכת אפרופים בפרשנות חוזים, וכיצד יושמה הלכה זו בפסיקה מאוחרת יותר?",
  },
  {
    // Narrow procedural question — small source set, naturally cites same source twice.
    id: "T2",
    question:
      "מהו המבחן להגשת בקשת רשות ערעור לבית המשפט העליון בגלגול שלישי לפי הלכת חניון חיפה?",
  },
  {
    // Narrow constitutional question — limited canonical sources, repeated references.
    id: "T3",
    question:
      "מהי פסקת ההגבלה בחוק יסוד: כבוד האדם וחירותו ומה הם ארבעת תנאיה?",
  },
];

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

function summarize(row: any, fx: { id: string }, run_id: string) {
  const md = row?.metadata || {};
  const drafter = md.drafter || {};
  const verifier = md.verifier || {};
  const mv = drafter.marker_validation || {};
  const cc = mv.citation_cleanup || {};
  const phase3 = cc.phase3 || {};
  const usedSources = drafter.used_sources || [];
  const footnotes: any[] = row?.footnotes || [];
  const answer: string = row?.answer || drafter.answer_markdown || "";
  const verifierUsable: string[] = (verifier.usable || []).map(
    (u: any) => u.candidate_id ?? u,
  );
  const usedIds: string[] = usedSources.map((u: any) => u.candidate_id).filter(Boolean);
  const subset = usedIds.every((id) => verifierUsable.includes(id));

  const ibidSamples = footnotes
    .filter((f) => f.short_form_kind === "ibid")
    .slice(0, 5)
    .map((f) => ({ number: f.number, back: f.back_ref_number, render: f.title }));
  const supraSamples = footnotes
    .filter((f) => f.short_form_kind === "supra")
    .slice(0, 5)
    .map((f) => ({ number: f.number, back: f.back_ref_number, render: f.title }));

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
      short_form_count: phase3.short_form_count ?? null,
      ibid_count: phase3.ibid_count ?? null,
      supra_count: phase3.supra_count ?? null,
      multi_digit_marker_runs_count: phase3.multi_digit_marker_runs_count ?? null,
      multi_digit_runs_from_single_token_count:
        phase3.multi_digit_runs_from_single_token_count ?? null,
      every_multi_digit_run_from_single_token:
        phase3.every_multi_digit_run_from_single_token ?? null,
    },
    ibid_examples: ibidSamples,
    supra_examples: supraSamples,
    token_leak_count: tokenLeakCount,
    source_set: {
      count: usedSources.length,
      ids: usedIds,
    },
    answer_strip_sup_len: stripSup(answer).length,
    answer_tail: answer.slice(-320),
  };
}

console.log(
  `[targeted] triggering ${FIXTURES.length} fixtures: ${FIXTURES.map((f) => f.id).join(",")}`,
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
    const row = await pollByRunId(run_id);
    if (!row) {
      console.error(`[${fx.id}] poll timeout`);
      return { fixture_id: fx.id, run_id, error: "poll_timeout" };
    }
    const s = summarize(row, fx, run_id);
    await Bun.write(
      `reports/legal-research-v1-occurrence-footnotes-targeted-${fx.id}.json`,
      JSON.stringify(s, null, 2),
    );
    console.log(
      `[${fx.id}] mvOK=${s.hard_gates.marker_validation_ok} p3=${s.phase3.applied} reason=${s.phase3.discarded_reason ?? "-"} K=${s.phase3.occurrence_count ?? "-"} U=${s.phase3.unique_source_count ?? "-"} ibid=${s.phase3.ibid_count ?? 0} supra=${s.phase3.supra_count ?? 0} leak=${s.token_leak_count}`,
    );
    return s;
  }),
);

const ok = results.filter((r: any) => !r.error);
const applied = ok.filter((r: any) => r.phase3?.applied);

const summary = {
  phase: "occurrence-footnotes-targeted-apply-path",
  ran: ok.length,
  errors: results.length - ok.length,
  applied_count: applied.length,
  any_applied: applied.length >= 1,
  hard_gates_all_pass:
    ok.every((r: any) => r.hard_gates.marker_validation_ok) &&
    ok.every((r: any) => r.hard_gates.internal_id_leak === false) &&
    ok.every((r: any) => r.hard_gates.footnote_eq_used) &&
    ok.every((r: any) => r.hard_gates.used_subset_of_usable),
  total_token_leaks: ok.reduce((a: number, r: any) => a + (r.token_leak_count || 0), 0),
  fixtures: results,
};
await Bun.write(
  "reports/legal-research-v1-occurrence-footnotes-targeted-summary.json",
  JSON.stringify(summary, null, 2),
);
console.log(
  "\n[targeted] gates_pass=",
  summary.hard_gates_all_pass,
  "applied=",
  summary.applied_count,
  "/",
  ok.length,
  "leaks=",
  summary.total_token_leaks,
);
