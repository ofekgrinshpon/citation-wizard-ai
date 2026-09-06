// literature_body_completeness_v1 — live validation (P1..P5).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const ALL = [
  { id: "P1", query: `תעשה לי סקירת ספרות על עילת הסבירות` },
  { id: "P2", query: `תכתוב לי סקירת ספרות לסמינריון על הבטחה מנהלית וציפייה לגיטימית` },
  { id: "P3", query: `תעשה לי סקירת ספרות על היחס בין מידתיות לסבירות במשפט הישראלי` },
  { id: "P4", query: `תכתוב לי רקע תיאורטי לסמינריון על עילת הסבירות והביקורת עליה` },
  { id: "P5", query: `תעזור לי לבנות פרק סקירת ספרות על הסתמכות מול רשות מנהלית` },
];

const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const QUERIES = ONLY.length ? ALL.filter((q) => ONLY.includes(q.id)) : ALL;

const OUT = "reports/literature-body-completeness-v1";
mkdirSync(OUT, { recursive: true });

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

async function poll(run_id: string, since: string, timeoutMs = 900_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url =
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes` +
      `&metadata->>run_id=eq.${run_id}&created_at=gte.${since}&order=created_at.desc&limit=1`;
    const r = await fetch(url, { headers });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) {
        const body = String(rows[0].answer ?? "").trim();
        if (body && body !== "STUB_ANSWER" && !body.startsWith("[stub]")) return rows[0];
      }
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

// deno-lint-ignore no-explicit-any
const results: any[] = [];
for (const q of QUERIES) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const t0 = Date.now();
  const t = await trigger(q.query).catch(() => ({} as { run_id?: string }));
  console.log(`[${q.id}] run_id=${t.run_id}`);
  if (!t.run_id) {
    results.push({ ...q, error: "trigger_failed" });
    continue;
  }
  const row = await poll(t.run_id, since);
  const ms = Date.now() - t0;
  if (!row) {
    results.push({ ...q, run_id: t.run_id, ms, error: "poll_timeout" });
    writeFileSync(`${OUT}/${process.env.RESULTS ?? "results"}.json`, JSON.stringify(results, null, 2));
    continue;
  }
  // deno-lint-ignore no-explicit-any
  const md = (row.metadata ?? {}) as Record<string, any>;
  const d0 = md.drafter ?? {};
  const d = { ...(d0.doctrinal_sufficiency_trace ?? {}), ...d0 };
  const act = d.natural_literature_mode_activation ?? null;
  results.push({
    id: q.id,
    query: q.query,
    run_id: t.run_id,
    ms,
    activation: act,
    center_of_gravity: d.literature_source_center_of_gravity ?? null,
    unused_pack: d.unused_literature_pack_sources ?? [],
    facet_guard: d.facet_contamination_guard ?? [],
    gate_trace: d.academic_literature_gate_trace ?? null,
    body_completeness_version: d.literature_body_completeness_version ?? null,
    body_completeness_assessment: d.literature_body_completeness_assessment ?? [],
    reextraction_candidate: d.literature_body_reextraction_candidate ?? [],
    reextraction_attempt: d.literature_body_reextraction_attempt ?? [],
    reextraction_result: d.literature_body_reextraction_result ?? [],
    reextraction_added_latency_ms: d.literature_body_reextraction_added_latency_ms ?? 0,
    downstream_effect: d.literature_body_downstream_effect ?? [],
    literature_mode: d.academic_literature_mode ?? null,
    pack_size: Array.isArray(d.input_sources) ? d.input_sources.length : null,
    pack: Array.isArray(d.input_sources)
      // deno-lint-ignore no-explicit-any
      ? d.input_sources.map((s: any) => ({
        ref: s.ref,
        title: s.title,
        citable_as: s.citable_as ?? null,
        role: s.role ?? null,
      }))
      : [],
    footnotes_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
    footnotes: row.footnotes ?? [],
    answer: String(row.answer ?? ""),
  });
  writeFileSync(`${OUT}/${q.id}_answer.md`, String(row.answer ?? ""));
  console.log(
    `[${q.id}] lit_mode=${d.academic_literature_mode} pack=${
      Array.isArray(d.input_sources) ? d.input_sources.length : "?"
    } fn=${Array.isArray(row.footnotes) ? row.footnotes.length : 0} ${ms}ms`,
  );
  writeFileSync(`${OUT}/${process.env.RESULTS ?? "results"}.json`, JSON.stringify(results, null, 2));
}

writeFileSync(`${OUT}/${process.env.RESULTS ?? "results"}.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}/results.json`);
