// Drafter model A/B — gpt-5-mini (current) vs gpt-5 (strong) — against the
// SAME source pack. Triggers the edge function once per question with
// `x-drafter-v2-compare-models: full`, which runs drafterV2 twice on the
// identical input pack (same retrieval, verifier, claims). The B answer
// is stashed in metadata.drafter_v2_full_compare.
//
// No production default changes; this is a harness/telemetry path only.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

type Fx = { id: string; question: string };

// Same 15-question set as v2.1d / v2.1e validation.
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
      "x-drafter-v2-compare-models": "full",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, smoke_user_id: SMOKE_USER_ID }),
  });
  return await r.json();
}

async function pollByRunId(run_id: string, timeoutMs = 900_000) {
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
function supCount(s: string) {
  return (s.match(SUP_RUN_RE) ?? []).length;
}

// Manual-review probe phrases the user flagged as residual defects.
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

// Detect Latin tokens inside Hebrew prose (excluding URLs / refs in footnotes
// — answer body usually doesn't contain URLs, but be defensive).
function latinArtifacts(answer: string): string[] {
  const lines = answer.split("\n");
  const out = new Set<string>();
  for (const line of lines) {
    if (line.startsWith("[^")) continue; // footnote line
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

const CONCURRENCY = 3;
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
  if (i + CONCURRENCY < FIXTURES.length) await new Promise(r => setTimeout(r, 5000));
}

const rows = await Promise.all(triggered.map(async ({ fx, run_id }) => {
  if (!run_id) return { fixture_id: fx.id, question: fx.question, error: "trigger_failed" };
  const row = await pollByRunId(run_id);
  if (!row) return { fixture_id: fx.id, question: fx.question, run_id, error: "poll_timeout" };
  const md: any = row.metadata ?? {};
  const A: any = md.drafter ?? {};
  const B: any = md.drafter_v2_full_compare ?? null;

  const aAnswer: string = row.answer ?? "";
  const bAnswer: string = B?.answer_markdown ?? "";
  const aFn: any[] = row.footnotes ?? [];
  const bFn: any[] = B?.footnotes ?? [];

  return {
    fixture_id: fx.id,
    question: fx.question,
    run_id,
    verifier_usable: (md.verifier?.usable ?? []).length,
    A: {
      model: A.model_final ?? "openai/gpt-5-mini",
      ok: A.ok === true,
      ms: A.ms ?? null,
      sources_passed: A.sources_passed ?? null,
      sources_used: A.unique_source_count ?? A.sources_used ?? 0,
      answer_length: aAnswer.length,
      footnote_count: aFn.length,
      superscript_count: supCount(aAnswer),
      adjacent_marker_runs: adjRuns(aAnswer),
      quality_warning_buckets: bucketsOf(A.quality_warning),
      probe_hits: probeHits(aAnswer),
      latin_tokens: latinArtifacts(aAnswer),
      answer_excerpt_head: aAnswer.slice(0, 600),
      answer_excerpt_tail: aAnswer.slice(-400),
    },
    B: B ? {
      model: B.model_final ?? "openai/gpt-5",
      ok: B.ok === true,
      ms: B.ms ?? null,
      sources_passed: B.sources_passed ?? null,
      sources_used: B.used_sources?.length ?? 0,
      answer_length: bAnswer.length,
      footnote_count: bFn.length,
      superscript_count: supCount(bAnswer),
      adjacent_marker_runs: adjRuns(bAnswer),
      quality_warning_buckets: bucketsOf(B.quality_warning),
      probe_hits: probeHits(bAnswer),
      latin_tokens: latinArtifacts(bAnswer),
      schema_failure_reason: B.schema_failure_reason ?? null,
      error: B.error ?? null,
      answer_excerpt_head: bAnswer.slice(0, 600),
      answer_excerpt_tail: bAnswer.slice(-400),
    } : { error: "compare_run_missing" },
  };
}));

await Bun.write(
  "reports/legal-research-v1-drafter-model-comparison.json",
  JSON.stringify({ generated_at: new Date().toISOString(), fixtures: rows }, null, 2),
);

// Console aggregate.
const ok = rows.filter((r: any) => r.A && r.B && !r.error && !(r.B as any).error);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => xs.length ? sum(xs) / xs.length : 0;

const aMs = ok.map((r: any) => r.A.ms ?? 0);
const bMs = ok.map((r: any) => r.B.ms ?? 0);
const aLen = ok.map((r: any) => r.A.answer_length);
const bLen = ok.map((r: any) => r.B.answer_length);
const aProbes = sum(ok.map((r: any) => Object.values(r.A.probe_hits as Record<string, number>).reduce((a: number, b: any) => a + b, 0)));
const bProbes = sum(ok.map((r: any) => Object.values(r.B.probe_hits as Record<string, number>).reduce((a: number, b: any) => a + b, 0)));
const aLatin = sum(ok.map((r: any) => r.A.latin_tokens.length));
const bLatin = sum(ok.map((r: any) => r.B.latin_tokens.length));
const aBuckets = sum(ok.map((r: any) => Object.values(r.A.quality_warning_buckets as Record<string, number>).reduce((a: number, b: any) => a + b, 0)));
const bBuckets = sum(ok.map((r: any) => Object.values(r.B.quality_warning_buckets as Record<string, number>).reduce((a: number, b: any) => a + b, 0)));

console.log("\n=== DRAFTER MODEL COMPARISON SUMMARY ===");
console.log(`fixtures total=${FIXTURES.length} completed=${ok.length}`);
console.log(`A (gpt-5-mini) avg_ms=${avg(aMs).toFixed(0)}  avg_len=${avg(aLen).toFixed(0)}  probe_hits=${aProbes}  latin=${aLatin}  warning_hits=${aBuckets}`);
console.log(`B (gpt-5)      avg_ms=${avg(bMs).toFixed(0)}  avg_len=${avg(bLen).toFixed(0)}  probe_hits=${bProbes}  latin=${bLatin}  warning_hits=${bBuckets}`);
console.log(`latency_delta_ms=${(avg(bMs) - avg(aMs)).toFixed(0)}  length_delta=${(avg(bLen) - avg(aLen)).toFixed(0)}`);

console.log("\n[done] reports/legal-research-v1-drafter-model-comparison.json");
