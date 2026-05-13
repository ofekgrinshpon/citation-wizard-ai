// Phase 5 — Targeted Gap Retrieval (Round 2) probe.
//
// Fires the same question in Fast and Deep with explicit evalRunIds, then
// inspects qa_logs.metadata for:
//   - research_safeguards.router (query_type / legal_domain)
//   - research_safeguards.source_pack_gate
//   - research_safeguards.targeted_retrieval_round_2 (full payload)
//   - retrievalFunnel.round_2.reason
//   - any sourcePack item with provenance="open_web_discovery" (must be 0)

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
    id: "Q1-contracts-amendment",
    question:
      "האם התיקון האחרון לחוק החוזים מהווה שינוי מהותי מההלכה הקיימת בפרשנות חוזים?",
  },
  {
    id: "Q2-consumer-deception-amendment",
    question:
      "האם התיקון האחרון לחוק הגנת הצרכן בעניין הטעיה בפרסום משנה את ההלכה הקיימת?",
  },
];

const DEPTHS = ["deep", "fast"];

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
  const evalRunId = `phase5-r2-${tc.id}-${depth}-${randomUUID()}`;
  const t0 = Date.now();
  let httpStatus = -1;
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
        evalVariant: "phase5-targeted-round2",
        requestId: `eval:${evalRunId}`,
      }),
    });
    httpStatus = res.status;
    try { await res.text(); } catch {}
  } catch (e) {
    console.warn(`[${tc.id}/${depth}] fetch failed: ${e.message}`);
  }
  const wallMs = Date.now() - t0;

  // Poll qa_logs for the row keyed by evalRunId.
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
  return { evalRunId, httpStatus, wallMs, row };
}

function summarizePackProvenance(metadata) {
  const pack = metadata?.source_pack ?? metadata?.sourcePack ?? [];
  const provenanceCounts = {};
  let openWeb = 0;
  for (const it of Array.isArray(pack) ? pack : []) {
    const p =
      it?.provenance ??
      it?.provenanceInternal ??
      it?.provenance_internal ??
      "unknown";
    provenanceCounts[p] = (provenanceCounts[p] || 0) + 1;
    if (p === "open_web_discovery") openWeb++;
  }
  return { provenanceCounts, openWeb, packSize: Array.isArray(pack) ? pack.length : 0 };
}

function printRun({ tc, depth, evalRunId, httpStatus, wallMs, row }) {
  console.log(`\n──────── ${tc.id} | depth=${depth} ────────`);
  console.log(`  evalRunId   : ${evalRunId}`);
  console.log(`  HTTP        : ${httpStatus}  wall=${wallMs}ms`);
  if (!row) {
    console.log("  ✗ no qa_logs row found within polling window");
    return { ok: false };
  }
  const md = row.metadata ?? {};
  const rs = md.research_safeguards ?? {};
  const router = rs.router ?? {};
  const gate = rs.source_pack_gate ?? null;
  const r2 = rs.targeted_retrieval_round_2 ?? null;
  const funnelR2 = md.retrieval_funnel?.round_2 ?? null;
  const prov = summarizePackProvenance(md);

  console.log(`  router      : query_type=${router.query_type ?? "∅"} legal_domain=${router.legal_domain ?? "∅"} status=${router.status ?? "∅"} timed_out=${router.timed_out ?? "∅"}`);
  console.log(`  gate(final) : mode=${gate?.mode ?? "∅"} ok=${gate?.ok ?? "∅"} missing=${JSON.stringify(gate?.missing ?? [])} blocking=${JSON.stringify(gate?.blocking_missing ?? [])} banner_attached=${gate?.banner_attached ?? "∅"}`);
  if (!r2) {
    console.log("  round_2     : ✗ targeted_retrieval_round_2 telemetry MISSING from metadata");
  } else {
    console.log(`  round_2.mode               : ${r2.mode}`);
    console.log(`  round_2.ran                : ${r2.ran}`);
    console.log(`  round_2.reason             : ${r2.reason}`);
    console.log(`  round_2.gaps_before        : ${JSON.stringify(r2.gaps_before)}`);
    console.log(`  round_2.gaps_eligible      : ${JSON.stringify(r2.gaps_eligible)}`);
    console.log(`  round_2.gaps_after         : ${JSON.stringify(r2.gaps_after)}`);
    console.log(`  round_2.gap_queries        : ${JSON.stringify(r2.gap_queries)}`);
    console.log(`  round_2.planner_queries    : ${JSON.stringify(r2.planner_queries)}`);
    console.log(`  round_2.queries_used       : ${JSON.stringify(r2.queries_used)} (count=${(r2.queries_used ?? []).length})`);
    console.log(`  round_2.new_cards_added    : ${r2.new_cards_added}`);
    console.log(`  round_2.pack_counts_before : ${JSON.stringify(r2.source_pack_counts_before)}`);
    console.log(`  round_2.pack_counts_after  : ${JSON.stringify(r2.source_pack_counts_after)}`);
    console.log(`  round_2.duration_ms        : ${r2.duration_ms}  timed_out=${r2.timed_out}`);
  }
  console.log(`  funnel.round_2.reason      : ${funnelR2?.reason ?? "∅"}`);
  console.log(`  sourcePack provenance      : ${JSON.stringify(prov.provenanceCounts)} (size=${prov.packSize}) open_web=${prov.openWeb}`);
  return { ok: true, r2, gate, prov, depth };
}

function judgeRun({ depth, r2, prov }) {
  const issues = [];
  if (prov.openWeb > 0) issues.push(`open_web_discovery in sourcePack: ${prov.openWeb}`);
  if (!r2) {
    issues.push("targeted_retrieval_round_2 telemetry missing");
    return issues;
  }
  if (depth === "deep" && r2.mode !== "full") issues.push(`Deep mode expected="full", got "${r2.mode}"`);
  if (depth === "fast" && r2.mode !== "essential_only") issues.push(`Fast mode expected="essential_only", got "${r2.mode}"`);
  const cap = depth === "deep" ? 6 : 2;
  if ((r2.queries_used ?? []).length > cap) issues.push(`queries_used.length=${r2.queries_used.length} > cap ${cap}`);
  // Pack must not degrade.
  const before = r2.source_pack_counts_before ?? {};
  const after = r2.source_pack_counts_after ?? {};
  for (const k of ["core", "supporting", "secondary"]) {
    if ((after[k] ?? 0) < (before[k] ?? 0)) issues.push(`pack ${k} degraded ${before[k]}→${after[k]}`);
  }
  if (r2.ran) {
    const ga = (r2.gaps_after ?? []).length;
    const gb = (r2.gaps_before ?? []).length;
    if (ga > gb) issues.push(`gaps_after(${ga}) > gaps_before(${gb})`);
  }
  return issues;
}

// ──────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────

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
    judgments.push({ id: run.tc.id, depth: run.depth, issues: ["no qa_logs row"] });
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
console.log(`\n${pass}/${total} runs passed Phase 5 invariants`);
process.exit(pass === total ? 0 : 1);
