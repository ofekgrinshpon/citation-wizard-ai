// no_negative_doctrine_existence_from_retrieval_failure_v1 — validation runner (v2).
//
// Polling contract (fixes the earlier placeholder-row artifact):
//  - capture job_id + run_id from the 202 launch response;
//  - poll legal_research_jobs BY job_id until terminal (done / error / failed / timeout);
//  - only then fetch the qa_logs row by run_id;
//  - require qa_logs.created_at >= launch_time;
//  - reject placeholder / early rows (stub answer, metadata.status running, empty body);
//  - FAIL on empty answer body, and FAIL if the job never reaches a terminal state.
// Sequential (CONC=1).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
const TERMINAL = new Set(["done", "error", "failed", "timeout", "completed"]);

const QUERIES = [
  { id: "G15", query: "מהי דוקטרינת השיתוף הספציפי בדירת מגורים?" },
  { id: "G07", query: "מה הפסיקה אומרת על מבחן ההשתלבות לקביעת יחסי עובד-מעביד?" },
  { id: "G08", query: "מה הפסיקה אומרת על מבחני המידתיות בביקורת חוקתית?" },
  { id: "FAKE", query: "מה הפסיקה אומרת על הלכת הכוכב הכחול הכפול?" },
  { id: "P02", query: 'מה נקבע בע"א 99887-04-22 לוי נ\' מדינת ישראל?' },
  { id: "R02", query: 'מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ\' מגדל כפר שיתופי?' },
  { id: "B8", query: "צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו." },
];

// Absolute non-existence phrasing (forbidden).
const FORBIDDEN = [
  "אין הלכה מוכרת בשם", "הדוקטרינה אינה קיימת", "לא קיימת הלכה כזו", "אינה מוכרת בפסיקה",
  "אינה קיימת", "איננה קיימת", "אינו קיים", "אין הלכה מוכרת", "לא קיימת הלכה",
  "לא נמצאה הלכה מוכרת", "אינה מוכרת בדין", "לא קיימת דוקטרינה", "אין דוקטרינה כזו",
  "אינה מוכרת במשפט",
];

// Source-scoped phrasing (allowed / expected when limiting).
const SOURCE_SCOPED = [
  "במקורות שאותרו", "לפי המקורות שאותרו", "החומר שאותר", "לא נמצא מקור ראשוני",
  "לא אותר במקורות", "לא אותרה במקורות", "לא אותר במקורות הזמינים", "במקורות שנסקרו",
  "לא נמצא עיגון מספק", "לא נמצאה במקורות", "נמצא במקורות", "נמצאו במקורות", "המקורות שאותרו",
];

const B8_CANON =
  "זכויות היסוד של האדם בישראל מושתתות על ההכרה בערך האדם, בקדושת חייו ובהיותו בן-חורין, והן יכובדו ברוח העקרונות שבהכרזה על הקמת מדינת ישראל.";

// Baselines for change detection (from the golden audit / safety-control reports).
const BASELINE: Record<string, { branch: string | null; drafted: boolean; footnotes: number; used: number }> = {
  G15: { branch: null, drafted: true, footnotes: 4, used: 7 },
  G07: { branch: "insufficient_sources_limitation", drafted: false, footnotes: 0, used: 0 },
  G08: { branch: "insufficient_sources_limitation", drafted: false, footnotes: 0, used: 0 },
  P02: { branch: "docket_limitation", drafted: false, footnotes: 0, used: 0 },
  R02: { branch: "specific_case", drafted: true, footnotes: 1, used: 1 },
  B8: { branch: "canonical_quote_registry", drafted: true, footnotes: 1, used: 1 },
};

const OUT = "reports/negative-existence-guardrail";
mkdirSync(OUT, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string; job_id?: string };
}

async function jobById(job_id: string) {
  const url = `${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,completed_stages,error,created_at,updated_at&id=eq.${job_id}&limit=1`;
  const r = await fetch(url, { headers });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function qaByRun(run_id: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,metadata&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=5`,
    { headers },
  );
  if (!r.ok) return [];
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

function isPlaceholder(row: any): boolean {
  const a: string = row?.answer ?? "";
  const st = row?.metadata?.status ?? row?.metadata?.phase_status ?? null;
  if (st === "running" || st === "queued") return true;
  if (!a.trim()) return true;
  if (a.includes("מעבד") && a.length < 80) return true; // stub placeholder text
  return false;
}

const results: any[] = [];

for (const q of QUERIES) {
  const t0 = Date.now();
  const launchIso = new Date(t0 - 5_000).toISOString();
  const t = await trigger(q.query).catch(() => ({} as any));
  console.log(`[${q.id}] launch run_id=${t.run_id} job_id=${t.job_id}`);
  if (!t.run_id || !t.job_id) {
    results.push({ id: q.id, query: q.query, pass: false, failure: "trigger_failed" });
    writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(results.at(-1), null, 2));
    continue;
  }

  // 1) Poll the job by job_id until terminal.
  let job: any = null;
  const deadline = Date.now() + 900_000;
  while (Date.now() < deadline) {
    job = await jobById(t.job_id);
    if (job && TERMINAL.has(String(job.status))) break;
    console.log(`[${q.id}] poll ${Math.round((Date.now() - t0) / 1000)}s status=${job?.status} stage=${job?.current_stage}`);
    await sleep(10_000);
  }
  const terminal = !!job && TERMINAL.has(String(job.status));
  const stale = !terminal;

  // 2) Only after terminal: fetch the qa_logs row, reject placeholders/early rows.
  let row: any = null;
  let placeholder_rows = 0;
  if (terminal) {
    for (let i = 0; i < 6 && !row; i++) {
      const rows = await qaByRun(t.run_id);
      const fresh = rows.filter((r: any) => new Date(r.created_at).getTime() >= new Date(launchIso).getTime());
      placeholder_rows = fresh.filter(isPlaceholder).length;
      row = fresh.find((r: any) => !isPlaceholder(r)) ?? null;
      if (!row) await sleep(5_000);
    }
  }

  const md: any = row?.metadata ?? {};
  const d: any = md.drafter ?? {};
  const answer: string = (row?.answer ?? d.answer_markdown ?? "") as string;
  const fns: any[] = (row?.footnotes ?? d.footnotes ?? []) as any[];
  const branch = d.deterministic_branch ?? md.deterministic_branch ?? null;
  const used = (d.used_sources ?? []).length;
  const drafted = d.drafted ?? (answer.length > 0 && used > 0);
  const hits = FORBIDDEN.filter((f) => answer.includes(f));
  const scoped = SOURCE_SCOPED.filter((s) => answer.includes(s));
  const limiting = !drafted || used === 0 || !!branch?.includes("limitation");
  const isStub = !!md.is_stub || answer.includes("STUB_ANSWER");
  const verifierFailed = !!d.verifier_call_failed || md.verifier_error != null;
  const cpuKill = /CPU|isolate|stale_worker/i.test(String(job?.error ?? ""));

  const base = BASELINE[q.id];
  const changed = base
    ? {
        branch: (base.branch ?? null) !== (branch ?? null),
        drafted: base.drafted !== !!drafted,
        footnotes: base.footnotes !== fns.length,
        used_sources: base.used !== used,
      }
    : null;

  const failures: string[] = [];
  if (!terminal) failures.push("job_not_terminal_or_stale");
  if (terminal && !row) failures.push("no_terminal_qa_row");
  if (!answer.trim()) failures.push("empty_answer_body");
  if (hits.length) failures.push("forbidden_absolute_non_existence");
  if (limiting && answer.trim() && scoped.length === 0) failures.push("limitation_not_source_scoped");
  if (isStub) failures.push("stub_answer");
  if (verifierFailed) failures.push("verifier_failure");
  if (cpuKill) failures.push("cpu_kill");
  if (q.id === "B8" && answer && !answer.includes(B8_CANON)) failures.push("b8_canonical_quote_changed");
  if (q.id === "P02" && branch !== "docket_limitation") failures.push("p02_not_deterministic_docket_refusal");
  if (q.id === "R02" && !(answer.includes("6821/93") || answer.includes("המזרחי"))) failures.push("r02_missing_exact_body");

  const rec = {
    id: q.id,
    query: q.query,
    job_id: t.job_id,
    run_id: t.run_id,
    ms: Date.now() - t0,
    terminal_status: job?.status ?? "none",
    job_error: job?.error ?? null,
    last_stage: job?.current_stage ?? null,
    stale,
    placeholder_rows_rejected: placeholder_rows,
    branch,
    drafted: !!drafted,
    answer_length: answer.length,
    used_sources_count: used,
    footnotes_count: fns.length,
    forbidden_hits: hits,
    forbidden_count: hits.length,
    source_scoped_phrases: scoped,
    source_scoped_when_limiting: !limiting ? "n/a" : scoped.length > 0,
    baseline_changed: changed,
    is_stub: isStub,
    verifier_failed: verifierFailed,
    cpu_kill: cpuKill,
    pass: failures.length === 0,
    failures,
    answer_head: answer.slice(0, 500),
    answer,
  };
  results.push(rec);
  console.log(
    `[${q.id}] pass=${rec.pass} status=${rec.terminal_status} branch=${branch} len=${answer.length} forbidden=${hits.length} scoped=${scoped.length} fns=${fns.length} ms=${rec.ms} ${failures.join(",")}`,
  );
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(results.map(({ answer, ...r }) => r), null, 2));
}

writeFileSync(`${OUT}/summary.json`, JSON.stringify(results.map(({ answer, ...r }) => r), null, 2));
console.log("done. pass=", results.filter((r) => r.pass).length, "/", results.length);
