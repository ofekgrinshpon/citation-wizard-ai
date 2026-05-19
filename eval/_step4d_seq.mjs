// Step 4d: sequential Q1/Q3/Q5/Q7 probe — verifies anchor-reservation + id-bridge fixes.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const EMAIL = "ofekgrinshpon@gmail.com";
const UID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : ["Q1", "Q3", "Q5", "Q7"];
const QUERIES = [
  { id: "Q1", q: "מהם התנאים למתן סעד זמני (צו מניעה זמני) במשפט האזרחי הישראלי?" },
  { id: "Q3", q: "מהי דוקטרינת המידתיות במשפט החוקתי הישראלי ומהם שלוש מבחני המשנה שלה?" },
  { id: "Q5", q: "מהם הכללים לפרשנות חוזה במשפט הישראלי לאור הלכת אפרופים והתיקון לסעיף 25 לחוק החוזים?" },
  { id: "Q7", q: "מהם תנאי הסף לעתירה מנהלית לפי חוק בתי משפט לעניינים מינהליים?" },
].filter((x) => ONLY.includes(x.id));

const admin = createClient(URL, SR, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

async function findRow(evalRunId, question, submittedAt) {
  const a = await admin.from("qa_logs")
    .select("id, footnotes, metadata, answer, created_at, question")
    .eq("user_id", UID).filter("metadata->>eval_run_id", "eq", evalRunId)
    .order("created_at", { ascending: false }).limit(1);
  if (a.data?.[0]?.metadata?.v3_path) return { row: a.data[0], matched_by: "eval_run_id" };
  const qPrefix = question.substring(0, 60);
  const b = await admin.from("qa_logs")
    .select("id, footnotes, metadata, answer, created_at, question")
    .eq("user_id", UID).gte("created_at", submittedAt)
    .ilike("question", `${qPrefix}%`).order("created_at", { ascending: false }).limit(5);
  const hit = (b.data || []).find((r) => r.metadata?.v3_path);
  if (hit) return { row: hit, matched_by: "question_time" };
  return { row: null, matched_by: null };
}

const results = [];
for (const { id, q } of QUERIES) {
  const evalRunId = `step4d-${id}-${randomUUID().slice(0, 8)}`;
  const submittedAt = new Date().toISOString();
  const t0 = Date.now();
  console.log(`\n=== ${id} submit eval=${evalRunId} ===`);
  try {
    const r = await fetch(`${URL}/functions/v1/legal-qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON },
      body: JSON.stringify({ question: q, taskMode: "research", depth: "deep", evalRunId, requestId: `eval:${evalRunId}` }),
    });
    try { const rdr = r.body.getReader(); while (true) { const { done } = await rdr.read(); if (done) break; } } catch { }
    console.log(`${id} stream done http=${r.status} wall=${Date.now() - t0}ms`);
  } catch (e) { console.log(`${id} submit error: ${e.message}`); }

  let found = { row: null, matched_by: null };
  for (let i = 0; i < 60; i++) {
    await new Promise((rr) => setTimeout(rr, 5000));
    found = await findRow(evalRunId, q, submittedAt);
    if (found.row) break;
  }
  if (!found.row) { results.push({ id, error: "no_row", evalRunId }); console.log(`${id}: NO ROW`); continue; }

  const row = found.row;
  const md = row.metadata || {};
  const mat = md.v3_anchor_materialization || {};
  const perAnchor = mat.per_anchor || [];
  const lifecycle = md.anchor_lifecycle?.per_claim || [];
  // Per-anchor verifier-pack telemetry across all claims
  const anchorPackTel = [];
  for (const pc of lifecycle) {
    for (const c of (pc.candidates || [])) {
      anchorPackTel.push({
        claim_id: pc.claim_id, source_id: c.source_id, anchor_id: c.anchor_id,
        title: (c.title || "").slice(0, 60),
        in_pool: true,
        included_in_verifier_pack: c.included_in_verifier_pack,
        verifier_verdict: c.verdict,
        ledger_included: c.ledger_included,
        cited_after_step3: c.cited,
        exclusion_reason: c.exclusion_reason ?? null,
      });
    }
  }

  results.push({
    id, qa_log_id: row.id, matched_by: found.matched_by, v3_path: md.v3_path,
    v1_fallback: !!md.v1_fallback || md.drafting_path === "v1_legacy",
    id_map: md.external_anchors?.id_map,
    totals: mat.totals,
    per_anchor: perAnchor.map((p) => ({
      name: (p.name || "").slice(0, 60), type: p.type,
      v3_id: p.anchor_id, v2_id: p.v2_anchor_id,
      local_exact_found: p.local_exact_found,
      candidates_added: p.candidates_added_to_pack,
      verified_direct: p.verified_direct, verified_partial: p.verified_partial,
      rejected: p.rejected, cited_after_step3: p.cited_after_step3, outcome: p.outcome,
    })),
    anchor_pack_telemetry: anchorPackTel,
    missing_expected_anchors: mat.missing_expected_anchors,
    footnotes_count: (row.footnotes || []).length,
    footnotes: (row.footnotes || []).map((f, i) => `${i + 1}. ${(typeof f === "string" ? f : f.text || f.citation || JSON.stringify(f)).slice(0, 320)}`),
  });
  console.log(`${id} ok v3=${md.v3_path} fn=${(row.footnotes || []).length}`);
}

console.log("\n========== STEP 4d RESULTS ==========");
console.log(JSON.stringify(results, null, 2));
console.log("\n========== ONE-LINE SUMMARY ==========");
for (const r of results) {
  if (r.error) { console.log(`${r.id}: ${r.error}`); continue; }
  const t = r.totals || {};
  console.log(`${r.id}: v1fb=${r.v1_fallback} planned=${t.anchors_planned} added=${t.anchor_candidates_added_to_verifier_pack} vd=${t.anchor_verified_direct} vp=${t.anchor_verified_partial} rj=${t.anchor_rejected} cited=${t.anchor_cited_after_step3} missing=${t.anchor_missing} fn=${r.footnotes_count}`);
}
