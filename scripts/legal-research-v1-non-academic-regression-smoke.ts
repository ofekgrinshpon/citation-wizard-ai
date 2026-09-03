// non_academic_regression_smoke_v1 — read-only validation runner.
// Runs three ordinary (non-academic) legal Q&A fixtures and captures routing,
// source-flow, alignment and answer telemetry. No code paths are modified.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const ALL = [
  { id: "Q1", query: "מתי בית המשפט מתערב בהחלטה מנהלית מקצועית של רשות?" },
  { id: "Q2", query: "מה אומר חוק-יסוד: כבוד האדם וחירותו לגבי פגיעה בזכויות?" },
  { id: "Q3", query: "מה ההלכה המרכזית בפסיקה לגבי מבחן המידתיות?" },
];
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const QUERIES = ONLY.length ? ALL.filter((q) => ONLY.includes(q.id)) : ALL;

const OUT = "reports/non-academic-regression-smoke-v1";
mkdirSync(OUT, { recursive: true });

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string };
}

async function poll(run_id: string, since: string, timeoutMs = 900_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes` +
      `&metadata->>run_id=eq.${run_id}&created_at=gte.${since}&order=created_at.desc&limit=1`;
    const r = await fetch(url, { headers });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) {
        const row = rows[0];
        const body = String(row.answer ?? "").trim();
        if (body && body !== "STUB_ANSWER" && !body.startsWith("[stub]")) return row;
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
  if (!t.run_id) { results.push({ ...q, error: "trigger_failed" }); continue; }
  const row = await poll(t.run_id, since);
  const ms = Date.now() - t0;
  if (!row) { results.push({ ...q, run_id: t.run_id, ms, error: "poll_timeout" }); continue; }
  // deno-lint-ignore no-explicit-any
  const md = (row.metadata ?? {}) as Record<string, any>;
  const answer = String(row.answer ?? "");
  results.push({
    id: q.id,
    query: q.query,
    run_id: t.run_id,
    ms,
    router: md.router_profile ?? md.router ?? null,
    analyzer: md.analyzer ?? md.claim_analysis ?? null,
    academic: md.academic_writing ?? md.academic ?? null,
    academic_mode_flags: {
      academic_authority_alignment: md.academic_authority_alignment ?? null,
      academic_presentation_hygiene: md.academic_presentation_hygiene ?? null,
      academic_candidate_admission: md.academic_candidate_admission ?? null,
    },
    source_use_plan: md.source_use_plan ?? null,
    source_depth_policy: md.source_depth_policy ?? null,
    local_primary_anchor: md.local_primary_anchor ?? null,
    local_caselaw_gate: md.local_caselaw_listing_gate ?? null,
    retrieval: md.retrieval ?? null,
    sufficiency: md.source_sufficiency ?? md.sufficiency ?? null,
    claim_source_match: md.claim_source_match ?? null,
    topic_aware_alignment: md.topic_aware_alignment ?? null,
    limitation_note_alignment: md.limitation_note_alignment ?? null,
    drafter: md.drafter ? { ...md.drafter, prompt: undefined } : null,
    footnotes_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
    // deno-lint-ignore no-explicit-any
    footnotes: (row.footnotes ?? []).map((f: any) => ({
      n: f.n ?? f.index ?? null,
      title: f.title ?? f.display_title ?? null,
      url: f.url ?? null,
      role: f.role ?? f.synthesis_role ?? null,
      source_type: f.source_type ?? null,
    })),
    answer_len: answer.length,
    answer,
    metadata_keys: Object.keys(md),
  });
  console.log(`[${q.id}] fn=${results.at(-1).footnotes_count} len=${answer.length} ${ms}ms`);
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}/results.json`);
