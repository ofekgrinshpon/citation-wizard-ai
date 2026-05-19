import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
const URL = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com", ADMIN_UID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";
const Q = [
  { id: "Q1", q: "מהם התנאים למתן סעד זמני (צו מניעה זמני) במשפט האזרחי הישראלי?" },
  { id: "Q3", q: "מהי דוקטרינת המידתיות במשפט החוקתי הישראלי ומהם שלוש מבחני המשנה שלה?" },
  { id: "Q5", q: "מהם הכללים לפרשנות חוזה במשפט הישראלי לאור הלכת אפרופים והתיקון לסעיף 25 לחוק החוזים?" },
  { id: "Q7", q: "מהי דוקטרינת מיצוי ההליכים במשפט המינהלי הישראלי ומתי בית המשפט יידחה עתירה בשל אי-מיצוי?" },
];
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const results = [];
for (const { id, q } of Q) {
  const evalRunId = `step4b-${id}-${randomUUID().slice(0,8)}`;
  const t0 = Date.now();
  try {
    const r = await fetch(`${URL}/functions/v1/legal-qa`, {
      method: "POST",
      headers: { "Content-Type":"application/json", Authorization:`Bearer ${jwt}`, apikey: ANON },
      body: JSON.stringify({ question: q, taskMode:"research", depth:"deep", evalRunId, requestId:`eval:${evalRunId}` }),
    });
    await r.text();
    console.log(`${id} submitted http=${r.status} wall=${Date.now()-t0}ms`);
  } catch(e) { console.log(`${id} submit error: ${e.message}`); }

  let row = null;
  for (let i=0;i<80;i++) {
    await new Promise(rr=>setTimeout(rr,3000));
    const { data } = await admin.from("qa_logs")
      .select("id, footnotes, metadata, answer, created_at")
      .eq("user_id", ADMIN_UID)
      .filter("metadata->>eval_run_id","eq", evalRunId)
      .order("created_at",{ascending:false}).limit(1);
    if (data?.[0]) { row = data[0]; break; }
  }
  if (!row) { results.push({ id, error: "no_row" }); continue; }
  const md = row.metadata||{}, mat = md.v3_anchor_materialization||{};
  results.push({
    id,
    v3_path: md.v3_path,
    v1_fallback: !!md.v1_fallback || md.drafting_path === "v1_legacy",
    totals: mat.totals,
    per_anchor: (mat.per_anchor||[]).map(p=>({
      name: p.name, type: p.type,
      local_exact_found: p.local_exact_found,
      matched_by: p.exact_lookup_detail?.matched_by,
      perplexity_called: p.perplexity_called,
      verified_direct: p.verified_direct,
      verified_partial: p.verified_partial,
      rejected: p.rejected,
      cited_after_step3: p.cited_after_step3,
      outcome: p.outcome,
    })),
    missing_expected_anchors: mat.missing_expected_anchors,
    footnotes_count: (row.footnotes||[]).length,
    footnotes_preview: (row.footnotes||[]).slice(0,3).map(f=>(typeof f==="string"?f:f.text||f.citation||JSON.stringify(f)).slice(0,200)),
  });
}
console.log("\n========== STEP 4b RESULTS ==========");
console.log(JSON.stringify(results, null, 2));
console.log("\n========== SUMMARY ==========");
for (const r of results) {
  if (r.error) { console.log(`${r.id}: ${r.error}`); continue; }
  const t = r.totals||{};
  console.log(`${r.id}: v3=${r.v3_path} v1fb=${r.v1_fallback} planned=${t.anchors_planned} found=${t.anchor_candidates_found} added=${t.anchor_candidates_added_to_verifier_pack} vd=${t.anchor_verified_direct} vp=${t.anchor_verified_partial} rj=${t.anchor_rejected} cited=${t.anchor_cited_after_step3} missing=${t.anchor_missing} fn=${r.footnotes_count}`);
}
