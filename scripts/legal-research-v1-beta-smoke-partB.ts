// Part B — fresh unseen queries, final pre-beta human smoke test. Read-only.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const ALL = [
  { id: "S1", query: `הסבר את הלכת אפרופים והשפעתה על פרשנות חוזים בישראל` },
  { id: "S2", query: `מה נקבע בבג"ץ חסון לגבי חוק יסוד: ישראל — מדינת הלאום?` },
  { id: "S3", query: `מה התנאים להרמת מסך לפי סעיף 6 לחוק החברות?` },
  { id: "S4", query: `כתוב סקירת פסיקה קצרה על חובת תום הלב במשא ומתן לפי סעיף 12 לחוק החוזים` },
  { id: "S5", query: `מה ההבדל בין בטלות יחסית לבטלות מוחלטת במשפט המינהלי?` },
];
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const QUERIES = only.length ? ALL.filter((q) => only.includes(q.id)) : ALL;
const OUT = "reports/beta-smoke/partB";
mkdirSync(OUT, { recursive: true });

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string; job_id?: string };
}

async function poll(run_id: string, since: string, timeoutMs = 900_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&created_at=gte.${since}&order=created_at.desc&limit=1`, { headers });
    if (r.ok) { const rows = await r.json(); if (Array.isArray(rows) && rows.length && String(rows[0].answer ?? "").trim().length > 0 && rows[0]?.metadata?.drafter) return rows[0]; }
    const j = await fetch(`${SUPABASE_URL}/rest/v1/legal_research_jobs?select=status,current_stage,error&run_id=eq.${run_id}&limit=1`, { headers });
    if (j.ok) { const jr = await j.json(); if (Array.isArray(jr) && jr[0]?.status === "failed") return { failed: jr[0] }; }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

function summarize(q: { id: string; query: string }, run_id: string, row: any, ms: number) {
  const md = (row.metadata ?? {}) as any;
  const dr = md?.drafter ?? {};
  const ret = md?.retrieval ?? {};
  const si = ret?.source_integrity ?? {};
  const admitted: any[] = si?.admitted ?? [];
  const gate = dr.metadata_only_holding_gate ?? md?.metadata_only_holding_gate ?? null;
  const answer = String(row.answer ?? "");
  const split = gate?.source_split ?? dr.source_split ?? { read_in_full: [], reference_only: [] };
  const refTitle = (ref: string) => {
    const a = admitted.find((x) => (x.ref ?? x.candidate_id) === ref);
    return a ? `${a.title ?? "(no title)"} — ${a.url ?? ""}` : ref;
  };
  return {
    id: q.id, query: q.query, run_id, total_ms: ms,
    research_mode: md?.research_mode ?? md?.planner?.mode_plan?.mode ?? null,
    shape: md?.analyzer?.answer_intent?.output_shape ?? null,
    drafted: dr.ok === true && answer.trim().length > 0,
    deterministic_branch: dr.deterministic_branch ?? null,
    is_stub: /\[stub\]/i.test(answer) || answer.trim().length === 0,
    sufficiency: dr.source_sufficiency ?? md?.source_sufficiency ?? null,
    gate_report: gate,
    read_in_full: (split.read_in_full ?? []).map(refTitle),
    reference_only: (split.reference_only ?? []).map(refTitle),
    used_sources: dr.used_sources ?? [],
    used_sources_count: (dr.used_sources ?? []).length,
    footnotes: row.footnotes ?? [],
    footnotes_count: (row.footnotes ?? []).length,
    verifier_call_failed: md?.verifier?.call_failed ?? false,
    answer_len: answer.length,
    answer,
  };
}

const results: any[] = [];
for (const q of QUERIES) {
  const t0 = Date.now();
  const since = new Date(Date.now() - 15_000).toISOString();
  const t = await trigger(q.query).catch(() => ({} as any));
  console.log(`[${q.id}] run_id=${t.run_id}`);
  let rec: any;
  if (!t.run_id) rec = { id: q.id, query: q.query, error: "trigger_failed" };
  else {
    const row: any = await poll(t.run_id, since);
    if (!row) rec = { id: q.id, query: q.query, run_id: t.run_id, error: "poll_timeout" };
    else if (row.failed) rec = { id: q.id, query: q.query, run_id: t.run_id, error: "job_failed", detail: row.failed };
    else rec = summarize(q, t.run_id, row, Date.now() - t0);
  }
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
  console.log(`[${q.id}] drafted=${rec.drafted} branch=${rec.deterministic_branch} src=${rec.used_sources_count} len=${rec.answer_len} err=${rec.error ?? "-"}`);
  results.push(rec);
  writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(results, null, 2));
}
console.log("DONE");
