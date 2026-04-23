// Fast-mode parity stability run — Q1 / Q6 / Q21 × 3 reps.
// Goal: confirm that wiring MODE_PROFILES (the Deep-mode toggle infra) did not
// change Fast-mode behavior. We explicitly send `depth: "fast"` and compare
// per-stage telemetry against the pre-Deep baseline (eval/stability-v7.12.summary.md).
//
// Same telemetry surface as v7.12; only the question set + depth pin differ.
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
const RUN_ID = `fast-parity-${randomUUID()}`;
const OUT_FILE = `${OUT_DIR}/fast-parity-q1-q6-q21.json`;
const LOG_FILE = `${OUT_DIR}/fast-parity-q1-q6-q21.log`;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + "\n");
}

// Q1, Q6, Q21 — the canonical 3-question parity set.
const QUESTIONS = [
  { id: 1, bucket: "constitutional_admin",
    question: "האם הממשלה מוסמכת לפטר את היועצת המשפטית לממשלה, ואם כן באילו מגבלות נורמטיביות ומנהליות?" },
  { id: 6, bucket: "constitutional_speech",
    question: "מהן ההגנות החוקתיות על חופש הביטוי הפוליטי בישראל, ומהן המגבלות עליהן?" },
  { id: 21, bucket: "statute_anchored",
    question: "מה קובע סעיף 17 לחוק שירות המדינה (מינויים) לעניין פיטורים או הפסקת כהונה?" },
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
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json, raw: json ? null : text };
  } finally { clearTimeout(timer); }
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
      depth: "fast", // <-- pin Fast for parity check
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

  const sps = md.source_pack_summary && typeof md.source_pack_summary === "object" && !Array.isArray(md.source_pack_summary) ? md.source_pack_summary : null;
  const e5 = md.retrieval_funnel?.perplexity_completion ?? null;
  const profile = md.profile_used ?? null;

  return {
    ok: httpOk, http_status: httpResult.status,
    http_error: httpOk ? null : (httpResult.body?.error || httpResult.raw || "unknown"),
    wall_ms,
    drafting_path: md.drafting_path ?? null,
    profile_depth: profile?.depth ?? null,
    profile_drafter: profile?.drafterVariant ?? null,
    profile_anchor_pass: profile?.anchorPassEnabled ?? null,
    profile_e5_min: profile?.perplexityCompletionMinAnchored ?? null,
    answer_words: words,
    footnotes_count: fnCount,
    anchored_count: anchored,
    dropped_unanchored_count: md.dropped_unanchored_count ?? null,
    core_count: sps?.core ?? null,
    supporting_count: sps?.supporting ?? null,
    secondary_count: sps?.secondary ?? null,
    e5_triggered: e5?.triggered ?? null,
    e5_status: e5?.status ?? null,
    e5_reason: e5?.reason ?? null,
    e5_core_before: e5?.core_before ?? null,
    e5_core_after: e5?.core_after ?? null,
    e5_candidates_returned: e5?.candidates_returned ?? null,
    e5_candidates_kept: e5?.candidates_kept ?? null,
    e5_by_type: e5?.candidates_by_type ?? null,
    e5_promoted_to_core: e5?.promoted_to_core ?? null,
    e5_duration_ms: e5?.duration_ms ?? null,
    qa_log_id: log_row?.id ?? null,
    eval_run_id: evalRunId,
  };
}

function summarize(state) {
  const lines = [];
  lines.push(`# Fast-Mode Parity — Q1 / Q6 / Q21 × ${REPETITIONS} — ${state.run_id}`);
  lines.push(``);
  lines.push(`Pinned \`depth: "fast"\`. Compare against pre-Deep baseline (stability-v7.12.summary.md).`);
  lines.push(``);
  lines.push(`| Q | bucket | path | depth | drafter | anchor | E5min | E5? | core | sup | sec | anch | fn | words | wall |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  let tot = { all: 0, e5_fired: 0, anch: 0, words: 0, wall: 0 };
  for (const q of state.questions) {
    q.runs.forEach((r) => {
      if (!r) { lines.push(`| Q${q.id} | ${q.bucket} | NO_RESULT |`); return; }
      tot.all++;
      if (r.e5_triggered) tot.e5_fired++;
      tot.anch += r.anchored_count || 0;
      tot.words += r.answer_words || 0;
      tot.wall += r.wall_ms || 0;
      const e5 = r.e5_triggered ? `${r.e5_status}` : "skip";
      lines.push(`| Q${q.id} | ${q.bucket} | ${r.drafting_path ?? "ERR"} | ${r.profile_depth ?? "?"} | ${r.profile_drafter ?? "?"} | ${r.profile_anchor_pass ?? "?"} | ${r.profile_e5_min ?? "?"} | ${e5} | ${r.core_count ?? "—"} | ${r.supporting_count ?? "—"} | ${r.secondary_count ?? "—"} | ${r.anchored_count} | ${r.footnotes_count} | ${r.answer_words} | ${(r.wall_ms/1000).toFixed(1)}s |`);
    });
  }
  lines.push(``);
  if (tot.all > 0) {
    lines.push(`**Aggregates (n=${tot.all}):**`);
    lines.push(`- Stage E.5 fired: ${tot.e5_fired}/${tot.all}`);
    lines.push(`- Avg anchored: ${(tot.anch/tot.all).toFixed(1)}`);
    lines.push(`- Avg words: ${(tot.words/tot.all).toFixed(0)}`);
    lines.push(`- Avg wall: ${(tot.wall/tot.all/1000).toFixed(1)}s`);
  }
  lines.push(``);
  lines.push(`## Profile-knob assertions (must hold for ALL runs)`);
  lines.push(`- depth = "fast"`);
  lines.push(`- drafterVariant = "structured" (gpt-5-mini)`);
  lines.push(`- anchorPassEnabled = false`);
  lines.push(`- perplexityCompletionMinAnchored = 2`);
  lines.push(``);
  const violations = [];
  for (const q of state.questions) {
    q.runs.forEach((r, i) => {
      if (!r) return;
      if (r.profile_depth !== "fast") violations.push(`Q${q.id} r${i+1}: depth=${r.profile_depth}`);
      if (r.profile_drafter !== "structured") violations.push(`Q${q.id} r${i+1}: drafter=${r.profile_drafter}`);
      if (r.profile_anchor_pass !== false) violations.push(`Q${q.id} r${i+1}: anchorPass=${r.profile_anchor_pass}`);
      if (r.profile_e5_min !== 2) violations.push(`Q${q.id} r${i+1}: e5min=${r.profile_e5_min}`);
    });
  }
  if (violations.length === 0) {
    lines.push(`✅ All ${tot.all} runs match Fast-mode profile.`);
  } else {
    lines.push(`❌ Profile violations:`);
    violations.forEach((v) => lines.push(`- ${v}`));
  }
  lines.push(``);
  lines.push(`## Per-run detail`);
  for (const q of state.questions) {
    lines.push(`### Q${q.id} — ${q.bucket}`);
    lines.push(`> ${q.question}`);
    q.runs.forEach((r, i) => {
      if (!r) { lines.push(`- r${i+1}: NO_RESULT`); return; }
      lines.push(`- r${i+1}: path=${r.drafting_path} • core=${r.core_count} sup=${r.supporting_count} sec=${r.secondary_count} • anchored=${r.anchored_count} fn=${r.footnotes_count} words=${r.answer_words} • ${(r.wall_ms/1000).toFixed(1)}s`);
      if (r.e5_triggered === false) {
        lines.push(`    - Stage E.5: SKIPPED (reason=${r.e5_reason})`);
      } else if (r.e5_triggered) {
        const by = r.e5_by_type || {};
        lines.push(`    - Stage E.5: status=${r.e5_status} • returned=${r.e5_candidates_returned} kept=${r.e5_candidates_kept} (statute=${by.statute ?? 0}, caselaw=${by.caselaw ?? 0}) • core ${r.e5_core_before}→${r.e5_core_after} • ${r.e5_duration_ms}ms`);
      }
    });
  }
  return lines.join("\n");
}

async function main() {
  log(`=== Fast-parity run ${RUN_ID} (${QUESTIONS.length} questions × ${REPETITIONS}, depth=fast) ===`);
  log("Authenticating…");
  const jwt = await getAdminJwt();
  log(`JWT acquired (length=${jwt.length})`);

  const state = { run_id: RUN_ID, started_at: new Date().toISOString(),
                  questions: QUESTIONS.map((q) => ({ ...q, runs: [] })) };

  for (const q of state.questions) {
    for (let i = 1; i <= REPETITIONS; i++) {
      log(`---- Q${q.id} (${q.bucket}) attempt ${i} ----`);
      const r = await runOne(jwt, q, i);
      log(`  -> path=${r.drafting_path} depth=${r.profile_depth} drafter=${r.profile_drafter} anch=${r.anchored_count} fn=${r.footnotes_count} core=${r.core_count} | E5 trig=${r.e5_triggered} kept=${r.e5_candidates_kept} | ${r.wall_ms}ms`);
      q.runs.push(r);
      writeFileSync(OUT_FILE, JSON.stringify(state, null, 2));
    }
  }

  state.completed_at = new Date().toISOString();
  writeFileSync(OUT_FILE, JSON.stringify(state, null, 2));
  const summary = summarize(state);
  writeFileSync(`${OUT_DIR}/fast-parity-q1-q6-q21.summary.md`, summary);
  log(`=== DONE ===\n${summary}`);
}

main().catch((e) => { log(`FATAL: ${e?.stack || e?.message || String(e)}`); process.exit(1); });
