// Resume harness: Q1-Q7 already completed; fetch by run_id. Q8-Q11 trigger fresh.
// Produces reports/legal-research-v1-drafter-sonnet-rerun.{json,md}.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

type Fx = { id: string; question: string; prior_sonnet: "completed" | "failed"; existing_run_id?: string };

const FIXTURES: Fx[] = [
  { id: "Q1",  question: "כיצד זהות לאומית יכולה להיות אובייקט לקודיפיקציה? מבט השוואתי על קודיפיקציה של זהות במדינות דמוקרטיות", prior_sonnet: "failed",    existing_run_id: "dddb4f02-0f21-405e-806a-6f4020b77c35" },
  { id: "Q2",  question: "מה התנאים להחלת תקנת השוק במיטלטלין?", prior_sonnet: "completed", existing_run_id: "eb0c5b66-d461-4f40-82cd-97542b59bbb9" },
  { id: "Q3",  question: "מה ההבדל בין רשלנות לבין הפרת חובה חקוקה?", prior_sonnet: "completed", existing_run_id: "f0d8a454-56bb-49e2-9591-a03b8747b244" },
  { id: "Q4",  question: "מהם התנאים לאכיפת הבטחה מנהלית?", prior_sonnet: "failed",    existing_run_id: "6885a4e9-90c4-4f27-aabe-5a834d1d4c04" },
  { id: "Q5",  question: "כיצד יש לפרש חוזה לאחר תיקון מס׳ 3 לחוק החוזים?", prior_sonnet: "completed", existing_run_id: "681e9887-5417-4b08-acc1-37e1a7b31f2b" },
  { id: "Q6",  question: "האם כישלון מערכתי באכיפת פרוטקשן יכול להקים טענה למחדל של המדינה?", prior_sonnet: "failed",    existing_run_id: "6f5d39b7-3279-49a7-bc08-149827f03c36" },
  { id: "Q7",  question: "מהם התנאים לצו מניעה זמני?", prior_sonnet: "completed", existing_run_id: "4e385f3f-e83f-4e8d-98d6-b476aa1181dd" },
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

async function fetchByRunId(run_id: string) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`,
    { headers },
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function pollByRunId(run_id: string, timeoutMs = 1_500_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await fetchByRunId(run_id);
    if (row) return row;
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
const HEB_ARTIFACTS = ["המשרוק","מום פרשני","שגיאות מוסיקליות","סיכי דה","שווה לנקוט","משקל תקף נמוך יותר","סמלייים","סמליומית","הבטחה מנהירת"];
const CIVIL_CRIMINAL_MIX = ["זיכוי","נאשם","הנאשם","כתב אישום"];
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
function costUSD(inTok: number, outTok: number): number {
  return (inTok / 1_000_000) * 3 + (outTok / 1_000_000) * 15;
}

function summarize(fx: Fx, run_id: string | null, sonnet: any, verifier_usable: number) {
  if (!sonnet) {
    return {
      fixture_id: fx.id, question: fx.question, prior_sonnet: fx.prior_sonnet, run_id,
      new_status: "failed" as const, http_status: null, http_error: "missing",
      schema_failure_reason: null, schema_ok: false,
      unknown_source_refs: 0, forbidden_text_hits: 0, adjacent_marker_runs: 0,
      superscript_count: 0, latin_tokens: [] as string[],
      hebrew_artifact_hits: {}, civil_criminal_hits: {},
      answer_length: 0, footnote_count: 0, used_sources: 0, sources_passed: verifier_usable,
      ms: null, input_tokens: 0, output_tokens: 0, cost_usd: 0,
      answer_head: "", answer_tail: "",
    };
  }
  const ans: string = sonnet.answer_markdown ?? "";
  const fn: any[] = sonnet.footnotes ?? [];
  const struct = sonnet.structured_validation ?? {};
  const initialRun = (sonnet.stage_runs ?? []).find((s: any) => s.stage === "drafter_v2.initial");
  const inTok = sonnet.usage?.input_tokens ?? 0;
  const outTok = sonnet.usage?.output_tokens ?? 0;
  return {
    fixture_id: fx.id, question: fx.question, prior_sonnet: fx.prior_sonnet, run_id,
    new_status: (sonnet.ok ? "completed" : "failed") as "completed" | "failed",
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
    answer_head: ans.slice(0, 600),
    answer_tail: ans.slice(-400),
  };
}

async function processRow(fx: Fx, row: any) {
  if (!row) return summarize(fx, null, null, 0);
  const md: any = row.metadata ?? {};
  const verifier_usable = (md.verifier?.usable ?? []).length;
  const sonnet = md.drafter_v2_sonnet_compare ?? null;
  return summarize(fx, md.run_id ?? null, sonnet, verifier_usable);
}

async function runFixture(fx: Fx) {
  if (fx.existing_run_id) {
    console.log(`[${fx.id}] fetching existing run_id=${fx.existing_run_id}`);
    const row = await fetchByRunId(fx.existing_run_id);
    return processRow(fx, row);
  }
  console.log(`[${fx.id}] trigger…`);
  const t = await trigger(fx.question).catch((e) => ({ error: String(e) } as any));
  if (!t?.run_id) return summarize(fx, null, null, 0);
  console.log(`[${fx.id}] run_id=${t.run_id}, polling…`);
  const row = await pollByRunId(t.run_id);
  if (!row) {
    const r = summarize(fx, t.run_id, null, 0);
    r.http_error = "poll_timeout";
    return r;
  }
  return processRow(fx, row);
}

const rows: any[] = [];
for (const fx of FIXTURES) {
  const row = await runFixture(fx);
  rows.push(row);
  console.log(`[${fx.id}] -> ${row.new_status} (ms=${row.ms}, schema_ok=${row.schema_ok}, http=${row.http_status})`);
  if (!fx.existing_run_id) await new Promise(r => setTimeout(r, 3000));
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
  hebrew_artifact_total: sum(completed.map(r => Object.values(r.hebrew_artifact_hits).reduce((a: number, b: any) => a + (b as number), 0))),
  civil_criminal_total: sum(completed.map(r => Object.values(r.civil_criminal_hits).reduce((a: number, b: any) => a + (b as number), 0))),
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

// Markdown report
const lines: string[] = [];
lines.push(`# Drafter V2 — Sonnet-only Rerun Report\n`);
lines.push(`_Generated: ${new Date().toISOString()}_\n`);
lines.push(`## Goal\n`);
lines.push(`Re-evaluate Claude Sonnet (sonnet-4-5-20251029) reliability after Anthropic credits were topped up, to determine whether the previous 5/11 \`no_tool_call\` failure rate was due to throttling/credits rather than model quality.\n`);
lines.push(`Harness adds exponential backoff (2s/5s/12s) for transient Anthropic errors (429/5xx/overloaded/network) inside \`lib/anthropic.ts\`.\n`);
lines.push(`## Aggregate (n=${ag.total})\n`);
lines.push(`| Metric | Value |\n|---|---|`);
lines.push(`| Completed runs | ${ag.completed}/${ag.total} |`);
lines.push(`| Schema OK | ${ag.schema_ok}/${ag.completed} |`);
lines.push(`| Unknown source_refs (total across completed) | ${ag.unknown_refs_total} |`);
lines.push(`| Forbidden text hits | ${ag.forbidden_text_total} |`);
lines.push(`| Adjacent superscript marker runs | ${ag.adj_marker_runs_total} |`);
lines.push(`| Superscript count (all completed) | ${ag.superscript_total} |`);
lines.push(`| Hebrew-artifact hits (probes) | ${ag.hebrew_artifact_total} |`);
lines.push(`| Civil/criminal-mix probe hits | ${ag.civil_criminal_total} |`);
lines.push(`| Avg answer length (chars) | ${ag.avg_len.toFixed(0)} |`);
lines.push(`| Avg footnotes | ${ag.avg_footnotes.toFixed(1)} |`);
lines.push(`| Avg unique sources used | ${ag.avg_used_sources.toFixed(1)} |`);
lines.push(`| Avg latency (ms) | ${ag.avg_ms.toFixed(0)} |`);
lines.push(`| Avg input tokens | ${ag.avg_in_tok.toFixed(0)} |`);
lines.push(`| Avg output tokens | ${ag.avg_out_tok.toFixed(0)} |`);
lines.push(`| Avg cost / run (USD) | $${ag.avg_cost_usd.toFixed(4)} |`);
lines.push(`| Total cost (USD) | $${ag.total_cost_usd.toFixed(4)} |`);
lines.push(``);
lines.push(`## Per-fixture\n`);
lines.push(`| Fx | Prior | Now | Schema | http | unk refs | adj runs | sup ct | latin | heb arts | civ/crim | fn | ans len | ms | cost |`);
lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of rows) {
  lines.push(`| ${r.fixture_id} | ${r.prior_sonnet} | ${r.new_status} | ${r.schema_ok ? "✅" : "❌"} | ${r.http_status ?? "-"} | ${r.unknown_source_refs} | ${r.adjacent_marker_runs} | ${r.superscript_count} | ${r.latin_tokens.length} | ${Object.keys(r.hebrew_artifact_hits).length} | ${Object.keys(r.civil_criminal_hits).length} | ${r.footnote_count} | ${r.answer_length} | ${r.ms ?? "-"} | $${r.cost_usd.toFixed(4)} |`);
}
lines.push(``);
lines.push(`## Compared to GPT-5 (from 4-way report)\n`);
lines.push(`Reference baseline numbers come from \`reports/legal-research-v1-drafter-model-comparison.md\` (gpt-5, B). The Sonnet metrics above can be compared directly: same 11 fixtures, same upstream source pack.\n`);
lines.push(`Key acceptance criteria from the request:\n`);
lines.push(`- ≥10/11 schema-valid runs (no \`no_tool_call\`): **${ag.schema_ok}/11**\n`);
lines.push(`- 0 unknown source_refs: **${ag.unknown_refs_total}**\n`);
lines.push(`- 0 model-generated citation markers/superscripts: **${ag.superscript_total}** total, **${ag.adj_marker_runs_total}** adjacent runs\n`);
lines.push(`- 0 Hebrew artifact / civil-criminal mix probes: **${ag.hebrew_artifact_total}** heb arts, **${ag.civil_criminal_total}** civ/crim\n`);
lines.push(`- Latency: avg ${ag.avg_ms.toFixed(0)} ms (gpt-5 ~63,600 ms)\n`);
lines.push(`- Cost / run: $${ag.avg_cost_usd.toFixed(4)} (gpt-5 ~$0.04)\n`);
lines.push(``);
lines.push(`## Answer heads (first 600 chars)\n`);
for (const r of rows) {
  lines.push(`### ${r.fixture_id} — ${r.new_status}\n`);
  lines.push("```");
  lines.push(r.answer_head || "(no answer)");
  lines.push("```");
  lines.push("");
}

await Bun.write("reports/legal-research-v1-drafter-sonnet-rerun.md", lines.join("\n"));
console.log("\n[done] reports/legal-research-v1-drafter-sonnet-rerun.{json,md}");
