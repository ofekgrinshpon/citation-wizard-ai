// metadata_only_holding_gate_v1 — validation runner.
//
// Contract: launch → poll legal_research_jobs by job_id until terminal →
// fetch the qa_logs row by run_id (fresh, non-placeholder) → assert:
//   * 0 metadata-only judgment sources carrying propositions (footnote-level);
//   * every footnote source that is a judgment has body-acquired text;
//   * source split (read_in_full / reference_only) is reported;
//   * R02 exact-body, P02 deterministic refusal, B8 canonical quote byte-equal;
//   * no CPU kills / stale rows / stubs / verifier failures.
// Sequential (CONC=1).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
const TERMINAL = new Set(["done", "error", "failed", "timeout", "completed"]);

const ONLY = (process.env.ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const QUERIES = [
  { id: "G15", query: "מהי דוקטרינת השיתוף הספציפי בדירת מגורים?" },
  { id: "G13", query: "מהי דוקטרינת הבטלות היחסית במשפט המנהלי?" },
  { id: "G14", query: "כיצד מיושם עקרון תום הלב בדיני חוזים בפסיקה?" },
  { id: "G17", query: "מהם התנאים להכרה בהסכם ממון שלא אושר בבית משפט?" },
  { id: "G07", query: "מה הפסיקה אומרת על מבחן ההשתלבות לקביעת יחסי עובד-מעביד?" },
  { id: "G08", query: "מה הפסיקה אומרת על מבחני המידתיות בביקורת חוקתית?" },
  { id: "G10", query: "מה הדין לגבי צוואות הדדיות וביטולן לאחר פטירת אחד מבני הזוג?" },
  { id: "R02", query: 'מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ\' מגדל כפר שיתופי?' },
  { id: "P02", query: 'מה נקבע בע"א 99887-04-22 לוי נ\' מדינת ישראל?' },
  { id: "B8", query: "צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו." },
].filter((q) => ONLY.length === 0 || ONLY.includes(q.id));

const B8_CANON =
  "זכויות היסוד של האדם בישראל מושתתות על ההכרה בערך האדם, בקדושת חייו ובהיותו בן-חורין, והן יכובדו ברוח העקרונות שבהכרזה על הקמת מדינת ישראל.";

const BODY_OK = new Set(["full_text", "substantive_excerpt", "holding_text"]);
const isJudgment = (s: any) => s?.citable_as === "judgment" || s?.is_judgment_document === true;
const bodyAcquired = (s: any) =>
  s?.has_holding_text === true || BODY_OK.has(String(s?.text_usability ?? "").toLowerCase());

const OUT = "reports/metadata-only-holding-gate";
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
  const url = `${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,error,created_at,updated_at&id=eq.${job_id}&limit=1`;
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
  if (a.includes("מעבד") && a.length < 80) return true;
  return false;
}

const results: any[] = [];

for (const q of QUERIES) {
  const t0 = Date.now();
  const launchIso = new Date(t0 - 5_000).toISOString();
  const t = await trigger(q.query).catch(() => ({} as any));
  console.log(`[${q.id}] launch run_id=${t.run_id} job_id=${t.job_id}`);
  if (!t.run_id || !t.job_id) {
    results.push({ id: q.id, query: q.query, pass: false, failures: ["trigger_failed"] });
    writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(results.at(-1), null, 2));
    continue;
  }

  let job: any = null;
  const deadline = Date.now() + 900_000;
  while (Date.now() < deadline) {
    job = await jobById(t.job_id);
    if (job && TERMINAL.has(String(job.status))) break;
    console.log(`[${q.id}] poll ${Math.round((Date.now() - t0) / 1000)}s status=${job?.status} stage=${job?.current_stage}`);
    await sleep(10_000);
  }
  const terminal = !!job && TERMINAL.has(String(job.status));

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
  const usedSources: any[] = d.used_sources ?? [];
  const used = usedSources.length;
  const drafted = d.drafted ?? (answer.length > 0 && used > 0);
  const gate = md.metadata_only_holding_gate ?? d.metadata_only_holding_gate ?? null;

  // Gate assertion at the artifact level: no cited source may be a judgment
  // whose body was never acquired.
  const offending = usedSources.filter((s) => isJudgment(s) && !bodyAcquired(s));
  const judgmentsCited = usedSources.filter(isJudgment);
  const splitReadInFull = usedSources.filter((s) => isJudgment(s) && bodyAcquired(s)).map((s) => s.title);
  const splitReferenceOnly = offending.map((s) => s.title);

  const isStub = !!md.is_stub || answer.includes("STUB_ANSWER");
  const verifierFailed = !!d.verifier_call_failed || md.verifier_error != null;
  const cpuKill = /CPU|isolate|stale_worker/i.test(String(job?.error ?? ""));

  const failures: string[] = [];
  if (!terminal) failures.push("job_not_terminal_or_stale");
  if (terminal && !row) failures.push("no_terminal_qa_row");
  if (!answer.trim()) failures.push("empty_answer_body");
  if (drafted && offending.length > 0) failures.push("metadata_only_holding_cited");
  if (gate && (gate.metadata_only_holdings_remaining ?? 0) > 0) failures.push("gate_invariant_violated");
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
    placeholder_rows_rejected: placeholder_rows,
    branch,
    drafted: !!drafted,
    answer_length: answer.length,
    used_sources_count: used,
    footnotes_count: fns.length,
    judgments_cited: judgmentsCited.length,
    metadata_only_cited: offending.length,
    metadata_only_cited_titles: splitReferenceOnly,
    source_split: { read_in_full: splitReadInFull, reference_only: splitReferenceOnly },
    gate_report: gate,
    is_stub: isStub,
    verifier_failed: verifierFailed,
    cpu_kill: cpuKill,
    pass: failures.length === 0,
    failures,
    answer,
  };
  results.push(rec);
  console.log(
    `[${q.id}] pass=${rec.pass} status=${rec.terminal_status} branch=${branch} len=${answer.length} used=${used} judgments=${judgmentsCited.length} meta_only_cited=${offending.length} ms=${rec.ms} ${failures.join(",")}`,
  );
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(results.map(({ answer, ...r }) => r), null, 2));
}

writeFileSync(`${OUT}/summary.json`, JSON.stringify(results.map(({ answer, ...r }) => r), null, 2));
console.log("done. pass=", results.filter((r) => r.pass).length, "/", results.length);
