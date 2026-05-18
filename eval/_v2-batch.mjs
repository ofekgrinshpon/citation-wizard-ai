// Run a subset of V2 deep queries sequentially. Pass IDs as comma list via env IDS.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";
const SPACING_MS = Number(process.env.SPACING_MS || 30000);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const ALL = {
  Q1: "מהם התנאים למתן צו מניעה זמני?",
  Q2: "דוקטרינת הסיכול בדיני חוזים — תנאים ויישום",
  Q3: "מבחנים לפסילת חוק בלתי חוקתי",
  Q4: "מחדל חקיקתי ודמי חסות — חובת המחוקק לפעול",
  Q5: "הלכת אפרופים ותיקון 2 לחוק החוזים — פרשנות חוזה",
  Q6: "פסקת ההגבלה וזכויות חוקתיות בחוקי היסוד",
  Q7: 'מהי דרישת מיצוי הליכים בעתירה לבג"ץ?',
};
const ids = (process.env.IDS || "Q3,Q7").split(",").map((s) => s.trim()).filter(Boolean);

function rep(fns) {
  const c = {};
  for (const f of fns || []) { const k = (f.citation || "").trim(); if (k) c[k] = (c[k]||0)+1; }
  return Object.entries(c).filter(([,n])=>n>1).map(([c,n])=>`${n}× ${c.slice(0,50)}`);
}

let i = 0;
for (const id of ids) {
  if (i++ > 0) { console.log(`-- spacing ${SPACING_MS}ms --`); await new Promise((r)=>setTimeout(r, SPACING_MS)); }
  const q = ALL[id];
  const evalRunId = `v2b-${id}-${randomUUID().slice(0,6)}`;
  console.log(`\n══════════ ${id}: ${q}`);
  const t0 = Date.now();
  let resp, json;
  try {
    resp = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
      body: JSON.stringify({ question: q, taskMode: "research", depth: "deep", evalRunId, requestId: `eval:${evalRunId}` }),
    });
    json = await resp.json();
  } catch (e) { console.log(`  ERROR ${e.message}`); continue; }
  console.log(`  wall=${Date.now()-t0}ms status=${resp.status} fn=${(json.footnotes||[]).length}`);

  let row = null;
  for (let k = 0; k < 90; k++) {
    await new Promise((r)=>setTimeout(r, 4000));
    const { data } = await admin.from("qa_logs")
      .select("id, answer, footnotes, metadata")
      .eq("user_id", ADMIN_USER_ID)
      .filter("metadata->>eval_run_id", "eq", evalRunId)
      .order("created_at", { ascending: false }).limit(1);
    const r0 = data?.[0];
    // Require v2_path OR explicit fallback OR a non-empty answer to consider it done.
    if (r0 && (r0.metadata?.v2_path || r0.metadata?.fallback || (r0.answer && r0.answer.length > 100))) { row = r0; break; }
    if (k === 89) row = r0;
  }
  if (!row) { console.log("  NO ROW"); continue; }
  const md = row.metadata || {};
  const rp = md.research_plan_v2 || {};
  const rt = md.retrieval_v2 || {};
  const lg = md.ledger_v2 || {};
  const dr = md.drafter || {};
  const tel = md.retrieval_telemetry || rt.telemetry || {};
  console.log(`  v2_path=${md.v2_path||"(none)"} fallback=${md.fallback?JSON.stringify(md.fallback):"none"}`);
  console.log(`  plan_claims=${rp.claim_count ?? "?"} retrieval_total=${rt.total_candidates ?? "?"} text_to=${tel.text_timeouts ?? tel.rpc_timeouts ?? 0} vec_to=${tel.vector_timeouts ?? 0} broken_drops=${tel.broken_title_drops ?? 0}`);
  console.log(`  ledger kept=${lg.kept ?? "?"} dropped=${lg.dropped ?? "?"} sup=${lg.supported ?? "?"} part=${lg.partially_supported ?? "?"}`);
  console.log(`  drafter ans_len=${dr.answer_len ?? "?"} fn_n=${dr.footnotes_n ?? "?"} ids=${(dr.source_ids_used||[]).join(",")}`);
  const fns = row.footnotes || [];
  console.log(`  footnote_titles:`);
  for (const f of fns.slice(0, 10)) {
    const t = (f.title || f.citation || "").slice(0, 90);
    const flag = /פרטי מסמך|^Home$|^Download$|^פסק דין$|^החלטה$/.test(t) ? " ⚠JUNK" : "";
    console.log(`    - ${t}${flag}`);
  }
  const r2 = rep(fns);
  if (r2.length) console.log(`  ⚠ repeated: ${r2.join(" | ")}`);
  console.log(`  row=${row.id}`);
}
console.log("\n══════════ DONE");
