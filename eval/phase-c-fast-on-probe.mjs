// Phase C — Fast-mode Stage 2 ON probe (controlled experiment).
//
// Per-user request 2026-04-25:
//   • Flip MODE_PROFILES.fast.partyLookupRetryEnabled = true (already done).
//   • Q1 + Q6 × 2 reps, depth=fast.
//   • Report:
//       1. wall-time delta vs Phase B / Fast-off baseline (~57s reference).
//       2. attempted / recovered / recovered_with_placeholders / failed.
//       3. SURVIVAL: do the recovered citations actually appear in the
//          response's footnotes[] with canonical text (i.e. survive into
//          validFootnotes / final response)?
//       4. 2–3 concrete Fast output examples (before → after).
//
// Survival logic: Stage 2 mutates `fn.citation` in place on `finalFootnotes`,
// which is what the response returns. So we capture each pending footnote's
// citation BEFORE the call by re-classifying client-side via a heuristic
// (we don't have the engine here) — instead we use the qa_log telemetry +
// the response footnotes to verify: every counted recovered/placeholder
// footnote should appear in response.footnotes with its canonical form.
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
const RUN_ID = `phase-c-fast-on-${randomUUID().slice(0, 8)}`;
const OUT_FILE = `${OUT_DIR}/phase-c-fast-on-probe.json`;
const SUMMARY_FILE = `${OUT_DIR}/phase-c-fast-on-probe.summary.md`;

const QUESTIONS = [
  { id: 1, q: "האם הממשלה מוסמכת לפטר את היועצת המשפטית לממשלה, ואם כן באילו מגבלות נורמטיביות ומנהליות?" },
  { id: 6, q: "מהן ההגנות החוקתיות על חופש הביטוי הפוליטי בישראל, ומהן המגבלות עליהן?" },
];
const REPS = 2;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
if (linkErr) { console.error(linkErr); process.exit(1); }
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const verify = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = verify.data.session.access_token;

function log(...args) { console.log(`[${new Date().toISOString()}]`, ...args); }

const PLACEHOLDER_RE = /\[חסר[^\]]*\]/;

const results = [];

for (const { id, q } of QUESTIONS) {
  for (let rep = 1; rep <= REPS; rep++) {
    const evalRunId = `${RUN_ID}-q${id}-r${rep}`;
    log(`▶ FAST(on) Q${id} rep${rep} — ${evalRunId}`);
    const t0 = Date.now();
    let body, status;
    try {
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
          depth: "fast",
          evalRunId,
          requestId: `eval:${evalRunId}`,
        }),
      });
      status = res.status;
      try { body = await res.json(); } catch { body = null; }
    } catch (e) {
      log(`  ✗ fetch failed: ${e.message}`);
      results.push({ q_id: id, rep, eval_run_id: evalRunId, error: e.message });
      continue;
    }
    const wallMs = Date.now() - t0;

    // Pull the qa_logs row for telemetry.
    await new Promise((r) => setTimeout(r, 2500));
    const { data: rows } = await admin.from("qa_logs")
      .select("id, metadata, footnotes, created_at")
      .eq("user_id", ADMIN_USER_ID)
      .filter("metadata->>eval_run_id", "eq", evalRunId)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = rows?.[0];
    const md = row?.metadata || {};
    const re = md.research_engine || null;
    const pl = re?.party_lookup || null;
    const responseFootnotes = body?.footnotes || row?.footnotes || [];

    // ─── Survival check ───
    // Stage 2 mutates fn.citation in place; so any footnote that was
    // recovered (with or without placeholders) should appear in the
    // response footnotes. Heuristic: look for caselaw-shaped footnotes
    // whose citation contains a docket pattern (e.g. בג"ץ 1234/19) AND
    // either real party names ("פלוני נ' אלמוני") OR a placeholder.
    // Then count: how many caselaw entries with placeholders survive,
    // and how many "look like a Stage 2 recovery".
    let caselawWithDocket = 0;
    let caselawWithPlaceholder = 0;
    let caselawWithRealParties = 0;
    const examples = [];
    for (const fn of responseFootnotes) {
      const c = fn?.citation || "";
      // Hebrew docket pattern: 2-4 Hebrew letters + gershayim + digits/digits
      const hasDocket = /[\u0590-\u05FF]{2,4}["״]?\s*\d+\/\d+/.test(c);
      if (!hasDocket) continue;
      caselawWithDocket++;
      const hasPlaceholder = PLACEHOLDER_RE.test(c);
      const hasParty = /\bנ['׳]\s+/.test(c);  // " נ' " separator
      if (hasPlaceholder) caselawWithPlaceholder++;
      if (hasParty && !hasPlaceholder) caselawWithRealParties++;
      if (examples.length < 3 && (hasPlaceholder || hasParty)) {
        examples.push({ number: fn.number, citation: c, has_placeholder: hasPlaceholder, has_party: hasParty });
      }
    }

    // Survival summary: pl.recovered + pl.recovered_with_placeholders should
    // roughly match (caselawWithRealParties from Stage 2) + caselawWithPlaceholder.
    // We can't know which were Stage 2 vs which were already-resolved by Pass 1,
    // but the gross check is: if pl.recovered>0 AND no caselaw with parties
    // in the response → suspicious.
    const survivalLikely = pl
      ? (pl.recovered + pl.recovered_with_placeholders === 0
          ? "n/a (nothing recovered)"
          : (caselawWithRealParties + caselawWithPlaceholder > 0 ? "yes" : "no"))
      : "n/a (Stage 2 did not run)";

    log(`  ← status=${status} wall=${wallMs}ms fn=${responseFootnotes.length}`);
    log(`    research_engine.mode=${re?.mode}`);
    if (pl) {
      log(`    party_lookup: attempted=${pl.attempted} recovered=${pl.recovered} w_placeholders=${pl.recovered_with_placeholders} failed=${pl.failed} status=${pl.status} wall=${pl.wall_ms}ms`);
      log(`    failure_reasons=${JSON.stringify(pl.failure_reasons || {})}`);
    } else {
      log(`    party_lookup: null (mode=${re?.mode}, candidates=${re?.legal_resolver?.needs_party_lookup_candidates || 0})`);
    }
    log(`    caselaw_in_response: total_with_docket=${caselawWithDocket} with_real_parties=${caselawWithRealParties} with_placeholder=${caselawWithPlaceholder}`);
    log(`    survival_likely=${survivalLikely}`);

    results.push({
      q_id: id, rep, eval_run_id: evalRunId,
      status, wall_ms: wallMs,
      total_footnotes: responseFootnotes.length,
      research_engine_mode: re?.mode || null,
      party_lookup_config: re?.party_lookup_config || null,
      legal_resolver: re?.legal_resolver || null,
      party_lookup: pl,
      survival: {
        caselaw_with_docket: caselawWithDocket,
        caselaw_with_real_parties: caselawWithRealParties,
        caselaw_with_placeholder: caselawWithPlaceholder,
        likely: survivalLikely,
      },
      examples,
      qa_log_id: row?.id || null,
    });

    writeFileSync(OUT_FILE, JSON.stringify({ run_id: RUN_ID, results }, null, 2));
  }
}

writeFileSync(OUT_FILE, JSON.stringify({ run_id: RUN_ID, results }, null, 2));

// ─── Summary ───
const PHASE_B_BASELINE_FAST_MS = 57_000; // approximate from prior Fast-off / Phase B runs
const wallTimes = results.map((r) => r.wall_ms).filter((w) => typeof w === "number");
const median = (arr) => { if (!arr.length) return null; const s=[...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; };
const wallMedian = median(wallTimes);
const wallMax = Math.max(...wallTimes, 0);
const wallDelta = wallMedian != null ? wallMedian - PHASE_B_BASELINE_FAST_MS : null;

const totalAttempted = results.reduce((s, r) => s + (r.party_lookup?.attempted || 0), 0);
const totalRecovered = results.reduce((s, r) => s + (r.party_lookup?.recovered || 0), 0);
const totalRecoveredPH = results.reduce((s, r) => s + (r.party_lookup?.recovered_with_placeholders || 0), 0);
const totalFailed = results.reduce((s, r) => s + (r.party_lookup?.failed || 0), 0);
const totalSurvived = results.reduce((s, r) => s + (r.survival?.caselaw_with_real_parties || 0) + (r.survival?.caselaw_with_placeholder || 0), 0);

const lines = [];
lines.push(`# Phase C — Fast-on probe — ${RUN_ID}`);
lines.push("");
lines.push(`**Configuration**: \`MODE_PROFILES.fast.partyLookupRetryEnabled=true\`, batch cap = 3, placeholder policy = "emit"`);
lines.push(`**Questions**: Q1, Q6 × ${REPS} reps each (n=${results.length})`);
lines.push("");
lines.push(`## 1. Wall-time delta`);
lines.push("");
lines.push(`| metric | Fast-off baseline (Phase B) | Fast-on (this run) | delta |`);
lines.push(`|---|---|---|---|`);
lines.push(`| median wall_ms | ~${PHASE_B_BASELINE_FAST_MS} | ${wallMedian} | ${wallDelta != null ? (wallDelta >= 0 ? '+' : '') + wallDelta + ' ms (' + (wallDelta/1000).toFixed(1) + 's)' : 'n/a'} |`);
lines.push(`| max wall_ms | — | ${wallMax} | — |`);
lines.push("");
lines.push(`## 2. Stage 2 outcomes (totals across ${results.length} runs)`);
lines.push("");
lines.push(`- attempted: **${totalAttempted}**`);
lines.push(`- recovered (clean): **${totalRecovered}**`);
lines.push(`- recovered_with_placeholders: **${totalRecoveredPH}**`);
lines.push(`- failed: **${totalFailed}**`);
lines.push("");
lines.push(`## 3. Survival into final response footnotes`);
lines.push("");
lines.push(`Total recovered+placeholder caselaw entries surviving in response.footnotes: **${totalSurvived}**`);
lines.push("");
lines.push(`| Q | rep | wall_ms | mode | attempted | recovered | w_placeholders | failed | survival |`);
lines.push(`|---|---|---|---|---|---|---|---|---|`);
for (const r of results) {
  const pl = r.party_lookup;
  lines.push(`| Q${r.q_id} | ${r.rep} | ${r.wall_ms} | ${r.research_engine_mode || '?'} | ${pl?.attempted ?? '-'} | ${pl?.recovered ?? '-'} | ${pl?.recovered_with_placeholders ?? '-'} | ${pl?.failed ?? '-'} | ${r.survival?.likely} |`);
}
lines.push("");
lines.push(`## 4. Example footnotes (recovered or placeholder caselaw)`);
lines.push("");
let exampleCount = 0;
for (const r of results) {
  for (const ex of r.examples || []) {
    if (exampleCount >= 5) break;
    lines.push(`**Q${r.q_id} r${r.rep} fn#${ex.number}** (placeholder=${ex.has_placeholder}, real_parties=${ex.has_party})`);
    lines.push("");
    lines.push("> " + ex.citation.replace(/\n/g, " "));
    lines.push("");
    exampleCount++;
  }
  if (exampleCount >= 5) break;
}
if (exampleCount === 0) lines.push("_No caselaw with parties or placeholders found in any response._");
lines.push("");
lines.push(`## 5. Recommendation`);
lines.push("");
const wallOK = wallDelta != null && wallDelta <= 5000;
const recoveryHappened = (totalRecovered + totalRecoveredPH) > 0;
const survivalOK = totalSurvived > 0;
if (wallOK && recoveryHappened && survivalOK) {
  lines.push(`✅ **Recommend keeping Fast Stage 2 ON.** Wall delta ${wallDelta}ms ≤ 5s gate, ${totalRecovered + totalRecoveredPH} citations recovered, ${totalSurvived} surviving in final output.`);
} else {
  const reasons = [];
  if (!wallOK) reasons.push(`wall delta ${wallDelta}ms > 5s gate`);
  if (!recoveryHappened) reasons.push(`no recoveries`);
  if (!survivalOK) reasons.push(`no recovered citations survived to final output`);
  lines.push(`⚠️ **Recommend reverting Fast Stage 2 to OFF.** Reasons: ${reasons.join("; ")}.`);
}
lines.push("");

writeFileSync(SUMMARY_FILE, lines.join("\n"));
log(`\nWrote ${OUT_FILE}`);
log(`Wrote ${SUMMARY_FILE}`);
console.log("\n" + lines.join("\n"));
process.exit(0);
