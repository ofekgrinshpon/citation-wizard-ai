// Normal Deep validation for Pass D compact drafter (no force overrides).
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const { data: lnk } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const v = await anon.auth.verifyOtp({ token_hash: lnk.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const QUERIES = [
  { label: "Q1-injunction", q: "מהם התנאים למתן צו מניעה זמני?" },
  { label: "Q2-extortion",  q: "האם, ובאילו תנאים, הסדרה חקיקתית חלקית והישענות מרכזית על הדין הפלילי במאבק בתופעת סחיטת דמי חסות, עשויים להיחשב מחדל חקיקתי חלקי העולה כדי הפרה של החובה החיובית של המדינה להגן על הזכות החוקתית לחיים ולשלמות הגוף?" },
];

for (const { label, q } of QUERIES) {
  const evalRunId = `eval-passD-deep-${label}-${randomUUID().slice(0,8)}`;
  const t0 = Date.now();
  let httpStatus = null, gatewayKilled = false;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
      method: "POST",
      headers: { "Content-Type":"application/json", Authorization:`Bearer ${jwt}`, apikey: ANON_KEY },
      body: JSON.stringify({ question: q, taskMode:"research", depth:"deep", evalRunId, requestId:`eval:${evalRunId}` }),
    });
    httpStatus = res.status;
    try { await res.text(); } catch {}
  } catch (e) {
    gatewayKilled = true;
    console.log(`[${label}] fetch err: ${e.message}`);
  }
  const wall = Date.now() - t0;
  console.log(`\n=== ${label} HTTP=${httpStatus} wall=${wall}ms killed=${gatewayKilled} ===`);
  await new Promise(r => setTimeout(r, 4000));
  const { data: rows } = await admin.from("qa_logs")
    .select("id,answer,total_footnotes,metadata,created_at")
    .eq("user_id", ADMIN_USER_ID)
    .filter("metadata->>eval_run_id", "eq", evalRunId)
    .order("created_at", { ascending: false }).limit(1);
  const row = rows?.[0];
  if (!row) { console.log("NO QA_LOG ROW (gateway killed before final write)"); continue; }
  const md = row.metadata || {};
  const pdc = md.pass_d_compact || {};
  const mu = md.models_used || {};
  const cv = md.claim_verification || {};
  const stageRuns = (md.stage_runs || []).map(s => `${s.stage}:${s.status}/${s.duration_ms}ms`);
  console.log(JSON.stringify({
    qa_log_id: row.id,
    answer_present: !!row.answer, answer_len: row.answer?.length ?? 0,
    footnotes: row.total_footnotes,
    checkpoint: md.checkpoint || null,
    drafter_failure: md.drafter_failure || null,
    pass_d_used: pdc.used ?? false,
    pass_d: pdc,
    drafter_model: mu.drafter,
    drafting: mu.drafting,
    drafter_duration_ms: md.drafter_duration_ms,
    cards_in: md.cards_in ?? md.source_pack?.cards_in,
    cards_cited: md.cards_cited ?? md.source_pack?.cards_cited,
    cv_pct: cv.cards_in ? Math.round((cv.cards_evaluated / cv.cards_in) * 100) : null,
    stage_runs: stageRuns,
  }, null, 2));
}

// Final sweep
const { data: stuck } = await admin.from("qa_logs")
  .select("id, created_at, metadata->>checkpoint as cp")
  .eq("user_id", ADMIN_USER_ID).is("answer", null)
  .gt("created_at", new Date(Date.now() - 30*60*1000).toISOString());
console.log("\nStuck rows in last 30min:", stuck?.length || 0, stuck);
