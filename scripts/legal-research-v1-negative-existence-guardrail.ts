// no_negative_doctrine_existence_from_retrieval_failure_v1 — validation runner.
// Sequential (CONC=1) to avoid isolate pressure.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  { id: "G15", query: "מהי דוקטרינת השיתוף הספציפי בדירת מגורים?" },
  { id: "G07", query: "מהו מבחן ההשתלבות ביחסי עובד-מעביד?" },
  { id: "G08", query: "מה הפסיקה אומרת על מבחני המידתיות בביקורת חוקתית?" },
  { id: "FAKE", query: "מה הפסיקה אומרת על הלכת הכוכב הכחול הכפול?" },
  { id: "P02", query: 'מה נקבע בע"א 99999/99 פלוני נ\' אלמוני?' },
  { id: "R02", query: 'מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ\' מגדל כפר שיתופי?' },
  { id: "B8", query: "צטט את סעיף 1 לחוק יסוד: כבוד האדם וחירותו" },
];

const FORBIDDEN = [
  "אינה קיימת", "איננה קיימת", "אינו קיים", "אין הלכה מוכרת",
  "לא קיימת הלכה", "לא נמצאה הלכה מוכרת", "אינה מוכרת בפסיקה",
  "אינה מוכרת בדין", "לא קיימת דוקטרינה",
];

const OUT = "reports/negative-existence-guardrail";
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
    const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,metadata,answer&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length && (rows[0].metadata?.status ?? "done") !== "running") return rows[0];
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

const results: any[] = [];
for (const q of QUERIES) {
  const t0 = Date.now();
  const t = await trigger(q.query).catch(() => ({} as { run_id?: string }));
  if (!t.run_id) { results.push({ ...q, error: "trigger_failed" }); continue; }
  const row = await poll(t.run_id);
  const md: any = row?.metadata ?? {};
  const d: any = md.drafter ?? {};
  const answer: string = row?.answer ?? d.answer_markdown ?? "";
  const hits = FORBIDDEN.filter((f) => answer.includes(f));
  const rec = {
    id: q.id, query: q.query, run_id: t.run_id, ms: Date.now() - t0,
    terminal: !!row,
    deterministic_branch: d.deterministic_branch ?? md.deterministic_branch ?? null,
    research_mode: md.planning?.research_mode ?? null,
    used_sources_count: (d.used_sources ?? []).length,
    forbidden_hits: hits,
    pass: !!row && hits.length === 0,
    answer_head: answer.slice(0, 400),
    answer,
  };
  results.push(rec);
  console.log(`[${q.id}] pass=${rec.pass} branch=${rec.deterministic_branch} hits=${JSON.stringify(hits)} ms=${rec.ms}`);
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(results.map(({ answer, ...r }) => r), null, 2));
console.log("done");
