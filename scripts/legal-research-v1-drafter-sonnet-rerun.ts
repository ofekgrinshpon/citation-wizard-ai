// Sonnet-only rerun harness. Same 11 fixtures as the 4-way Claude comparison.
// Triggers each fixture sequentially (concurrency=1), uses header
// `x-drafter-v2-compare-models: sonnet` so the edge function runs only the
// Sonnet pass against the same source pack as the served answer.
//
// Anthropic transient errors (429/5xx/overloaded/network) are retried inside
// lib/anthropic.ts. Schema-level failures of a *completed* model call are not
// retried — but here, on top of the in-call retry, we also retry the whole
// fixture once if Sonnet failed with no_tool_call AND the http_status was
// transient (defensive belt-and-braces for the rerun).
//
// Writes:
//   reports/legal-research-v1-drafter-sonnet-rerun.json
//   reports/legal-research-v1-drafter-sonnet-rerun.md

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

type Fx = { id: string; question: string; prior_sonnet: "completed" | "failed" };

// Same 11 fixtures as the previous Claude comparison. Q12-Q15 were not in
// the prior 11-row report. Prior results filled from the 4-way report.
const FIXTURES: Fx[] = [
  { id: "Q1",  question: "כיצד זהות לאומית יכולה להיות אובייקט לקודיפיקציה? מבט השוואתי על קודיפיקציה של זהות במדינות דמוקרטיות", prior_sonnet: "failed" },
  { id: "Q2",  question: "מה התנאים להחלת תקנת השוק במיטלטלין?", prior_sonnet: "completed" },
  { id: "Q3",  question: "מה ההבדל בין רשלנות לבין הפרת חובה חקוקה?", prior_sonnet: "completed" },
  { id: "Q4",  question: "מהם התנאים לאכיפת הבטחה מנהלית?", prior_sonnet: "failed" },
  { id: "Q5",  question: "כיצד יש לפרש חוזה לאחר תיקון מס׳ 3 לחוק החוזים?", prior_sonnet: "completed" },
  { id: "Q6",  question: "האם כישלון מערכתי באכיפת פרוטקשן יכול להקים טענה למחדל של המדינה?", prior_sonnet: "failed" },
  { id: "Q7",  question: "מהם התנאים לצו מניעה זמני?", prior_sonnet: "completed" },
  { id: "Q8",  question: "מה מעמד חופש הביטוי מול פגיעה בשם טוב?", prior_sonnet: "failed" },
  { id: "Q9",  question: "מה ההבדל בין תביעה נגזרת לתביעה ייצוגית בהפרת חובת אמונים?", prior_sonnet: "completed" },
  { id: "Q10", question: "כיצד בתי משפט מאזנים בין ביטחון המדינה לזכויות יסוד?", prior_sonnet: "failed" },
  { id: "Q11", question: "מהן מגבלות השימוש במידע ביומטרי במגזר הציבורי?", prior_sonnet: "completed" },
];

async function trigger(question: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "x-drafter-v2-compare-models": "sonnet",
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

const HEB_ARTIFACTS = [
  "המשרוק", "מום פרשני", "שגיאות מוסיקליות", "סיכי דה",
  "שווה לנקוט", "משקל תקף נמוך יותר",
  "סמלייים", "סמליומית", "הבטחה מנהירת",
];
const CIVIL_CRIMINAL_MIX = ["זיכוי", "נאשם", "הנאשם", "כתב אישום"];

function probeHits(answer: string, probes: string[]) {
  const hits: Record<string, number> = {};
  for (const p of probes) {
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    const n = (answer.match(re) ?? []).length;
    if (n > 0) hits[p] = n;
  }
  return hits;
}

function latinTokens(answer: string): string[] {
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

// Anthropic Sonnet 4.5 pricing (per million tokens), as of 2025:
//   input  $3.00 / 1M
//   output $15.00 / 1M
function costUSD(inTok: number, outTok: number): number {
  return (inTok / 1_000_000) * 3 + (outTok / 1_000_000) * 15;
}

interface SonnetRow {
  fixture_id: string;
  question: string;
  prior_sonnet: string;
  run_id: string | null;
  new_status: "completed" | "failed";
  http_status: number | null;
  http_error: string | null;
  schema_failure_reason: string | null;
  schema_ok: boolean;
  unknown_source_refs: number;
  forbidden_text_hits: number;
  adjacent_marker_runs: number;
  superscript_count: number;
  latin_tokens: string[];
  hebrew_artifact_hits: Record<string, number>;
  civil_criminal_hits: Record<string, number>;
  answer_length: number;
  footnote_count: number;
  used_sources: number;
  sources_passed: number;
  ms: number | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  retry_attempts: number | null;
  answer_head: string;
  answer_tail: string;
}

function summarize(fx: Fx, run_id: string | null, sonnet: any, verifier_usable: number): SonnetRow {
  if (!sonnet) {
    return {
      fixture_id: fx.id, question: fx.question, prior_sonnet: fx.prior_sonnet, run_id,
      new_status: "failed", http_status: null, http_error: "missing", schema_failure_reason: null,
      schema_ok: false, unknown_source_refs: 0, forbidden_text_hits: 0,
      adjacent_marker_runs: 0, superscript_count: 0, latin_tokens: [],
      hebrew_artifact_hits: {}, civil_criminal_hits: {},
      answer_length: 0, footnote_count: 0, used_sources: 0, sources_passed: verifier_usable,
      ms: null, input_tokens: 0, output_tokens: 0, cost_usd: 0, retry_attempts: null,
      answer_head: "", answer_tail: "",
    };
  }
  const ans: string = sonnet.answer_markdown ?? "";
  const fn: any[] = sonnet.footnotes ?? [];
  const struct = sonnet.structured_validation ?? {};
  const initialRun = (sonnet.stage_runs ?? []).find((s: any) => s.stage === "drafter_v2.initial");
  const inTok = sonnet.usage?.input_tokens ?? 0;
  const outTok = sonnet.usage?.output_tokens ?? 0;
  const completed = !!sonnet.ok;
  return {
    fixture_id: fx.id, question: fx.question, prior_sonnet: fx.prior_sonnet, run_id,
    new_status: completed ? "completed" : "failed",
    http_status: initialRun?.http_status ?? null,
    http_error: initialRun?.http_error ?? null,
    schema_failure_reason: sonnet.schema_failure_reason ?? null,
    schema_ok: struct.ok === true,
    unknown_source_refs: struct.unknown_source_refs?.length ?? 0,
    forbidden_text_hits: struct.forbidden_text_hits?.length ?? 0,
    adjacent_marker_runs: adjRuns(ans),
    superscript_count: supCount(ans),
    latin_tokens: latinTokens(ans),
    hebrew_artifact_hits: probeHits(ans, HEB_ARTIFACTS),
    civil_criminal_hits: probeHits(ans, CIVIL_CRIMINAL_MIX),
    answer_length: ans.length,
    footnote_count: fn.length,
    used_sources: sonnet.unique_source_count ?? sonnet.used_sources?.length ?? 0,
    sources_passed: sonnet.sources_passed ?? verifier_usable,
    ms: sonnet.ms ?? null,
    input_tokens: inTok,
    output_tokens: outTok,
    cost_usd: costUSD(inTok, outTok),
    retry_attempts: null, // populated below if surfaced
    answer_head: ans.slice(0, 600),
    answer_tail: ans.slice(-400),
  };
}

async function runFixture(fx: Fx): Promise<SonnetRow> {
  console.log(`[${fx.id}] trigger…`);
  const t = await trigger(fx.question).catch((e) => ({ error: String(e) } as any));
  if (!t?.run_id) {
    return summarize(fx, null, null, 0);
  }
  console.log(`[${fx.id}] run_id=${t.run_id}, polling…`);
  const row = await pollByRunId(t.run_id);
  if (!row) {
    const r = summarize(fx, t.run_id, null, 0);
    r.http_error = "poll_timeout";
    return r;
  }
  const md: any = row.metadata ?? {};
  const verifier_usable = (md.verifier?.usable ?? []).length;
  const sonnet = md.drafter_v2_sonnet_compare ?? null;
  return summarize(fx, t.run_id, sonnet, verifier_usable);
}

const rows: SonnetRow[] = [];
for (const fx of FIXTURES) {
  let row = await runFixture(fx);
  // Defensive whole-fixture retry: only if failed and looks like incomplete call.
  if (row.new_status === "failed" &&
      (row.schema_failure_reason === "no_tool_call" || row.http_status === 0 ||
       (row.http_status && (row.http_status === 429 || row.http_status >= 500)))) {
    console.log(`[${fx.id}] transient failure (http=${row.http_status}, reason=${row.schema_failure_reason}); retrying once`);
    await new Promise(r => setTimeout(r, 10000));
    const retry = await runFixture(fx);
    retry.retry_attempts = (row.retry_attempts ?? 0) + 1;
    row = retry;
  }
  rows.push(row);
  console.log(`[${fx.id}] -> ${row.new_status} (ms=${row.ms}, schema_ok=${row.schema_ok}, http=${row.http_status})`);
  // small pause between fixtures
  await new Promise(r => setTimeout(r, 3000));
}

await Bun.write(
  "reports/legal-research-v1-drafter-sonnet-rerun.json",
  JSON.stringify({ generated_at: new Date().toISOString(), fixtures: rows }, null, 2),
);

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => xs.length ? sum(xs) / xs.length : 0;
const completed = rows.filter(r => r.new_status === "completed");
const ag = {
  total: rows.length,
  completed: completed.length,
  schema_ok: completed.filter(r => r.schema_ok).length,
  unknown_refs_total: sum(completed.map(r => r.unknown_source_refs)),
  forbidden_text_total: sum(completed.map(r => r.forbidden_text_hits)),
  adj_marker_runs_total: sum(completed.map(r => r.adjacent_marker_runs)),
  superscript_total: sum(completed.map(r => r.superscript_count)),
  latin_total: sum(completed.map(r => r.latin_tokens.length)),
  hebrew_artifact_total: sum(completed.map(r => Object.values(r.hebrew_artifact_hits).reduce((a, b) => a + b, 0))),
  civil_criminal_total: sum(completed.map(r => Object.values(r.civil_criminal_hits).reduce((a, b) => a + b, 0))),
  avg_len: avg(completed.map(r => r.answer_length)),
  avg_footnotes: avg(completed.map(r => r.footnote_count)),
  avg_used_sources: avg(completed.map(r => r.used_sources)),
  avg_ms: avg(completed.map(r => r.ms ?? 0)),
  avg_in_tok: avg(completed.map(r => r.input_tokens)),
  avg_out_tok: avg(completed.map(r => r.output_tokens)),
  total_cost_usd: sum(completed.map(r => r.cost_usd)),
  avg_cost_usd: avg(completed.map(r => r.cost_usd)),
};
console.log("\n=== SONNET RERUN AGGREGATE ===");
console.log(JSON.stringify(ag, null, 2));
console.log("\n[done] reports/legal-research-v1-drafter-sonnet-rerun.json");
