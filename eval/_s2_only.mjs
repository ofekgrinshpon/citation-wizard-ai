import { createClient } from "@supabase/supabase-js";
const URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY;
const EMAIL = "ofekgrinshpon@gmail.com";
const UID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

const TAG = "S2";
const Q = "מהי דרישת מיצוי ההליכים והסעד החלופי בעתירה לבג\"ץ?";

const admin = createClient(URL, SR, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const submitTs = new Date().toISOString();
const t0 = Date.now();
const ctl = new AbortController();
const timer = setTimeout(() => ctl.abort(), 290_000);
try {
  await fetch(`${URL}/functions/v1/legal-qa`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON },
    body: JSON.stringify({ question: Q, taskMode: "research", depth: "deep" }),
    signal: ctl.signal,
  }).then((r) => r.json().catch(() => null));
} catch (_e) {}
clearTimeout(timer);

let row = null;
for (let k = 0; k < 90; k++) {
  await new Promise((r) => setTimeout(r, 4000));
  const { data: rows } = await admin.from("qa_logs")
    .select("id,answer,footnotes,metadata,created_at,question")
    .eq("user_id", UID)
    .gte("created_at", submitTs)
    .order("created_at", { ascending: false })
    .limit(5);
  const match = rows?.find((r) => r.question === Q);
  const pu = match?.metadata?.pipeline_used;
  if (match && pu && pu !== "core_running") { row = match; break; }
}
const wall = Date.now() - t0;
if (!row) { console.log(JSON.stringify({ tag: TAG, wall, error: "no_completion" })); process.exit(0); }
const md = row.metadata || {};
const core = md.core || {};
const ans = row.answer || "";
const fns = row.footnotes || [];
const cq = core.citation_quality || {};
const ledger = core.ledger || {};
const removed = cq.removed_citations || [];
const supportedClaims = (ledger.entries || []).filter((e) => e.status === "supported").length;

const summary = {
  tag: TAG,
  qa_id: row.id,
  wall,
  pipeline_used: md.pipeline_used,
  cq_status: cq.status,
  supported_claims: supportedClaims,
  footnotes_count: fns.length,
  answer_len: ans.length,
  removed_citations: removed.length,
  removed_reasons: removed.map((r) => r.reason),
  claims_lost: (cq.claims_lost_all_support || []).length,
  citation_summary: cq.citation_summary,
  core_last_stage: md.core_last_stage,
  core_fallback_reason: md.core_fallback_reason ?? null,
};
console.log(JSON.stringify(summary, null, 2));

// Find C4 sources specifically (or any approved_web direct sources)
const c4Sources = [];
for (const e of (ledger.entries || [])) {
  for (const s of (e.sources || [])) {
    if (s.origin === "approved_web" && s.support === "direct") {
      const survived = !removed.find((r) => r.ls_id === s.ls_id);
      c4Sources.push({ claim: e.claim_id, ls_id: s.ls_id, url: s.url, source_type: s.source_type, survived });
    }
  }
}
console.log("\napproved_web direct sources:");
console.log(JSON.stringify(c4Sources, null, 2));
