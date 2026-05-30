// V2.1c default-switch validation.
// Triggers the live legal-research-v1 edge function (no special header), so
// the response reflects the production drafter path. Asserts invariants on
// metadata.drafter (now sourced from V2.1c via the adapter).
//
// Fixtures: L1-L6 + PROT + 5 real qa_logs questions.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const STUB_ANSWER =
  "[stub] התשובה תיווצר בשלב P5. כרגע הצינור מבצע רק ניתוח טענות ותכנון שאילתות מחקר.";

type Fx = { id: string; question: string };
const FIXTURES: Fx[] = [
  { id: "L1", question: "מהי הלכת רים נסראלדין בעניין דיני עבודה?" },
  { id: "L2", question: "מהי דוקטרינת הביצוע בקירוב בדיני חוזים?" },
  { id: "L3", question: "מהם תנאי תקנת השוק לפי חוק המכר?" },
  { id: "L4", question: "מהי חזקת השיתוף בנכסים בין בני זוג?" },
  { id: "L5", question: "מהי עילת אי הסבירות במשפט המינהלי הישראלי?" },
  { id: "L6", question: "מהם יסודות עוולת הרשלנות בדיני הנזיקין הישראליים?" },
  {
    id: "PROT",
    question:
      "האם כישלון מערכתי באכיפת עבירת גביית דמי חסות (פרוטקשן) יכול להוות מחדל חקיקתי בהגנה על הזכות לחיים וביטחון?",
  },
  { id: "R03", question: "מהי פסקת ההגבלה בחוק יסוד: כבוד האדם וחירותו ומה הם ארבעת תנאיה?" },
  { id: "R04", question: "מהו היחס בין עוולת הרשלנות לעוולת הפרת חובה חקוקה כאשר אותו מעשה נטען כעולה כדי שתי העוולות?" },
  { id: "R09", question: "נניח שרשות מקומית נתנה ליזם התחייבות כתובה לקדם תב\"ע מסוימת ואף אפשרה לו להשקיע כספים בהסתמך על אותה התחייבות, אך לאחר חילופי הנהלה הרשות חזרה בה בטענה שההתחייבות ניתנה בחוסר סמכות ושקיים אינטרס ציבורי לשנות את המדיניות. מהם התנאים לאכיפת הבטחה מנהלית במקרה כזה, ומה משקלם של הסתמכות, סמכות, ושינוי נסיבות?" },
  { id: "R10", question: "מהי דוקטרינת תום הלב בקיום חוזה לפי סעיף 39 לחוק החוזים?" },
  { id: "R18", question: "מהם יסודות עוולת התרמית בדיני הנזיקין?" },
];

async function trigger(question: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
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

const SUP_RUN_RE = /[\u2070-\u209F\u00B2\u00B3\u00B9]+/gu;
function adjRuns(s: string): number {
  let prevEnd = -1, count = 0;
  for (const m of s.matchAll(SUP_RUN_RE)) {
    const start = m.index ?? 0;
    if (prevEnd >= 0 && /^\s*$/.test(s.slice(prevEnd, start))) count++;
    prevEnd = start + m[0].length;
  }
  return count;
}

const CONCURRENCY = 6;
const triggered: Array<{ fx: Fx; run_id: string | null }> = [];
for (let i = 0; i < FIXTURES.length; i += CONCURRENCY) {
  const batch = FIXTURES.slice(i, i + CONCURRENCY);
  const out = await Promise.all(batch.map(async (fx) => {
    try {
      const t = await trigger(fx.question);
      console.log(`[${fx.id}] run_id=${t.run_id}`);
      return { fx, run_id: t.run_id ?? null };
    } catch (e) {
      console.error(`[${fx.id}] trigger error`, e);
      return { fx, run_id: null };
    }
  }));
  triggered.push(...out);
  if (i + CONCURRENCY < FIXTURES.length) await new Promise(r => setTimeout(r, 2000));
}

const rows = await Promise.all(triggered.map(async ({ fx, run_id }) => {
  if (!run_id) return { fixture_id: fx.id, error: "trigger_failed" };
  const row = await pollByRunId(run_id);
  if (!row) return { fixture_id: fx.id, run_id, error: "poll_timeout" };
  const md = row.metadata ?? {};
  const d = md.drafter ?? {};
  const verifier = md.verifier ?? {};
  const usableIds = new Set<string>((verifier.usable ?? []).map((u: any) => u.candidate_id ?? u));
  const used: any[] = d.used_sources ?? [];
  const usedIds = used.map((u: any) => u.candidate_id).filter(Boolean);
  const answer: string = row.answer ?? "";
  const sv = d.structured_validation ?? {};
  const br = d.builder_report ?? {};
  return {
    fixture_id: fx.id, run_id, total_ms: md.total_ms ?? null,
    drafter_version: d.drafter_version ?? null,
    ok: d.ok === true,
    escalated: d.escalated === true,
    ms: d.ms ?? null,
    is_stub: answer === STUB_ANSWER,
    verifier_usable_count: usableIds.size,
    used_count: used.length,
    footnote_count: (row.footnotes ?? []).length,
    used_subset_of_usable: usedIds.every((id: string) => usableIds.has(id)),
    schema_failure_reason: d.schema_failure_reason ?? null,
    unknown_source_refs: sv.unknown_source_refs ?? [],
    forbidden_text_hits: sv.forbidden_text_hits ?? [],
    builder_adjacent_marker_count: br.adjacent_marker_count ?? null,
    adjacent_runs_in_answer: adjRuns(answer),
    prose_length: answer.length,
    cited_segment_count: sv.cited_segment_count ?? null,
    compound_footnote_count: br.compound_footnote_count ?? null,
    avg_sources_per_cited_segment: br.avg_sources_per_cited_segment ?? null,
  };
}));

const ok = rows.filter((r: any) => !r.error);
const allOk = ok.every((r: any) => r.ok);
const noStub = ok.every((r: any) => !r.is_stub);
const noUnknown = ok.every((r: any) => (r.unknown_source_refs ?? []).length === 0);
const noForbidden = ok.every((r: any) => (r.forbidden_text_hits ?? []).length === 0);
const allSubset = ok.every((r: any) => r.used_subset_of_usable === true);
const noAdjBuilder = ok.every((r: any) => (r.builder_adjacent_marker_count ?? 0) === 0);
const noAdjAnswer = ok.every((r: any) => (r.adjacent_runs_in_answer ?? 0) === 0);
const allV2 = ok.every((r: any) => r.drafter_version === "v2.1c");
const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

const summary = {
  phase: "v2.1c-default-switch",
  fixtures_total: FIXTURES.length,
  fixtures_completed: ok.length,
  errors: rows.length - ok.length,
  invariants: {
    all_ok: allOk,
    no_stub_answers: noStub,
    all_drafter_version_v2_1c: allV2,
    no_unknown_source_refs: noUnknown,
    no_forbidden_text_hits: noForbidden,
    all_used_subset_of_usable: allSubset,
    builder_adjacent_marker_zero: noAdjBuilder,
    answer_adjacent_runs_zero: noAdjAnswer,
  },
  metrics: {
    avg_ms: avg(ok.map((r: any) => r.ms ?? 0)),
    avg_total_ms: avg(ok.map((r: any) => r.total_ms ?? 0)),
    avg_prose_length: avg(ok.map((r: any) => r.prose_length ?? 0)),
    avg_used_sources: avg(ok.map((r: any) => r.used_count ?? 0)),
    avg_sources_per_cited_segment: avg(ok.map((r: any) => r.avg_sources_per_cited_segment ?? 0)),
  },
  fixtures: rows,
};

await Bun.write(
  "reports/legal-research-v1-v2.1c-default-validation.json",
  JSON.stringify(summary, null, 2),
);
console.log("\n[validation] invariants:", summary.invariants);
console.log("[validation] metrics:", summary.metrics);
