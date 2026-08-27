// claim_source_rebinding_v1 — Stage 2 mini live smoke (3 runs only).
// B8 (canonical quote control), NATION-STATE-ACADEMIC (rebinding upside),
// P02 (safety control: fabricated docket must still refuse).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
const TERMINAL = new Set(["done", "error", "failed", "timeout", "completed"]);
const OUT = "reports/claim-source-rebinding";
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const B8_CANON =
  "זכויות היסוד של האדם בישראל מושתתות על ההכרה בערך האדם, בקדושת חייו ובהיותו בן-חורין, והן יכובדו ברוח העקרונות שבהכרזה על הקמת מדינת ישראל.";

const QUERIES = [
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
  {
    id: "NATION-STATE-ACADEMIC",
    query:
      `אני כותב עבודה סמינריונית על חוק יסוד: ישראל – מדינת הלאום של העם היהודי. מהם הקווים המרכזיים בביקורת האקדמית והפסיקתית על החוק, ואילו מקורות מרכזיים כדאי לקרוא?`,
  },
  { id: "P02", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
];

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
async function jobById(id: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,error&id=eq.${id}&limit=1`,
    { headers },
  );
  const rows = r.ok ? await r.json() : [];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}
async function qaByRun(run_id: string, sinceIso: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,metadata` +
      `&metadata->>run_id=eq.${run_id}&created_at=gte.${encodeURIComponent(sinceIso)}` +
      `&order=created_at.desc&limit=5`,
    { headers },
  );
  const rows = r.ok ? await r.json() : [];
  return Array.isArray(rows) ? rows : [];
}
function isPlaceholder(row: any) {
  const a = String(row?.answer ?? "");
  const md = row?.metadata ?? {};
  return md.trace_status === "in_progress" || md.status === "running" || !a.trim();
}

const results: any[] = [];
for (const q of QUERIES) {
  const t0 = Date.now();
  const since = new Date(t0 - 5_000).toISOString();
  const t = await trigger(q.query).catch(() => ({} as any));
  console.log(`[${q.id}] job=${t.job_id} run=${t.run_id}`);
  if (!t.job_id || !t.run_id) {
    results.push({ id: q.id, pass: false, failures: ["trigger_failed"] });
    continue;
  }
  let job: any = null;
  const deadline = Date.now() + 900_000;
  while (Date.now() < deadline) {
    job = await jobById(t.job_id);
    if (job && TERMINAL.has(String(job.status))) break;
    console.log(`[${q.id}] ${Math.round((Date.now() - t0) / 1000)}s ${job?.status}/${job?.current_stage}`);
    await sleep(10_000);
  }
  let row: any = null;
  for (let i = 0; i < 6 && !row; i++) {
    row = (await qaByRun(t.run_id, since)).find((r: any) => !isPlaceholder(r)) ?? null;
    if (!row) await sleep(5_000);
  }
  const md = row?.metadata ?? {};
  const d = md.drafter ?? {};
  const answer: string = row?.answer ?? d.answer_markdown ?? "";
  const fns: any[] = row?.footnotes ?? d.footnotes ?? [];
  const csm = d.claim_source_match ?? md.claim_source_match ?? null;
  const reb = csm?.rebinding ?? null;
  const branch = d.deterministic_branch ?? md.deterministic_branch ?? null;

  const failures: string[] = [];
  if (!job || !TERMINAL.has(String(job.status))) failures.push("job_not_terminal");
  if (!answer.trim()) failures.push("empty_answer");
  if (q.id === "B8" && answer && !answer.includes(B8_CANON)) failures.push("b8_quote_changed");
  if (q.id === "P02" && branch !== "docket_limitation") failures.push("p02_refusal_lost");

  const rec = {
    id: q.id,
    run_id: t.run_id,
    job_id: t.job_id,
    ms: Date.now() - t0,
    status: job?.status,
    branch,
    answer_length: answer.length,
    footnotes: fns.length,
    rebinding: reb,
    claim_source_match: csm
      ? {
        source_ref_mismatch_count: csm.source_ref_mismatch_count,
        unsupported_block_count: csm.unsupported_block_count,
        limitation_added: csm.limitation_added,
        dropped_source_refs: csm.dropped_source_refs,
        authority_overstatements: csm.authority_overstatements,
      }
      : null,
    pass: failures.length === 0,
    failures,
    answer,
  };
  results.push(rec);
  writeFileSync(`${OUT}/stage2-${q.id}.json`, JSON.stringify(rec, null, 2));
  console.log(
    `[${q.id}] ${rec.pass ? "PASS" : "FAIL"} fns=${fns.length} reb=${JSON.stringify(reb && {
      e: reb.bound_exact, f: reb.bound_facet, t: reb.bound_topical,
      a: reb.bound_area_direct, u: reb.unbound, rescued: reb.rebound_ref_count,
      capped: reb.capped_ref_count,
    })} ${rec.failures.join(",")}`,
  );
}
writeFileSync(`${OUT}/stage2-SUMMARY.json`, JSON.stringify(
  results.map((r) => ({ id: r.id, pass: r.pass, failures: r.failures, footnotes: r.footnotes, rebinding: r.rebinding })),
  null,
  2,
));
console.log("stage2 done");
