// Phase 1 Router Eval — 5 disambiguation queries.
//
// Verifies that `legal_issue_router` correctly distinguishes between
// different meanings of "שינוי מהותי" and contract sub-types BEFORE we
// proceed to Phase 3 (OpenWebDiscovery).
//
// Usage:
//   node eval/router-phase1-eval.mjs            # run + analyze
//   node eval/router-phase1-eval.mjs --analyze  # re-analyze most recent rows
//
// Telemetry shape (flat under metadata.research_safeguards.router):
//   { ran, status, timed_out, duration_ms, confidence, query_type,
//     legal_domain, target_statute, forbidden_topics, forbidden_domains,
//     requires_current_context, ambiguous_terms_count }
// (notes / actual ambiguous terms / secondary_domains are NOT persisted —
//  soft checks that require them are skipped.)

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";
const ANALYZE_ONLY = process.argv.includes("--analyze");

if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
  console.error("Missing SUPABASE_URL / SERVICE_ROLE / ANON_KEY env vars");
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const QUERY_TYPE_FAMILIES = {
  amendment: ["statutory_amendment_comparison"],
  caselaw_or_doctrinal: ["case_law_application", "doctrinal"],
  procedural_or_doctrinal: ["procedural", "doctrinal"],
  doctrinal: ["doctrinal"],
};

const nameHas = (r, n) => (r?.target_statute?.name ?? "").includes(n);

const CASES = [
  {
    id: "Q1-amendment-contract",
    question:
      "האם התיקון האחרון לחוק החוזים מהווה שינוי מהותי מההלכה הקיימת בפרשנות חוזים?",
    hard: (r) => {
      const e = [];
      if (!QUERY_TYPE_FAMILIES.amendment.includes(r.query_type))
        e.push(`query_type=${r.query_type} not in {statutory_amendment_comparison}`);
      if (r.legal_domain !== "contract_law")
        e.push(`legal_domain=${r.legal_domain} expected contract_law`);
      if (!nameHas(r, "חוק החוזים") || nameHas(r, "אחידים"))
        e.push(`target_statute.name=${r.target_statute?.name} should include "חוק החוזים" and not "אחידים"`);
      return e;
    },
    soft: (r) => {
      const w = [];
      if (r.target_statute?.amendment !== "latest")
        w.push(`target_statute.amendment=${r.target_statute?.amendment} expected "latest"`);
      const ft = (r.forbidden_topics ?? []).join(",");
      if (!/מזונות|משמורת|משפחה/.test(ft))
        w.push(`forbidden_topics missing family signal: [${ft}]`);
      return w;
    },
    catastrophic: (r) =>
      r.legal_domain === "family_law" ? ["Q1 routed to family_law"] : [],
  },
  {
    id: "Q2-apropim-current",
    question: "מהי הלכת אפרופים כיום?",
    hard: (r) => {
      const e = [];
      if (!QUERY_TYPE_FAMILIES.caselaw_or_doctrinal.includes(r.query_type))
        e.push(`query_type=${r.query_type} not in {case_law_application, doctrinal}`);
      if (r.legal_domain !== "contract_law")
        e.push(`legal_domain=${r.legal_domain} expected contract_law`);
      return e;
    },
    soft: (r) => {
      const w = [];
      if (r.requires_current_context !== true)
        w.push(`requires_current_context=${r.requires_current_context} (recommended true)`);
      return w;
    },
    catastrophic: (r) =>
      r.legal_domain === "family_law" ? ["Q2 routed to family_law"] : [],
  },
  {
    id: "Q3-bibi-roads",
    question: "האם פסק דין ביבי כבישים שינה את הלכת אפרופים?",
    hard: (r) => {
      const e = [];
      if (!QUERY_TYPE_FAMILIES.caselaw_or_doctrinal.includes(r.query_type))
        e.push(`query_type=${r.query_type} not in {case_law_application, doctrinal}`);
      if (r.legal_domain !== "contract_law")
        e.push(`legal_domain=${r.legal_domain} expected contract_law`);
      return e;
    },
    soft: () => [
      // notes/ambiguous_terms not persisted in telemetry → cannot validate.
    ],
    catastrophic: (r) =>
      r.legal_domain === "family_law" ? ["Q3 routed to family_law"] : [],
  },
  {
    id: "Q4-family-mezonot",
    question:
      "האם שינוי נסיבות מהותי מאפשר פתיחת פסק דין מזונות שניתן בעבר?",
    hard: (r) => {
      const e = [];
      if (!QUERY_TYPE_FAMILIES.procedural_or_doctrinal.includes(r.query_type))
        e.push(`query_type=${r.query_type} not in {procedural, doctrinal}`);
      if (r.legal_domain !== "family_law")
        e.push(`legal_domain=${r.legal_domain} expected family_law`);
      return e;
    },
    soft: (r) => {
      const w = [];
      const ft = (r.forbidden_topics ?? []).join(",");
      if (!/חוז|פרשנות|אפרופים/i.test(ft))
        w.push(`forbidden_topics do not steer away from contract interpretation: [${ft}]`);
      return w;
    },
    catastrophic: (r) => {
      const e = [];
      if (r.legal_domain === "contract_law") e.push("Q4 routed to contract_law");
      const tname = r.target_statute?.name ?? "";
      if (/אפרופים/i.test(tname)) e.push("Q4 target_statute mentions Apropim");
      return e;
    },
  },
  {
    id: "Q5-standard-contracts",
    question: "מה הדין לגבי תנאי מקפח בחוזה אחיד?",
    hard: (r) => {
      const e = [];
      if (!QUERY_TYPE_FAMILIES.doctrinal.includes(r.query_type))
        e.push(`query_type=${r.query_type} not in {doctrinal}`);
      if (!["consumer_law", "contract_law"].includes(r.legal_domain))
        e.push(`legal_domain=${r.legal_domain} expected consumer_law or contract_law`);
      if (!nameHas(r, "חוק החוזים האחידים"))
        e.push(`target_statute.name=${r.target_statute?.name} must include "חוק החוזים האחידים"`);
      return e;
    },
    soft: () => [],
    catastrophic: (r) => {
      const n = r.target_statute?.name ?? "";
      if (n.includes("חוק החוזים") && !n.includes("אחידים"))
        return [`Q5 target_statute is general חוק החוזים, not חוק החוזים האחידים`];
      return [];
    },
  },
];

// ---------------------------------------------------------------------------
// Run (or load) one case
// ---------------------------------------------------------------------------

async function callPipeline(jwt, tc) {
  const evalRunId = `router-phase1-${tc.id}-${randomUUID()}`;
  const t0 = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({
      question: tc.question,
      taskMode: "research",
      depth: "fast",
      evalRunId,
      evalVariant: "router-phase1",
      requestId: `eval:${evalRunId}`,
    }),
  });
  const wallMs = Date.now() - t0;
  try { await res.text(); } catch {}
  let row = null;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const { data } = await admin
      .from("qa_logs")
      .select("id, metadata")
      .eq("user_id", ADMIN_USER_ID)
      .filter("metadata->>eval_run_id", "eq", evalRunId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data?.[0]) { row = data[0]; break; }
  }
  return { httpStatus: res.status, wallMs, row };
}

async function loadLatestRow(tc) {
  const { data } = await admin
    .from("qa_logs")
    .select("id, metadata")
    .eq("user_id", ADMIN_USER_ID)
    .ilike("metadata->>eval_run_id", `router-phase1-${tc.id}-%`)
    .order("created_at", { ascending: false })
    .limit(1);
  return { httpStatus: null, wallMs: null, row: data?.[0] ?? null };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let jwt = null;
if (!ANALYZE_ONLY) {
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: ADMIN_EMAIL,
  });
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const v = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  jwt = v.data.session.access_token;
}

const results = [];
for (const tc of CASES) {
  process.stdout.write(`▶ ${tc.id} ${ANALYZE_ONLY ? "(analyze)" : ""} ... `);
  const r = ANALYZE_ONLY ? await loadLatestRow(tc) : await callPipeline(jwt, tc);
  process.stdout.write(
    ANALYZE_ONLY ? `${r.row ? "row found" : "no row"}\n` : `HTTP ${r.httpStatus} (${r.wallMs}ms)\n`,
  );
  results.push({ tc, ...r });
}

let timeouts = 0;
const catastrophic = [];
const summary = [];

for (const { tc, row } of results) {
  console.log(`\n=== ${tc.id} ===`);
  console.log(`Q: ${tc.question}`);
  if (!row) {
    console.log("✗ NO qa_logs row found");
    catastrophic.push(`${tc.id}: no qa_logs row`);
    summary.push({ id: tc.id, status: "NO_ROW" });
    continue;
  }
  const router = row.metadata?.research_safeguards?.router ?? {};
  const timed_out = router.timed_out === true || router.status === "timeout";
  if (timed_out) timeouts++;

  console.log(`router.duration_ms=${router.duration_ms} status=${router.status} timed_out=${timed_out}`);

  if (!router.query_type) {
    console.log("✗ router fields missing (no query_type)");
    summary.push({ id: tc.id, status: "NO_ROUTE", timed_out });
    if (timed_out) catastrophic.push(`${tc.id}: router timeout`);
    continue;
  }

  console.log(`  query_type   = ${router.query_type}`);
  console.log(`  legal_domain = ${router.legal_domain}`);
  console.log(`  forbidden_dom= ${JSON.stringify(router.forbidden_domains)}`);
  console.log(`  forbidden_top= ${JSON.stringify(router.forbidden_topics)}`);
  console.log(`  target_statute=${JSON.stringify(router.target_statute)}`);
  console.log(`  req_current  = ${router.requires_current_context}`);
  console.log(`  ambig_count  = ${router.ambiguous_terms_count}`);
  console.log(`  confidence   = ${router.confidence}`);

  const cat = tc.catastrophic(router);
  const hard = tc.hard(router);
  const soft = tc.soft(router);

  for (const m of cat) { console.log(`✗✗ CATASTROPHIC: ${m}`); catastrophic.push(`${tc.id}: ${m}`); }
  for (const m of hard) console.log(`✗  HARD: ${m}`);
  for (const m of soft) console.log(`~  SOFT: ${m}`);
  if (cat.length === 0 && hard.length === 0)
    console.log(soft.length === 0 ? "✓ PASS" : "✓ PASS (with soft warnings)");

  summary.push({
    id: tc.id,
    status: cat.length ? "CATASTROPHIC" : hard.length ? "HARD_FAIL" : soft.length ? "SOFT_WARN" : "PASS",
    query_type: router.query_type,
    legal_domain: router.legal_domain,
    target: router.target_statute?.name,
    timed_out,
    duration_ms: router.duration_ms,
  });
}

console.log("\n========== SUMMARY ==========");
console.table(summary);

const passed = summary.filter((s) => s.status === "PASS" || s.status === "SOFT_WARN").length;
const hardFails = summary.filter((s) => s.status === "HARD_FAIL").length;
console.log(`\nPassed (incl. soft): ${passed}/${CASES.length}`);
console.log(`Hard fails:          ${hardFails}`);
console.log(`Catastrophic:        ${catastrophic.length}`);
console.log(`Router timeouts:     ${timeouts} (catastrophic if > 1)`);

const blocking = catastrophic.length > 0 || timeouts > 1 || passed < CASES.length - 1;

if (catastrophic.length) {
  console.log("\nCATASTROPHIC FAILURES:");
  for (const c of catastrophic) console.log(`  - ${c}`);
}
console.log(
  blocking
    ? "\n⛔ BLOCK Phase 3 — fix router prompt/normalization first."
    : "\n✅ OK to proceed to Phase 3 (OpenWebDiscovery).",
);
process.exit(blocking ? 1 : 0);
