// footnote_rendering_invariant_v1 — validation runner.
// Checks marker ↔ footnote-row 1:1 correspondence on live runs, plus the
// existing regression guards (B8 byte-identical quote, P02 refusal, R02 body,
// no stubs / CPU kills / verifier failures).
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
  { id: "F01", query: `מה נטל ההוכחה בעתירות לבג״ץ? על מי מוטל הנטל? על העותר תמיד?` },
  { id: "F02", query: `בסוגייה של חלוקת רכוש לאחר גירושי בני זוג, מה היא אמת המידה לביקורת שיפוטית של בג״ץ כאשר יש חשד שבית הדין הרבני הסתמך על שיקול חיצוני לדין האזרחי?` },
  { id: "F05", query: `מה קובע סעיף 6 לחוק החברות, תשנ"ט-1999 בעניין הרמת מסך?` },
  { id: "F06", query: `מהו היקף חובת תום הלב במשא ומתן לפי סעיף 12 לחוק החוזים (חלק כללי)?` },
  { id: "N02", query: `מהי עילת הסבירות במשפט המינהלי הישראלי?` },
  { id: "R02", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
  { id: "P02", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
  { id: "F07", query: `מהם מבחני המידתיות בביקורת חוקתית בישראל?` },
];
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const QUERIES = only.length ? ALL.filter((q) => only.includes(q.id)) : ALL;

const B8_CANON =
  "זכויות היסוד של האדם בישראל מושתתות על ההכרה בערך האדם, בקדושת חייו ובהיותו בן-חורין, והן יכובדו ברוח העקרונות שבהכרזה על הקמת מדינת ישראל.";

const OUT = "reports/pdf-preemption";
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SUP_MAP: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};
const RUN_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu;

function markersIn(answer: string, valid: Set<number>) {
  const found: number[] = [];
  let dangling = 0;
  for (const m of answer.matchAll(RUN_RE)) {
    const digits = m[0].split("").map((c) => SUP_MAP[c] ?? c).join("");
    let i = 0;
    while (i < digits.length) {
      let matched = -1;
      let len = 1;
      for (let l = Math.min(digits.length - i, 4); l >= 1; l--) {
        const n = parseInt(digits.slice(i, i + l), 10);
        if (Number.isFinite(n) && valid.has(n)) { matched = n; len = l; break; }
      }
      if (matched > 0) found.push(matched); else dangling++;
      i += len;
    }
  }
  return { found, dangling };
}

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
    `${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,error&id=eq.${job_id}&limit=1`,
    { headers },
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

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
    const rec = { id: q.id, pass: false, failures: ["trigger_failed"] };
    results.push(rec);
    writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
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
  if (terminal) {
    for (let i = 0; i < 6 && !row; i++) {
      const rows = await qaByRun(t.run_id, launchIso);
      row = rows.find((r: any) => !isPlaceholder(r)) ?? null;
      if (!row) await sleep(5_000);
    }
  }

  const md: any = row?.metadata ?? {};
  const d: any = md.drafter ?? {};
  const answer: string = (row?.answer ?? d.answer_markdown ?? "") as string;
  const fns: any[] = (row?.footnotes ?? d.footnotes ?? []) as any[];
  const usedSources: any[] = d.used_sources ?? [];
  const report = d.footnote_render_report ?? md.footnote_render_report ?? null;
  const branch = d.deterministic_branch ?? md.deterministic_branch ?? null;
  const csm = d.claim_source_match ?? md.claim_source_match ?? null;
  // large_pdf_extraction_preemption_v1 telemetry
  const sc: any = md.limitation?.specific_case ?? md.specific_case ?? d.specific_case ?? {};
  const preflight = {
    exact_case_source_found: sc.exact_case_source_found ?? null,
    exact_case_body_unavailable: sc.exact_case_body_unavailable ?? null,
    body_unavailable_reason: sc.body_unavailable_reason ?? null,
    extraction_skipped_reason: sc.extraction_skipped_reason ?? null,
    large_pdf_skipped: sc.large_pdf_skipped ?? null,
    pdf_preflight_size: sc.pdf_preflight_size ?? null,
    pdf_preflight_decision: sc.pdf_preflight_decision ?? null,
    text_endpoint_attempted: sc.text_endpoint_attempted ?? null,
    text_endpoint_stub_detected: sc.text_endpoint_stub_detected ?? null,
    derived_url_resolved: sc.derived_url_resolved ?? null,
    acquisition_success: sc.acquisition_success ?? null,
  };
  const phase = md.phase ?? null;

  const valid = new Set<number>(fns.map((f: any) => Number(f.number)));
  const { found, dangling } = markersIn(answer, valid);
  const markerSet = new Set(found);
  const maxMarker = found.length ? Math.max(...found) : 0;
  const orphanRows = fns.filter((f: any) => !markerSet.has(Number(f.number))).length;
  const compoundRows = fns.filter((f: any) => Array.isArray(f.sources) && f.sources.length > 1).length;

  const isStub = !!md.is_stub || answer.includes("STUB_ANSWER");
  const verifierFailed = !!d.verifier_call_failed || md.verifier_error != null;
  const cpuKill = /CPU|isolate|stale_worker/i.test(String(job?.error ?? ""));

  const failures: string[] = [];
  if (!terminal) failures.push("job_not_terminal_or_stale");
  if (terminal && !row) failures.push("no_terminal_qa_row");
  if (!String(answer).trim()) failures.push("empty_answer_body");
  if (dangling > 0) failures.push("dangling_marker");
  if (orphanRows > 0) failures.push("orphan_source_row");
  if (fns.length > 0 && maxMarker !== fns.length) failures.push("invariant_max_marker_mismatch");
  if (report && report.invariant_passed === false) failures.push("builder_invariant_failed");
  if (isStub) failures.push("stub_answer");
  if (verifierFailed) failures.push("verifier_failure");
  if (cpuKill) failures.push("cpu_kill");
  if (q.id === "B8" && answer && !answer.includes(B8_CANON)) failures.push("b8_canonical_quote_changed");
  if (q.id === "P02" && branch !== "docket_limitation") failures.push("p02_not_deterministic_docket_refusal");
  if (q.id === "R02") {
    if (!(answer.includes("6821/93") || answer.includes("המזרחי"))) {
      failures.push("r02_missing_exact_docket_reference");
    }
    // Acceptable outcomes: real body, or the precise body-unavailable
    // limitation. A generic reaper interruption is a failure.
    if (phase === "retrieval_cpu_guard" || /interrupted/i.test(String(branch ?? ""))) {
      failures.push("r02_generic_interruption");
    }
  }
  if (/interrupted/i.test(String(md.limitation?.reason ?? ""))) failures.push("retrieval_interrupted");

  const rec = {
    id: q.id,
    query: q.query,
    job_id: t.job_id,
    run_id: t.run_id,
    ms: Date.now() - t0,
    terminal_status: job?.status ?? "none",
    job_error: job?.error ?? null,
    branch,
    answer_length: answer.length,
    inline_marker_count: found.length,
    distinct_markers: markerSet.size,
    max_marker: maxMarker,
    footnotes_length: fns.length,
    used_sources_length: usedSources.length,
    dangling_marker_count: dangling,
    orphan_source_row_count: orphanRows,
    compound_footnote_rows: compoundRows,
    invariant_passed: failures.filter((f) => f.startsWith("dangling") || f.startsWith("orphan") || f.startsWith("invariant")).length === 0,
    builder_report: report,
    claim_source_match: csm,
    phase,
    preflight,
    pass: failures.length === 0,
    failures,
    footnote_rows: fns.map((f: any) => ({
      number: f.number,
      title: f.title,
      sub_sources: Array.isArray(f.sources) ? f.sources.length : 0,
    })),
    answer,
  };
  results.push(rec);
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
  console.log(
    `[${q.id}] ${rec.pass ? "PASS" : "FAIL"} markers=${found.length} max=${maxMarker} fns=${fns.length} used=${usedSources.length} dangling=${dangling} orphan=${orphanRows} ${rec.failures.join(",")}`,
  );
}

writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(results.map((r) => ({
  id: r.id, pass: r.pass, failures: r.failures, phase: r.phase, preflight: r.preflight, max_marker: r.max_marker,
  footnotes_length: r.footnotes_length, used_sources_length: r.used_sources_length,
  dangling: r.dangling_marker_count, orphan: r.orphan_source_row_count,
})), null, 2));
console.log("done");
