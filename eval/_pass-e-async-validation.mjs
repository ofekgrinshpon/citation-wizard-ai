// Pass E validation: Deep async + polling, Fast still sync.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const { data: lnk } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const v = await anon.auth.verifyOtp({ token_hash: lnk.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const QUERIES = [
  { label: "Q1-injunction-deep", depth: "deep", q: "מהם התנאים למתן צו מניעה זמני?" },
  { label: "Q2-extortion-deep", depth: "deep", q: "האם, ובאילו תנאים, הסדרה חקיקתית חלקית והישענות מרכזית על הדין הפלילי במאבק בתופעת סחיטת דמי חסות, עשויים להיחשב מחדל חקיקתי חלקי העולה כדי הפרה של החובה החיובית של המדינה להגן על הזכות החוקתית לחיים ולשלמות הגוף?" },
  { label: "Q1-injunction-fast", depth: "fast", q: "מהם התנאים למתן צו מניעה זמני?" },
];

async function poll(runId, jwt, maxMs = 240000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < maxMs) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
      body: JSON.stringify({ runId }),
    });
    last = await res.json();
    process.stdout.write(`  [poll t=${((Date.now()-start)/1000).toFixed(0)}s] status=${last.status} cp=${last.checkpoint} stages=${last.progress?.stages_completed} last=${last.progress?.last_stage}\n`);
    if (last.status === "completed" || last.status === "failed") return { ...last, poll_wall_ms: Date.now() - start };
    await new Promise(r => setTimeout(r, 4000));
  }
  return { ...last, poll_wall_ms: Date.now() - start, timed_out_polling: true };
}

for (const { label, depth, q } of QUERIES) {
  console.log(`\n=== ${label} depth=${depth} ===`);
  const evalRunId = `eval-passE-${label}-${randomUUID().slice(0,6)}`;
  const t0 = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
    body: JSON.stringify({ question: q, taskMode: "research", depth, evalRunId, requestId: `eval:${evalRunId}` }),
  });
  const initialMs = Date.now() - t0;
  const initialJson = await res.json();
  console.log(`initial HTTP=${res.status} in ${initialMs}ms → ${JSON.stringify(initialJson).slice(0,200)}`);

  if (depth === "deep") {
    if (res.status !== 202 || !initialJson.run_id) {
      console.log("UNEXPECTED: Deep did not return 202+run_id");
      continue;
    }
    const final = await poll(initialJson.run_id, jwt);
    const pdc = final.metadata_summary?.pass_d_compact || {};
    const mu = final.metadata_summary?.models_used || {};
    console.log(JSON.stringify({
      status: final.status,
      checkpoint: final.checkpoint,
      poll_wall_ms: final.poll_wall_ms,
      answer_len: final.answer?.length ?? 0,
      total_footnotes: final.total_footnotes ?? 0,
      pass_d_used: pdc.used ?? false,
      pass_d_prompt_before: pdc.prompt_chars_before,
      pass_d_prompt_after: pdc.prompt_chars_after,
      pass_d_trim: pdc.trim_level_applied,
      pass_d_ledger_claims: pdc.ledger_claims_included,
      pass_d_source_cards: pdc.source_cards_included,
      drafter_model: mu.drafter,
      drafting: mu.drafting,
      drafter_failure: final.drafter_failure,
      stages: (final.metadata_summary?.stage_runs || []).map(s => `${s.stage}:${s.status}/${s.duration_ms}ms`),
    }, null, 2));
  } else {
    // Fast: should be synchronous, full body in response
    console.log(`Fast keys: ${Object.keys(initialJson).join(",")}`);
    console.log(`Fast answer_len=${initialJson.answer?.length ?? 0} footnotes=${initialJson.footnotes?.length ?? 0}`);
  }
}

// Final sweep
const { data: stuck } = await admin.from("qa_logs")
  .select("id, created_at, metadata->>checkpoint as cp, metadata->>async_run as ar")
  .is("answer", null)
  .gt("created_at", new Date(Date.now() - 30*60*1000).toISOString());
console.log("\nStuck rows (no answer) in last 30min:", stuck?.length || 0);
if (stuck?.length) console.log(stuck);
