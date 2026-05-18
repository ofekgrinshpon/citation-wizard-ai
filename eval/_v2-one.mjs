// Run ONE V2 deep query by ID env. Submit, poll DB up to ~7min, report.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

const ALL = {
  Q1: "מהם התנאים למתן צו מניעה זמני?",
  Q2: "דוקטרינת הסיכול בדיני חוזים — תנאים ויישום",
  Q3: "מבחנים לפסילת חוק בלתי חוקתי",
  Q4: "מחדל חקיקתי ודמי חסות — חובת המחוקק לפעול",
  Q5: "הלכת אפרופים ותיקון 2 לחוק החוזים — פרשנות חוזה",
  Q6: "פסקת ההגבלה וזכויות חוקתיות בחוקי היסוד",
  Q7: 'מהי דרישת מיצוי הליכים בעתירה לבג"ץ?',
};
const id = process.env.ID;
const q = ALL[id];
if (!q) { console.error(`Unknown ID=${id}`); process.exit(1); }

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const evalRunId = `v2one-${id}-${randomUUID().slice(0,6)}`;
console.log(`══════════ ${id}: ${q}`);
const t0 = Date.now();
const resp = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
  body: JSON.stringify({ question: q, taskMode: "research", depth: "deep", evalRunId, requestId: `eval:${evalRunId}` }),
});
const json = await resp.json().catch(() => ({}));
console.log(`submit_wall=${Date.now()-t0}ms status=${resp.status} run_id=${json.run_id || json.runId || "?"}`);

let row = null;
for (let k = 0; k < 150; k++) { // ~10 min @ 4s
  await new Promise((r)=>setTimeout(r, 4000));
  const { data } = await admin.from("qa_logs")
    .select("id, answer, footnotes, metadata, created_at")
    .eq("user_id", ADMIN_USER_ID)
    .filter("metadata->>eval_run_id", "eq", evalRunId)
    .order("created_at", { ascending: false }).limit(1);
  const r0 = data?.[0];
  const done = r0 && (
    r0.metadata?.checkpoint === "completed" ||
    r0.metadata?.checkpoint === "failed" ||
    r0.metadata?.fallback ||
    (r0.answer && r0.answer.length > 100 && (r0.metadata?.v2_path || r0.metadata?.drafter))
  );
  if (done) { row = r0; break; }
  if ((k+1) % 10 === 0) console.log(`  ...polling ${4*(k+1)}s checkpoint=${r0?.metadata?.checkpoint || "?"} v2_path=${r0?.metadata?.v2_path || "?"}`);
}
if (!row) { console.log("⚠ NO COMPLETION within poll window"); process.exit(0); }

const md = row.metadata || {};
const rp = md.research_plan_v2 || {};
const rt = md.retrieval_v2 || {};
const lg = md.ledger_v2 || {};
const dr = md.drafter || {};
const tel = md.retrieval_telemetry || rt.telemetry || {};
const fns = row.footnotes || [];

console.log(`\n── REPORT ${id} (row=${row.id}) wall=${Date.now()-t0}ms`);
console.log(`v2_path=${md.v2_path || "(none)"} status=${row.answer ? "completed" : "failed"} fallback=${md.fallback ? JSON.stringify(md.fallback) : "none"}`);
console.log(`plan.claim_count=${rp.claim_count ?? "?"}`);
console.log(`retrieval.total_candidates=${rt.total_candidates ?? "?"} claims_with_zero=${rt.claims_with_zero_candidates ?? "?"}`);
console.log(`timeouts: text=${tel.text_timeouts ?? tel.rpc_timeouts ?? 0} vector=${tel.vector_timeouts ?? 0} broken_drops=${tel.broken_title_drops ?? 0}`);
console.log(`ledger: kept=${lg.kept ?? "?"} dropped=${lg.dropped ?? "?"} supported=${lg.supported ?? "?"} partial=${lg.partially_supported ?? "?"}`);
console.log(`drafter: answer_len=${dr.answer_len ?? (row.answer?.length ?? "?")} footnotes_n=${dr.footnotes_n ?? fns.length} source_ids=${(dr.source_ids_used||[]).join(",")}`);
console.log(`footnote_titles (${fns.length}):`);
for (const f of fns) {
  const t = (f.title || f.citation || "").slice(0, 110);
  const flag = /פרטי מסמך|^Home$|^Download$|^פסק דין$|^החלטה$|מרכז המחקר והמידע/.test(t) ? " ⚠JUNK" : "";
  console.log(`  - ${t}${flag}`);
}
