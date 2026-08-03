// Diagnostic-only: research-grade source acquisition for legal surveys (10 queries).
// Read-only against the deployed function; captures the full source pack per run.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const ALL = [
  { id: "R01", mode_expected: "specific_case_holding", query: `מה נקבע בבג"ץ קעדאן ביחס לשוויון בהקצאת מקרקעין?` },
  { id: "R02", mode_expected: "specific_case_holding", query: `מה נקבע בבנק המזרחי ביחס לסמכות בית המשפט לבטל חקיקה?` },
  { id: "R03", mode_expected: "case_law_synthesis", query: `מה הפסיקה אומרת על הלכת השיתוף?` },
  { id: "R04", mode_expected: "case_law_synthesis", query: `מה הפסיקה אומרת על הרמת מסך ההתאגדות?` },
  { id: "R05", mode_expected: "doctrine_explanation", query: `מהי דוקטרינת הבטלות היחסית במשפט המנהלי?` },
  { id: "R06", mode_expected: "statute_section_analysis", query: `מה הדין ביחס לצוואות הדדיות לפי סעיף 8א לחוק הירושה?` },
  { id: "R07", mode_expected: "statute_section_analysis", query: `מהי חובת תום הלב במשא ומתן לפי סעיף 12 לחוק החוזים?` },
  { id: "R08", mode_expected: "academic_legal_review", query: `כתוב סקירה משפטית קצרה על התפתחות מבחני המידתיות במשפט החוקתי הישראלי.` },
  { id: "R09", mode_expected: "academic_legal_review", query: `כתוב סקירת פסיקה על מבחן ההשתלבות בדיני עבודה.` },
  { id: "R10", mode_expected: "academic_legal_review", query: `כתוב סקירה משפטית על השימוש בהרמת מסך בחברות משפחתיות.` },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const QUERIES = only.length ? ALL.filter((q) => only.includes(q.id)) : ALL;

const OUT = "reports/research-pack-diagnostic";
mkdirSync(OUT, { recursive: true });

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string };
}

async function poll(run_id: string, timeoutMs = 900_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
    if (r.ok) { const rows = await r.json(); if (Array.isArray(rows) && rows.length) return rows[0]; }
    const j = await fetch(`${SUPABASE_URL}/rest/v1/legal_research_jobs?select=status,current_stage,error&run_id=eq.${run_id}&limit=1`, { headers });
    if (j.ok) { const jr = await j.json(); if (Array.isArray(jr) && jr[0]?.status === "failed") return { failed: jr[0] }; }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

function summarize(q: { id: string; query: string; mode_expected: string }, run_id: string, row: any, ms: number) {
  const md = (row.metadata ?? {}) as any;
  const dr = md?.drafter ?? {};
  const ret = md?.retrieval ?? {};
  const si = ret?.source_integrity ?? {};
  const admitted: any[] = si?.admitted ?? [];
  const acq = ret?.judgment_text_acquisition ?? null;
  const suf = dr.source_sufficiency ?? md?.source_sufficiency ?? null;
  return {
    id: q.id,
    query: q.query,
    mode_expected: q.mode_expected,
    run_id,
    total_ms: ms,
    research_mode: md?.research_mode ?? md?.planner?.mode_plan?.mode ?? md?.planning?.mode_plan?.mode ?? null,
    shape: md?.analyzer?.answer_intent?.output_shape ?? null,
    deterministic_branch: dr.deterministic_branch ?? null,
    sufficiency_profile: suf?.sufficiency_profile ?? md?.sufficiency_profile ?? null,
    sufficiency_passed: suf?.authority_type_sufficiency_passed ?? md?.authority_type_sufficiency_passed ?? null,
    sufficiency_reason: suf?.reason ?? null,
    pool: {
      found: ret?.candidate_pool?.found ?? ret?.found ?? null,
      admitted: admitted.length,
      integrity_rejects: si?.rejects ?? null,
      tier_counts: si?.tier_counts ?? null,
      citable_counts: si?.citable_counts ?? null,
      judgment_documents: si?.judgment_documents ?? null,
      judgments_with_holding_text: si?.judgments_with_holding_text ?? null,
      synthesis_role_counts: si?.synthesis_role_counts ?? null,
    },
    text_usability_counts: admitted.reduce((a: any, r: any) => { a[r.text_usability] = (a[r.text_usability] ?? 0) + 1; return a; }, {}),
    role_counts: admitted.reduce((a: any, r: any) => { a[r.role] = (a[r.role] ?? 0) + 1; return a; }, {}),
    admitted_sources: admitted.map((r: any) => ({
      title: r.title, url: r.url, role: r.role, tier: r.authority_tier,
      text_usability: r.text_usability, citable_as: r.citable_as,
      judgment: r.is_judgment_document, holding_text: r.has_holding_text,
      synthesis_role: r.synthesis_role, flags: r.integrity_flags,
    })),
    acquisition: acq,
    used_sources: (dr.used_sources ?? []).length,
    footnotes: (row.footnotes ?? []).length,
    answer_len: String(row.answer ?? "").length,
    answer: String(row.answer ?? ""),
  };
}

const CONCURRENCY = Number(process.env.CONC ?? 3);
const results: any[] = [];
for (let i = 0; i < QUERIES.length; i += CONCURRENCY) {
  const batch = QUERIES.slice(i, i + CONCURRENCY);
  const out = await Promise.all(batch.map(async (q) => {
    const t0 = Date.now();
    const t = await trigger(q.query).catch(() => ({} as { run_id?: string }));
    console.log(`[${q.id}] run_id=${t.run_id}`);
    if (!t.run_id) return { id: q.id, query: q.query, error: "trigger_failed" };
    const row: any = await poll(t.run_id);
    if (!row) return { id: q.id, query: q.query, run_id: t.run_id, error: "poll_timeout" };
    if (row.failed) return { id: q.id, query: q.query, run_id: t.run_id, error: "job_failed", detail: row.failed };
    const rec = summarize(q, t.run_id, row, Date.now() - t0);
    writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
    console.log(`[${q.id}] mode=${rec.research_mode} branch=${rec.deterministic_branch} admitted=${rec.pool.admitted} used=${rec.used_sources} len=${rec.answer_len}`);
    return rec;
  }));
  results.push(...out);
  writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(results, null, 2));
}
writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(results, null, 2));
console.log("DONE");
