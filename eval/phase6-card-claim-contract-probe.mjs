// Phase 6 — Card→Claim Citation Contract probe.
//
// Fires three queries × Fast/Deep with explicit evalRunIds, then inspects
// qa_logs.metadata.research_safeguards.card_claim_contract for:
//   - used / legacy_fallback / reason
//   - markers_found / unique_source_ids_used / invalid_source_ids
//   - generated_footnotes / formatter_usage
//   - source_id_usage / missing_metadata
//
// Also asserts:
//   - response.footnotes is non-empty and renders
//   - no open_web_discovery items in sourcePack (Phase 3 invariant)

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

const QUESTIONS = [
  {
    id: "QA-caselaw-heavy",
    question:
      "מהי הלכת בנק אפואים בעניין פרשנות חוזים, וכיצד היא משפיעה על פרשנות תניית שיפוט?",
  },
  {
    id: "QB-statute-changed-doctrine",
    question:
      "האם התיקון האחרון לחוק החוזים מהווה שינוי מהותי מההלכה הקיימת בפרשנות חוזים?",
  },
  {
    id: "QC-legislation-heavy",
    question: "מה הדין לגבי תנאי מקפח בחוזה אחיד?",
  },
];

const DEPTHS = ["fast", "deep"];

async function getJwt() {
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: ADMIN_EMAIL,
  });
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const v = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  return v.data.session.access_token;
}

async function callPipeline(jwt, tc, depth) {
  const evalRunId = `phase6-ccc-${tc.id}-${depth}-${randomUUID()}`;
  const t0 = Date.now();
  let httpStatus = -1;
  let respJson = null;
  try {
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
        depth,
        evalRunId,
        evalVariant: "phase6-card-claim-contract",
        requestId: `eval:${evalRunId}`,
      }),
    });
    httpStatus = res.status;
    try { respJson = await res.json(); } catch {}
  } catch (e) {
    console.warn(`[${tc.id}/${depth}] fetch failed: ${e.message}`);
  }
  const wallMs = Date.now() - t0;

  let row = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data } = await admin
      .from("qa_logs")
      .select("id, metadata, created_at")
      .eq("user_id", ADMIN_USER_ID)
      .filter("metadata->>eval_run_id", "eq", evalRunId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data?.[0]) { row = data[0]; break; }
  }
  return { evalRunId, httpStatus, wallMs, row, respJson };
}

function summarizeOpenWeb(metadata) {
  const pack = metadata?.source_pack ?? metadata?.sourcePack ?? [];
  let openWeb = 0;
  for (const it of Array.isArray(pack) ? pack : []) {
    const p = it?.provenance ?? it?.provenanceInternal ?? it?.provenance_internal;
    if (p === "open_web_discovery") openWeb++;
  }
  return openWeb;
}

function printRun({ tc, depth, evalRunId, httpStatus, wallMs, row, respJson }) {
  console.log(`\n──────── ${tc.id} | depth=${depth} ────────`);
  console.log(`  evalRunId   : ${evalRunId}`);
  console.log(`  HTTP        : ${httpStatus}  wall=${wallMs}ms`);
  const fnCount = Array.isArray(respJson?.footnotes) ? respJson.footnotes.length : 0;
  const ansLen = (respJson?.answer ?? "").length;
  console.log(`  response    : answer=${ansLen} chars  footnotes=${fnCount}`);
  if (!row) {
    console.log("  ✗ no qa_logs row found within polling window");
    return { ok: false, fnCount };
  }
  const md = row.metadata ?? {};
  const ccc = md.research_safeguards?.card_claim_contract ?? null;
  const openWeb = summarizeOpenWeb(md);
  if (!ccc) {
    console.log("  ✗ card_claim_contract telemetry MISSING");
    return { ok: false, fnCount };
  }
  console.log(`  ccc.mode                 : ${ccc.mode}`);
  console.log(`  ccc.used                 : ${ccc.used}  legacy_fallback=${ccc.legacy_fallback}  reason=${ccc.reason}`);
  console.log(`  ccc.markers_found        : ${ccc.markers_found}`);
  console.log(`  ccc.unique_source_ids    : ${ccc.unique_source_ids_used}`);
  console.log(`  ccc.invalid_source_ids   : ${JSON.stringify(ccc.invalid_source_ids)}`);
  console.log(`  ccc.claims_with_sources  : ${ccc.claims_with_sources}`);
  console.log(`  ccc.generated_footnotes  : ${ccc.generated_footnotes}`);
  console.log(`  ccc.formatter_usage      : ${JSON.stringify(ccc.formatter_usage)}`);
  console.log(`  ccc.source_id_usage      : ${JSON.stringify(ccc.source_id_usage)}`);
  console.log(`  ccc.missing_metadata     : ${JSON.stringify(ccc.missing_metadata)}`);
  console.log(`  ccc.resolver_failures    : ${JSON.stringify(ccc.resolver_failures ?? [])}`);
  console.log(`  open_web_discovery in pack: ${openWeb}`);
  return { ok: true, ccc, fnCount, openWeb };
}

function judgeRun({ ccc, fnCount, openWeb }) {
  const issues = [];
  if (openWeb > 0) issues.push(`open_web_discovery in sourcePack: ${openWeb}`);
  if (ccc.mode === "off") issues.push(`mode=off — Phase 6 should be on`);
  if (ccc.mode === "on") {
    if (!ccc.used) issues.push(`used=false (reason=${ccc.reason})`);
    if (ccc.markers_found < 2) issues.push(`markers_found=${ccc.markers_found} < 2`);
    if ((ccc.invalid_source_ids ?? []).length > 0) issues.push(`invalid_source_ids non-empty: ${JSON.stringify(ccc.invalid_source_ids)}`);
    if (ccc.generated_footnotes < 2) issues.push(`generated_footnotes=${ccc.generated_footnotes} < 2`);
    if (ccc.legacy_fallback) issues.push(`legacy_fallback=true`);
    if (fnCount === 0) issues.push(`response.footnotes empty`);
  }
  return issues;
}

const jwt = await getJwt();
console.log(`✓ admin JWT acquired (len=${jwt.length})`);

const allRuns = [];
for (const tc of QUESTIONS) {
  for (const depth of DEPTHS) {
    process.stdout.write(`▶ firing ${tc.id} depth=${depth} ... `);
    const r = await callPipeline(jwt, tc, depth);
    process.stdout.write(`HTTP ${r.httpStatus} (${r.wallMs}ms) ${r.row ? "row✓" : "row✗"}\n`);
    allRuns.push({ tc, depth, ...r });
  }
}

console.log("\n════════════ PER-RUN INSPECTION ════════════");
const judgments = [];
for (const run of allRuns) {
  const summary = printRun(run);
  if (summary.ok) {
    const issues = judgeRun(summary);
    judgments.push({ id: run.tc.id, depth: run.depth, issues });
  } else {
    judgments.push({ id: run.tc.id, depth: run.depth, issues: ["no qa_logs row or telemetry"] });
  }
}

console.log("\n════════════ JUDGMENT ════════════");
let total = 0, pass = 0;
for (const j of judgments) {
  total++;
  const ok = j.issues.length === 0;
  if (ok) pass++;
  console.log(`${ok ? "✓" : "✗"} ${j.id} depth=${j.depth} ${ok ? "PASS" : "issues=" + JSON.stringify(j.issues)}`);
}
console.log(`\n${pass}/${total} runs passed Phase 6 invariants`);
process.exit(pass === total ? 0 : 1);
