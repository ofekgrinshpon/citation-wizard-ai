// V2.1e validation — re-run the same 15 questions used for V2.1d.
// Telemetry-only patch: extended Hebrew/legal-prose warning buckets +
// drafter prompt hygiene additions. Validates citation cleanliness,
// footnote completeness, source usage, latency, and quality_warning hits.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

type Fx = { id: string; question: string };

// Same 15 questions as the V2.1d validation set (reports/legal-research-v1-v2.1d-validation.md).
const FIXTURES: Fx[] = [
  { id: "Q1", question: "כיצד זהות לאומית יכולה להיות אובייקט לקודיפיקציה? מבט השוואתי על קודיפיקציה של זהות במדינות דמוקרטיות" },
  { id: "Q2", question: "מה התנאים להחלת תקנת השוק במיטלטלין?" },
  { id: "Q3", question: "מה ההבדל בין רשלנות לבין הפרת חובה חקוקה?" },
  { id: "Q4", question: "מהם התנאים לאכיפת הבטחה מנהלית?" },
  { id: "Q5", question: "כיצד יש לפרש חוזה לאחר תיקון מס׳ 3 לחוק החוזים?" },
  { id: "Q6", question: "האם כישלון מערכתי באכיפת פרוטקשן יכול להקים טענה למחדל של המדינה?" },
  { id: "Q7", question: "מהם התנאים לצו מניעה זמני?" },
  { id: "Q8", question: "מה מעמד חופש הביטוי מול פגיעה בשם טוב?" },
  { id: "Q9", question: "מה ההבדל בין תביעה נגזרת לתביעה ייצוגית בהפרת חובת אמונים?" },
  { id: "Q10", question: "כיצד בתי משפט מאזנים בין ביטחון המדינה לזכויות יסוד?" },
  { id: "Q11", question: "מהן מגבלות השימוש במידע ביומטרי במגזר הציבורי?" },
  { id: "Q12", question: "כיצד מתמודדים עם אכיפה בררנית במשפט המנהלי?" },
  { id: "Q13", question: "מהי משמעות עקרון תום הלב בסעיף 39 לחוק החוזים?" },
  { id: "Q14", question: "מהם השיקולים בביקורת שיפוטית על החלטות רשויות אכיפה?" },
  { id: "Q15", question: "כיצד ניתן להוכיח קשר סיבתי במקרים של עמימות סיבתית?" },
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

const CONCURRENCY = 5;
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
  if (i + CONCURRENCY < FIXTURES.length) await new Promise(r => setTimeout(r, 3000));
}

const rows = await Promise.all(triggered.map(async ({ fx, run_id }) => {
  if (!run_id) return { fixture_id: fx.id, question: fx.question, error: "trigger_failed" };
  const row = await pollByRunId(run_id);
  if (!row) return { fixture_id: fx.id, question: fx.question, run_id, error: "poll_timeout" };
  const md: any = row.metadata ?? {};
  const d: any = md.drafter ?? {};
  const qw: any = d.quality_warning ?? null;
  const buckets: Record<string, number> = {};
  for (const h of (qw?.hits ?? [])) buckets[h.bucket] = (buckets[h.bucket] ?? 0) + 1;
  const answer: string = row.answer ?? "";
  const fns: any[] = row.footnotes ?? [];
  const fn_with_sources = fns.filter((f) => Array.isArray(f.sources) ? f.sources.length > 0 : !!f.url).length;
  return {
    fixture_id: fx.id,
    question: fx.question,
    run_id,
    ms: d.ms ?? null,
    sources_used: d.sources_used ?? 0,
    escalated: d.escalated === true,
    drafter_version: d.drafter_version ?? null,
    footnote_count: fns.length,
    footnotes_with_sources: fn_with_sources,
    adjacent_runs_in_answer: adjRuns(answer),
    builder_adj: d.builder_report?.adjacent_marker_count ?? null,
    quality_warning_buckets: buckets,
    quality_warning_hits: qw?.hits ?? [],
    prose_length: answer.length,
    answer_preview: answer.slice(0, 400),
  };
}));

const ok = rows.filter((r: any) => !r.error);
const sumBucket = (name: string) =>
  ok.reduce((acc: number, r: any) => acc + (r.quality_warning_buckets?.[name] ?? 0), 0);
const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

const summary = {
  phase: "v2.1e-validation",
  fixtures_total: FIXTURES.length,
  fixtures_completed: ok.length,
  errors: rows.length - ok.length,
  warnings: {
    broken_hebrew: sumBucket("broken_hebrew"),
    truncated_source_fragment: sumBucket("truncated_source_fragment"),
    scaffold_leakage: sumBucket("scaffold_leakage"),
    wrong_official_name: sumBucket("wrong_official_name"),
    foreign_word_in_hebrew: sumBucket("foreign_word_in_hebrew"),
    wrong_party_label_civil: sumBucket("wrong_party_label_civil"),
  },
  citation_cleanliness: {
    answers_with_adjacent_runs: ok.filter((r: any) => (r.adjacent_runs_in_answer ?? 0) > 0).length,
    builder_adj_total: ok.reduce((a: number, r: any) => a + (r.builder_adj ?? 0), 0),
  },
  source_completeness: {
    runs_total: ok.length,
    runs_with_all_footnotes_having_sources: ok.filter((r: any) => r.footnote_count > 0 && r.footnotes_with_sources === r.footnote_count).length,
    runs_with_zero_footnotes: ok.filter((r: any) => r.footnote_count === 0).length,
  },
  latency: {
    avg_ms: avg(ok.map((r: any) => r.ms ?? 0)),
    max_ms: Math.max(0, ...ok.map((r: any) => r.ms ?? 0)),
    min_ms: ok.length ? Math.min(...ok.map((r: any) => r.ms ?? 0)) : 0,
  },
  avg_sources_used: avg(ok.map((r: any) => r.sources_used ?? 0)),
  fixtures: rows,
};

await Bun.write(
  "reports/legal-research-v1-v2.1e-validation.json",
  JSON.stringify(summary, null, 2),
);
console.log("\n[v2.1e] warnings:", summary.warnings);
console.log("[v2.1e] citation:", summary.citation_cleanliness);
console.log("[v2.1e] source:", summary.source_completeness);
console.log("[v2.1e] latency:", summary.latency);
console.log("[v2.1e] avg_sources_used:", summary.avg_sources_used);
