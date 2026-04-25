// Phase C — research-mode Stage 2 party-lookup retry validation probe.
//
// Plan (matches the approved Phase C plan in .lovable/plan.md):
//   • Deep: flag default-on. Verify party_lookup populates and at least one
//     recovery happens across Q1+Q6 × 2 reps. wall_ms ≤ +30% baseline.
//   • Fast: flag default-off. Verify party_lookup === null and behaviour
//     stays Phase B (canonical_reemission). Same questions, 1 rep — pure
//     gate-works regression check.
//
// Reads metadata.research_engine from qa_logs.
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";
if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
  console.error("Missing SUPABASE_* env vars");
  process.exit(1);
}

const OUT_DIR = "/mnt/documents/legal-qa-eval";
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const RUN_ID = `phase-c-${randomUUID().slice(0, 8)}`;
const OUT_FILE = `${OUT_DIR}/phase-c-research-router.json`;

const QUESTIONS = [
  { id: 1, q: "האם הממשלה מוסמכת לפטר את היועצת המשפטית לממשלה, ואם כן באילו מגבלות נורמטיביות ומנהליות?" },
  { id: 6, q: "מהן ההגנות החוקתיות על חופש הביטוי הפוליטי בישראל, ומהן המגבלות עליהן?" },
];

// Plan: Deep×2 reps (real Stage 2 attempt), Fast×1 rep (pure gate test).
const RUN_PLAN = [
  { depth: "deep", reps: 2 },
  { depth: "fast", reps: 1 },
];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const verify = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = verify.data.session.access_token;

function log(...args) { console.log(`[${new Date().toISOString()}]`, ...args); }

const results = [];

for (const { depth, reps } of RUN_PLAN) {
  for (const { id, q } of QUESTIONS) {
    for (let rep = 1; rep <= reps; rep++) {
      const evalRunId = `${RUN_ID}-${depth}-q${id}-r${rep}`;
      log(`▶ ${depth} Q${id} rep${rep} — eval_run_id=${evalRunId}`);
      const t0 = Date.now();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
          apikey: ANON_KEY,
        },
        body: JSON.stringify({
          question: q,
          taskMode: "research",
          depth,
          evalRunId,
          requestId: `eval:${evalRunId}`,
        }),
      });
      const wallMs = Date.now() - t0;
      let body;
      try { body = await res.json(); } catch { body = null; }
      log(`  ← status=${res.status} wall=${wallMs}ms answer_words=${(body?.answer||"").split(/\s+/).filter(Boolean).length} fn=${(body?.footnotes||[]).length}`);

      // Pull the qa_logs row.
      await new Promise((r) => setTimeout(r, 2500));
      const { data: rows } = await admin.from("qa_logs")
        .select("id, metadata, created_at")
        .eq("user_id", ADMIN_USER_ID)
        .filter("metadata->>eval_run_id", "eq", evalRunId)
        .order("created_at", { ascending: false })
        .limit(1);
      const row = rows?.[0];
      const md = row?.metadata || {};
      const re = md.research_engine || null;
      log(`  research_engine.mode=${re?.mode} party_lookup=${re?.party_lookup ? JSON.stringify(re.party_lookup) : 'null'}`);
      if (re) {
        log(`    legal=${re.legal_resolver?.resolved_count}/${(re.legal_resolver?.resolved_count||0) + (re.legal_resolver?.unresolved_count||0)} rewrites=${re.legal_resolver?.canonical_rewrites} needs_party_lookup_candidates=${re.legal_resolver?.needs_party_lookup_candidates}`);
        log(`    cfg=${JSON.stringify(re.party_lookup_config)}`);
      }
      results.push({
        depth, q_id: id, rep, eval_run_id: evalRunId, wall_ms: wallMs,
        status: res.status,
        answer_words: (body?.answer || "").split(/\s+/).filter(Boolean).length,
        footnote_count: (body?.footnotes || []).length,
        research_engine: re,
        qa_log_id: row?.id || null,
      });
    }
  }
}

writeFileSync(OUT_FILE, JSON.stringify({ run_id: RUN_ID, results }, null, 2));
log(`Wrote ${OUT_FILE}`);

// ─── Summary tables ───
console.log("\n=== Phase C summary ===");
for (const depth of ["deep", "fast"]) {
  const sub = results.filter((r) => r.depth === depth);
  if (sub.length === 0) continue;
  console.log(`\n▼ ${depth}`);
  console.log("q_id rep  wall_ms  fn  legal_R/A  cand  pl_attempted  pl_recovered  pl_w_placeholders  pl_failed  pl_status  pl_wall_ms");
  for (const r of sub) {
    const re = r.research_engine || {};
    const lr = re.legal_resolver || {};
    const pl = re.party_lookup;
    const total = (lr.resolved_count || 0) + (lr.unresolved_count || 0);
    console.log(
      `Q${r.q_id}   ${r.rep}    ${String(r.wall_ms).padStart(6)}   ${String(r.footnote_count).padStart(2)}  ${lr.resolved_count || 0}/${total}        ${lr.needs_party_lookup_candidates || 0}     ${pl?.attempted ?? '-'}            ${pl?.recovered ?? '-'}             ${pl?.recovered_with_placeholders ?? '-'}                 ${pl?.failed ?? '-'}        ${pl?.status ?? '-'}      ${pl?.wall_ms ?? '-'}`
    );
  }
}

// Acceptance gates from the plan.
console.log("\n=== Acceptance ===");
const deepRows = results.filter((r) => r.depth === "deep");
const deepAttempted = deepRows.reduce((s, r) => s + (r.research_engine?.party_lookup?.attempted || 0), 0);
const deepRecovered = deepRows.reduce((s, r) => s + ((r.research_engine?.party_lookup?.recovered || 0) + (r.research_engine?.party_lookup?.recovered_with_placeholders || 0)), 0);
const deepMaxWall = Math.max(...deepRows.map((r) => r.wall_ms), 0);
const deepMedianWall = (() => {
  const xs = deepRows.map((r) => r.wall_ms).sort((a,b)=>a-b);
  return xs.length ? xs[Math.floor(xs.length/2)] : 0;
})();
console.log(`Deep: attempted=${deepAttempted}  recovered_or_placeholder=${deepRecovered}  median_wall=${deepMedianWall}ms  max_wall=${deepMaxWall}ms`);

const fastRows = results.filter((r) => r.depth === "fast");
const fastPlNonNull = fastRows.filter((r) => r.research_engine?.party_lookup !== null && r.research_engine?.party_lookup !== undefined).length;
const fastFlagOff = fastRows.every((r) => r.research_engine?.party_lookup_config?.enabled === false);
console.log(`Fast: party_lookup_present_count=${fastPlNonNull} (expected 0)  flag_off=${fastFlagOff}`);
console.log(`Fast modes: ${[...new Set(fastRows.map((r) => r.research_engine?.mode))].join(", ")}`);

process.exit(0);
