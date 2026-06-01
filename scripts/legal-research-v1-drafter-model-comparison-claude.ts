// Drafter 4-way model comparison: gpt-5-mini (A) vs gpt-5 (B) vs
// Claude Sonnet (C) vs Claude Opus (D). All four are run against the
// SAME source pack per question (same retrieval/verifier/claims).
//
// Triggers the edge function once per question with header
// `x-drafter-v2-compare-models: full+claude`; the edge function runs
// drafterV2 four times and stashes results in metadata. This script polls
// qa_logs by run_id and aggregates.
//
// No production default change.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

type Fx = { id: string; question: string };

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
      "x-drafter-v2-compare-models": "full+claude",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, smoke_user_id: SMOKE_USER_ID }),
  });
  return await r.json();
}

async function pollByRunId(run_id: string, timeoutMs = 1_500_000) {
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
    await new Promise((res) => setTimeout(res, 6000));
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
function supCount(s: string) { return (s.match(SUP_RUN_RE) ?? []).length; }

const PROBES = [
  "alcance", "scope", "due process",
  "המשרוק", "מום פרשני", "שגיאות מוסיקליות", "סיכי דה",
  "שווה לנקוט", "משקל תקף נמוך יותר",
  "כיבוד האדם והחירות",
  "סמלייים", "סמליומית", "הבטחה מנהירת",
  "זיכוי", "נאשם", "הנאשם",
];

function probeHits(answer: string) {
  const hits: Record<string, number> = {};
  for (const p of PROBES) {
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    const n = (answer.match(re) ?? []).length;
    if (n > 0) hits[p] = n;
  }
  return hits;
}

function latinArtifacts(answer: string): string[] {
  const lines = answer.split("\n");
  const out = new Set<string>();
  for (const line of lines) {
    if (line.startsWith("[^")) continue;
    if (/https?:\/\//.test(line)) continue;
    const m = line.match(/[A-Za-z]{2,}/g);
    if (m) for (const t of m) out.add(t);
  }
  return [...out];
}

function bucketsOf(qw: any): Record<string, number> {
  const o: Record<string, number> = {};
  for (const h of (qw?.hits ?? [])) o[h.bucket] = (o[h.bucket] ?? 0) + 1;
  return o;
}

// Crude framing-preservation: does the first 200 chars contain at least one
// of the question's content words (length>=4 Hebrew tokens)?
function framingPreserved(question: string, answer: string): boolean {
  const head = answer.slice(0, 300);
  const words = (question.match(/[\u05D0-\u05EA]{4,}/g) ?? []).slice(0, 6);
  if (!words.length) return true;
  return words.some((w) => head.includes(w));
}

function summarize(label: string, m: any, fx: Fx) {
  if (!m) return { label, error: "missing" };
  const ans: string = m.answer_markdown ?? "";
  const fn: any[] = m.footnotes ?? [];
  const struct = m.structured_validation ?? {};
  return {
    label,
    model: m.model_final ?? m.model_initial,
    provider: m.provider,
    ok: m.ok === true,
    ms: m.ms ?? null,
    sources_passed: m.sources_passed ?? null,
    sources_used: m.sources_used ?? (m.used_sources?.length ?? 0),
    answer_length: ans.length,
    footnote_count: fn.length,
    superscript_count: supCount(ans),
    adjacent_marker_runs: adjRuns(ans),
    schema_ok: struct.ok === true,
    unknown_source_refs: struct.unknown_source_refs?.length ?? 0,
    forbidden_text_hits: struct.forbidden_text_hits?.length ?? 0,
    adjacent_marker_count_builder: m.builder_report?.adjacent_marker_count ?? null,
    quality_warning_buckets: bucketsOf(m.quality_warning),
    probe_hits: probeHits(ans),
    latin_tokens: latinArtifacts(ans),
    framing_preserved: framingPreserved(fx.question, ans),
    schema_failure_reason: m.schema_failure_reason ?? null,
    usage: m.usage ?? null,
    error: m.error ?? null,
    answer_excerpt_head: ans.slice(0, 600),
    answer_excerpt_tail: ans.slice(-400),
  };
}

const CONCURRENCY = 2;
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
  if (i + CONCURRENCY < FIXTURES.length) await new Promise(r => setTimeout(r, 8000));
}

const rows = await Promise.all(triggered.map(async ({ fx, run_id }) => {
  if (!run_id) return { fixture_id: fx.id, question: fx.question, error: "trigger_failed" };
  const row = await pollByRunId(run_id);
  if (!row) return { fixture_id: fx.id, question: fx.question, run_id, error: "poll_timeout" };
  const md: any = row.metadata ?? {};
  const A: any = md.drafter ?? {};
  // A is a slightly different shape (lifted in index.ts); normalize to the same fields:
  const Anorm = {
    answer_markdown: row.answer ?? "",
    footnotes: row.footnotes ?? [],
    model_final: A.model_final,
    model_initial: A.model_initial,
    ok: A.ok,
    ms: A.ms,
    provider: "openai",
    sources_passed: A.sources_passed,
    sources_used: A.unique_source_count ?? A.sources_used ?? 0,
    structured_validation: A.structured_validation,
    builder_report: A.builder_report,
    quality_warning: A.quality_warning,
    schema_failure_reason: A.schema_failure_reason,
    usage: A.usage,
    error: A.error,
  };
  const B = md.drafter_v2_full_compare ?? null;
  const C = md.drafter_v2_sonnet_compare ?? null;
  const D = md.drafter_v2_opus_compare ?? null;

  return {
    fixture_id: fx.id,
    question: fx.question,
    run_id,
    verifier_usable: (md.verifier?.usable ?? []).length,
    A: summarize("A_gpt5_mini", Anorm, fx),
    B: B ? summarize("B_gpt5", B, fx) : { label: "B_gpt5", error: "missing" },
    C: C ? summarize("C_claude_sonnet", C, fx) : { label: "C_claude_sonnet", error: "missing" },
    D: D ? summarize("D_claude_opus", D, fx) : { label: "D_claude_opus", error: "missing" },
  };
}));

await Bun.write(
  "reports/legal-research-v1-drafter-claude-comparison.json",
  JSON.stringify({ generated_at: new Date().toISOString(), fixtures: rows }, null, 2),
);

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => xs.length ? sum(xs) / xs.length : 0;

function agg(rows: any[], key: "A"|"B"|"C"|"D") {
  const ok = rows.filter((r) => r[key] && !r[key].error && r[key].ok);
  return {
    completed: ok.length,
    total: rows.length,
    schema_ok_rate: ok.filter((r) => r[key].schema_ok).length / Math.max(ok.length, 1),
    avg_ms: avg(ok.map((r) => r[key].ms ?? 0)),
    avg_len: avg(ok.map((r) => r[key].answer_length ?? 0)),
    unknown_refs_total: sum(ok.map((r) => r[key].unknown_source_refs ?? 0)),
    forbidden_text_total: sum(ok.map((r) => r[key].forbidden_text_hits ?? 0)),
    adj_marker_runs_total: sum(ok.map((r) => r[key].adjacent_marker_runs ?? 0)),
    probe_hits_total: sum(ok.map((r) => Object.values(r[key].probe_hits as Record<string, number>).reduce((a: number, b: any) => a + b, 0))),
    latin_total: sum(ok.map((r) => r[key].latin_tokens.length)),
    warning_hits_total: sum(ok.map((r) => Object.values(r[key].quality_warning_buckets as Record<string, number>).reduce((a: number, b: any) => a + b, 0))),
    framing_preserved_count: ok.filter((r) => r[key].framing_preserved).length,
    avg_input_tokens: avg(ok.map((r) => r[key].usage?.input_tokens ?? 0).filter(Boolean)),
    avg_output_tokens: avg(ok.map((r) => r[key].usage?.output_tokens ?? 0).filter(Boolean)),
  };
}

const agA = agg(rows, "A");
const agB = agg(rows, "B");
const agC = agg(rows, "C");
const agD = agg(rows, "D");

console.log("\n=== 4-WAY DRAFTER COMPARISON ===");
console.log(JSON.stringify({ A: agA, B: agB, C: agC, D: agD }, null, 2));
console.log("\n[done] reports/legal-research-v1-drafter-claude-comparison.json");
