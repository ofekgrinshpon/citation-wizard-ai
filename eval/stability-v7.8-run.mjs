// Stability test for v7.8 Fast-mode output shaping.
// Runs Q1, Q6, Q21 three times each (structured variant only) and reports:
// - drafting_path (structured vs fallback)
// - wall_ms
// - answer length (chars + words)
// - footnote count + anchored count
// - citation density (footnotes per 100 words)
// - claim_map_summary
// Reuses the auth strategy from stability-test.mjs.

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
const RUN_ID = `stability-v78-${randomUUID()}`;
const OUT_FILE = `${OUT_DIR}/stability-v7.8.json`;
const LOG_FILE = `${OUT_DIR}/stability-v7.8.log`;

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
    qa_log_id: log_row?.id ?? null,
    eval_run_id: evalRunId,
  };
}

function summarize(state) {
  const lines = [];
  lines.push(`# Stability v7.8 (Milestone A — parser-side anchor enforcement) — ${state.run_id}`);
  lines.push(``);
  lines.push(`Goal: 400-700 words, 4-6 footnotes, anchor-pass skipped, claim_map=Gemini Flash.`);
  lines.push(``);
  lines.push(`| Q | Bucket | r | path | words | fn | anchored | density | wall |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  let totals = { struct: 0, all: 0, words: 0, fn: 0, anch: 0, wall: 0 };
  for (const q of state.questions) {
    q.runs.forEach((r, i) => {
      if (!r) { lines.push(`| Q${q.id} | ${q.bucket} | r${i + 1} | NO_RESULT | — | — | — | — | — |`); return; }
      totals.all++;
      if (r.drafting_path === "structured") totals.struct++;
      totals.words += r.answer_words || 0;
      totals.fn += r.footnotes_count || 0;
      totals.anch += r.anchored_count || 0;
      totals.wall += r.wall_ms || 0;
      lines.push(`| Q${q.id} | ${q.bucket} | r${i + 1} | ${r.drafting_path ?? "ERR"} | ${r.answer_words} | ${r.footnotes_count} | ${r.anchored_count} | ${r.citation_density_per_100w} | ${(r.wall_ms / 1000).toFixed(1)}s |`);
    });
  }
  lines.push(``);
  if (totals.all > 0) {
    lines.push(`**Aggregates (n=${totals.all}):**`);
    lines.push(`- Structured path: ${totals.struct}/${totals.all}`);
    lines.push(`- Avg words: ${Math.round(totals.words / totals.all)} (target 400-700)`);
    lines.push(`- Avg footnotes: ${(totals.fn / totals.all).toFixed(1)} (target 4-6)`);
    lines.push(`- Avg anchored: ${(totals.anch / totals.all).toFixed(1)}`);
    lines.push(`- Avg wall: ${(totals.wall / totals.all / 1000).toFixed(1)}s`);
  }
  lines.push(``);
  lines.push(`## Per-run detail`);
  for (const q of state.questions) {
    lines.push(`### Q${q.id} — ${q.bucket}`);
    q.runs.forEach((r, i) => {
      if (!r) { lines.push(`- r${i + 1}: NO_RESULT`); return; }
      const stages = r.models_used || {};
      lines.push(`- r${i + 1}: path=${r.drafting_path} • ${r.answer_words}w / ${r.answer_chars}ch • fn=${r.footnotes_count} (anchored=${r.anchored_count}, density=${r.citation_density_per_100w}/100w) • ${(r.wall_ms / 1000).toFixed(1)}s`);
      lines.push(`    - stages: decomp=${stages.decomposition?.status} (${stages.decomposition?.duration_ms}ms), claim_map=${stages.claim_map?.status} (${stages.claim_map?.duration_ms}ms), draft=${stages.drafting?.status} (${stages.drafting?.duration_ms}ms)`);
      if (r.claim_map_summary) {
        const cm = r.claim_map_summary;
        lines.push(`    - claim_map: total=${cm.total} direct=${cm.direct} qualified=${cm.qualified} omit=${cm.omit}`);
      }
    });
  }
  return lines.join("\n");
}

async function main() {
  log(`=== Stability v7.8 run ${RUN_ID} ===`);
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
      log(`  -> path=${r.drafting_path} words=${r.answer_words} fn=${r.footnotes_count} anchored=${r.anchored_count} ${r.wall_ms}ms`);
      q.runs.push(r);
      writeFileSync(OUT_FILE, JSON.stringify(state, null, 2));
    }
  }

  state.completed_at = new Date().toISOString();
  writeFileSync(OUT_FILE, JSON.stringify(state, null, 2));
  const summary = summarize(state);
  writeFileSync(`${OUT_DIR}/stability-v7.8.summary.md`, summary);
  log(`=== DONE ===\n${summary}`);
}

main().catch((e) => {
  log(`FATAL: ${e?.stack || e?.message || String(e)}`);
  process.exit(1);
});
