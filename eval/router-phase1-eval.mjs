// Phase 1 Router Eval — 5 disambiguation queries.
//
// Verifies that `legal_issue_router` correctly distinguishes between
// different meanings of "שינוי מהותי" and contract sub-types BEFORE we
// proceed to Phase 3 (OpenWebDiscovery).
//
// Usage: node eval/router-phase1-eval.mjs
//
// Reads router output from qa_logs.metadata.research_safeguards.router.
// Hard vs soft assertions per refined plan; catastrophic failures called out.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
  console.error("Missing SUPABASE_URL / SERVICE_ROLE / ANON_KEY env vars");
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: ADMIN_EMAIL,
});
if (linkErr) throw linkErr;
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const verify = await anon.auth.verifyOtp({
  token_hash: linkData.properties.hashed_token,
  type: "magiclink",
});
if (verify.error) throw verify.error;
const jwt = verify.data.session.access_token;

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

/** @typedef {{
 *   id: string,
 *   question: string,
 *   hard: (route: any) => string[],          // returns array of failure messages
 *   soft: (route: any) => string[],          // soft warnings only
 *   catastrophic: (route: any) => string[],  // hardest of hard — counted separately
 * }} TestCase
 */

const QUERY_TYPE_FAMILIES = {
  amendment: ["statutory_amendment_comparison"],
  caselaw_or_doctrinal: ["case_law_application", "doctrinal"],
  procedural_or_doctrinal: ["procedural", "doctrinal"],
  doctrinal: ["doctrinal"],
};

function nameHas(route, needle) {
  return (route?.target_statute?.name ?? "").includes(needle);
}

const CASES = [
  {
    id: "Q1-amendment-contract",
    question:
      "האם התיקון האחרון לחוק החוזים מהווה שינוי מהותי מההלכה הקיימת בפרשנות חוזים?",
    hard: (r) => {
      const errs = [];
      if (!QUERY_TYPE_FAMILIES.amendment.includes(r.query_type))
        errs.push(`query_type=${r.query_type} not in {statutory_amendment_comparison}`);
      if (r.legal_domain !== "contract_law")
        errs.push(`legal_domain=${r.legal_domain} expected contract_law`);
      if (!nameHas(r, "חוק החוזים") || nameHas(r, "אחידים"))
        errs.push(`target_statute.name=${r.target_statute?.name} should include "חוק החוזים" and not "אחידים"`);
      return errs;
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
      const errs = [];
      if (!QUERY_TYPE_FAMILIES.caselaw_or_doctrinal.includes(r.query_type))
        errs.push(`query_type=${r.query_type} not in {case_law_application, doctrinal}`);
      if (r.legal_domain !== "contract_law")
        errs.push(`legal_domain=${r.legal_domain} expected contract_law`);
      return errs;
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
      const errs = [];
      if (!QUERY_TYPE_FAMILIES.caselaw_or_doctrinal.includes(r.query_type))
        errs.push(`query_type=${r.query_type} not in {case_law_application, doctrinal}`);
      if (r.legal_domain !== "contract_law")
        errs.push(`legal_domain=${r.legal_domain} expected contract_law`);
      return errs;
    },
    soft: (r) => {
      const w = [];
      const blob = `${r.notes ?? ""} ${Object.keys(r.ambiguous_terms ?? {}).join(" ")}`;
      if (!/אפרופים|ביבי|פרשנות|חוז/i.test(blob))
        w.push(`notes/ambiguous_terms missing apropim/bibi/interpretation hint`);
      return w;
    },
    catastrophic: (r) =>
      r.legal_domain === "family_law" ? ["Q3 routed to family_law"] : [],
  },
  {
    id: "Q4-family-mezonot",
    question:
      "האם שינוי נסיבות מהותי מאפשר פתיחת פסק דין מזונות שניתן בעבר?",
    hard: (r) => {
      const errs = [];
      if (!QUERY_TYPE_FAMILIES.procedural_or_doctrinal.includes(r.query_type))
        errs.push(`query_type=${r.query_type} not in {procedural, doctrinal}`);
      if (r.legal_domain !== "family_law")
        errs.push(`legal_domain=${r.legal_domain} expected family_law`);
      return errs;
    },
    soft: (r) => {
      const w = [];
      const ft = (r.forbidden_topics ?? []).join(",");
      const blob = `${r.notes ?? ""} ${ft}`;
      if (!/חוז|פרשנות|אפרופים/i.test(blob))
        w.push(`forbidden_topics/notes do not steer away from contract interpretation: [${ft}]`);
      return w;
    },
    catastrophic: (r) => {
      const errs = [];
      if (r.legal_domain === "contract_law")
        errs.push("Q4 routed to contract_law");
      const blob = `${r.notes ?? ""} ${r.target_statute?.name ?? ""}`;
      if (/אפרופים/i.test(blob))
        errs.push("Q4 mentions Apropim in router output");
      return errs;
    },
  },
  {
    id: "Q5-standard-contracts",
    question: "מה הדין לגבי תנאי מקפח בחוזה אחיד?",
    hard: (r) => {
      const errs = [];
      if (!QUERY_TYPE_FAMILIES.doctrinal.includes(r.query_type))
        errs.push(`query_type=${r.query_type} not in {doctrinal}`);
      if (!["consumer_law", "contract_law"].includes(r.legal_domain))
        errs.push(`legal_domain=${r.legal_domain} expected consumer_law or contract_law`);
      if (!nameHas(r, "חוק החוזים האחידים"))
        errs.push(`target_statute.name=${r.target_statute?.name} must include "חוק החוזים האחידים"`);
      return errs;
    },
    soft: () => [],
    catastrophic: (r) => {
      // Catastrophic: identifies general חוק החוזים without "אחידים"
      const n = r.target_statute?.name ?? "";
      if (n.includes("חוק החוזים") && !n.includes("אחידים"))
        return [`Q5 target_statute is general חוק החוזים, not חוק החוזים האחידים`];
      return [];
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runOne(tc) {
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
  // Drain body to free socket
  try { await res.text(); } catch { /* ignore */ }

  // Wait briefly for qa_logs row to land
  let row = null;
  for (let i = 0; i < 8; i++) {
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

  return { tc, evalRunId, httpStatus: res.status, wallMs, row };
}

const results = [];
for (const tc of CASES) {
  process.stdout.write(`▶ ${tc.id} ... `);
  const r = await runOne(tc);
  process.stdout.write(`HTTP ${r.httpStatus} (${r.wallMs}ms)\n`);
  results.push(r);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

let timeouts = 0;
const catastrophic = [];
const summary = [];

for (const { tc, evalRunId, row } of results) {
  console.log(`\n=== ${tc.id} ===`);
  console.log(`Q: ${tc.question}`);
  if (!row) {
    console.log("✗ NO qa_logs row found");
    catastrophic.push(`${tc.id}: no qa_logs row`);
    summary.push({ id: tc.id, status: "NO_ROW" });
    continue;
  }
  const safeguards = row.metadata?.research_safeguards ?? {};
  const router = safeguards.router ?? {};
  const route = router.route ?? null;
  const timed_out = router.timed_out === true || router.run?.status === "timeout";
  const dur = router.duration_ms ?? router.run?.duration_ms ?? null;

  console.log(`router.duration_ms = ${dur}, timed_out = ${timed_out}`);
  if (timed_out) timeouts++;

  if (!route) {
    console.log("✗ router.route is null/missing");
    summary.push({ id: tc.id, status: "NO_ROUTE", timed_out });
    if (timed_out) catastrophic.push(`${tc.id}: router timeout (no route)`);
    continue;
  }

  console.log(`  query_type     = ${route.query_type}`);
  console.log(`  legal_domain   = ${route.legal_domain}`);
  console.log(`  secondary      = ${JSON.stringify(route.secondary_domains)}`);
  console.log(`  forbidden_dom  = ${JSON.stringify(route.forbidden_domains)}`);
  console.log(`  forbidden_top  = ${JSON.stringify(route.forbidden_topics)}`);
  console.log(`  target_statute = ${JSON.stringify(route.target_statute)}`);
  console.log(`  req_current    = ${route.requires_current_context}`);
  console.log(`  ambiguous      = ${JSON.stringify(route.ambiguous_terms)}`);
  console.log(`  confidence     = ${route.confidence}`);
  console.log(`  notes          = ${route.notes}`);

  const cat = tc.catastrophic(route);
  const hard = tc.hard(route);
  const soft = tc.soft(route);

  for (const m of cat) { console.log(`✗✗ CATASTROPHIC: ${m}`); catastrophic.push(`${tc.id}: ${m}`); }
  for (const m of hard) console.log(`✗  HARD: ${m}`);
  for (const m of soft) console.log(`~  SOFT: ${m}`);
  if (cat.length === 0 && hard.length === 0)
    console.log(soft.length === 0 ? "✓ PASS (all)" : "✓ PASS (with soft warnings)");

  summary.push({
    id: tc.id,
    status: cat.length ? "CATASTROPHIC" : hard.length ? "HARD_FAIL" : soft.length ? "SOFT_WARN" : "PASS",
    query_type: route.query_type,
    legal_domain: route.legal_domain,
    target: route.target_statute?.name,
    timed_out,
    duration_ms: dur,
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

const blocking =
  catastrophic.length > 0 || timeouts > 1 || passed < CASES.length - 1;

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
