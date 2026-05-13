// Phase 5 — Forced-gap rehearsal (eval-only mechanism).
//
// Exercises the actual gap-rescue execution path (`reason="ran"`) by injecting
// `evalForceMissingSlots` into the preliminary source_pack_gate.missing[]
// inside legal-qa. Admin-only; activates only when evalRunId starts with
// "phase5-".
//
// Three runs:
//   1. Fast + ["authoritative_source_for_amendment"] → must run
//   2. Deep + ["prior_text_or_explanatory"]          → must run
//   3. Fast + ["prior_text_or_explanatory"]          → must NOT run
//      (preferred-only gap blocked by essential_only mode)

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

const QUESTION =
  "האם התיקון האחרון לחוק החוזים מהווה שינוי מהותי מההלכה הקיימת בפרשנות חוזים?";

const CASES = [
  {
    id: "T1-fast-essential",
    depth: "fast",
    forced: ["authoritative_source_for_amendment"],
    expect: {
      mode: "essential_only",
      ran: true,
      reason: "ran",
      maxQueries: 2,
      mustIncludeAnyQueryRe: [/חוק החוזים.*תיקון.*נוסח עדכני/, /ס"ח/],
    },
  },
  {
    id: "T2-deep-preferred",
    depth: "deep",
    forced: ["prior_text_or_explanatory"],
    expect: {
      mode: "full",
      ran: true,
      reason: "ran",
      maxQueries: 6,
      mustIncludeAnyQueryRe: [/חוק החוזים דברי הסבר הצעת חוק/],
    },
  },
  {
    id: "T3-fast-preferred-only",
    depth: "fast",
    forced: ["prior_text_or_explanatory"],
    expect: {
      mode: "essential_only",
      ran: false,
      reason: "essential_only_preferred_gaps_only",
    },
  },
];

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

async function callPipeline(jwt, tc) {
  const evalRunId = `phase5-forced-gap-${tc.id}-${randomUUID()}`;
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
        question: QUESTION,
        taskMode: "research",
        depth: tc.depth,
        evalRunId,
        evalVariant: "phase5-forced-gap",
        evalForceMissingSlots: tc.forced,
        requestId: `eval:${evalRunId}`,
      }),
    });
    httpStatus = res.status;
    try { await res.text(); } catch {}
  } catch (e) {
    console.warn(`[${tc.id}] fetch failed: ${e.message}`);
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
  return { evalRunId, httpStatus, wallMs, row };
}

function summarizeProvenance(metadata) {
  const pack = metadata?.source_pack ?? metadata?.sourcePack ?? [];
  let openWeb = 0;
  for (const it of Array.isArray(pack) ? pack : []) {
    const p = it?.provenance ?? it?.provenanceInternal ?? "unknown";
    if (p === "open_web_discovery") openWeb++;
  }
  return openWeb;
}

function judge(tc, r2, openWeb) {
  const issues = [];
  if (!r2) {
    issues.push("targeted_retrieval_round_2 telemetry MISSING");
    return issues;
  }
  if (openWeb > 0) issues.push(`open_web_discovery in sourcePack: ${openWeb}`);
  if (r2.mode !== tc.expect.mode) issues.push(`mode=${r2.mode} expected ${tc.expect.mode}`);
  if (r2.ran !== tc.expect.ran) issues.push(`ran=${r2.ran} expected ${tc.expect.ran}`);
  if (r2.reason !== tc.expect.reason) issues.push(`reason=${r2.reason} expected ${tc.expect.reason}`);

  // forced_eval_gaps must echo what we sent.
  const echoed = JSON.stringify(r2.forced_eval_gaps ?? []);
  const sent = JSON.stringify(tc.forced);
  if (echoed !== sent) issues.push(`forced_eval_gaps echo mismatch: ${echoed} vs ${sent}`);

  if (tc.expect.ran) {
    const elig = r2.gaps_eligible ?? [];
    for (const f of tc.forced) {
      if (!elig.includes(f)) issues.push(`gaps_eligible missing forced slot ${f}`);
    }
    const used = r2.queries_used ?? [];
    if (used.length > tc.expect.maxQueries)
      issues.push(`queries_used.length=${used.length} > cap ${tc.expect.maxQueries}`);
    for (const re of tc.expect.mustIncludeAnyQueryRe ?? []) {
      if (!used.some((q) => re.test(q)))
        issues.push(`no query matches ${re}`);
    }
    const before = r2.source_pack_counts_before ?? {};
    const after = r2.source_pack_counts_after ?? {};
    for (const k of ["core", "supporting", "secondary"]) {
      if ((after[k] ?? 0) < (before[k] ?? 0))
        issues.push(`pack ${k} degraded ${before[k]}→${after[k]}`);
    }
  }
  return issues;
}

// ──────────────────────────────────────────────────────────────────
const jwt = await getJwt();
console.log(`✓ admin JWT acquired (len=${jwt.length})`);

const results = [];
for (const tc of CASES) {
  process.stdout.write(`▶ ${tc.id} depth=${tc.depth} forced=${JSON.stringify(tc.forced)} ... `);
  const r = await callPipeline(jwt, tc);
  process.stdout.write(`HTTP ${r.httpStatus} (${r.wallMs}ms) ${r.row ? "row✓" : "row✗"}\n`);
  results.push({ tc, ...r });
}

console.log("\n════════════ PER-RUN INSPECTION ════════════");
let pass = 0;
for (const { tc, evalRunId, row } of results) {
  console.log(`\n──── ${tc.id} (depth=${tc.depth}) ────`);
  console.log(`  evalRunId: ${evalRunId}`);
  if (!row) { console.log("  ✗ no qa_logs row"); continue; }
  const md = row.metadata ?? {};
  const r2 = md.research_safeguards?.targeted_retrieval_round_2 ?? null;
  const gate = md.research_safeguards?.source_pack_gate ?? null;
  const funnelR2 = md.retrieval_funnel?.round_2 ?? null;
  const openWeb = summarizeProvenance(md);

  console.log(`  gate(final): mode=${gate?.mode} ok=${gate?.ok} missing=${JSON.stringify(gate?.missing ?? [])}`);
  if (r2) {
    console.log(`  r2.mode               : ${r2.mode}`);
    console.log(`  r2.ran                : ${r2.ran}`);
    console.log(`  r2.reason             : ${r2.reason}`);
    console.log(`  r2.forced_eval_gaps   : ${JSON.stringify(r2.forced_eval_gaps)}`);
    console.log(`  r2.gaps_before        : ${JSON.stringify(r2.gaps_before)}`);
    console.log(`  r2.gaps_eligible      : ${JSON.stringify(r2.gaps_eligible)}`);
    console.log(`  r2.gaps_after         : ${JSON.stringify(r2.gaps_after)}`);
    console.log(`  r2.gap_queries        : ${JSON.stringify(r2.gap_queries)}`);
    console.log(`  r2.queries_used       : ${JSON.stringify(r2.queries_used)} (count=${(r2.queries_used ?? []).length})`);
    console.log(`  r2.new_cards_added    : ${r2.new_cards_added}`);
    console.log(`  r2.pack_counts_before : ${JSON.stringify(r2.source_pack_counts_before)}`);
    console.log(`  r2.pack_counts_after  : ${JSON.stringify(r2.source_pack_counts_after)}`);
    console.log(`  r2.duration_ms        : ${r2.duration_ms}  timed_out=${r2.timed_out}`);
  } else {
    console.log("  ✗ targeted_retrieval_round_2 missing");
  }
  console.log(`  funnel.round_2.reason : ${funnelR2?.reason}`);
  console.log(`  open_web in pack      : ${openWeb}`);

  const issues = judge(tc, r2, openWeb);
  if (issues.length === 0) {
    console.log("  ✓ PASS");
    pass++;
  } else {
    for (const i of issues) console.log(`  ✗ ${i}`);
  }
}

console.log(`\n════════════ SUMMARY ════════════`);
console.log(`${pass}/${CASES.length} forced-gap rehearsals passed`);
process.exit(pass === CASES.length ? 0 : 1);
