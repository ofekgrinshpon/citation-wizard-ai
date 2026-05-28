// Quality-gate validation runner.
// Fixtures: T1–T3 + PROT + L1–L6 + RPT1–RPT3.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const ALL = (await Bun.file("eval/legal-research-v1/fixtures.json").json()).questions as Array<{ id: string; question: string }>;
const LIDS = ["L1","L2","L3","L4","L5","L6"];
const FIXTURES: Array<{ id: string; question: string }> = [
  { id: "T1", question: "מהי הלכת אפרופים בפרשנות חוזים, וכיצד יושמה הלכה זו בפסיקה מאוחרת יותר?" },
  { id: "T2", question: "מהו המבחן להגשת בקשת רשות ערעור לבית המשפט העליון בגלגול שלישי לפי הלכת חניון חיפה?" },
  { id: "T3", question: "מהי פסקת ההגבלה בחוק יסוד: כבוד האדם וחירותו ומה הם ארבעת תנאיה?" },
  { id: "PROT", question: "האם כישלון מערכתי באכיפת עבירת גביית דמי חסות (פרוטקשן) יכול להוות מחדל חקיקתי בהגנה על הזכות לחיים וביטחון?" },
  ...ALL.filter((f) => LIDS.includes(f.id)),
  { id: "RPT1", question: "מהם תנאי החלת השתק פלוגתא בין הליכים אזרחיים לפליליים, וכיצד מתייחסת הפסיקה לנטל ההוכחה השונה?" },
  { id: "RPT2", question: "מהי דוקטרינת הצפיות בדיני חוזים — הגדרה, יסודות, יישום וסייגים — לפי הפסיקה הישראלית המנחה?" },
  { id: "RPT3", question: "מהו היחס בין עוולת הרשלנות לעוולת הפרת חובה חקוקה כאשר אותו מעשה נטען כעולה כדי שתי העוולות?" },
];

const SUP = /[⁰¹²³⁴⁵⁶⁷⁸⁹]/gu;
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

async function pollByRunId(run_id: string, timeoutMs = 600_000) {
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
  const qg = md.quality_gate || {};
  const initialDraft = md.quality_gate_drafter_initial || null;
  const mv = drafter.marker_validation || {};
  const cc = mv.citation_cleanup || {};
  const phase3 = cc.phase3 || {};
  const usedSources = drafter.used_sources || [];
  const answer: string = row?.answer || drafter.answer_markdown || "";
  const tokenLeakCount = (answer.match(/\[\[fn:\d+\]\]/g) || []).length;
  const adjacentSuperRuns = (answer.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]{2,}/gu) || []);
  return {
    fixture_id: fx.id,
    run_id,
    qa_log_id: row?.id ?? null,
    total_ms: md.total_ms,
    final_action: qg.final_action ?? null,
    quality_gate: {
      enabled: qg.enabled,
      triggered: qg.triggered,
      reasons: qg.reasons,
      retry_attempted: qg.retry_attempted,
      retry_passed: qg.retry_passed,
      source_set_equal_on_retry: qg.source_set_equal_on_retry,
      extra_drafter_ms: qg.extra_drafter_ms,
      before: qg.before,
      after: qg.after,
    },
    hard_gates: {
      marker_validation_ok: mv.ok === true,
      internal_id_leak: mv.internal_id_leak === true,
      footnote_eq_used: phase3.applied === true
        ? (drafter.footnote_count ?? 0) === (phase3.occurrence_count ?? 0)
        : (drafter.footnote_count ?? 0) === usedSources.length,
    },
    phase3: {
      applied: phase3.applied === true,
      discarded_reason: phase3.discarded_reason ?? null,
      compound_group_count: phase3.compound_group_count ?? null,
    },
    source_set: {
      count_initial: initialDraft ? initialDraft.unique_source_count : usedSources.length,
      count_shipped: usedSources.length,
    },
    drafter: {
      ok: drafter.ok,
      footnote_count: drafter.footnote_count,
      unique_source_count: drafter.unique_source_count ?? usedSources.length,
    },
    token_leak_count: tokenLeakCount,
    answer_strip_sup_len: stripSup(answer).length,
    adjacent_superscript_runs_in_body: adjacentSuperRuns.length,
    answer_tail: answer.slice(-260),
    initial_answer_tail: initialDraft?.answer_markdown
      ? String(initialDraft.answer_markdown).slice(-260)
      : null,
  };
}

console.log(`[quality-gate] triggering ${FIXTURES.length} fixtures`);
const triggered = await Promise.all(FIXTURES.map(async (fx) => {
  try {
    const t = await trigger(fx.question);
    console.log(`[${fx.id}] run_id=${t.run_id}`);
    return { fx, run_id: t.run_id };
  } catch (e) {
    console.error(`[${fx.id}] trigger error`, e);
    return { fx, run_id: null as any };
  }
}));

const results = await Promise.all(triggered.map(async ({ fx, run_id }) => {
  if (!run_id) return { fixture_id: fx.id, error: "trigger_failed" };
  const row = await pollByRunId(run_id);
  if (!row) return { fixture_id: fx.id, run_id, error: "poll_timeout" };
  const s = summarize(row, fx, run_id);
  await Bun.write(`reports/legal-research-v1-quality-gate-${fx.id}.json`, JSON.stringify(s, null, 2));
  console.log(
    `[${fx.id}] action=${s.final_action} trig=${s.quality_gate.triggered} retry=${s.quality_gate.retry_attempted} pass=${s.quality_gate.retry_passed} reasons=${(s.quality_gate.reasons || []).join(",")} adj=${s.adjacent_superscript_runs_in_body} leak=${s.token_leak_count} p3=${s.phase3.applied} extraMs=${s.quality_gate.extra_drafter_ms}`,
  );
  return s;
}));

const ok = results.filter((r: any) => !r.error);
const triggeredOk = ok.filter((r: any) => r.quality_gate.triggered);
const retried = ok.filter((r: any) => r.quality_gate.retry_attempted);
const retryPassed = ok.filter((r: any) => r.quality_gate.retry_passed);
const controlled = ok.filter((r: any) => r.final_action === "controlled_failure");
const shippedRetry = ok.filter((r: any) => r.final_action === "shipped_retry");
const shippedInitial = ok.filter((r: any) => r.final_action === "shipped_initial");

const summary = {
  phase: "quality-gate-v1",
  ran: ok.length,
  errors: results.length - ok.length,
  triggered_count: triggeredOk.length,
  retry_attempted_count: retried.length,
  retry_passed_count: retryPassed.length,
  controlled_failure_count: controlled.length,
  shipped_initial_count: shippedInitial.length,
  shipped_retry_count: shippedRetry.length,
  hard_gates_all_pass:
    ok.every((r: any) => r.hard_gates.marker_validation_ok) &&
    ok.every((r: any) => r.hard_gates.internal_id_leak === false) &&
    ok.every((r: any) => r.hard_gates.footnote_eq_used),
  total_token_leaks: ok.reduce((a: number, r: any) => a + (r.token_leak_count || 0), 0),
  source_set_equality_on_retry: retried.every((r: any) =>
    r.quality_gate.source_set_equal_on_retry === true ||
    r.quality_gate.source_set_equal_on_retry === null
  ),
  extra_drafter_ms_total_for_triggered: retried.reduce(
    (a: number, r: any) => a + (r.quality_gate.extra_drafter_ms || 0), 0,
  ),
  retry_examples: shippedRetry.map((r: any) => ({
    fixture: r.fixture_id,
    reasons: r.quality_gate.reasons,
    before: {
      max_cluster_len: r.quality_gate.before?.max_cluster_len,
      end_paragraph_dump_count: r.quality_gate.before?.end_paragraph_dump_count,
      cluster_run_count: r.quality_gate.before?.cluster_run_count,
      phantom: (r.quality_gate.before?.phantom_footnote_runs || []).map((p: any) => p.run),
      lang: r.quality_gate.before?.language_artifacts_found,
    },
    after: {
      max_cluster_len: r.quality_gate.after?.max_cluster_len,
      end_paragraph_dump_count: r.quality_gate.after?.end_paragraph_dump_count,
      cluster_run_count: r.quality_gate.after?.cluster_run_count,
      phantom: (r.quality_gate.after?.phantom_footnote_runs || []).map((p: any) => p.run),
      lang: r.quality_gate.after?.language_artifacts_found,
    },
  })),
  controlled_failures: controlled.map((r: any) => ({
    fixture: r.fixture_id,
    reasons: r.quality_gate.reasons,
    source_set_equal: r.quality_gate.source_set_equal_on_retry,
    after: r.quality_gate.after,
  })),
  fixtures: results,
};
await Bun.write("reports/legal-research-v1-quality-gate-summary.json", JSON.stringify(summary, null, 2));
console.log(
  `\n[quality-gate] triggered=${summary.triggered_count}/${ok.length} retried=${summary.retry_attempted_count} passed=${summary.retry_passed_count} controlled=${summary.controlled_failure_count} gates=${summary.hard_gates_all_pass} leaks=${summary.total_token_leaks} srcEq=${summary.source_set_equality_on_retry}`,
);
