// 30-question Legal Research evaluation harness.
// Runs each question twice (legacy + structured) against the deployed
// `legal-qa` edge function, then assembles a side-by-side report.
//
// Auth strategy:
//   - service role to mint a magic link for the admin user
//   - anon client exchanges the token_hash → real session JWT
//   - JWT is then sent as Authorization: Bearer to the edge function
//
// Outputs (all under /mnt/documents/legal-qa-eval/):
//   - results.json  — full per-question record, both variants
//   - results.csv   — flat spreadsheet
//   - report.md     — narrative side-by-side report
//   - progress.log  — incremental log so a crash mid-run is recoverable
//
// Re-runnable: pass --run-id <uuid> to resume / re-aggregate from qa_logs.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY");
  process.exit(1);
}

const OUT_DIR = process.env.EVAL_OUT_DIR || "/mnt/documents/legal-qa-eval";
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

const RUN_ID = args["run-id"] || randomUUID();
const ONLY_QUESTIONS = args["only"] ? String(args["only"]).split(",").map(Number) : null;
const SKIP_RUN = !!args["aggregate-only"];

const PROGRESS_LOG = `${OUT_DIR}/progress.log`;
const RESULTS_JSON = `${OUT_DIR}/results.json`;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(PROGRESS_LOG, line + "\n");
}

const QUESTIONS = [
  { id: 1, question: "האם הממשלה מוסמכת לפטר את היועצת המשפטית לממשלה, ואם כן באילו מגבלות נורמטיביות ומנהליות?", bucket: "constitutional_admin" },
  { id: 2, question: "מהו המעמד הנורמטיבי של המלצות ועדת שמגר ביחס למעמד היועץ המשפטי לממשלה?", bucket: "constitutional_admin" },
  { id: 3, question: "האם ניתן לתקוף החלטת ממשלה בטענה של חוסר סבירות לאחר תיקוני החקיקה האחרונים?", bucket: "constitutional_admin" },
  { id: 4, question: "באילו תנאים בית המשפט יתערב במינוי בכיר בשירות הציבורי?", bucket: "admin_law" },
  { id: 5, question: "מה ההבדל בין שיקולים זרים, חוסר סבירות ומשוא פנים במשפט המנהלי הישראלי?", bucket: "admin_law" },
  { id: 6, question: "באילו נסיבות ניתן לאכוף תניית אי-תחרות בחוזה עבודה בישראל?", bucket: "contract_labor" },
  { id: 7, question: "מתי הפרת חובת תום הלב במשא ומתן מזכה בפיצויים?", bucket: "contract" },
  { id: 8, question: "האם אפשר לבטל חוזה בגלל טעות בכדאיות העסקה?", bucket: "contract" },
  { id: 9, question: "מה התנאים להרמת מסך בחברת יחיד לפי הדין והפסיקה?", bucket: "corporate" },
  { id: 10, question: "מתי תניית שיפוי בחוזה מסחרי תפורש בצמצום?", bucket: "contract" },
  { id: 11, question: "מה המבחנים להכרה ביחסי עובד–מעסיק כשיש חוזה פרילנס?", bucket: "labor" },
  { id: 12, question: "האם מעסיק אחראי בנזיקין להטרדה מינית של עובד כלפי עובד אחר?", bucket: "labor_tort" },
  { id: 13, question: "מהם התנאים להטלת אחריות על רשות ציבורית בגין רשלנות בהפעלת סמכות?", bucket: "tort_admin" },
  { id: 14, question: "באילו נסיבות ייפסק פיצוי בגין פגיעה באוטונומיה בלי הוכחת נזק ממוני?", bucket: "tort" },
  { id: 15, question: "מה ההבדל בין אשם תורם לבין הסתכנות מרצון בפסיקת הנזיקין?", bucket: "tort" },
  { id: 16, question: "מתי בית המשפט יתיר תיקון כתב טענות בשלב מתקדם של ההליך?", bucket: "procedural" },
  { id: 17, question: "באילו תנאים יינתן צו לגילוי מסמכים ספציפיים נגד צד שלישי?", bucket: "procedural" },
  { id: 18, question: "מהו המבחן למתן סעד זמני כשיש מחלוקת עובדתית משמעותית?", bucket: "procedural" },
  { id: 19, question: "מתי ניתן לעכב ביצוע של פסק דין כספי בערעור?", bucket: "procedural" },
  { id: 20, question: "כיצד בוחנים קבילות של ראיה דיגיטלית בהליך אזרחי?", bucket: "procedural" },
  { id: 21, question: "מה קובע סעיף 17 לחוק שירות המדינה (מינויים) לעניין פיטורים או הפסקת כהונה?", bucket: "statute_anchored" },
  { id: 22, question: "מהי המשמעות של סעיף 39 לחוק החוזים (חלק כללי) בפסיקה הישראלית?", bucket: "statute_anchored" },
  { id: 23, question: "כיצד פורש סעיף 30 לחוק החוזים לגבי חוזה בלתי חוקי?", bucket: "statute_anchored" },
  { id: 24, question: "מה ההבדל בין סעיף 12 לבין סעיף 39 לחוק החוזים מבחינת תום לב?", bucket: "statute_anchored" },
  { id: 25, question: "כיצד סעיף 6 לחוק-יסוד: כבוד האדם וחירותו שימש בפסיקה?", bucket: "statute_anchored" },
  { id: 26, question: "האם קיימת מחלוקת בספרות לגבי מעמדו של היועץ המשפטי לממשלה?", bucket: "literature" },
  { id: 27, question: "כיצד הספרות האקדמית הישראלית מבקרת את מבחן הסבירות?", bucket: "literature" },
  { id: 28, question: "מהי עמדת הספרות לגבי היחס בין חופש החוזים לבין רגולציה צרכנית?", bucket: "literature" },
  { id: 29, question: "האם קיימת מחלוקת בפסיקה ובספרות לגבי הרמת מסך בחברות קטנות?", bucket: "literature_caselaw" },
  { id: 30, question: "מהם הקשיים המרכזיים שהספרות מצביעה עליהם בשימוש בעילת תום הלב כעילת-על?", bucket: "literature" },
];

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
  const timer = setTimeout(() => ctrl.abort(), 5 * 60 * 1000); // 5min hard cap
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

async function fetchQaLog(evalRunId, variant, qIdx) {
  // poll up to 6s in case the upsert is still landing
  for (let i = 0; i < 6; i++) {
    const { data, error } = await admin
      .from("qa_logs")
      .select("id, created_at, answer, footnotes, total_footnotes, local_footnotes_count, perplexity_footnotes_count, metadata")
      .eq("user_id", ADMIN_USER_ID)
      .filter("metadata->>eval_run_id", "eq", evalRunId)
      .filter("metadata->>eval_variant", "eq", variant)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) {
      log(`  qa_logs query error: ${error.message}`);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    // Match by question index when multiple rows share the run_id (shouldn't happen, but safe)
    const row = data?.[0] ?? null;
    if (row) return row;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

function densityPer1000(footnotesCount, answer) {
  const len = (answer || "").length;
  if (len === 0) return 0;
  return Number(((footnotesCount / len) * 1000).toFixed(2));
}

function anchoredCount(footnotes) {
  if (!Array.isArray(footnotes)) return 0;
  return footnotes.filter((f) => typeof f?.url === "string" && f.url.length > 0).length;
}

function summarizeStageRuns(runs) {
  if (!Array.isArray(runs)) return null;
  return runs.map((r) => ({
    stage: r.stage,
    status: r.status,
    provider: r.provider,
    model: r.model,
    duration_ms: r.duration_ms,
  }));
}

async function runOne(jwt, q, variant, evalRunId) {
  const start = Date.now();
  const body = {
    question: q.question,
    taskMode: "research",
    evalRunId,
    evalVariant: variant,
    ...(variant === "legacy" ? { evalForceLegacy: true } : {}),
    requestId: `eval:${evalRunId}:${q.id}:${variant}`,
  };
  let httpResult;
  try {
    httpResult = await callLegalQa(jwt, body);
  } catch (e) {
    return {
      variant,
      ok: false,
      error: `fetch_failed: ${e?.message || String(e)}`,
      wall_ms: Date.now() - start,
    };
  }
  const wall_ms = Date.now() - start;
  const httpOk = httpResult.status === 200 && httpResult.body?.answer;

  const log_row = await fetchQaLog(evalRunId, variant, q.id);

  const answer = httpOk ? httpResult.body.answer : (log_row?.answer ?? "");
  const footnotes = httpOk ? (httpResult.body.footnotes ?? []) : (log_row?.footnotes ?? []);
  const dropped = httpOk ? (httpResult.body.dropped_footnotes_count ?? null) : null;

  const md = log_row?.metadata ?? {};
  return {
    variant,
    ok: httpOk,
    http_status: httpResult.status,
    http_error: httpOk ? null : (httpResult.body?.error || httpResult.raw || "unknown"),
    wall_ms,
    answer,
    answer_length_chars: answer.length,
    answer_length_words: answer ? answer.split(/\s+/).filter(Boolean).length : 0,
    footnotes_count: Array.isArray(footnotes) ? footnotes.length : 0,
    anchored_count: anchoredCount(footnotes),
    unverified_count: Array.isArray(footnotes) ? footnotes.length - anchoredCount(footnotes) : 0,
    dropped_footnotes: dropped,
    density_per_1000: densityPer1000(Array.isArray(footnotes) ? footnotes.length : 0, answer),
    drafting_path: md.drafting_path ?? null,
    models_used: md.models_used ?? null,
    stage_runs: summarizeStageRuns(md.stage_runs),
    claim_map_summary: md.claim_map_summary ?? null,
    source_pack_summary: md.source_pack_summary ?? null,
    qa_log_id: log_row?.id ?? null,
  };
}

function loadExistingResults() {
  if (!existsSync(RESULTS_JSON)) return { run_id: RUN_ID, started_at: new Date().toISOString(), results: [] };
  try {
    const j = JSON.parse(readFileSync(RESULTS_JSON, "utf8"));
    if (j.run_id === RUN_ID) return j;
    return { run_id: RUN_ID, started_at: new Date().toISOString(), results: [] };
  } catch {
    return { run_id: RUN_ID, started_at: new Date().toISOString(), results: [] };
  }
}

function saveResults(state) {
  writeFileSync(RESULTS_JSON, JSON.stringify(state, null, 2));
}

function escapeCsv(v) {
  if (v == null) return "";
  const s = String(v).replace(/\r?\n/g, " ").replace(/"/g, '""');
  return /[",]/.test(s) ? `"${s}"` : s;
}

function writeCsv(state) {
  const headers = [
    "id", "bucket", "question",
    "legacy_ok", "legacy_drafting_path", "legacy_footnotes", "legacy_anchored", "legacy_density", "legacy_length_chars", "legacy_wall_ms", "legacy_drafting_model",
    "structured_ok", "structured_drafting_path", "structured_footnotes", "structured_anchored", "structured_density", "structured_length_chars", "structured_wall_ms",
    "structured_decomp_status", "structured_claimmap_status", "structured_drafting_model", "structured_completed",
  ];
  const rows = [headers.join(",")];
  for (const r of state.results) {
    const L = r.legacy ?? {};
    const S = r.structured ?? {};
    const sStages = S.models_used ?? {};
    const lStages = L.models_used ?? {};
    rows.push([
      r.id, r.bucket, r.question,
      L.ok, L.drafting_path, L.footnotes_count, L.anchored_count, L.density_per_1000, L.answer_length_chars, L.wall_ms, lStages.drafting?.model ?? "",
      S.ok, S.drafting_path, S.footnotes_count, S.anchored_count, S.density_per_1000, S.answer_length_chars, S.wall_ms,
      sStages.decomposition?.status ?? "", sStages.claim_map?.status ?? "", sStages.drafting?.model ?? "",
      S.drafting_path === "structured",
    ].map(escapeCsv).join(","));
  }
  writeFileSync(`${OUT_DIR}/results.csv`, rows.join("\n"));
}

function writeReport(state) {
  const rs = state.results;
  const n = rs.length;
  const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : "n/a";
  const legAns = rs.map((r) => r.legacy?.answer_length_chars ?? 0);
  const strAns = rs.map((r) => r.structured?.answer_length_chars ?? 0);
  const legFn = rs.map((r) => r.legacy?.footnotes_count ?? 0);
  const strFn = rs.map((r) => r.structured?.footnotes_count ?? 0);
  const legDen = rs.map((r) => r.legacy?.density_per_1000 ?? 0);
  const strDen = rs.map((r) => r.structured?.density_per_1000 ?? 0);
  const structuredCompleted = rs.filter((r) => r.structured?.drafting_path === "structured").length;
  const structuredFell = rs.filter((r) => r.structured && r.structured.drafting_path !== "structured").length;
  const decompSuccess = rs.filter((r) => r.structured?.models_used?.decomposition?.status === "success").length;
  const cmSuccess = rs.filter((r) => r.structured?.models_used?.claim_map?.status === "success").length;
  const draftSuccess = rs.filter((r) => r.structured?.models_used?.drafting?.status === "success").length;

  const lines = [];
  lines.push(`# Legal Research Evaluation — Run ${state.run_id}`);
  lines.push(``);
  lines.push(`Started: ${state.started_at}  •  Questions: ${n}`);
  lines.push(``);
  lines.push(`## Aggregate Metrics`);
  lines.push(``);
  lines.push(`| Metric | Legacy | Structured |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Avg answer length (chars) | ${avg(legAns)} | ${avg(strAns)} |`);
  lines.push(`| Avg footnotes | ${avg(legFn)} | ${avg(strFn)} |`);
  lines.push(`| Avg density (per 1000 chars) | ${avg(legDen)} | ${avg(strDen)} |`);
  lines.push(``);
  lines.push(`## Structured Pipeline Health`);
  lines.push(``);
  lines.push(`- Decomposition success: **${decompSuccess}/${n}**`);
  lines.push(`- Claim map success: **${cmSuccess}/${n}**`);
  lines.push(`- Drafting success: **${draftSuccess}/${n}**`);
  lines.push(`- drafting_path = "structured": **${structuredCompleted}/${n}** (fell back: ${structuredFell})`);
  lines.push(``);

  // Bucket breakdown
  const buckets = {};
  for (const r of rs) {
    if (!buckets[r.bucket]) buckets[r.bucket] = [];
    buckets[r.bucket].push(r);
  }
  lines.push(`## Per-Bucket`);
  lines.push(``);
  lines.push(`| Bucket | n | Avg legacy fn | Avg structured fn | Structured completed |`);
  lines.push(`|---|---|---|---|---|`);
  for (const [b, items] of Object.entries(buckets)) {
    const lf = avg(items.map((r) => r.legacy?.footnotes_count ?? 0));
    const sf = avg(items.map((r) => r.structured?.footnotes_count ?? 0));
    const sc = items.filter((r) => r.structured?.drafting_path === "structured").length;
    lines.push(`| ${b} | ${items.length} | ${lf} | ${sf} | ${sc}/${items.length} |`);
  }
  lines.push(``);

  lines.push(`## Per-Question Side-by-Side`);
  lines.push(``);
  for (const r of rs) {
    lines.push(`### Q${r.id} — ${r.bucket}`);
    lines.push(`> ${r.question}`);
    lines.push(``);
    const L = r.legacy ?? {};
    const S = r.structured ?? {};
    lines.push(`**Legacy** — ok=${L.ok} • path=${L.drafting_path} • fn=${L.footnotes_count} (anchored=${L.anchored_count}) • density=${L.density_per_1000} • len=${L.answer_length_chars} chars • ${L.wall_ms}ms`);
    if (L.models_used?.drafting) lines.push(`  - drafting: ${L.models_used.drafting.provider}/${L.models_used.drafting.model ?? "—"} (${L.models_used.drafting.status})`);
    lines.push(``);
    lines.push(`**Structured** — ok=${S.ok} • path=${S.drafting_path} • fn=${S.footnotes_count} (anchored=${S.anchored_count}) • density=${S.density_per_1000} • len=${S.answer_length_chars} chars • ${S.wall_ms}ms`);
    if (S.models_used) {
      const m = S.models_used;
      lines.push(`  - decomposition: ${m.decomposition?.provider ?? "—"}/${m.decomposition?.model ?? "—"} (${m.decomposition?.status ?? "—"}, ${m.decomposition?.duration_ms ?? "?"}ms)`);
      lines.push(`  - claim_map: ${m.claim_map?.provider ?? "—"}/${m.claim_map?.model ?? "—"} (${m.claim_map?.status ?? "—"}, ${m.claim_map?.duration_ms ?? "?"}ms)`);
      lines.push(`  - drafting: ${m.drafting?.provider ?? "—"}/${m.drafting?.model ?? "—"} (${m.drafting?.status ?? "—"}, ${m.drafting?.duration_ms ?? "?"}ms)`);
    }
    if (S.claim_map_summary) {
      const cm = S.claim_map_summary;
      lines.push(`  - claim_map_summary: total=${cm.total} direct=${cm.direct} qualified=${cm.qualified} omit=${cm.omit} uncovered=${cm.uncovered_sub_issues?.length ?? 0}`);
    }
    lines.push(``);
    lines.push(`<details><summary>Legacy answer</summary>\n\n\`\`\`\n${(L.answer ?? "").slice(0, 4000)}\n\`\`\`\n</details>`);
    lines.push(`<details><summary>Structured answer</summary>\n\n\`\`\`\n${(S.answer ?? "").slice(0, 4000)}\n\`\`\`\n</details>`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }
  writeFileSync(`${OUT_DIR}/report.md`, lines.join("\n"));
}

async function main() {
  log(`=== Eval run ${RUN_ID} ===`);
  log(`Output dir: ${OUT_DIR}`);

  let state = loadExistingResults();
  const completedIds = new Set(state.results.map((r) => r.id));

  const targetQuestions = ONLY_QUESTIONS
    ? QUESTIONS.filter((q) => ONLY_QUESTIONS.includes(q.id))
    : QUESTIONS;

  if (!SKIP_RUN) {
    log("Authenticating as admin via magic link…");
    let jwt = await getAdminJwt();
    log(`JWT acquired (length=${jwt.length})`);
    const jwtAcquiredAt = Date.now();

    for (const q of targetQuestions) {
      if (completedIds.has(q.id)) {
        log(`Q${q.id} already in results — skipping`);
        continue;
      }
      // Refresh JWT every 30 minutes to avoid expiry mid-run
      if (Date.now() - jwtAcquiredAt > 25 * 60 * 1000) {
        log("Refreshing JWT…");
        jwt = await getAdminJwt();
      }
      log(`---- Q${q.id} (${q.bucket}) ----`);
      log(`  legacy…`);
      const legacy = await runOne(jwt, q, "legacy", RUN_ID);
      log(`    ok=${legacy.ok} path=${legacy.drafting_path} fn=${legacy.footnotes_count} ${legacy.wall_ms}ms`);
      log(`  structured…`);
      const structured = await runOne(jwt, q, "structured", RUN_ID);
      log(`    ok=${structured.ok} path=${structured.drafting_path} fn=${structured.footnotes_count} ${structured.wall_ms}ms`);

      state.results.push({
        id: q.id,
        bucket: q.bucket,
        question: q.question,
        legacy,
        structured,
      });
      saveResults(state);
      writeCsv(state);
      writeReport(state);
    }
  } else {
    log("Skip-run flag set; only re-aggregating existing results.json");
  }

  saveResults(state);
  writeCsv(state);
  writeReport(state);
  log(`=== DONE — wrote ${state.results.length} questions to ${OUT_DIR} ===`);
}

main().catch((e) => {
  log(`FATAL: ${e?.stack || e?.message || String(e)}`);
  process.exit(1);
});
