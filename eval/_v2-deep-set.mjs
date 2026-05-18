import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const QUESTIONS = [
  { id: "Q1", q: "מהם התנאים למתן צו מניעה זמני?" },
  { id: "Q2", q: "דוקטרינת הסיכול בדיני חוזים — תנאים ויישום" },
  { id: "Q3", q: "מבחנים לפסילת חוק בלתי חוקתי" },
  { id: "Q4", q: "מחדל חקיקתי ודמי חסות — חובת המחוקק לפעול" },
  { id: "Q5", q: "הלכת אפרופים ותיקון 2 לחוק החוזים — פרשנות חוזה" },
  { id: "Q6", q: "פסקת ההגבלה וזכויות חוקתיות בחוקי היסוד" },
  { id: "Q7", q: "מהי דרישת מיצוי הליכים בעתירה לבג\"ץ?" },
];

function repeatedCitations(footnotes) {
  const counts = {};
  for (const f of footnotes || []) {
    const k = (f.citation || "").trim();
    if (!k) continue;
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.entries(counts).filter(([, n]) => n > 1).map(([c, n]) => `${n}× ${c.slice(0, 60)}`);
}

function dupTokens(footnotes) {
  const bad = [];
  for (const f of footnotes || []) {
    const c = f.citation || "";
    if (/בג"?ץ\s+בג"?ץ/.test(c) || /ע"?א\s+ע"?א/.test(c)) bad.push(c.slice(0, 60));
  }
  return bad;
}

let qi = 0;
for (const { id, q } of QUESTIONS) {
  if (qi++ > 0) {
    console.log(`  -- spacing 45s --`);
    await new Promise((r) => setTimeout(r, 45000));
  }
  const evalRunId = `v2-set-${id}-${randomUUID().slice(0, 6)}`;
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
  } catch (e) {
    console.log(`  ERROR ${e.message}`);
    continue;
  }
  console.log(`  wall=${Date.now() - t0}ms status=${resp.status} footnotes=${(json.footnotes || []).length}`);

  let row = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const { data } = await admin.from("qa_logs")
      .select("id, answer, footnotes, metadata")
      .eq("user_id", ADMIN_USER_ID)
      .filter("metadata->>eval_run_id", "eq", evalRunId)
      .order("created_at", { ascending: false }).limit(1);
    const r0 = data?.[0];
    if (r0 && (r0.metadata?.v2_path || r0.metadata?.fallback || r0.metadata?.total_duration_ms || r0.metadata?.drafter || r0.answer)) {
      row = r0; break;
    }
    if (i === 59) row = r0;
  }
  if (!row) { console.log("  NO ROW"); continue; }
  console.log(`  poll_wall=${Date.now() - t0}ms`);
  const md = row.metadata || {};
  const rp = md.research_plan_v2 || md.research_plan || {};
  const rt = md.retrieval_v2 || {};
  const lg = md.ledger_v2 || {};
  const dr = md.drafter || {};
  const tel = md.retrieval_telemetry || {};

  console.log(`  v2_path=${md.v2_path || "(none)"} fallback=${md.fallback ? JSON.stringify(md.fallback) : "none"}`);
  console.log(`  plan: claims=${rp.claim_count ?? rp.claims ?? "?"} status=${md.research_plan_v2_status || "?"} model=${md.planner_model || "?"} ms=${md.planner_ms || "?"}`);
  console.log(`  retrieval: total_candidates=${rt.total_candidates ?? "?"} claims_with_zero=${rt.claims_with_zero_candidates ?? "?"} text_to=${tel.text_timeouts ?? 0} vec_to=${tel.vector_timeouts ?? 0}`);
  console.log(`  ledger: kept=${lg.kept ?? "?"} dropped=${lg.dropped ?? "?"} supported=${lg.supported ?? "?"} partial=${lg.partially_supported ?? "?"}`);
  console.log(`  drafter: answer_len=${dr.answer_len ?? "?"} footnotes_n=${dr.footnotes_n ?? "?"} cards_cited=${dr.cards_cited ?? "?"} ids=${(dr.source_ids_used || []).join(",")}`);

  const fns = row.footnotes || json.footnotes || [];
  const rep = repeatedCitations(fns);
  const dup = dupTokens(fns);
  if (rep.length) console.log(`  ⚠ repeated_citations: ${rep.join(" | ")}`);
  if (dup.length) console.log(`  ⚠ duplicated_tokens: ${dup.join(" | ")}`);
  if (!rep.length && !dup.length) console.log(`  ✓ no repeat/dup citation issues`);
  console.log(`  row=${row.id}`);
}
console.log("\n══════════ DONE");
