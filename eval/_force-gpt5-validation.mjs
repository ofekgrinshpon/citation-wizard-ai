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
  const evalRunId = `force-gpt5-${label}-${randomUUID().slice(0,8)}`;
  const t0 = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
    method: "POST",
    headers: { "Content-Type":"application/json", Authorization:`Bearer ${jwt}`, apikey: ANON_KEY },
    body: JSON.stringify({
      question: q,
      taskMode: "research",
      depth: "deep",
      evalRunId,
      requestId: `eval:${evalRunId}`,
    })
  });
  const wall = Date.now() - t0;
  let bodyTxt = "";
  try { bodyTxt = await res.text(); } catch {}
  console.log(`\n=== ${label} HTTP=${res.status} wall=${wall}ms ===`);
  await new Promise(r => setTimeout(r, 3000));
  const { data: rows } = await admin.from("qa_logs")
    .select("id,answer,total_footnotes,metadata,created_at")
    .eq("user_id", ADMIN_USER_ID)
    .filter("metadata->>eval_run_id", "eq", evalRunId)
    .order("created_at", { ascending: false }).limit(1);
  const row = rows?.[0];
  if (!row) { console.log("NO QA_LOG ROW (stuck?)"); continue; }
  const md = row.metadata || {};
  const pu = md.profile_used || {};
  const mu = md.models_used || {};
  const cv = md.claim_verification || {};
  const dp = md.drafter_prompt || {};
  console.log({
    qa_log_id: row.id,
    depth: md.depth,
    drafter_variant_profile: pu.drafterVariant,
    drafter_variant_actual: md.drafting_path,
    drafter_model_used: mu.drafter,
    prompt_chars: dp.prompt_chars ?? md.drafter_prompt_chars ?? md.prompt_chars,
    size_guard_triggered: md.size_guard_triggered ?? md.drafter_size_guard ?? null,
    drafter_duration_ms: md.drafter_duration_ms,
    drafter_failure: md.drafter_failure || null,
    answer_len: row.answer?.length ?? 0,
    footnotes: row.total_footnotes,
    cards_in: md.cards_in ?? md.source_pack?.cards_in,
    cards_cited: md.cards_cited ?? md.source_pack?.cards_cited,
    unique_cards_cited_pct: md.unique_cards_cited_pct,
    unanchored_claims: md.unanchored_claims ?? md.qa_guard?.unanchored_claims,
    claim_verification_pct: cv.batches_total ? Math.round((cv.cards_evaluated / cv.cards_in) * 100) : null,
    cv_summary: cv,
    checkpoints: md.checkpoints,
    final_status: md.final_status || md.status,
  });
}
