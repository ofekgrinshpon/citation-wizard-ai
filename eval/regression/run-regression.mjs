// Regression harness for legal-qa.
// Runs fixture queries → captures footnote shapes → asserts → diffs vs baseline → exits 0/1.
//
// Usage:
//   node eval/regression/run-regression.mjs                        # standard run, fail on regression
//   node eval/regression/run-regression.mjs --update-baseline      # capture current state as new baseline
//   node eval/regression/run-regression.mjs --only=Q-extort,Q21    # subset
//   node eval/regression/run-regression.mjs --repetitions=2        # run each query N times, union failures
//
// Auth: reuses magic-link flow from stability-test.mjs.

import { createClient } from "@supabase/supabase-js";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { runAllAssertions, computeIdentityKey } from "./assertions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------- Config ----------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY");
  process.exit(2);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const UPDATE_BASELINE = !!args["update-baseline"];
const ONLY = args["only"] ? String(args["only"]).split(",") : null;
const REPS = args["repetitions"] ? Number(args["repetitions"]) : 1;

const FIXTURES_PATH = resolve(__dirname, "fixtures.json");
const BASELINES_DIR = resolve(__dirname, "baselines");
if (!existsSync(BASELINES_DIR)) mkdirSync(BASELINES_DIR, { recursive: true });

const RUN_ID = `regression-${randomUUID()}`;
const OUT_DIR = `/mnt/documents/legal-qa-regression/${RUN_ID}`;
mkdirSync(OUT_DIR, { recursive: true });
const LOG_FILE = `${OUT_DIR}/run.log`;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + "\n");
}

// ---------- Auth (verbatim from stability-test.mjs) ----------
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function getAdminJwt() {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: ADMIN_EMAIL,
  });
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
  const timer = setTimeout(() => ctrl.abort(), 6 * 60 * 1000);
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
    try { json = JSON.parse(text); } catch { /* keep raw */ }
    return { status: res.status, body: json, raw: json ? null : text };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchQaLog(evalRunId) {
  for (let i = 0; i < 10; i++) {
    const { data, error } = await admin
      .from("qa_logs")
      .select("id, created_at, answer, footnotes, total_footnotes, metadata")
      .eq("user_id", ADMIN_USER_ID)
      .filter("metadata->>eval_run_id", "eq", evalRunId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (!error && data?.[0]) return data[0];
    if (error) log(`  qa_logs query error: ${error.message}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

// ---------- Per-query execution ----------
async function runOne(jwt, q, attempt) {
  const evalRunId = `${RUN_ID}-${q.id}-r${attempt}`;
  log(`→ ${q.id} (attempt ${attempt}) eval_run_id=${evalRunId}`);
  const t0 = Date.now();
  const httpResult = await callLegalQa(jwt, {
    question: q.question,
    depth: "fast",
    metadata: { eval_run_id: evalRunId, eval_variant: "regression" },
  });
  const wallMs = Date.now() - t0;
  log(`  http=${httpResult.status} wall=${wallMs}ms`);

  let log_row = null;
  if (httpResult.status === 200) {
    log_row = await fetchQaLog(evalRunId);
  }

  const answerBody = httpResult.body?.answer ?? log_row?.answer ?? "";
  const footnotes = httpResult.body?.footnotes ?? log_row?.footnotes ?? [];
  const metadata = log_row?.metadata ?? httpResult.body?.metadata ?? {};

  const assertions = runAllAssertions({
    answerBody,
    footnotes,
    metadata,
    fixtureCounts: q.counts,
  });

  return {
    query_id: q.id,
    attempt,
    http_status: httpResult.status,
    wall_ms: wallMs,
    qa_log_id: log_row?.id ?? null,
    total_footnotes: Array.isArray(footnotes) ? footnotes.length : 0,
    footnote_identity_keys: (footnotes || []).map(computeIdentityKey).filter(Boolean),
    assertions,
    raw_answer_preview: String(answerBody || "").slice(0, 200),
  };
}

// ---------- Baseline I/O ----------
function loadBaseline(qid) {
  const path = `${BASELINES_DIR}/${qid}.json`;
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    log(`  WARN: failed to parse baseline ${qid}: ${e.message}`);
    return null;
  }
}

function saveBaseline(qid, snapshot) {
  const path = `${BASELINES_DIR}/${qid}.json`;
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
  log(`  wrote baseline → ${path}`);
}

function buildSnapshot(qid, results, codeState) {
  const failingAcrossReps = new Set();
  for (const r of results) {
    for (const a of r.assertions) {
      if (!a.passed) failingAcrossReps.add(a.id);
    }
  }
  const last = results[results.length - 1];
  return {
    query_id: qid,
    captured_at: new Date().toISOString(),
    code_state: codeState,
    total_footnotes: last.total_footnotes,
    anchored_count: last.assertions.find((a) => a.id === "COUNT_ANCHORED")?.detail ?? "",
    footnote_identity_keys: last.footnote_identity_keys,
    known_failing_assertions: [...failingAcrossReps].sort(),
    note: "Each entry in known_failing_assertions must be tracked to a fix (C, E, or B). Remove on fix.",
  };
}

// ---------- Diff & report ----------
function evaluateAgainstBaseline(qid, runResults, baseline) {
  const known = new Set(baseline?.known_failing_assertions ?? []);
  const newFailures = new Set();
  const fixedAssertions = new Set(known); // start with all known, remove as we see fails
  for (const r of runResults) {
    for (const a of r.assertions) {
      if (!a.passed) {
        if (!known.has(a.id)) newFailures.add(a.id);
        fixedAssertions.delete(a.id); // still failing → not fixed
      }
    }
  }
  // identity-key set diff vs baseline
  const baselineKeys = new Set(baseline?.footnote_identity_keys ?? []);
  const lastKeys = new Set(runResults[runResults.length - 1].footnote_identity_keys);
  const added = [...lastKeys].filter((k) => !baselineKeys.has(k));
  const removed = [...baselineKeys].filter((k) => !lastKeys.has(k));
  return { newFailures: [...newFailures], fixedAssertions: [...fixedAssertions], added, removed };
}

function renderReport(perQuery, overall) {
  const lines = [];
  lines.push(`# Regression Report — ${RUN_ID}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Mode: ${UPDATE_BASELINE ? "UPDATE BASELINE" : "CHECK"}`);
  lines.push(`Repetitions per query: ${REPS}`);
  lines.push("");
  lines.push(`## Overall: ${overall.exitCode === 0 ? "PASS ✓" : "FAIL ✗"}`);
  lines.push(`- New failures: ${overall.totalNewFailures}`);
  lines.push(`- Newly fixed: ${overall.totalFixed}`);
  lines.push("");
  for (const q of perQuery) {
    lines.push(`## ${q.qid}`);
    lines.push(`HTTP=${q.results.map((r) => r.http_status).join(",")} • wall=${q.results.map((r) => r.wall_ms).join(",")}ms • total_fn=${q.results.map((r) => r.total_footnotes).join(",")}`);
    lines.push("");
    lines.push("Assertions (across reps):");
    const seenIds = new Set();
    for (const r of q.results) {
      for (const a of r.assertions) {
        if (seenIds.has(a.id) && a.passed) continue;
        seenIds.add(a.id);
        lines.push(`- ${a.passed ? "✓" : "✗"} \`${a.id}\` — ${a.detail}`);
      }
    }
    if (q.diff) {
      lines.push("");
      lines.push("Diff vs baseline:");
      lines.push(`- New failures: ${q.diff.newFailures.length ? q.diff.newFailures.map((x) => `\`${x}\``).join(", ") : "_(none)_"}`);
      lines.push(`- Newly fixed: ${q.diff.fixedAssertions.length ? q.diff.fixedAssertions.map((x) => `\`${x}\``).join(", ") : "_(none)_"}`);
      lines.push(`- Identity keys added: ${q.diff.added.length}`);
      lines.push(`- Identity keys removed: ${q.diff.removed.length}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------- Main ----------
async function main() {
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, "utf8")).queries;
  const queries = ONLY ? fixtures.filter((q) => ONLY.includes(q.id)) : fixtures;
  if (queries.length === 0) {
    log("No queries selected. --only filter eliminated all fixtures.");
    process.exit(2);
  }
  log(`Loaded ${queries.length} fixtures: ${queries.map((q) => q.id).join(", ")}`);

  const jwt = await getAdminJwt();
  log("Got admin JWT.");

  const perQuery = [];
  let totalNewFailures = 0;
  let totalFixed = 0;

  for (const q of queries) {
    const results = [];
    for (let i = 1; i <= REPS; i++) {
      try {
        const r = await runOne(jwt, q, i);
        results.push(r);
      } catch (e) {
        log(`  ERROR on ${q.id} attempt ${i}: ${e.message}`);
        results.push({
          query_id: q.id,
          attempt: i,
          http_status: 0,
          wall_ms: 0,
          qa_log_id: null,
          total_footnotes: 0,
          footnote_identity_keys: [],
          assertions: [{ id: "EXEC_ERROR", passed: false, detail: e.message }],
          raw_answer_preview: "",
        });
      }
    }

    const baseline = loadBaseline(q.id);
    let diff = null;
    if (UPDATE_BASELINE) {
      const codeState = process.env.BASELINE_LABEL || "before-C-E-B-fixes";
      const snap = buildSnapshot(q.id, results, codeState);
      saveBaseline(q.id, snap);
    } else if (baseline) {
      diff = evaluateAgainstBaseline(q.id, results, baseline);
      totalNewFailures += diff.newFailures.length;
      totalFixed += diff.fixedAssertions.length;
    } else {
      log(`  no baseline for ${q.id} — run with --update-baseline first`);
    }

    perQuery.push({ qid: q.id, results, diff });
  }

  const exitCode = UPDATE_BASELINE ? 0 : (totalNewFailures > 0 ? 1 : 0);
  const overall = { exitCode, totalNewFailures, totalFixed };

  const report = renderReport(perQuery, overall);
  writeFileSync(`${OUT_DIR}/report.md`, report);
  writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify({ run_id: RUN_ID, overall, perQuery }, null, 2));

  log("");
  log(`Report: ${OUT_DIR}/report.md`);
  log(`Overall: ${exitCode === 0 ? "PASS" : "FAIL"} (newFailures=${totalNewFailures}, fixed=${totalFixed})`);
  process.exit(exitCode);
}

main().catch((e) => {
  log(`FATAL: ${e.stack || e.message}`);
  process.exit(2);
});
