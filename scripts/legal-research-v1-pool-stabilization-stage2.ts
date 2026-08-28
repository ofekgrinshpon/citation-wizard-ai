// doctrinal_candidate_pool_stabilization_v1 — Stage 2 live smoke + variance.
// Sequence: B8, D1 (mini smoke) → B8#2, D1#2 (variance) → P02 + R02 (safety).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
const TERMINAL = new Set(["done", "error", "failed", "timeout", "completed"]);
const OUT = "reports/doctrinal-pool-stabilization";
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const Q = {
  B8: `אני כותב פרק אקדמי על חוק יסוד: ישראל – מדינת הלאום של העם היהודי. מהם קווי הביקורת המרכזיים בספרות המשפטית, ואילו מקורות דוקטרינריים מרכזיים כדאי לקרוא?`,
  D1: `מהם מבחני המידתיות בביקורת חוקתית בישראל, וכיצד הם מיושמים כאשר חוק פוגע בזכות יסוד?`,
  P02: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?`,
  R02: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?`,
};

const STAGE3 = [
  { id: "ACADEMIC", q: `אני כותב סמינריון על עילת הסבירות במשפט המנהלי — אילו מקורות מרכזיים כדאי לקרוא?` },
  { id: "NATION-STATE-ACADEMIC", q: `כיצד מנתחת הספרות האקדמית את חוק יסוד: ישראל – מדינת הלאום של העם היהודי ואת שאלת הזהות החוקתית?` },
  { id: "PAYWALL", q: `מה נכתב במאמרים בכתב העת "עיוני משפט" על תורת הפרשנות התכליתית של אהרן ברק?` },
  { id: "MMM", q: `מה עולה ממחקרי מרכז המחקר והמידע של הכנסת ומדוחות רגולטוריים בנוגע לאכיפת חוקי עבודה בישראל?` },
  { id: "B8-DOCTRINE", q: `מהי דוקטרינת ההבטחה המנהלית?` },
  { id: "D1-SWEEP", q: `מהם מבחני המידתיות בביקורת חוקתית בישראל, וכיצד יישם אותם בית המשפט העליון?` },
  { id: "D3", q: `מה הדין לגבי פיטורי עובדת בהיריון, ומהו היקף ההגנה?` },
  { id: "DARKPATTERNS", q: `מהי הגישה המשפטית והאקדמית ל"דפוסים אפלים" (dark patterns) בהגנת הצרכן, ואילו מקורות מחקריים דנים בכך?` },
  { id: "R02", q: Q.R02 },
  { id: "P02", q: Q.P02 },
];

const D1_ONLY = [
  { id: "D1-DIAG", q: `מהם מבחני המידתיות בביקורת חוקתית בישראל, וכיצד יישם אותם בית המשפט העליון?` },
];

const RUNS = (process.env.STAGE2_PHASE === "d1"
  ? D1_ONLY
  : process.env.STAGE2_PHASE === "3"
  ? STAGE3
  : process.env.STAGE2_PHASE === "2"
  ? [
    { id: "B8-2", q: Q.B8 },
    { id: "D1-2", q: Q.D1 },
    { id: "P02", q: Q.P02 },
    { id: "R02", q: Q.R02 },
  ]
  : [
    { id: "B8-1", q: Q.B8 },
    { id: "D1-1", q: Q.D1 },
  ]);

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
const isPlaceholder = (row: any) => {
  const a = String(row?.answer ?? "");
  const md = row?.metadata ?? {};
  return md.trace_status === "in_progress" || md.status === "running" || !a.trim();
};

const results: any[] = [];
for (const run of RUNS) {
  const t0 = Date.now();
  const since = new Date(t0 - 5_000).toISOString();
  const t = await trigger(run.q).catch(() => ({} as any));
  console.log(`[${run.id}] job=${t.job_id} run=${t.run_id}`);
  if (!t.job_id || !t.run_id) {
    results.push({ id: run.id, pass: false, failures: ["trigger_failed"] });
    continue;
  }
  let job: any = null;
  const deadline = Date.now() + 900_000;
  while (Date.now() < deadline) {
    job = await jobById(t.job_id);
    if (job && TERMINAL.has(String(job.status))) break;
    console.log(
      `[${run.id}] ${Math.round((Date.now() - t0) / 1000)}s ${job?.status}/${job?.current_stage}`,
    );
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
  const stab = d.candidate_pool_stabilization ?? null;
  const branch = d.deterministic_branch ?? md.deterministic_branch ?? null;
  const secondary = md.secondary_body_acquisition ?? null;

  const failures: string[] = [];
  if (!job || !TERMINAL.has(String(job.status))) failures.push("job_not_terminal");
  if (!answer.trim()) failures.push("empty_answer");
  if (run.id === "P02" && branch !== "docket_limitation") failures.push("p02_refusal_lost");
  if (run.id === "R02" && !(answer.includes("6821/93") || answer.includes("המזרחי"))) {
    failures.push("r02_missing_exact_body");
  }
  if (run.id.startsWith("B8") || run.id.startsWith("D1")) {
    if (branch === "insufficient_sources_limitation") failures.push("insufficiency_branch");
    if ((stab?.snapshot_after?.doctrinal_eligible ?? 0) < 1) failures.push("below_eligibility_floor");
  }

  const rec = {
    id: run.id,
    run_id: t.run_id,
    job_id: t.job_id,
    ms: Date.now() - t0,
    status: job?.status,
    branch,
    answer_length: answer.length,
    footnotes: fns.length,
    stabilization: stab,
    secondary_acquisition: secondary
      ? {
        acquired: secondary.acquired_candidate_ids?.length ?? 0,
        listing_suppressed: secondary.listing_suppressed ?? 0,
        reconsidered: secondary.reconsidered_candidate_ids?.length ?? 0,
        web_attempts: secondary.web_attempts,
        stop_reason: secondary.stage_stop_reason,
      }
      : null,
    pass: failures.length === 0,
    failures,
    answer,
  };
  results.push(rec);
  writeFileSync(`${OUT}/stage2-${run.id}.json`, JSON.stringify(rec, null, 2));
  console.log(
    `[${run.id}] ${rec.pass ? "PASS" : "FAIL"} branch=${branch} fns=${fns.length} ` +
      `elig=${stab?.snapshot_before?.doctrinal_eligible}->${stab?.snapshot_after?.doctrinal_eligible} ` +
      `recovery=${stab?.recovery?.ran}:${stab?.recovery?.reason} ${rec.failures.join(",")}`,
  );
}
writeFileSync(
  `${OUT}/stage2-SUMMARY-${process.env.STAGE2_PHASE ?? "1"}.json`,
  JSON.stringify(
    results.map((r) => ({
      id: r.id,
      pass: r.pass,
      failures: r.failures,
      branch: r.branch,
      footnotes: r.footnotes,
      recovery: r.stabilization?.recovery ?? null,
      snapshot_before: r.stabilization?.snapshot_before ?? null,
      snapshot_after: r.stabilization?.snapshot_after ?? null,
    })),
    null,
    2,
  ),
);
console.log("stage2 phase done");
