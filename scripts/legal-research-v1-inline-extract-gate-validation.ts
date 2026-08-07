// Validation for the pre-extract inline gate (MAX_INLINE_EXTRACTION_BYTES).
// Usage: bun scripts/legal-research-v1-inline-extract-gate-validation.ts G15[,G05,G07]
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const ALL: Record<string, string> = {
  G05: `מה הפסיקה אומרת על הלכת השיתוף בנכסים בין בני זוג?`,
  G07: `מה הפסיקה אומרת על מבחן ההשתלבות לקביעת יחסי עובד-מעביד?`,
  G15: `מהי דוקטרינת השיתוף הספציפי בדירת מגורים?`,
};
const ids = (process.argv[2] ?? "G15").split(",").map((s) => s.trim()).filter((s) => ALL[s]);

const OUT = "reports/inline-extract-gate";
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
  const url = `${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,error,result,created_at&question=eq.${encodeURIComponent(question)}&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc&limit=1`;
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

const out: any[] = [];
for (const id of ids) {
  const q = ALL[id];
  const t0 = Date.now();
  const sinceIso = new Date(t0 - 30_000).toISOString();
  const t = await trigger(q);
  console.log(`[${id}] run_id=${t.run_id}`);
  let job: any = null;
  const deadline = Date.now() + 900_000;
  let row: any = null;
  while (Date.now() < deadline) {
    job = await jobRow(q, sinceIso);
    if (job?.status === "failed") break;
    if (job?.status === "done") { row = await qaRow(t.run_id); break; }
    console.log(`[${id}] POLL ${Math.round((Date.now() - t0) / 1000)}s`, job?.status, job?.current_stage);
    await new Promise((s) => setTimeout(s, 10000));
  }
  const cps = (job?.result?.retrieval_checkpoints ?? []) as any[];
  const skipped = cps.filter((c) => c?.stage === "judgment_attempt_skipped");
  out.push({
    id, run_id: t.run_id, job_id: job?.id, status: job?.status, error: job?.error,
    elapsed_s: Math.round((Date.now() - t0) / 1000),
    stage: job?.current_stage,
    skipped_attempts: skipped.map((c) => ({ ...c.detail, at_ms: c.at_ms })),
    checkpoint_tail: cps.slice(-14).map((c) => `${c.stage}@${c.at_ms}ms ${JSON.stringify(c.detail ?? {}).slice(0, 160)}`),
    answer_len: row?.answer?.length ?? null,
    branch: row?.metadata?.drafter?.deterministic_branch ?? null,
  });
  console.log(JSON.stringify(out[out.length - 1], null, 2));
  writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(out, null, 2));
}
