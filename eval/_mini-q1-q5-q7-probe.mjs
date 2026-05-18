// Mini-eval: Q1 (temp injunction), Q5 (Apropim / contract amendment),
// Q7 (exhaustion of remedies). Deep mode, V3 anchor pipeline.
// Reports: v3_path, v3 expected anchors, fallback per-anchor, cited anchors,
// missing, final footnotes, V2 telemetry presence, V1 fallback flag.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

const QUERIES = [
  {
    id: "Q1",
    label: "temporary injunction",
    question: "מהם התנאים למתן סעד זמני (צו מניעה זמני) במשפט האזרחי הישראלי?",
    expected_keywords: [
      ["תקנה 95", "תקנות סדר הדין"],
      ["סעיף 75", "חוק בתי המשפט"],
      ["צו מניעה זמני", "סעד זמני"],
    ],
  },
  {
    id: "Q5",
    label: "Apropim / contract interpretation",
    question: "מהם הכללים לפרשנות חוזה במשפט הישראלי לאור הלכת אפרופים והתיקון לסעיף 25 לחוק החוזים?",
    expected_keywords: [
      ["אפרופים"],
      ["מגדלי הירקות"],
      ["סעיף 25", "חוק החוזים"],
    ],
  },
  {
    id: "Q7",
    label: "exhaustion of remedies",
    question: "מהי דוקטרינת מיצוי ההליכים במשפט המינהלי הישראלי ומתי בית המשפט יידחה עתירה בשל אי-מיצוי?",
    expected_keywords: [
      ["פסטרנק"],
      ["חוק בתי משפט לעניינים מינהליים", "בתי משפט לעניינים מינהליים"],
      ["זמיר"],
    ],
  },
];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const results = [];

for (const q of QUERIES) {
  const evalRunId = `mini-${q.id}-${randomUUID().slice(0, 8)}`;
  console.log(`\n===== ${q.id} (${q.label}) — evalRunId=${evalRunId} =====`);
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
  } catch (e) {
    console.log(`HTTP error: ${e.message}`);
  }
  const wall = Date.now() - start;
  console.log(`http=${httpStatus} wall=${wall}ms — fetching qa_log…`);

  // Poll for the row
  let row = null;
  for (let i = 0; i < 8; i++) {
    await new Promise((rr) => setTimeout(rr, 2000));
    const { data } = await admin
      .from("qa_logs")
      .select("id, footnotes, metadata, answer")
      .eq("user_id", ADMIN_USER_ID)
      .filter("metadata->>eval_run_id", "eq", evalRunId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data?.[0]) { row = data[0]; break; }
  }
  if (!row) { console.log(`NO ROW for ${q.id}`); results.push({ id: q.id, error: "no_row" }); continue; }

  const md = row.metadata || {};
  const footnotes = row.footnotes || [];
  const fnText = footnotes.map((f) => (typeof f === "string" ? f : (f.text || f.citation || JSON.stringify(f)))).join("\n");
  const v3plan = md.v3_legal_research_plan || {};
  const fallback = md.v3_anchor_fallback || {};
  const expected = v3plan.anchors || [];
  const perAnchor = fallback.per_anchor || [];

  // Keyword coverage
  const coverage = q.expected_keywords.map((alts) => ({
    keys: alts,
    hit_in_footnotes: alts.some((k) => fnText.includes(k)),
    hit_in_answer: alts.some((k) => (row.answer || "").includes(k)),
  }));

  const summary = {
    id: q.id,
    label: q.label,
    qa_log_id: row.id,
    v3_path: md.v3_path,
    v1_fallback: !!md.v1_fallback || md.drafting_path === "v1_legacy",
    v2_telemetry_present: {
      research_plan_v2: !!md.research_plan_v2,
      retrieval_v2: !!md.retrieval_v2,
      verification_v2: !!md.verification_v2,
      ledger_v2: !!md.ledger_v2,
      drafter: !!md.drafter || !!md.models_used?.drafting,
    },
    v3_plan_status: v3plan.status,
    expected_anchor_count: expected.length,
    expected_anchors: expected.map((a) => ({
      id: a.id, type: a.type, name: a.name, docket: a.docket, section: a.section, centrality: a.centrality,
    })),
    per_anchor_fallback: perAnchor.map((p) => ({
      anchor_id: p.anchor_id,
      anchor_name: p.anchor_name,
      local_found: p.local_found,
      perplexity_called: p.perplexity_called,
      approved_found: p.approved_found,
      candidate_added: p.candidate_added,
      verified: p.verified,
      cited: p.cited,
      not_found_reason: p.not_found_reason,
    })),
    cited_anchor_ids: perAnchor.filter((p) => p.cited > 0).map((p) => p.anchor_id),
    missing_expected_anchors: perAnchor
      .filter((p) => (p.local_found ?? 0) === 0 && (p.approved_found ?? 0) === 0)
      .map((p) => ({ id: p.anchor_id, name: p.anchor_name, reason: p.not_found_reason })),
    total_footnotes: footnotes.length,
    footnote_preview: footnotes.slice(0, 12).map((f, i) => `${i + 1}. ${(typeof f === "string" ? f : f.text || f.citation || JSON.stringify(f)).slice(0, 200)}`),
    acceptance_keyword_coverage: coverage,
    acceptance_passes:
      (coverage.filter((c) => c.hit_in_footnotes || c.hit_in_answer).length) >=
      (q.id === "Q5" ? 2 : 1) &&
      footnotes.length >= 5 && footnotes.length <= 8,
  };
  results.push(summary);
  console.log(JSON.stringify(summary, null, 2));
}

console.log("\n\n========== AGGREGATE ==========");
console.log(JSON.stringify(results.map((r) => ({
  id: r.id,
  v3_path: r.v3_path,
  v1_fallback: r.v1_fallback,
  expected: r.expected_anchor_count,
  footnotes: r.total_footnotes,
  cited_anchors: r.cited_anchor_ids?.length,
  acceptance_passes: r.acceptance_passes,
})), null, 2));
