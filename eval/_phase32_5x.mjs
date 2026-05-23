// Phase 3.2 5× regression — reads from metadata.core.source_requirements
// Schema:
//   .plan.{per_claim, mandatory_roles, triggered_doctrines}
//   .injection.{totals, records[]}
//   .reconciliation.{totals, per_role[]}
//   .inject_flag, .protect_flag
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY;
const EMAIL = "ofekgrinshpon@gmail.com";
const UID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";
const Q = "האם כישלון מערכתי באכיפת עבירת גביית דמי חסות (פרוטקשן) יכולה להוות מחדל חקיקתי חלקי בהגנה על הזכות לחיים וביטחון?";

const admin = createClient(URL, SR, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

function summarizeRole(roleId, inj, rec) {
  const i = (inj.records || []).find((r) => r.role_id === roleId) || {};
  const r = (rec.per_role || []).find((r) => r.role_id === roleId) || {};
  return {
    role_id: roleId,
    kind: i.kind ?? r.kind,
    tried_local: i.tried_local,
    tried_vector: i.tried_vector,
    tried_exact_authority: i.tried_exact_authority,
    tried_web: i.tried_web,
    local_hit_count: i.local_hit_count,
    vector_hit_count: i.vector_hit_count,
    exact_hit_count: i.exact_hit_count,
    web_hit_count: i.web_hit_count,
    injected_candidate_ids: i.injected_candidate_ids,
    protected_candidate_id: i.protected_candidate_id,
    protected_slot_used: i.protected_slot_used,
    reached_verifier: r.reached_verifier,
    missing_before_verifier: r.missing_before_verifier ?? i.missing_before_verifier,
    missing_reason: r.missing_reason,
    verifier_verdicts: r.verifier_verdicts,
  };
}

async function runOne(i) {
  const submitTs = new Date().toISOString();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 290_000);
  try {
    await fetch(`${URL}/functions/v1/legal-qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON },
      body: JSON.stringify({ question: Q, taskMode: "research", depth: "deep" }),
      signal: ctl.signal,
    }).then((r) => r.text().catch(() => null));
  } catch (_e) {}
  clearTimeout(timer);

  let row = null;
  for (let k = 0; k < 90; k++) {
    await new Promise((r) => setTimeout(r, 4000));
    const { data: rows } = await admin.from("qa_logs")
      .select("id,total_footnotes,metadata,question,created_at")
      .eq("user_id", UID)
      .gte("created_at", submitTs)
      .order("created_at", { ascending: false })
      .limit(5);
    const match = rows?.find((r) => r.question === Q);
    const pu = match?.metadata?.pipeline_used;
    if (match && pu && pu !== "core_running") { row = match; break; }
  }
  if (!row) { console.log(`Run ${i}: NO_COMPLETION`); return; }

  const md = row.metadata || {};
  const core = md.core || {};
  const sr = core.source_requirements || {};
  const plan = sr.plan || {};
  const inj = sr.injection || {};
  const rec = sr.reconciliation || {};
  const cq = core.citation_quality || md.citation_quality || {};

  const roleIds = [...new Set([
    ...(plan.mandatory_roles || []).map((x) => x.role_id),
    ...(inj.records || []).map((x) => x.role_id),
    ...(rec.per_role || []).map((x) => x.role_id),
  ])];

  const out = {
    run: i,
    qa_log_id: row.id,
    pipeline_used: md.pipeline_used,
    profile_depth: md.profile_used?.depth ?? core.profile?.depth,
    sr_exists: !!core.source_requirements,
    inject_flag: sr.inject_flag,
    protect_flag: sr.protect_flag,
    triggered_doctrines: plan.triggered_doctrines,
    roles_generated: (plan.mandatory_roles || []).map((r) => ({ role_id: r.role_id, kind: r.kind, label: r.label })),
    injection_totals: inj.totals,
    reconciliation_totals: rec.totals,
    per_role: roleIds.map((rid) => summarizeRole(rid, inj, rec)),
    final: {
      citation_quality_status: cq.status,
      core_failed: core.failed || md.core_failed || false,
      claims_lost_all_support: cq.claims_lost_all_support,
      footnotes_count: row.total_footnotes,
    },
  };
  console.log(`\n========== RUN ${i} ==========`);
  console.log(JSON.stringify(out, null, 2));
}

const N = parseInt(process.env.N || "5", 10);
for (let i = 1; i <= N; i++) await runOne(i);
