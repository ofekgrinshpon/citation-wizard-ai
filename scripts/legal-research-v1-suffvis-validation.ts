// sufficiency_false_negatives_and_topical_matching_v1 — validation runner.
//
// Contract (hardened):
//   * capture job_id AND run_id from the launch response;
//   * poll legal_research_jobs by job_id until terminal (done/failed/error/timeout);
//   * only after terminal, fetch qa_logs using the ACTUAL schema
//     (no qa_logs.run_id column — run_id lives in metadata->>'run_id');
//   * require qa_logs.created_at >= launch_time;
//   * reject placeholder/empty answer rows;
//   * fail on empty answer body, stale/running job, stub, verifier failure, CPU kill.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) {
  console.error("Missing env");
  process.exit(1);
}
const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
const TERMINAL = new Set(["done", "error", "failed", "timeout", "completed"]);

const ALL = [
  { id: "G07", query: `מה הפסיקה אומרת על מבחן ההשתלבות לקביעת יחסי עובד-מעביד?` },
  { id: "G08", query: `מה הפסיקה אומרת על מבחני המידתיות בביקורת חוקתית?` },
  { id: "G11", query: `מה קובע סעיף 6 לחוק החברות, תשנ"ט-1999 בעניין הרמת מסך?` },
  { id: "G12", query: `מהו הנוסח המדויק של סעיף 8 לחוק יסוד: כבוד האדם וחירותו (פסקת ההגבלה)?` },
  { id: "G10", query: `מה הדין ביחס לצוואות הדדיות וביטולן לפי סעיף 8א לחוק הירושה?` },
  { id: "G13", query: `מהי דוקטרינת הבטלות היחסית במשפט המנהלי הישראלי?` },
  { id: "G15", query: `מהי דוקטרינת השיתוף הספציפי בדירת מגורים?` },
  { id: "G17", query: `כתוב סקירת פסיקה על מבחן ההשתלבות בדיני עבודה.` },
  { id: "R02", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
  { id: "P02", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
];
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const QUERIES = only.length ? ALL.filter((q) => only.includes(q.id)) : ALL;

const B8_CANON =
  "זכויות היסוד של האדם בישראל מושתתות על ההכרה בערך האדם, בקדושת חייו ובהיותו בן-חורין, והן יכובדו ברוח העקרונות שבהכרזה על הקמת מדינת ישראל.";

const BODY_OK = new Set(["full_text", "substantive_excerpt", "holding_text"]);
const isJudgment = (s: any) => s?.citable_as === "judgment" || s?.is_judgment_document === true;
const bodyAcquired = (s: any) =>
  s?.has_holding_text === true || s?.body_acquired === true ||
  BODY_OK.has(String(s?.text_usability ?? s?.final_text_usability ?? "").toLowerCase());

const OUT = "reports/suffvis-validation";
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  return (await r.json().catch(() => ({}))) as { run_id?: string; job_id?: string };
}

async function jobById(job_id: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,error,created_at,updated_at&id=eq.${job_id}&limit=1`,
    { headers },
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// qa_logs columns (verified against live schema):
// id, user_id, question, local_footnotes_count, perplexity_footnotes_count,
// total_footnotes, created_at, answer, footnotes, task_mode, project_id, metadata
async function qaByRun(run_id: string, sinceIso: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,metadata` +
      `&metadata->>run_id=eq.${run_id}&created_at=gte.${encodeURIComponent(sinceIso)}` +
      `&order=created_at.desc&limit=5`,
    { headers },
  );
  if (!r.ok) return [];
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

function isPlaceholder(row: any): boolean {
  const a: string = row?.answer ?? "";
  const md = row?.metadata ?? {};
  if (md.trace_status === "in_progress") return true;
  if (md.status === "running" || md.status === "queued") return true;
  if (!String(a).trim()) return true;
  if (a.includes("מעבד") && a.length < 80) return true;
  return false;
}

const results: any[] = [];

for (const q of QUERIES) {
  const t0 = Date.now();
  const launchIso = new Date(t0 - 5_000).toISOString();
  const t = await trigger(q.query).catch(() => ({} as any));
  console.log(`[${q.id}] launch job_id=${t.job_id} run_id=${t.run_id}`);
  if (!t.run_id || !t.job_id) {
    const rec = { id: q.id, query: q.query, pass: false, failures: ["trigger_failed"] };
    results.push(rec);
    writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
    continue;
  }

  let job: any = null;
  const deadline = Date.now() + 900_000;
  while (Date.now() < deadline) {
    job = await jobById(t.job_id);
    if (job && TERMINAL.has(String(job.status))) break;
    console.log(
      `[${q.id}] poll ${Math.round((Date.now() - t0) / 1000)}s status=${job?.status} stage=${job?.current_stage}`,
    );
    await sleep(10_000);
  }
  const terminal = !!job && TERMINAL.has(String(job.status));

  let row: any = null;
  let placeholder_rows = 0;
  if (terminal) {
    for (let i = 0; i < 6 && !row; i++) {
      const rows = await qaByRun(t.run_id, launchIso);
      placeholder_rows = rows.filter(isPlaceholder).length;
      row = rows.find((r: any) => !isPlaceholder(r)) ?? null;
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
  const statAcq = md.statute_text_acquisition ?? null;
  const suff = md.source_sufficiency ?? null;

  const judgments = usedSources.filter(isJudgment);
  const judgBody = judgments.filter(bodyAcquired);
  const judgMetaOnly = judgments.filter((s) => !bodyAcquired(s));
  const statuteAcquiredCount = statAcq?.successes ?? 0;
  const sectionLocated = (statAcq?.attempts ?? []).some((a: any) => a?.section_found === true);
  const sufficiencyUsedBody =
    (suff?.body_text_topical_matches ?? null) != null
      ? Number(suff.body_text_topical_matches) > 0
      : judgBody.length > 0 || statuteAcquiredCount > 0;

  const isStub = !!md.is_stub || answer.includes("STUB_ANSWER");
  const verifierFailed = !!d.verifier_call_failed || md.verifier_error != null;
  const cpuKill = /CPU|isolate|stale_worker/i.test(String(job?.error ?? ""));

  const failures: string[] = [];
  if (!terminal) failures.push("job_not_terminal_or_stale");
  if (terminal && !row) failures.push("no_terminal_qa_row");
  if (!String(answer).trim()) failures.push("empty_answer_body");
  if (drafted && judgMetaOnly.length > 0) failures.push("metadata_only_holding_cited");
  if (gate && (gate.metadata_only_holdings_remaining ?? 0) > 0) failures.push("gate_invariant_violated");
  if (isStub) failures.push("stub_answer");
  if (verifierFailed) failures.push("verifier_failure");
  if (cpuKill) failures.push("cpu_kill");
  if (q.id === "B8" && answer && !answer.includes(B8_CANON)) failures.push("b8_canonical_quote_changed");
  if (q.id === "P02" && branch !== "docket_limitation") failures.push("p02_not_deterministic_docket_refusal");
  if (q.id === "R02" && !(answer.includes("6821/93") || answer.includes("המזרחי"))) {
    failures.push("r02_missing_exact_body");
  }

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
    judgments_cited: judgments.length,
    body_acquired_judgments: judgBody.length,
    metadata_only_judgments: judgMetaOnly.length,
    metadata_only_titles: judgMetaOnly.map((s) => s.title),
    statute_text_acquired_count: statuteAcquiredCount,
    statute_section_text_located: sectionLocated,
    statute_acquisition: statAcq,
    sufficiency_used_acquired_body: sufficiencyUsedBody,
    sufficiency_profile: md.sufficiency_profile ?? null,
    sufficiency_passed: md.authority_type_sufficiency_passed ?? null,
    metadata_only_holdings_remaining: gate?.metadata_only_holdings_remaining ?? 0,
    gate_report: gate,
    is_stub: isStub,
    verifier_failed: verifierFailed,
    cpu_kill: cpuKill,
    pass: failures.length === 0,
    failures,
    used_source_titles: usedSources.map((s: any) => ({
      title: s.title,
      citable_as: s.citable_as,
      text_usability: s.text_usability ?? s.final_text_usability ?? null,
    })),
    answer,
  };
  results.push(rec);
  console.log(
    `[${q.id}] pass=${rec.pass} status=${rec.terminal_status} branch=${branch} drafted=${rec.drafted} len=${answer.length} used=${used} judg=${judgments.length} body=${judgBody.length} metaonly=${judgMetaOnly.length} statute_acq=${statuteAcquiredCount} ms=${rec.ms} ${failures.join(",")}`,
  );
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
  writeFileSync(
    `${OUT}/summary.json`,
    JSON.stringify(results.map(({ answer, ...r }) => r), null, 2),
  );
}

writeFileSync(`${OUT}/summary.json`, JSON.stringify(results.map(({ answer, ...r }) => r), null, 2));
console.log("done. pass=", results.filter((r) => r.pass).length, "/", results.length);
