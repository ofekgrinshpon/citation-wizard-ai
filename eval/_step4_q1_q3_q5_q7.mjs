// Step 4 validation probe: Q1/Q3/Q5/Q7 — anchor materialization → verification → citation.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

const QUERIES = [
  { id: "Q1", question: "מהם התנאים למתן סעד זמני (צו מניעה זמני) במשפט האזרחי הישראלי?" },
  { id: "Q3", question: "מהי דוקטרינת המידתיות במשפט החוקתי הישראלי ומהם שלוש מבחני המשנה שלה?" },
  { id: "Q5", question: "מהם הכללים לפרשנות חוזה במשפט הישראלי לאור הלכת אפרופים והתיקון לסעיף 25 לחוק החוזים?" },
  { id: "Q7", question: "מהי דוקטרינת מיצוי ההליכים במשפט המינהלי הישראלי ומתי בית המשפט יידחה עתירה בשל אי-מיצוי?" },
];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

// Fire all 4 in parallel
const submissions = await Promise.all(QUERIES.map(async (q) => {
  const evalRunId = `step4-${q.id}-${randomUUID().slice(0, 8)}`;
  const start = Date.now();
  let httpStatus = 0;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
      body: JSON.stringify({
        question: q.question,
        taskMode: "research",
        depth: "deep",
        evalRunId,
        requestId: `eval:${evalRunId}`,
      }),
    });
    httpStatus = r.status;
    await r.text();
  } catch (e) { console.log(`${q.id} HTTP error: ${e.message}`); }
  console.log(`${q.id} submitted: http=${httpStatus} wall=${Date.now()-start}ms eval=${evalRunId}`);
  return { ...q, evalRunId };
}));

// Poll all
const results = [];
for (const q of submissions) {
  let row = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((rr) => setTimeout(rr, 3000));
    const { data } = await admin
      .from("qa_logs")
      .select("id, footnotes, metadata, answer, created_at")
      .eq("user_id", ADMIN_USER_ID)
      .filter("metadata->>eval_run_id", "eq", q.evalRunId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data?.[0]) { row = data[0]; break; }
  }
  if (!row) { results.push({ id: q.id, error: "no_row", evalRunId: q.evalRunId }); continue; }

  const md = row.metadata || {};
  const footnotes = row.footnotes || [];
  const v3plan = md.v3_legal_research_plan || {};
  const fallback = md.v3_anchor_fallback || {};
  const matz = md.v3_anchor_materialization || {};
  const step3 = md.v3_anchor_first_step3 || md.v3_anchor_first || {};
  const expected = v3plan.anchors || [];
  const perAnchor = fallback.per_anchor || [];
  const perAnchorMatz = matz.per_anchor || [];

  results.push({
    id: q.id,
    qa_log_id: row.id,
    v3_path: md.v3_path,
    v1_fallback: !!md.v1_fallback || md.drafting_path === "v1_legacy",
    expected_anchors: expected.map((a) => ({ id: a.id, name: a.name, type: a.type, docket: a.docket, section: a.section, centrality: a.centrality })),
    materialization_totals: matz.totals || matz,
    materialization_per_anchor: perAnchorMatz,
    fallback_per_anchor: perAnchor.map((p) => ({
      anchor_id: p.anchor_id, anchor_name: p.anchor_name,
      local_found: p.local_found, perplexity_called: p.perplexity_called,
      approved_found: p.approved_found, candidate_added: p.candidate_added,
      verified: p.verified, cited: p.cited, not_found_reason: p.not_found_reason,
    })),
    step3_totals: step3.totals,
    missing_expected_anchors: matz.missing_expected_anchors || fallback.missing_expected_anchors,
    total_footnotes: footnotes.length,
    footnotes: footnotes.map((f, i) => `${i + 1}. ${(typeof f === "string" ? f : f.text || f.citation || JSON.stringify(f)).slice(0, 280)}`),
  });
}

console.log("\n\n========== STEP 4 PROBE RESULTS ==========");
console.log(JSON.stringify(results, null, 2));

console.log("\n\n========== ONE-LINE SUMMARY ==========");
for (const r of results) {
  if (r.error) { console.log(`${r.id}: ERROR ${r.error}`); continue; }
  const t = r.materialization_totals || {};
  console.log(`${r.id}: v3_path=${r.v3_path} planned=${t.anchors_planned ?? '?'} attached=${t.anchors_attached_to_claim ?? '?'} found=${t.anchor_candidates_found ?? '?'} added=${t.anchor_candidates_added_to_verifier_pack ?? '?'} verified=${(t.anchor_verified_direct ?? 0)+(t.anchor_verified_partial ?? 0)} cited=${t.anchor_cited_after_step3 ?? '?'} missing=${t.anchor_missing ?? '?'} footnotes=${r.total_footnotes}`);
}
