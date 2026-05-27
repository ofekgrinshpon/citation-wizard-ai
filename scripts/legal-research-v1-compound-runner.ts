// Phase 3 v3 compound-footnote validation runner.
// T1–T3 + PROT + L1–L6 + RPT1–RPT3.
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
    headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "x-atomic-markers": "validate", "Content-Type": "application/json" },
    body: JSON.stringify({ question, smoke_user_id: SMOKE_USER_ID }),
  });
  return await r.json();
}
async function pollByRunId(run_id: string, timeoutMs = 540_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
    if (r.ok) { const rows = await r.json(); if (Array.isArray(rows) && rows.length) return rows[0]; }
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
  const verifierUsable: string[] = (verifier.usable || []).map((u: any) => u.candidate_id ?? u);
  const usedIds: string[] = usedSources.map((u: any) => u.candidate_id).filter(Boolean);
  const subset = usedIds.every((id) => verifierUsable.includes(id));
  const tokenLeakCount = (answer.match(/\[\[fn:\d+\]\]/g) || []).length;
  const adjacentSuperRuns = (answer.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]{2,}/gu) || []);
  const compoundFns = footnotes.filter((f) => f?.is_compound);
  const compoundFnCount = compoundFns.length;
  const compoundMembers = compoundFns.reduce((a, f) => a + (f.items?.length ?? f.source_numbers?.length ?? 0), 0);
  return {
    fixture_id: fx.id, run_id, qa_log_id: row?.id ?? null, total_ms: md.total_ms,
    hard_gates: {
      marker_validation_ok: mv.ok === true,
      internal_id_leak: mv.internal_id_leak === true,
      used_subset_of_usable: subset,
      footnote_eq_used: phase3.applied === true
        ? (drafter.footnote_count ?? 0) === (phase3.occurrence_count ?? 0)
        : (drafter.footnote_count ?? 0) === usedSources.length,
    },
    phase3: {
      applied: phase3.applied === true,
      discarded_reason: phase3.discarded_reason ?? null,
      occurrence_count: phase3.occurrence_count ?? null,
      unique_source_count: phase3.unique_source_count ?? null,
      short_form_count: phase3.short_form_count ?? null,
      ibid_count: phase3.ibid_count ?? null,
      supra_count: phase3.supra_count ?? null,
      compound_enabled: phase3.compound_enabled ?? null,
      compound_group_count: phase3.compound_group_count ?? null,
      compound_member_count_total: phase3.compound_member_count_total ?? null,
      compound_max_group_size: phase3.compound_max_group_size ?? null,
      every_compound_member_in_usable: phase3.every_compound_member_in_usable ?? null,
      compound_footnote_examples: phase3.compound_footnote_examples ?? null,
    },
    persisted_compound_footnote_count: compoundFnCount,
    persisted_compound_member_total: compoundMembers,
    source_set: { count: usedSources.length, unique_count_in_phase3: phase3.unique_source_count ?? usedSources.length },
    source_set_equal: phase3.applied === true ? (phase3.unique_source_count === usedSources.length) : true,
    drafter: { ok: drafter.ok, footnote_count: drafter.footnote_count, unique_source_count: drafter.unique_source_count ?? usedSources.length },
    token_leak_count: tokenLeakCount,
    answer_strip_sup_len: stripSup(answer).length,
    adjacent_superscript_runs_in_body: adjacentSuperRuns.length,
    answer_tail: answer.slice(-260),
  };
}

console.log(`[compound] triggering ${FIXTURES.length} fixtures`);
const triggered = await Promise.all(FIXTURES.map(async (fx) => {
  try { const t = await trigger(fx.question); console.log(`[${fx.id}] run_id=${t.run_id}`); return { fx, run_id: t.run_id }; }
  catch (e) { console.error(`[${fx.id}] trigger error`, e); return { fx, run_id: null }; }
}));
const results = await Promise.all(triggered.map(async ({ fx, run_id }) => {
  if (!run_id) return { fixture_id: fx.id, error: "trigger_failed" };
  const row = await pollByRunId(run_id);
  if (!row) return { fixture_id: fx.id, run_id, error: "poll_timeout" };
  const s = summarize(row, fx, run_id);
  await Bun.write(`reports/legal-research-v1-compound-${fx.id}.json`, JSON.stringify(s, null, 2));
  console.log(`[${fx.id}] mv=${s.hard_gates.marker_validation_ok} p3=${s.phase3.applied} reason=${s.phase3.discarded_reason ?? "-"} cg=${s.phase3.compound_group_count ?? "-"} cm=${s.phase3.compound_member_count_total ?? "-"} maxg=${s.phase3.compound_max_group_size ?? "-"} occ=${s.phase3.occurrence_count ?? "-"} uniq=${s.phase3.unique_source_count ?? "-"} ibid=${s.phase3.ibid_count ?? 0} supra=${s.phase3.supra_count ?? 0} adj=${s.adjacent_superscript_runs_in_body} leak=${s.token_leak_count}`);
  return s;
}));

const ok = results.filter((r: any) => !r.error);
const applied = ok.filter((r: any) => r.phase3?.applied);
const summary = {
  phase: "phase3-v3-compound",
  ran: ok.length, errors: results.length - ok.length,
  hard_gates_all_pass:
    ok.every((r: any) => r.hard_gates.marker_validation_ok) &&
    ok.every((r: any) => r.hard_gates.internal_id_leak === false) &&
    ok.every((r: any) => r.hard_gates.used_subset_of_usable) &&
    ok.every((r: any) => r.hard_gates.footnote_eq_used),
  phase3_applied_count: applied.length,
  phase3_applied_fixtures: applied.map((r: any) => r.fixture_id),
  compound_groups_across_applied: applied.reduce((a: number, r: any) => a + (r.phase3.compound_group_count ?? 0), 0),
  compound_members_across_applied: applied.reduce((a: number, r: any) => a + (r.phase3.compound_member_count_total ?? 0), 0),
  every_compound_member_in_usable_all: applied.every((r: any) => r.phase3.every_compound_member_in_usable !== false),
  source_set_equality_all: ok.every((r: any) => r.source_set_equal),
  total_token_leaks: ok.reduce((a: number, r: any) => a + (r.token_leak_count || 0), 0),
  applied_with_adjacent_body_markers: applied.filter((r: any) => r.adjacent_superscript_runs_in_body > 0).map((r: any) => r.fixture_id),
  skip_reasons: ok.reduce((m: any, r: any) => { const k = r.phase3.discarded_reason ?? (r.phase3.applied ? "applied" : "unknown"); m[k] = (m[k] ?? 0) + 1; return m; }, {}),
  fixtures: results,
};
await Bun.write("reports/legal-research-v1-compound-summary.json", JSON.stringify(summary, null, 2));
console.log("\n[compound] gates=", summary.hard_gates_all_pass, "applied=", summary.phase3_applied_count, "/", ok.length, "compoundGroups=", summary.compound_groups_across_applied, "compoundMembers=", summary.compound_members_across_applied, "memberUsable=", summary.every_compound_member_in_usable_all, "srcEq=", summary.source_set_equality_all, "leaks=", summary.total_token_leaks, "reasons=", summary.skip_reasons);
