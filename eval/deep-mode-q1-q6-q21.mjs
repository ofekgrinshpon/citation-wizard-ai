// Deep-mode wiring smoke test — Q1 / Q6 / Q21 × 1 rep with depth: "deep".
// Asserts: words >= 1200 (soft), anchored >= 6 (soft), profile_used.depth = "deep".
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) { console.error("missing envs"); process.exit(1); }

const OUT_DIR = "/mnt/documents/legal-qa-eval";
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const RUN_ID = `deep-smoke-${randomUUID()}`;
const OUT_FILE = `${OUT_DIR}/deep-mode-q1-q6-q21.json`;
const LOG_FILE = `${OUT_DIR}/deep-mode-q1-q6-q21.log`;

const log = (m) => { const l = `[${new Date().toISOString()}] ${m}`; console.log(l); appendFileSync(LOG_FILE, l + "\n"); };

const QUESTIONS = [
  { id: 1, bucket: "constitutional_admin", question: "האם הממשלה מוסמכת לפטר את היועצת המשפטית לממשלה, ואם כן באילו מגבלות נורמטיביות ומנהליות?" },
  { id: 6, bucket: "constitutional_speech", question: "מהן ההגנות החוקתיות על חופש הביטוי הפוליטי בישראל, ומהן המגבלות עליהן?" },
  { id: 21, bucket: "statute_anchored", question: "מה קובע סעיף 17 לחוק שירות המדינה (מינויים) לעניין פיטורים או הפסקת כהונה?" },
];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function getJwt() {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
  if (error) throw error;
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const v = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (v.error) throw v.error;
  return v.data.session.access_token;
}

async function callQa(jwt, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7 * 60 * 1000);
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, body: json, raw: json ? null : text };
  } finally { clearTimeout(t); }
}

async function fetchLog(evalRunId) {
  for (let i = 0; i < 10; i++) {
    const { data } = await admin.from("qa_logs")
      .select("id, answer, footnotes, total_footnotes, metadata")
      .eq("user_id", ADMIN_USER_ID)
      .filter("metadata->>eval_run_id", "eq", evalRunId)
      .order("created_at", { ascending: false }).limit(1);
    if (data?.[0]) return data[0];
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

const anchored = (fn) => Array.isArray(fn) ? fn.filter((f) => typeof f?.url === "string" && f.url.length > 0).length : 0;
const wordsOf = (t) => {
  if (typeof t !== "string") return 0;
  const i = t.search(/---\s*הערות שוליים\s*---|\*\*\s*הערות שוליים\s*\*\*/);
  return (i === -1 ? t : t.slice(0, i)).trim().split(/\s+/).filter(Boolean).length;
};

async function runOne(jwt, q) {
  const evalRunId = `${RUN_ID}:Q${q.id}:r1`;
  const start = Date.now();
  const r = await callQa(jwt, {
    question: q.question, taskMode: "research", depth: "deep",
    evalRunId, evalVariant: "structured", evalForceLegacy: false, requestId: `eval:${evalRunId}`,
  });
  const wall = Date.now() - start;
  const ok = r.status === 200 && r.body?.answer;
  const row = await fetchLog(evalRunId);
  const md = row?.metadata ?? {};
  const ans = ok ? r.body.answer : (row?.answer ?? "");
  const fn = ok ? (r.body.footnotes ?? []) : (row?.footnotes ?? []);
  const sps = md.source_pack_summary || {};
  const profile = md.profile_used || {};
  const r2 = md.retrieval_funnel?.round_2 || null;
  const sc = md.statute_completion || {};
  const placements = Array.isArray(sc.insertion_placement) ? sc.insertion_placement : [];
  return {
    ok, http_status: r.status, http_error: ok ? null : (r.body?.error || r.raw),
    wall_ms: wall,
    drafting_path: md.drafting_path,
    profile_depth: profile.depth, profile_drafter: profile.drafterVariant,
    profile_anchor_pass: profile.anchorPassEnabled,
    profile_retrieval_rounds: profile.retrievalRounds,
    profile_word_min: profile.wordRangeMin, profile_word_max: profile.wordRangeMax,
    profile_fn_floor: profile.footnoteFloor, profile_fn_max: profile.footnoteTargetMax,
    profile_e5_min: profile.perplexityCompletionMinAnchored,
    answer_words: wordsOf(ans),
    answer_full: ans, // for qualitative diff
    footnotes_count: Array.isArray(fn) ? fn.length : 0,
    anchored_count: anchored(fn),
    core_count: sps.core, supporting_count: sps.supporting, secondary_count: sps.secondary,
    round_2_triggered: r2?.triggered, round_2_queries: r2?.queries?.length, round_2_new_cards: r2?.new_cards, round_2_ms: r2?.duration_ms,
    e5_triggered: md.retrieval_funnel?.perplexity_completion?.triggered,
    e5_status: md.retrieval_funnel?.perplexity_completion?.status,
    sc_kept_for_completion: sc.kept_for_completion ?? null,
    sc_skipped_covered_by_primary: sc.skipped_covered_by_primary ?? null,
    sc_completed_count: sc.completed_count ?? null,
    sc_placement_sentence_end: placements.filter((p) => p === "sentence_end").length,
    sc_placement_name_adjacent: placements.filter((p) => p === "name_adjacent").length,
    qa_guard: sc.qa_guard ?? null,
    qa_log_id: row?.id, eval_run_id: evalRunId,
  };
}

async function main() {
  log(`=== Deep-smoke ${RUN_ID} (3 questions × 1, depth=deep) ===`);
  const jwt = await getJwt();
  const state = { run_id: RUN_ID, started_at: new Date().toISOString(), runs: [] };
  for (const q of QUESTIONS) {
    log(`---- Q${q.id} ----`);
    const r = await runOne(jwt, q);
    log(`  -> depth=${r.profile_depth} drafter=${r.profile_drafter} anchor=${r.profile_anchor_pass} rounds=${r.profile_retrieval_rounds} words=${r.answer_words} anch=${r.anchored_count} fn=${r.footnotes_count} core=${r.core_count} | r2=${r.round_2_triggered}(+${r.round_2_new_cards}cards) | ${r.wall_ms}ms`);
    state.runs.push({ qid: q.id, bucket: q.bucket, ...r });
    writeFileSync(OUT_FILE, JSON.stringify(state, null, 2));
  }
  state.completed_at = new Date().toISOString();

  // Summary
  const lines = [`# Deep-Mode Smoke — ${RUN_ID}`, ``, `| Q | depth | drafter | anchor | rounds | words | anch | fn | core | r2(+) | wall |`, `|---|---|---|---|---|---|---|---|---|---|---|`];
  let pass = { depth: 0, words: 0, anch: 0 };
  for (const r of state.runs) {
    lines.push(`| Q${r.qid} | ${r.profile_depth} | ${r.profile_drafter} | ${r.profile_anchor_pass} | ${r.profile_retrieval_rounds} | ${r.answer_words} | ${r.anchored_count} | ${r.footnotes_count} | ${r.core_count} | ${r.round_2_triggered ? "+" + r.round_2_new_cards : "—"} | ${(r.wall_ms/1000).toFixed(1)}s |`);
    if (r.profile_depth === "deep") pass.depth++;
    if (r.answer_words >= 1200) pass.words++;
    if (r.anchored_count >= 6) pass.anch++;
  }
  lines.push(``, `## Acceptance gates`, `- profile_used.depth === "deep": ${pass.depth}/3`, `- words >= 1200: ${pass.words}/3`, `- anchored >= 6: ${pass.anch}/3`);
  const summary = lines.join("\n");
  writeFileSync(`${OUT_DIR}/deep-mode-q1-q6-q21.summary.md`, summary);
  log(`\n${summary}`);
}

main().catch((e) => { log(`FATAL: ${e?.stack || e?.message}`); process.exit(1); });
