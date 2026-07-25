// Narrow lead_ref patch — validation runner (Q01, Q02, Q03, Q17, Q18, plus
// בג״ץ 5555/18 case_holding smoke). Captures the deterministic lead_ref
// selection and the drafter output.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

if (!SUPABASE_URL || !SR_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

type Q = { id: string; category?: string; query: string };
const golden = JSON.parse(
  readFileSync("reports/quality-audit/golden-set.json", "utf8"),
) as { questions: Q[] };
const wanted = ["Q01", "Q02", "Q03", "Q17", "Q18"];
const set: Q[] = golden.questions.filter((q) => wanted.includes(q.id));
set.push({
  id: "BGZ5555",
  category: "case_holding_smoke",
  query: 'מה נקבע בבג"ץ 5555/18 בעניין חוק-יסוד: הלאום? נסח את ההלכה שנפסקה.',
});

const OUT = "reports/quality-audit/runs-leadref";
mkdirSync(OUT, { recursive: true });
mkdirSync("/mnt/documents/quality-audit/runs-leadref", { recursive: true });

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string };
}

async function poll(run_id: string, timeoutMs = 900_000) {
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

console.log(`[leadref] triggering ${set.length} runs`);
const triggered: Array<{ q: Q; run_id: string | null }> = [];
const CONC = 3;
for (let i = 0; i < set.length; i += CONC) {
  const batch = set.slice(i, i + CONC);
  const out = await Promise.all(batch.map(async (q) => {
    try {
      const t = await trigger(q.query);
      console.log(`[${q.id}] triggered run_id=${t.run_id}`);
      return { q, run_id: t.run_id ?? null };
    } catch (e) {
      console.error(`[${q.id}] trigger err`, e);
      return { q, run_id: null };
    }
  }));
  triggered.push(...out);
  if (i + CONC < set.length) await new Promise((r) => setTimeout(r, 4000));
}

const results = await Promise.all(triggered.map(async ({ q, run_id }) => {
  const base: any = { id: q.id, category: q.category, query: q.query, run_id };
  if (!run_id) return { ...base, error: "trigger_failed" };
  const row = await poll(run_id);
  if (!row) return { ...base, error: "poll_timeout" };
  const md: any = row.metadata ?? {};
  const d: any = md.drafter ?? {};
  const raw = {
    ...base,
    ok: d.ok === true,
    total_ms: md.total_ms ?? null,
    answer_intent: md?.planning?.analyzer?.answer_intent ?? null,
    lead_ref: d.lead_ref ?? null,
    missing_anchor_caveat_injected: d.missing_anchor_caveat_injected ?? false,
    missing_anchor_descriptions: d.missing_anchor_descriptions ?? [],
    answer: row.answer ?? "",
    footnotes: row.footnotes ?? [],
    used_sources: d.used_sources ?? [],
    quality_warning: d.quality_warning ?? null,
  };
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(raw, null, 2));
  writeFileSync(`/mnt/documents/quality-audit/runs-leadref/${q.id}.json`, JSON.stringify(raw, null, 2));
  console.log(
    `[${q.id}] ok=${raw.ok} shape=${raw.answer_intent?.output_shape ?? "-"} lead_ref=${raw.lead_ref?.ref ?? "-"} reason=${raw.lead_ref?.reason ?? "-"}`,
  );
  return raw;
}));

writeFileSync(`${OUT}/_summary.json`, JSON.stringify(results, null, 2));
console.log(`[leadref] done, wrote ${OUT}/_summary.json`);
