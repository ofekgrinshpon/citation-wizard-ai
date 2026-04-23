// Stability test for v7.10 — Milestone B.0 (soft-min supplementary retrieval).
// Same questions as v7.8, but now captures core.length + source_type_counts
// from the new metadata to verify the promotion gate is doing its job.
// Pass criteria:
//   - core.length >= 2 on at least 7/9 runs
//   - anchored citations >= 3 on at least 7/9 runs
//   - avg wall stays < 65s
//   - dropped_unanchored_count avg <= 3.6 (v7.8 baseline)

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY|PUBLISHABLE_KEY");
  process.exit(1);
}

const OUT_DIR = "/mnt/documents/legal-qa-eval";
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const RUN_ID = `stability-v710-${randomUUID()}`;
const OUT_FILE = `${OUT_DIR}/stability-v7.10.json`;
const LOG_FILE = `${OUT_DIR}/stability-v7.10.log`;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + "\n");
}

const QUESTIONS = [
  { id: 1, question: "האם הממשלה מוסמכת לפטר את היועצת המשפטית לממשלה, ואם כן באילו מגבלות נורמטיביות ומנהליות?", bucket: "constitutional_admin" },
  { id: 6, question: "באילו נסיבות ניתן לאכוף תניית אי-תחרות בחוזה עבודה בישראל?", bucket: "contract_labor" },
  { id: 21, question: "מה קובע סעיף 17 לחוק שירות המדינה (מינויים) לעניין פיטורים או הפסקת כהונה?", bucket: "statute_anchored" },
];
const REPETITIONS = 3;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function getAdminJwt() {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
  if (error) throw new Error(`generateLink failed: ${error.message}`);
  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error("no hashed_token in generateLink response");
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const verify = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (verify.error) throw new Error(`verifyOtp failed: ${verify.error.message}`);
  const jwt = verify.data?.session?.access_token;
  if (!jwt) throw new Error("no access_token after verifyOtp");
  return jwt;
}

async function callLegalQa(jwt, body) {
  const url = `${SUPABASE_URL}/functions/v1/legal-qa`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5 * 60 * 1000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep as text */ }
    return { status: res.status, body: json, raw: json ? null : text };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchQaLog(evalRunId, variant) {
  for (let i = 0; i < 8; i++) {
    const { data, error } = await admin
      .from("qa_logs")
      .select("id, created_at, answer, footnotes, total_footnotes, metadata")
      .eq("user_id", ADMIN_USER_ID)
      .filter("metadata->>eval_run_id", "eq", evalRunId)
      .filter("metadata->>eval_variant", "eq", variant)
      .order("created_at", { ascending: false })
      .limit(1);
    if (!error && data?.[0]) return data[0];
    if (error) log(`  qa_logs query error: ${error.message}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

function anchoredCount(footnotes) {
  if (!Array.isArray(footnotes)) return 0;
  return footnotes.filter((f) => typeof f?.url === "string" && f.url.length > 0).length;
}

function countWords(text) {
  if (typeof text !== "string") return 0;
  // Strip the footnote block before counting.
  const sepIdx = text.search(/---\s*הערות שוליים\s*---|\*\*\s*הערות שוליים\s*\*\*/);
  const body = sepIdx === -1 ? text : text.slice(0, sepIdx);
  return body.trim().split(/\s+/).filter(Boolean).length;
}

async function runOne(jwt, q, attempt) {
  const evalRunId = `${RUN_ID}:Q${q.id}:r${attempt}`;
  const requestId = `eval:${evalRunId}`;
  const start = Date.now();
  let httpResult;
  try {
    httpResult = await callLegalQa(jwt, {
      question: q.question,
      taskMode: "research",
      evalRunId,
      evalVariant: "structured",
      evalForceLegacy: false,
      requestId,
    });
  } catch (e) {
    return { ok: false, error: `fetch_failed: ${e?.message || e}`, wall_ms: Date.now() - start };
  }
  const wall_ms = Date.now() - start;
  const httpOk = httpResult.status === 200 && httpResult.body?.answer;
  const log_row = await fetchQaLog(evalRunId, "structured");
  const md = log_row?.metadata ?? {};
  const answer = httpOk ? httpResult.body.answer : (log_row?.answer ?? "");
  const footnotes = httpOk ? (httpResult.body.footnotes ?? []) : (log_row?.footnotes ?? []);
  const words = countWords(answer);
  const fnCount = Array.isArray(footnotes) ? footnotes.length : 0;
  const anchored = anchoredCount(footnotes);
  const density = words > 0 ? +(fnCount * 100 / words).toFixed(2) : 0;

  const sps = md.source_pack_summary && typeof md.source_pack_summary === "object" && !Array.isArray(md.source_pack_summary)
    ? md.source_pack_summary
    : null;
  const stc = md.source_type_counts ?? null;

  return {
    ok: httpOk,
    http_status: httpResult.status,
    http_error: httpOk ? null : (httpResult.body?.error || httpResult.raw || "unknown"),
    wall_ms,
    drafting_path: md.drafting_path ?? null,
    answer_chars: typeof answer === "string" ? answer.length : 0,
    answer_words: words,
    footnotes_count: fnCount,
    anchored_count: anchored,
    citation_density_per_100w: density,
    claim_map_summary: md.claim_map_summary ?? null,
    claim_map_allowed_count: md.claim_map_summary?.direct ?? null,
    dropped_unanchored_count: md.dropped_unanchored_count ?? null,
    dropped_unanchored_previews: md.dropped_unanchored_previews ?? null,
    models_used: md.models_used ?? null,
    stage_runs: md.stage_runs ?? null,
    source_pack_summary: sps,
    source_type_counts: stc,
    core_count: sps?.core ?? null,
    supporting_count: sps?.supporting ?? null,
    secondary_count: sps?.secondary ?? null,
    promoted_to_core: stc?.promoted_to_core ?? null,
    qa_log_id: log_row?.id ?? null,
    eval_run_id: evalRunId,
  };
}

function summarize(state) {
  const lines = [];
  lines.push(`# Stability v7.10 (Milestone A.5 — source-pack classification fix) — ${state.run_id}`);
  lines.push(``);
  lines.push(`Goal: core>=2 on >=7/9 runs, anchored>=3 on >=7/9, wall<65s avg, dropped<=3.6 avg.`);
  lines.push(``);
  lines.push(`| Q | r | path | words | fn | anch | drop | core | sup | sec | promoted | wall |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
  let totals = { struct: 0, all: 0, words: 0, fn: 0, anch: 0, dropped: 0, core: 0, prom: 0, wall: 0,
                 core_ge2: 0, anch_ge3: 0 };
  for (const q of state.questions) {
    q.runs.forEach((r, i) => {
      if (!r) { lines.push(`| Q${q.id} | r${i + 1} | NO_RESULT | — | — | — | — | — | — | — | — | — |`); return; }
      totals.all++;
      if (r.drafting_path === "structured") totals.struct++;
      totals.words += r.answer_words || 0;
      totals.fn += r.footnotes_count || 0;
      totals.anch += r.anchored_count || 0;
      totals.dropped += r.dropped_unanchored_count || 0;
      totals.core += r.core_count || 0;
      totals.prom += r.promoted_to_core || 0;
      totals.wall += r.wall_ms || 0;
      if ((r.core_count ?? 0) >= 2) totals.core_ge2++;
      if ((r.anchored_count ?? 0) >= 3) totals.anch_ge3++;
      lines.push(`| Q${q.id} | r${i + 1} | ${r.drafting_path ?? "ERR"} | ${r.answer_words} | ${r.footnotes_count} | ${r.anchored_count} | ${r.dropped_unanchored_count ?? "—"} | ${r.core_count ?? "—"} | ${r.supporting_count ?? "—"} | ${r.secondary_count ?? "—"} | ${r.promoted_to_core ?? "—"} | ${(r.wall_ms / 1000).toFixed(1)}s |`);
    });
  }
  lines.push(``);
  if (totals.all > 0) {
    lines.push(`**Aggregates (n=${totals.all}):**`);
    lines.push(`- Structured path: ${totals.struct}/${totals.all}`);
    lines.push(`- Avg words: ${Math.round(totals.words / totals.all)}`);
    lines.push(`- Avg footnotes: ${(totals.fn / totals.all).toFixed(1)}`);
    lines.push(`- Avg anchored: ${(totals.anch / totals.all).toFixed(1)}`);
    lines.push(`- Avg dropped: ${(totals.dropped / totals.all).toFixed(1)}`);
    lines.push(`- Avg core: ${(totals.core / totals.all).toFixed(1)}`);
    lines.push(`- Avg promoted_to_core: ${(totals.prom / totals.all).toFixed(1)}`);
    lines.push(`- Avg wall: ${(totals.wall / totals.all / 1000).toFixed(1)}s`);
    lines.push(``);
    lines.push(`**Pass gates:**`);
    lines.push(`- core>=2: ${totals.core_ge2}/${totals.all} ${totals.core_ge2 >= 7 ? "✅" : "❌ (need >=7)"}`);
    lines.push(`- anchored>=3: ${totals.anch_ge3}/${totals.all} ${totals.anch_ge3 >= 7 ? "✅" : "❌ (need >=7)"}`);
    lines.push(`- wall<65s avg: ${(totals.wall / totals.all / 1000).toFixed(1)}s ${(totals.wall / totals.all / 1000) < 65 ? "✅" : "❌"}`);
    lines.push(`- dropped<=3.6 avg: ${(totals.dropped / totals.all).toFixed(1)} ${(totals.dropped / totals.all) <= 3.6 ? "✅" : "❌"}`);
  }
  lines.push(``);
  lines.push(`## Per-run detail`);
  for (const q of state.questions) {
    lines.push(`### Q${q.id} — ${q.bucket}`);
    q.runs.forEach((r, i) => {
      if (!r) { lines.push(`- r${i + 1}: NO_RESULT`); return; }
      const stages = r.models_used || {};
      lines.push(`- r${i + 1}: path=${r.drafting_path} • ${r.answer_words}w • fn=${r.footnotes_count} (anch=${r.anchored_count}, drop=${r.dropped_unanchored_count ?? "—"}) • core=${r.core_count}/sup=${r.supporting_count}/sec=${r.secondary_count} • promoted=${r.promoted_to_core} • ${(r.wall_ms / 1000).toFixed(1)}s`);
      if (r.source_type_counts) {
        const c = r.source_type_counts;
        lines.push(`    - source_type_counts: caselaw=${c.caselaw} legislation=${c.israeli_law} knesset=${c.knesset_research} journal=${c.journal_article} perplexity=${c.perplexity} doc=${c.document} other=${c.other}`);
      }
      lines.push(`    - stages: decomp=${stages.decomposition?.status} (${stages.decomposition?.duration_ms}ms), claim_map=${stages.claim_map?.status} (${stages.claim_map?.duration_ms}ms), draft=${stages.drafting?.status} (${stages.drafting?.duration_ms}ms)`);
    });
  }
  return lines.join("\n");
}

async function main() {
  log(`=== Stability v7.10 run ${RUN_ID} ===`);
  log("Authenticating…");
  let jwt = await getAdminJwt();
  log(`JWT acquired (length=${jwt.length})`);

  const state = {
    run_id: RUN_ID,
    started_at: new Date().toISOString(),
    questions: QUESTIONS.map((q) => ({ ...q, runs: [] })),
  };

  for (const q of state.questions) {
    for (let i = 1; i <= REPETITIONS; i++) {
      log(`---- Q${q.id} attempt ${i} ----`);
      const r = await runOne(jwt, q, i);
      log(`  -> path=${r.drafting_path} words=${r.answer_words} fn=${r.footnotes_count} anch=${r.anchored_count} core=${r.core_count} prom=${r.promoted_to_core} ${r.wall_ms}ms`);
      q.runs.push(r);
      writeFileSync(OUT_FILE, JSON.stringify(state, null, 2));
    }
  }

  state.completed_at = new Date().toISOString();
  writeFileSync(OUT_FILE, JSON.stringify(state, null, 2));
  const summary = summarize(state);
  writeFileSync(`${OUT_DIR}/stability-v7.10.summary.md`, summary);
  log(`=== DONE ===\n${summary}`);
}

main().catch((e) => {
  log(`FATAL: ${e?.stack || e?.message || String(e)}`);
  process.exit(1);
});
