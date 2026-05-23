import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const Q = "מהי עילת הסבירות ומה היקף הביקורת השיפוטית עליה?";
const evalRunId = `q7valid-${randomUUID().slice(0, 6)}`;
const startTs = new Date(Date.now() - 60000).toISOString();
console.log("eid=", evalRunId);

const ctrl = new AbortController();
const to = setTimeout(() => ctrl.abort(), 180000);
const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
  body: JSON.stringify({ question: Q, taskMode: "research", depth: "deep", evalRunId, requestId: `eval:${evalRunId}` }),
  signal: ctrl.signal,
}).catch(e => ({ ok: false, err: e.message }));
clearTimeout(to);
console.log("submit status=", r.status, "ok=", r.ok);

// Poll qa_logs
let row = null;
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const { data } = await admin.from("qa_logs")
    .select("id,created_at,answer,footnotes,metadata")
    .gte("created_at", startTs)
    .order("created_at", { ascending: false })
    .limit(20);
  row = (data || []).find(x => x.metadata?.eval_run_id === evalRunId)
     || (data || []).find(x => x.question === Q);
  console.log(`t=${(i+1)*5}s rows=${data?.length||0} match=${!!row}`);
  if (row) break;
}
if (!row) { console.log("NO ROW"); process.exit(1); }

const m = row.metadata || {};
const core = m.core || {};
const sr = m.source_requirements || {};
const dc = m.doctrine_classifier || m.doctrineClassifier || {};
const cq = m.citation_quality || core.citation_quality || {};

const out = {
  qa_log_id: row.id,
  pipeline_used: m.pipeline_used || m.pipeline || core.version,
  doctrine_classifier_doctrines: dc.doctrines || dc.classification?.doctrines,
  sr_triggered_doctrines: sr.triggered_doctrines || sr.plan?.triggered_doctrines,
  sr_mandatory_roles: (sr.mandatory_roles || sr.plan?.mandatory_roles || []).map(r => ({
    role_id: r.role_id, doctrine_id: r.doctrine_id, kind: r.kind, label: r.label,
    canonical_queries: r.canonical_queries,
  })),
  sr_injection_records: (sr.injection_records || sr.records || []).map(r => ({
    role_id: r.role_id, doctrine_id: r.doctrine_id,
    local_hit_count: r.local_hit_count, vector_hit_count: r.vector_hit_count,
    exact_hit_count: r.exact_hit_count, web_hit_count: r.web_hit_count,
    injected: r.injected_candidate_ids?.length || 0,
    protected_slot_used: r.protected_slot_used,
    reached_verifier: r.reached_verifier,
    verifier_verdicts: r.verifier_verdicts,
    missing_before_verifier: r.missing_before_verifier,
    missing_reason: r.missing_reason,
    errors: r.errors,
  })),
  sr_per_claim_summary: sr.per_claim_summary || sr.per_claim,
  citation_quality_status: cq.status,
  claims_lost_all_support: cq.claims_lost_all_support,
  total_footnotes: (row.footnotes || []).length,
  footnotes_preview: (row.footnotes || []).slice(0, 20).map(f => ({ n: f.number, text: (f.text || "").slice(0, 180) })),
};
console.log(JSON.stringify(out, null, 2));
