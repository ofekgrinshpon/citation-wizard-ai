// Stage 5e controlled batch — runs ~12 statute-likely questions through legal-qa,
// captures statute_completion telemetry, and classifies perplexity_completion footnotes
// as useful vs noisy using a deterministic local heuristic.
//
// Output: /mnt/documents/legal-qa-eval/stage5e-batch-<runid>/{report.md,report.json,run.log}

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
  console.error("Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY|PUBLISHABLE_KEY");
  process.exit(1);
}

const RUN_ID = `stage5e-${Date.now()}-${randomUUID().slice(0, 8)}`;
const OUT_DIR = `/mnt/documents/legal-qa-eval/${RUN_ID}`;
mkdirSync(OUT_DIR, { recursive: true });
const LOG = `${OUT_DIR}/run.log`;

function log(m) {
  const line = `[${new Date().toISOString()}] ${m}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
}

// ---------- 12 statute-likely questions across domains ----------
const QUESTIONS = [
  { id: "S1",  q: "מה קובע סעיף 17 לחוק שירות המדינה (מינויים) לעניין פיטורים?", domain: "civil_service" },
  { id: "S2",  q: "מהי המשמעות של סעיף 39 לחוק החוזים (חלק כללי) בפסיקה הישראלית?", domain: "contract" },
  { id: "S3",  q: "מהן הוראות סעיף 284 לחוק העונשין לגבי הפרת אמונים?", domain: "criminal" },
  { id: "S4",  q: "מהו היקף ההגנה לפי חוק-יסוד: כבוד האדם וחירותו על הזכות לחירות?", domain: "constitutional" },
  { id: "S5",  q: "מתי ניתן לחייב פיצויים מוגברים לפי חוק איסור לשון הרע?", domain: "tort_press" },
  { id: "S6",  q: "מהן ההגנות הקבועות בחוק הגנת הפרטיות, התשמ\"א-1981?", domain: "privacy" },
  { id: "S7",  q: "באילו תנאים מורה בית המשפט על אכיפה של חוזה לפי חוק החוזים (תרופות בשל הפרת חוזה)?", domain: "contract_remedies" },
  { id: "S8",  q: "מהן ההוראות של חוק שוויון הזדמנויות בעבודה לעניין אפליה בקבלה לעבודה?", domain: "labor_equality" },
  { id: "S9",  q: "מהי תחולת חוק הגנת הצרכן על עסקאות מקוונות?", domain: "consumer" },
  { id: "S10", q: "מתי תוטל אחריות מנהלים לפי חוק החברות, התשנ\"ט-1999?", domain: "corporate" },
  { id: "S11", q: "מה קובעות הוראות חוק זכויות החולה לגבי הסכמה מדעת?", domain: "health" },
  { id: "S12", q: "מהי תחולת חוק יישוב סכסוכי עבודה על שביתות במגזר הציבורי?", domain: "labor_disputes" },
];

// ---------- auth ----------
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
async function getAdminJwt() {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
  if (error) throw new Error(`generateLink: ${error.message}`);
  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error("no hashed_token");
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const v = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (v.error) throw new Error(`verifyOtp: ${v.error.message}`);
  return v.data.session.access_token;
}

async function callLegalQa(jwt, body) {
  const url = `${SUPABASE_URL}/functions/v1/legal-qa`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5 * 60 * 1000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json, raw: json ? null : text };
  } finally { clearTimeout(t); }
}

async function fetchQaLog(evalRunId) {
  for (let i = 0; i < 12; i++) {
    const { data } = await admin
      .from("qa_logs")
      .select("id, created_at, answer, footnotes, total_footnotes, metadata")
      .eq("user_id", ADMIN_USER_ID)
      .filter("metadata->>eval_run_id", "eq", evalRunId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data?.[0]) return data[0];
    await new Promise(r => setTimeout(r, 1500));
  }
  return null;
}

// ---------- footnote usefulness classifier ----------
// Heuristic: a "useful" perplexity_completion footnote should
//   (a) name a real-looking statute (start with חוק/פקודת/תקנות/חוק-יסוד/צו),
//   (b) include a Hebrew or Gregorian year,
//   (c) include a publication marker (ס"ח / ק"ת / נ"ח / ע"ר) followed by a positive page,
//   (d) NOT contain case-law dockets or placeholder strings.
// Anything failing (a–d) is "noisy".
const STATUTE_HEAD_RE = /^(?:חוק[- ]יסוד\s*:|חוק|פקודת|פקודה|תקנות|תקנה|צו|כללי)\b/;
const YEAR_RE = /(?:התש[א-ת]["״']?[א-ת]?|\b(?:19|20)\d{2}\b)/;
const PUB_PAGE_RE = /(?:ס["״]ח|ק["״]ת|נ["״]ח|ע["״]ר)\s+(\d+)/;
const CASE_DOCKET_RE = /(?:בג["״]ץ|ע["״]א|ע["״]פ|רע["״]א|רע["״]פ|דנ["״]א|דנ["״]פ|ת["״]א|ת["״]פ|תפ["״]ח|בש["״]פ|עע["״]מ|בר["״]ם|עמ["״]ה)\s+\d+\/\d+/;
const PLACEHOLDER_RE = /(?:פרטי\s+מסמך|לא\s+נמצא|לא\s+ידוע|unknown|לא\s+נמצאו\s+פרטי\s+פרסום)/;

function getCitationText(fn) {
  // Production stores the formatted citation under `citation`. Older fixtures
  // may use text/formatted/body/content. Read citation FIRST.
  return String(fn?.citation || fn?.text || fn?.formatted || fn?.body || fn?.content || "").trim();
}

function classifyCompletion(fn) {
  const text = getCitationText(fn);
  if (!text) return { label: "noisy", reason: "empty_text" };
  if (CASE_DOCKET_RE.test(text)) return { label: "noisy", reason: "case_law_leakage" };
  if (PLACEHOLDER_RE.test(text)) return { label: "noisy", reason: "placeholder_in_text" };
  // Strip leading "ל" prefix and quotes if present
  const head = text.replace(/^[ל"״']\s*/, "");
  if (!STATUTE_HEAD_RE.test(head)) return { label: "noisy", reason: "no_statute_head" };
  if (!YEAR_RE.test(text)) return { label: "noisy", reason: "no_year" };
  const pubM = text.match(PUB_PAGE_RE);
  if (!pubM) return { label: "noisy", reason: "no_publication_marker" };
  const page = Number(pubM[1]);
  if (!Number.isFinite(page) || page <= 0) return { label: "noisy", reason: "bad_page" };
  return { label: "useful", reason: "ok" };
}

// ---------- per-question runner ----------
async function runOne(jwt, q) {
  const evalRunId = `${RUN_ID}-${q.id}`;
  log(`→ ${q.id} (${q.domain}) eval_run_id=${evalRunId}`);
  const t0 = Date.now();
  const r = await callLegalQa(jwt, {
    question: q.q, taskMode: "research", depth: "fast",
    evalRunId, evalVariant: "stage5e-batch",
  });
  const wallMs = Date.now() - t0;
  log(`  http=${r.status} wall=${wallMs}ms`);
  let row = null;
  if (r.status === 200) row = await fetchQaLog(evalRunId);

  const md = row?.metadata ?? r.body?.metadata ?? {};
  const sc = md?.statute_completion ?? null;
  const fns = row?.footnotes ?? r.body?.footnotes ?? [];
  const total = Array.isArray(fns) ? fns.length : 0;
  const completionFns = (fns || []).filter(f => f?.source === "perplexity_completion");
  const classified = completionFns.map((f, i) => ({
    idx: i, ...classifyCompletion(f),
    preview: String(f?.text || f?.formatted || f?.body || f?.content || "").slice(0, 220),
  }));
  const useful = classified.filter(c => c.label === "useful").length;
  const noisy = classified.filter(c => c.label === "noisy").length;

  return {
    id: q.id, domain: q.domain, question: q.q,
    http: r.status, wall_ms: wallMs, qa_log_id: row?.id ?? null,
    total_footnotes: total,
    statute_completion: sc ? {
      triggered: !!sc.triggered,
      status: sc.status ?? null,
      named_statutes: sc.named_statutes ?? [],
      regex_matches_total: sc.regex_matches_total ?? null,
      kept_for_completion: sc.kept_for_completion ?? null,
      skipped_with_existing: sc.skipped_with_existing ?? null,
      completed_count: sc.completed_count ?? 0,
      drops: sc.drops ?? {},
      duration_ms: sc.duration_ms ?? null,
      format_kind_counts: sc.format_kind_counts ?? null,
    } : null,
    completion_footnotes: {
      added: completionFns.length,
      useful, noisy,
      classified,
    },
  };
}

// ---------- main ----------
(async () => {
  const jwt = await getAdminJwt();
  log(`Got admin JWT. Running ${QUESTIONS.length} questions sequentially.`);
  const results = [];
  for (const q of QUESTIONS) {
    try { results.push(await runOne(jwt, q)); }
    catch (e) {
      log(`  ERROR ${q.id}: ${e.message}`);
      results.push({ id: q.id, domain: q.domain, question: q.q, error: e.message });
    }
  }

  // ---------- aggregate ----------
  const triggered = results.filter(r => r.statute_completion?.triggered).length;
  const statusCounts = {};
  let totalCompleted = 0, totalAdded = 0, totalUseful = 0, totalNoisy = 0;
  const dropAgg = {};
  for (const r of results) {
    const sc = r.statute_completion;
    if (sc) {
      statusCounts[sc.status || "null"] = (statusCounts[sc.status || "null"] || 0) + 1;
      totalCompleted += sc.completed_count || 0;
      for (const [k, v] of Object.entries(sc.drops || {})) dropAgg[k] = (dropAgg[k] || 0) + (v || 0);
    }
    if (r.completion_footnotes) {
      totalAdded += r.completion_footnotes.added || 0;
      totalUseful += r.completion_footnotes.useful || 0;
      totalNoisy += r.completion_footnotes.noisy || 0;
    }
  }

  const summary = {
    run_id: RUN_ID,
    questions_run: results.length,
    triggered_count: triggered,
    status_counts: statusCounts,
    total_completed_count_sum: totalCompleted,
    total_perplexity_completion_footnotes_added: totalAdded,
    useful_footnotes: totalUseful,
    noisy_footnotes: totalNoisy,
    useful_ratio: totalAdded > 0 ? +(totalUseful / totalAdded).toFixed(2) : null,
    drop_reason_aggregate: dropAgg,
  };

  writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify({ summary, results }, null, 2));

  // markdown
  const lines = [];
  lines.push(`# Stage 5e Batch Report — ${RUN_ID}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Aggregate");
  lines.push("```json");
  lines.push(JSON.stringify(summary, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Per-question");
  for (const r of results) {
    lines.push(`### ${r.id} — ${r.domain}`);
    lines.push(`Q: ${r.question}`);
    if (r.error) { lines.push(`**ERROR**: ${r.error}`); lines.push(""); continue; }
    lines.push(`HTTP=${r.http} wall=${r.wall_ms}ms total_fn=${r.total_footnotes}`);
    const sc = r.statute_completion;
    if (!sc) { lines.push("statute_completion: _missing_"); lines.push(""); continue; }
    lines.push(`statute_completion: triggered=${sc.triggered} status=${sc.status} kept=${sc.kept_for_completion} completed=${sc.completed_count} duration=${sc.duration_ms}ms`);
    if (sc.named_statutes?.length) lines.push(`  named: ${sc.named_statutes.slice(0, 5).join(" | ")}`);
    if (Object.keys(sc.drops || {}).length) lines.push(`  drops: ${JSON.stringify(sc.drops)}`);
    const cf = r.completion_footnotes;
    lines.push(`completion footnotes: added=${cf.added} useful=${cf.useful} noisy=${cf.noisy}`);
    for (const c of cf.classified) {
      lines.push(`  - [${c.label}/${c.reason}] ${c.preview}`);
    }
    lines.push("");
  }
  writeFileSync(`${OUT_DIR}/report.md`, lines.join("\n"));

  log(`Done. report.md / report.json written to ${OUT_DIR}`);
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));
})().catch(e => { log(`FATAL: ${e.stack || e.message}`); process.exit(1); });
