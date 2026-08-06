// Read-only golden product audit after specific_case stabilization.
// No code/prompt/routing changes — triggers the live function and records telemetry.
// NOTE: legal_research_jobs.id is a JOB id (!= pipeline run_id); jobs are matched by question+created_at.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const ALL = [
  // 1. specific_case_holding
  { id: "G01", cat: "specific_case_holding", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל ביחס להקצאת קרקע על בסיס השתייכות לאומית?` },
  { id: "G02", cat: "specific_case_holding", query: `מה נקבע בע"א 6821/93 בנק המזרחי נ' מגדל כפר שיתופי ביחס לסמכות בית המשפט לבטל חוק הסותר חוק יסוד?` },
  { id: "G03", cat: "specific_case_holding", query: `מה נקבע בע"א 99887-04-22 לוי נ' כהן ביחס לאחריות פלטפורמה מקוונת לתוכן משתמשים?` },
  { id: "G04", cat: "specific_case_holding", query: `מה נקבע בת"א 1234/09 כהן נ' לוי בעניין הפרת חוזה?` },
  // 2. case_law_synthesis
  { id: "G05", cat: "case_law_synthesis", query: `מה הפסיקה אומרת על הלכת השיתוף בנכסים בין בני זוג?` },
  { id: "G06", cat: "case_law_synthesis", query: `מה הפסיקה אומרת על הרמת מסך ההתאגדות?` },
  { id: "G07", cat: "case_law_synthesis", query: `מה הפסיקה אומרת על מבחן ההשתלבות לקביעת יחסי עובד-מעביד?` },
  { id: "G08", cat: "case_law_synthesis", query: `מה הפסיקה אומרת על מבחני המידתיות בביקורת חוקתית?` },
  // 3. statute_section_analysis
  { id: "G09", cat: "statute_section_analysis", query: `מהי חובת תום הלב במשא ומתן לפי סעיף 12 לחוק החוזים (חלק כללי), תשל"ג-1973?` },
  { id: "G10", cat: "statute_section_analysis", query: `מה הדין ביחס לצוואות הדדיות וביטולן לפי סעיף 8א לחוק הירושה?` },
  { id: "G11", cat: "statute_section_analysis", query: `מה קובע סעיף 6 לחוק החברות, תשנ"ט-1999 בעניין הרמת מסך?` },
  { id: "G12", cat: "statute_section_analysis", query: `מהו הנוסח המדויק של סעיף 8 לחוק יסוד: כבוד האדם וחירותו (פסקת ההגבלה)?` },
  // 4. doctrine_explanation
  { id: "G13", cat: "doctrine_explanation", query: `מהי דוקטרינת הבטלות היחסית במשפט המנהלי הישראלי?` },
  { id: "G14", cat: "doctrine_explanation", query: `מהו עקרון תום הלב במשפט הישראלי וכיצד הוא מיושם?` },
  { id: "G15", cat: "doctrine_explanation", query: `מהי דוקטרינת השיתוף הספציפי בדירת מגורים?` },
  { id: "G16", cat: "doctrine_explanation", query: `מהו השתק הבטחה (הבטחה מנהלית) במשפט הישראלי?` },
  // 5. academic / legal survey
  { id: "G17", cat: "academic_survey", query: `כתוב סקירת פסיקה על מבחן ההשתלבות בדיני עבודה.` },
  { id: "G18", cat: "academic_survey", query: `כתוב סקירה משפטית על השימוש בהרמת מסך בחברות משפחתיות.` },
  { id: "G19", cat: "academic_survey", query: `כתוב סקירה משפטית קצרה על התפתחות מבחני המידתיות במשפט החוקתי הישראלי.` },
  { id: "G20", cat: "academic_survey", query: `כתוב סקירת פסיקה על חובת תום הלב במשא ומתן.` },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const QUERIES = only.length ? ALL.filter((q) => only.includes(q.id)) : ALL;

const OUT = "reports/golden-audit-post-specific-case";
mkdirSync(OUT, { recursive: true });
const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string };
}
async function jobRow(question: string, sinceIso: string) {
  const url = `${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,error,created_at&question=eq.${encodeURIComponent(question)}&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc&limit=1`;
  const j = await fetch(url, { headers });
  if (!j.ok) return null;
  const jr = await j.json();
  return Array.isArray(jr) ? jr[0] ?? null : null;
}
async function qaRow(run_id: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function summarize(q: any, run_id: string, row: any, job: any, ms: number) {
  const md = (row?.metadata ?? {}) as any;
  const dr = md?.drafter ?? {};
  const rt = md?.retrieval ?? {};
  const si = rt?.source_integrity ?? md?.sourceIntegrity ?? {};
  const admitted: any[] = si?.admitted ?? [];
  const sc = dr.specific_case_resolution ?? rt.specific_case_resolution ?? md?.specific_case_resolution ?? {};
  const identity = dr.specific_case_identity ?? rt.specific_case_identity ?? md?.specific_case_identity ?? {};
  const suf = dr.source_sufficiency ?? md?.sufficiency ?? md?.source_sufficiency ?? {};
  const budget = rt.retrieval_budget ?? md?.retrieval_budget ?? {};
  const fns = (row?.footnotes ?? []) as any[];
  const branch = dr.deterministic_branch ?? null;
  const answer = String(row?.answer ?? "");
  return {
    id: q.id, category: q.cat, query: q.query, run_id,
    job_id: job?.id ?? null, job_status: job?.status ?? null, job_error: job?.error ?? null,
    wall_ms: ms, pipeline_total_ms: md?.total_ms ?? null,
    retrieval_elapsed_ms: budget.elapsed_ms ?? null, guard_triggered: budget.guard_triggered ?? null,
    research_mode: md?.research_mode ?? md?.planning?.research_mode ?? null,
    shape: md?.analyzer?.answer_intent?.output_shape ?? md?.planning?.analyzer?.answer_intent?.output_shape ?? null,
    branch,
    drafted: !!row && !(branch && /limitation|refus/i.test(String(branch))),
    sufficiency_profile: suf?.sufficiency_profile ?? null,
    sufficiency_passed: suf?.authority_type_sufficiency_passed ?? suf?.passed ?? null,
    fast_lane: sc.fast_lane ?? md?.fast_lane ?? null,
    exact_docket_source_found: sc.exact_docket_source_found ?? null,
    exact_docket_source_usable: sc.exact_docket_source_usable ?? null,
    specific_case_identity_passed: identity.specific_case_identity_passed ?? identity.passed ?? null,
    metadata_only_sources_used_as_holdings: dr.metadata_only_sources_used_as_holdings ?? md?.metadata_only_sources_used_as_holdings ?? null,
    commentary_carries_holding: dr.commentary_carries_holding ?? md?.commentary_carries_holding ?? null,
    synthesis_rendering: md?.synthesis_rendering ?? dr?.synthesis_rendering ?? null,
    pool: {
      admitted: admitted.length,
      tier_counts: si?.tier_counts ?? null,
      judgment_documents: si?.judgment_documents ?? null,
      judgments_with_holding_text: si?.judgments_with_holding_text ?? null,
    },
    text_usability_counts: admitted.reduce((a: any, r: any) => { a[r.text_usability] = (a[r.text_usability] ?? 0) + 1; return a; }, {}),
    role_counts: admitted.reduce((a: any, r: any) => { a[r.role] = (a[r.role] ?? 0) + 1; return a; }, {}),
    used_sources: (dr.used_sources ?? []).map((s: any) => ({ title: s.title ?? s.source_title, url: s.url, type: s.source_type ?? s.role, tier: s.authority_tier, usability: s.text_usability })),
    used_sources_count: (dr.used_sources ?? []).length,
    footnotes_count: fns.length,
    footnote1: fns[0] ? { title: fns[0]?.title, url: fns[0]?.url, type: fns[0]?.source_type } : null,
    is_stub: /\[stub\]/i.test(answer) || dr.ok === false,
    verifier: md?.verifier?.counts ?? md?.verifier?.status ?? null,
    answer_len: answer.length,
    answer,
  };
}

const CONCURRENCY = Number(process.env.CONC ?? 3);
const results: any[] = [];
for (let i = 0; i < QUERIES.length; i += CONCURRENCY) {
  const batch = QUERIES.slice(i, i + CONCURRENCY);
  const out = await Promise.all(batch.map(async (q) => {
    const t0 = Date.now();
    const sinceIso = new Date(t0 - 30_000).toISOString();
    const t = await trigger(q.query).catch(() => ({} as { run_id?: string }));
    console.log(`[${q.id}] run_id=${t.run_id}`);
    if (!t.run_id) return { id: q.id, category: q.cat, query: q.query, error: "trigger_failed" };
    let row: any = null, job: any = null;
    const deadline = Date.now() + 1_200_000;
    while (Date.now() < deadline) {
      row = await qaRow(t.run_id);
      if (row) break;
      job = await jobRow(q.query, sinceIso);
      if (job?.status === "failed") break;
      await new Promise((s) => setTimeout(s, 10000));
    }
    job = await jobRow(q.query, sinceIso);
    if (!row) return { id: q.id, category: q.cat, query: q.query, run_id: t.run_id, error: job?.status === "failed" ? "job_failed" : "poll_timeout", job };
    const rec = summarize(q, t.run_id, row, job, Date.now() - t0);
    writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
    console.log(`[${q.id}] branch=${rec.branch} drafted=${rec.drafted} used=${rec.used_sources_count} admitted=${rec.pool.admitted} len=${rec.answer_len} ms=${rec.wall_ms}`);
    return rec;
  }));
  results.push(...out);
  writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(results, null, 2));
}
writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(results, null, 2));

const stale = await fetch(`${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,created_at&status=eq.running&order=created_at.desc&limit=20`, { headers });
const staleTxt = await stale.text();
writeFileSync(`${OUT}/STALE_RUNNING.json`, staleTxt);
console.log("STALE_RUNNING", staleTxt.slice(0, 2000));
console.log("DONE");
