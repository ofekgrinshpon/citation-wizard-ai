// docket_aware_url_dedup_v1 — validation runner.
// Same hardened contract as the suffvis runner (job_id polling, qa_logs by
// metadata->>run_id, placeholder rejection) plus rescue-specific reporting.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }
const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
const TERMINAL = new Set(["done", "error", "failed", "timeout", "completed"]);

const MAYA =
  `בסוגייה של חלוקת רכוש לאחר גירושי בני זוג, מה היא אמת המידה לביקורת שיפוטית של בג״ץ כאשר יש חשד שבית הדין הרבני הסתמך על שיקול חיצוני לדין האזרחי?`;

const ALL = [
  { id: "MAYA", query: MAYA },
  { id: "MAYA-BAVLI", query: `${MAYA} התייחסו להלכת בבלי.` },
  { id: "MAYA-AMIR", query: `${MAYA} התייחסו לעניין סימה אמיר.` },
  { id: "R02", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
  { id: "P02", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
  { id: "G08", query: `מה הפסיקה אומרת על מבחני המידתיות בביקורת חוקתית?` },
  { id: "NOISE", query: `מהי הביקורת האקדמית על הלכת השיתוף בדירת מגורים?` },
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

const OUT = "reports/docket-aware-dedup";
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
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,error,created_at,updated_at&id=eq.${job_id}&limit=1`,
    { headers });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
async function qaByRun(run_id: string, sinceIso: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,metadata` +
      `&metadata->>run_id=eq.${run_id}&created_at=gte.${encodeURIComponent(sinceIso)}` +
      `&order=created_at.desc&limit=5`, { headers });
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
/** Walk metadata for any object carrying rescue telemetry. */
function collectRescued(md: any): any[] {
  const out: any[] = [];
  const seen = new Set<any>();
  const walk = (n: any, depth: number) => {
    if (!n || typeof n !== "object" || depth > 8 || seen.has(n)) return;
    seen.add(n);
    if (!Array.isArray(n) && n.rescue_reason === "primary_authority_shape") {
      out.push({ title: n.title, url: n.url, rescued_as: n.rescued_as,
        original_classification: n.original_classification,
        original_query_role: n.original_query_role,
        matched_docket: n.rescue_matched_docket, matched_in: n.rescue_matched_in,
        admitted: n.admitted_to_candidate_pool ?? true });
    }
    for (const v of Array.isArray(n) ? n : Object.values(n)) walk(v, depth + 1);
  };
  walk(md, 0);
  return out;
}
const hasDocket = (hay: string, d: string) => hay.includes(d);

const results: any[] = [];

for (const q of QUERIES) {
  const t0 = Date.now();
  const launchIso = new Date(t0 - 5_000).toISOString();
  const t = await trigger(q.query).catch(() => ({} as any));
  console.log(`[${q.id}] launch job_id=${t.job_id} run_id=${t.run_id}`);
  if (!t.run_id || !t.job_id) {
    const rec = { id: q.id, query: q.query, pass: false, failures: ["trigger_failed"] };
    results.push(rec); writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
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

  let row: any = null; let placeholder_rows = 0;
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
  const gate = md.metadata_only_holding_gate ?? d.metadata_only_holding_gate ?? null;
  const pool = md.candidate_pool ?? md.pool ?? null;
  const integrity: any[] = pool?.integrity ?? md.integrity ?? [];
  const rescued = collectRescued(md);
  const verdicts: Record<string, number> = {};
  for (const v of (md.verifier?.results ?? md.verified ?? []) as any[]) {
    const k = String(v?.verdict ?? v?.relevance ?? "unknown");
    verdicts[k] = (verdicts[k] ?? 0) + 1;
  }
  const poolHay = JSON.stringify({ integrity, rescued, cands: pool?.candidates ?? [] });
  const judgments = usedSources.filter(isJudgment);
  const judgBody = judgments.filter(bodyAcquired);
  const judgMetaOnly = judgments.filter((s) => !bodyAcquired(s));

  const isStub = !!md.is_stub || answer.includes("STUB_ANSWER");
  const verifierFailed = !!d.verifier_call_failed || md.verifier_error != null;
  const cpuKill = /CPU|isolate|stale_worker/i.test(String(job?.error ?? ""));
  const drafted = d.drafted ?? (answer.length > 0 && usedSources.length > 0);

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
  if (q.id === "R02" && !(answer.includes("6821/93") || answer.includes("המזרחי"))) failures.push("r02_missing_exact_body");

  const rec = {
    id: q.id, query: q.query, job_id: t.job_id, run_id: t.run_id, ms: Date.now() - t0,
    terminal_status: job?.status ?? "none", job_error: job?.error ?? null,
    last_stage: job?.current_stage ?? null, placeholder_rows_rejected: placeholder_rows,
    branch, drafted: !!drafted, answer_length: answer.length,
    admitted_sources_count: integrity.length,
    rescued_count: rescued.length, rescued,
    amir_8638_03_in_pool: hasDocket(poolHay, "8638/03"),
    amir_8638_03_used: usedSources.some((s: any) => String(s.title ?? "").includes("8638/03")),
    bavli_1000_92_in_pool: hasDocket(poolHay, "1000/92"),
    bavli_1000_92_used: usedSources.some((s: any) => String(s.title ?? "").includes("1000/92")) ||
      answer.includes("1000/92"),
    dedupe: (() => {
      const ud = pool?.url_dedupe ?? {};
      const drops: any[] = pool?.drops ?? [];
      const dupUrl = drops.filter((x) => x.drop_reason === "dup_url");
      const supremeKeys = new Set<string>();
      for (const c of (pool?.candidates ?? integrity ?? [])) {
        const u = String((c as any).url ?? (c as any).source_url ?? "");
        if (/supremedecisions\.court\.gov\.il/i.test(u)) supremeKeys.add(u.toLowerCase());
      }
      return {
        identity_source_counts: ud.identity_source_counts ?? null,
        rescued_from_legacy_collapse: ud.rescued_from_legacy_collapse ?? null,
        identity_rows: (ud.rows ?? []).length,
        dup_url_drops: dupUrl.length,
        dup_url_drop_keys: dupUrl.map((x: any) => x.drop_key),
        distinct_supreme_pdfs_admitted: supremeKeys.size,
        pool_found: pool?.found ?? null,
        pool_after_dedup: pool?.after_dedup ?? null,
      };
    })(),
    verdict_distribution: verdicts,
    used_sources_count: usedSources.length, footnotes_count: fns.length,
    judgments_cited: judgments.length, body_acquired_judgments: judgBody.length,
    metadata_only_judgments: judgMetaOnly.length,
    metadata_only_titles: judgMetaOnly.map((s) => s.title),
    used_source_titles: usedSources.map((s: any) => ({
      title: s.title, url: s.url ?? s.source_url ?? null, citable_as: s.citable_as,
      text_usability: s.text_usability ?? s.final_text_usability ?? null })),
    is_stub: isStub, verifier_failed: verifierFailed, cpu_kill: cpuKill,
    pass: failures.length === 0, failures, answer,
  };
  results.push(rec);
  console.log(`[${q.id}] pass=${rec.pass} status=${rec.terminal_status} branch=${branch} used=${usedSources.length} rescued=${rescued.length} amir=${rec.amir_8638_03_in_pool} bavli=${rec.bavli_1000_92_in_pool} metaonly=${judgMetaOnly.length} ms=${rec.ms} ${failures.join(",")}`);
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(results.map(({ answer, ...r }) => r), null, 2));
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(results.map(({ answer, ...r }) => r), null, 2));
console.log("done. pass=", results.filter((r) => r.pass).length, "/", results.length);
