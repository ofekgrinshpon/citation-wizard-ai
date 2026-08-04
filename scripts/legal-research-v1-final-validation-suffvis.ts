// Final validation report: acquisition -> sufficiency visibility track.
// Read-only against the deployed function.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const ALL = [
  { id: "R03", query: `מה הפסיקה אומרת על הלכת השיתוף?` },
  { id: "R04", query: `מה הפסיקה אומרת על הרמת מסך ההתאגדות?` },
  { id: "R09", query: `כתוב סקירת פסיקה על מבחן ההשתלבות בדיני עבודה.` },
  { id: "R01", query: `מה נקבע בבג"ץ קעדאן ביחס לשוויון בהקצאת מקרקעין?` },
  { id: "R02", query: `מה נקבע בבנק המזרחי ביחס לסמכות בית המשפט לבטל חקיקה?` },
  { id: "P02", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const QUERIES = only.length ? ALL.filter((q) => only.includes(q.id)) : ALL;
const OUT = "reports/final-validation-suffvis";
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

function summarize(q: { id: string; query: string }, run_id: string, row: any, ms: number) {
  const md = (row.metadata ?? {}) as any;
  const dr = md?.drafter ?? {};
  const ret = md?.retrieval ?? {};
  const si = ret?.source_integrity ?? {};
  const admitted: any[] = si?.admitted ?? [];
  const acq = ret?.judgment_text_acquisition ?? null;
  const suf = dr.source_sufficiency ?? md?.source_sufficiency ?? null;
  const ver = md?.verifier ?? {};
  const verdicts: any[] = ver?.verdicts ?? [];
  const answer = String(row.answer ?? "");

  const byRef = new Map<string, any>();
  for (const a of admitted) byRef.set(a.ref ?? a.candidate_id, a);
  const usableRefs: string[] = suf?.usable_judgment_refs ?? [];

  const verdictFor = (cid: string) =>
    verdicts.filter((v: any) => v.candidate_id === cid || v.ref === cid)
      .map((v: any) => v.support ?? v.verified_support);

  return {
    id: q.id, query: q.query, run_id, total_ms: ms,
    research_mode: md?.research_mode ?? md?.planner?.mode_plan?.mode ?? null,
    shape: md?.analyzer?.answer_intent?.output_shape ?? null,
    deterministic_branch: dr.deterministic_branch ?? null,
    is_stub: /\[stub\]/.test(answer),
    verifier_counts: ver?.counts ?? null,
    verifier_errors: ver?.errors ?? null,
    sufficiency: suf,
    acquisition: acq,
    usable_judgments: usableRefs.map((ref) => {
      const a = byRef.get(ref) ?? {};
      return {
        ref, title: a.title, url: a.url,
        citable_as: a.citable_as, authority_tier: a.authority_tier,
        text_usability: a.text_usability, has_holding_text: a.has_holding_text,
        usable_for_holding: a.usable_for_holding,
        acquired_text_length: a.acquired_text_length ?? a.text_length ?? null,
        synthesis_role: a.synthesis_role, flags: a.integrity_flags,
        verifier: verdictFor(a.candidate_id ?? ref),
        in_answer_footnote: (row.footnotes ?? []).some((f: any) =>
          (f.sources ?? []).some((s: any) => s.url && s.url === a.url)),
      };
    }),
    admitted_sources: admitted.map((r: any) => ({
      ref: r.ref, title: r.title, url: r.url, role: r.role, tier: r.authority_tier,
      text_usability: r.text_usability, citable_as: r.citable_as,
      judgment: r.is_judgment_document, holding_text: r.has_holding_text,
      usable_for_holding: r.usable_for_holding, synthesis_role: r.synthesis_role,
      flags: r.integrity_flags, verifier: verdictFor(r.candidate_id ?? r.ref),
    })),
    used_sources: dr.used_sources ?? [],
    footnotes: row.footnotes ?? [],
    answer_len: answer.length,
    answer,
  };
}

const CONCURRENCY = Number(process.env.CONC ?? 4);
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
    console.log(`[${q.id}] mode=${rec.research_mode} branch=${rec.deterministic_branch} suff=${rec.sufficiency?.reason} usable_j=${rec.usable_judgments.length} len=${rec.answer_len}`);
    return rec;
  }));
  results.push(...out);
  writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(results, null, 2));
}
console.log("DONE");
