// Reusable Deep-pipeline smoke runner.
//
// Runs 10 fixed Hebrew questions sequentially against the protected
// `legal-qa` edge function in Deep research mode, consumes the SSE
// stream until `final`, then pulls the matching qa_logs row via REST
// (using the same JWT) and writes both CSV + JSON to /tmp/.
//
// USAGE (locally, NOT in the agent sandbox):
//
//   1. Log in to the app in your browser.
//   2. In DevTools → Application → Local Storage, copy the
//      `sb-<project>-auth-token` access_token (the JWT).
//   3. Export it and run:
//        export SMOKE_JWT="eyJhbGciOi..."
//        export SMOKE_USER_ID="<your auth.uid()>"
//        # optional overrides:
//        export SMOKE_PROJECT_ID="<a project_id of yours>"
//        export SMOKE_LABEL="batch-verifier-after"
//        bun scripts/deep-smoke.ts
//
//   4. Re-run with SMOKE_LABEL="baseline" against a deploy that does
//      NOT have the batch verifier to capture the comparison row.
//
// Outputs:
//   /tmp/deep-smoke-<label>-<timestamp>.json
//   /tmp/deep-smoke-<label>-<timestamp>.csv
//
// The script never writes outside /tmp and never mutates DB state
// beyond the qa_logs rows that the normal pipeline writes on its own.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://ioktiqcffungtlsmlkcv.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlva3RpcWNmZnVuZ3Rsc21sa2N2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjM2NzcsImV4cCI6MjA5MDM5OTY3N30.yDup2nKt-vEeccJjVY9CU32Zk_B6A04DC6ufQPH7ZXk";

const JWT = process.env.SMOKE_JWT;
const USER_ID = process.env.SMOKE_USER_ID;
const PROJECT_ID = process.env.SMOKE_PROJECT_ID ?? null;
const LABEL = process.env.SMOKE_LABEL ?? "smoke";
const RESEARCH_DEPTH = process.env.SMOKE_DEPTH ?? "deep";

if (!JWT || !USER_ID) {
  console.error("Set SMOKE_JWT and SMOKE_USER_ID env vars. See header for details.");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 10 fixed Hebrew Deep questions. Keep this list stable across runs so you can
// diff telemetry meaningfully. Mix doctrinal/procedural/legislative to
// exercise all retrieval paths.
const QUESTIONS: string[] = [
  "מהם תנאי הסף לעיכוב ביצוע פסק דין כספי בערעור אזרחי?",
  "מהי דוקטרינת הבטלות היחסית בהליך המינהלי, ומה היחס בינה לבין עילת אי-הסבירות?",
  "מתי בית המשפט יכיר בטענת אכיפת בררה במסגרת חוזה אחיד?",
  "מהי משמעות הגנת תום-הלב בעוולת לשון הרע, וכיצד היא יושמה לאחר תיקון 11 לחוק?",
  "באילו תנאים יורה בית הדין הארצי לעבודה על השבת עובד שפוטר בניגוד לחוק שוויון ההזדמנויות?",
  "מהי הילכת רותם לעניין נטל ההוכחה בעבירות מס לפי סעיף 220 לפקודת מס הכנסה?",
  "מהם הקריטריונים שגיבש בג\"ץ לבחינת חוקיות צו הריסה מינהלי לפי חוק התכנון והבנייה?",
  "מתי תקום אחריות אישית של נושא משרה בחברה לפי סעיף 54 לחוק החברות?",
  "מהו המבחן לקיומה של 'הפרה יסודית' בחוזה, וכיצד הוא משפיע על תרופת הביטול?",
  "מהי דוקטרינת השימוש לרעה בזכות התביעה האזרחית, ומתי הוכרה בפסיקה כעילה לדחיית תביעה על הסף?",
];

const LIMIT = Number(process.env.SMOKE_LIMIT ?? QUESTIONS.length);
const QUESTIONS_TO_RUN = QUESTIONS.slice(0, LIMIT);

// ─────────────────────────────────────────────────────────────────────────────
interface SmokeRow {
  index: number;
  question: string;
  qa_log_id: string | null;
  pipeline_used: string | null;
  ok: boolean;
  fallback_reason: string | null;
  stage_durations_ms: Record<string, number>;
  // Verifier telemetry
  claims_count: number | null;
  verifier_calls_before_estimate: number | null;
  verifier_calls_after: number | null;
  verifier_batch_size_avg: number | null;
  verifier_duration_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  missing_verdict_count: number | null;
  malformed_batch_count: number | null;
  zero_parseable_verdict_claim_count: number | null;
  http_error_count: number | null;
  json_parse_error_count: number | null;
  batch_fallback_count: number | null;
  // Quality signals
  citation_quality_status: string | null;
  supported_claims_count: number | null;
  claims_lost_all_support: number | null;
  footnotes_count: number | null;
  // Hard invariants
  cite_ls_leftovers: number;
  orphan_superscripts: number;
  citation_missing_placeholder_hits: number;
  wallclock_ms: number;
  error: string | null;
}

const HARD_INVARIANTS = {
  citeLs: /\[cite:LS\d+\]/g,
  orphanSuper: /[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]/g,
  missingCitation: /ציטוט\s*חסר/g,
};

function emptyDurations(): Record<string, number> {
  return {};
}

async function runOne(idx: number, question: string): Promise<SmokeRow> {
  const t0 = Date.now();
  const row: SmokeRow = {
    index: idx, question,
    qa_log_id: null, pipeline_used: null, ok: false, fallback_reason: null,
    stage_durations_ms: emptyDurations(),
    claims_count: null,
    verifier_calls_before_estimate: null,
    verifier_calls_after: null,
    verifier_batch_size_avg: null,
    verifier_duration_ms: null,
    prompt_tokens: null, completion_tokens: null, total_tokens: null,
    missing_verdict_count: null,
    malformed_batch_count: null,
    zero_parseable_verdict_claim_count: null,
    http_error_count: null,
    json_parse_error_count: null,
    batch_fallback_count: null,
    citation_quality_status: null,
    supported_claims_count: null,
    claims_lost_all_support: null,
    footnotes_count: null,
    cite_ls_leftovers: 0, orphan_superscripts: 0, citation_missing_placeholder_hits: 0,
    wallclock_ms: 0,
    error: null,
  };

  let qaLogId: string | null = null;
  let finalAnswer = "";

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/legal-qa`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${JWT}`,
        "apikey": SUPABASE_ANON_KEY,
        "Accept": "text/event-stream",
      },
      body: JSON.stringify({
        question,
        taskMode: "research",
        researchDepth: RESEARCH_DEPTH,
        projectId: PROJECT_ID,
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      row.error = `http_${res.status}:${(await res.text()).slice(0, 300)}`;
      row.wallclock_ms = Date.now() - t0;
      return row;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const stageStart: Record<string, number> = {};

    outer: while (true) {
      const { value, done } = await reader.read();
      if (done) { row.ok = row.ok || finalAnswer.length > 0 || !!qaLogId; break; }
      buf += dec.decode(value, { stream: true });
      let split: number;
      while ((split = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, split);
        buf = buf.slice(split + 2);
        let evtName = "message";
        const dataLines: string[] = [];
        for (const ln of raw.split("\n")) {
          if (ln.startsWith("event:")) evtName = ln.slice(6).trim();
          else if (ln.startsWith("data:")) dataLines.push(ln.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        const payload = dataLines.join("");
        if (!payload) continue;
        if (payload === "[DONE]") { row.ok = true; break outer; }
        let evt: any;
        try { evt = JSON.parse(payload); } catch { continue; }

        if (evtName === "stage" && typeof evt?.stage === "string") {
          if (evt.status === "running") stageStart[evt.stage] = Date.now();
          else if (evt.status === "complete" && stageStart[evt.stage]) {
            row.stage_durations_ms[evt.stage] =
              (row.stage_durations_ms[evt.stage] ?? 0) + (Date.now() - stageStart[evt.stage]);
            delete stageStart[evt.stage];
          }
          continue;
        }
        if (evtName === "final" || evt?.type === "final" || evt?.type === "complete") {
          const body = evt?.body ?? evt;
          qaLogId = body?.qa_log_id ?? body?.qaLogId ?? body?.id ?? qaLogId;
          finalAnswer = body?.answer ?? body?.text ?? finalAnswer;
          row.ok = true;
        }
      }
    }
  } catch (e) {
    row.error = `stream_throw:${(e as Error).message}`;
    row.wallclock_ms = Date.now() - t0;
    return row;
  }

  row.wallclock_ms = Date.now() - t0;
  row.qa_log_id = qaLogId;

  // Hard-invariant scan on the streamed answer (may be incomplete if final
  // event didn't carry full text; we backfill from qa_logs below).
  if (finalAnswer) {
    row.cite_ls_leftovers = (finalAnswer.match(HARD_INVARIANTS.citeLs) || []).length;
    row.orphan_superscripts = (finalAnswer.match(HARD_INVARIANTS.orphanSuper) || []).length;
    row.citation_missing_placeholder_hits =
      (finalAnswer.match(HARD_INVARIANTS.missingCitation) || []).length;
  }

  // ── Fetch qa_logs row to extract telemetry ────────────────────────────
  if (qaLogId) {
    await sleep(1200); // give the writer a beat to flush
    const log = await fetchQaLog(qaLogId);
    if (log) hydrateFromLog(row, log);
  } else {
    // Best-effort: most recent qa_logs row for this user.
    await sleep(1500);
    const log = await fetchMostRecentQaLogForQuestion(question);
    if (log) {
      row.qa_log_id = log.id;
      hydrateFromLog(row, log);
    }
  }

  return row;
}

function hydrateFromLog(row: SmokeRow, log: any) {
  const md = log.metadata ?? {};
  const core = md.core ?? {};
  row.pipeline_used = md.pipeline_used ?? md.pipeline ?? core.version ?? null;

  // Stage durations from server side (authoritative)
  if (Array.isArray(core.stage_runs)) {
    for (const s of core.stage_runs) {
      if (s?.stage && typeof s.duration_ms === "number") {
        row.stage_durations_ms[s.stage] = s.duration_ms;
      }
    }
    const verifyStage = core.stage_runs.find((s: any) => s?.stage === "verify");
    const vt = verifyStage?.metadata?.verifier;
    if (vt) {
      row.verifier_calls_before_estimate = vt.verifier_calls_before_estimate ?? null;
      row.verifier_calls_after = vt.verifier_calls_after ?? null;
      row.verifier_batch_size_avg = vt.verifier_batch_size_avg ?? null;
      row.verifier_duration_ms = vt.verifier_duration_ms ?? null;
      row.prompt_tokens = vt.prompt_tokens ?? null;
      row.completion_tokens = vt.completion_tokens ?? null;
      row.total_tokens = vt.total_tokens ?? null;
      row.missing_verdict_count = vt.missing_verdict_count ?? null;
      row.malformed_batch_count = vt.malformed_batch_count ?? null;
      row.zero_parseable_verdict_claim_count = vt.zero_parseable_verdict_claim_count ?? null;
      row.http_error_count = vt.http_error_count ?? null;
      row.json_parse_error_count = vt.json_parse_error_count ?? null;
      row.batch_fallback_count = vt.batch_fallback_count ?? null;
    }
  }

  // Plan claims count
  const claims = core.plan?.claims;
  if (Array.isArray(claims)) row.claims_count = claims.length;

  // Ledger
  const ledger = core.ledger;
  if (ledger) {
    if (typeof ledger.supported_count === "number") row.supported_claims_count = ledger.supported_count;
    if (Array.isArray(ledger.claims)) {
      row.claims_lost_all_support = ledger.claims.filter(
        (c: any) => c?.status === "unsupported" && c?.lost_all_support === true,
      ).length;
      if (row.supported_claims_count == null) {
        row.supported_claims_count = ledger.claims.filter((c: any) => c?.status === "supported").length;
      }
    }
  }

  // Citation quality
  const cq = core.citation_quality ?? md.citation_quality;
  if (cq?.status) row.citation_quality_status = cq.status;

  // Footnotes
  if (typeof log.total_footnotes === "number") row.footnotes_count = log.total_footnotes;
  else if (Array.isArray(log.footnotes)) row.footnotes_count = log.footnotes.length;

  // Hard-invariant rescan on authoritative answer
  if (typeof log.answer === "string" && log.answer) {
    row.cite_ls_leftovers = (log.answer.match(HARD_INVARIANTS.citeLs) || []).length;
    row.orphan_superscripts = (log.answer.match(HARD_INVARIANTS.orphanSuper) || []).length;
    row.citation_missing_placeholder_hits =
      (log.answer.match(HARD_INVARIANTS.missingCitation) || []).length;
  }
}

async function fetchQaLog(id: string): Promise<any | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/qa_logs?id=eq.${id}&select=id,answer,metadata,footnotes,total_footnotes,task_mode,created_at`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${JWT}` } },
    );
    if (r.ok) {
      const arr = await r.json();
      if (Array.isArray(arr) && arr.length) return arr[0];
    }
    await sleep(1000 * (attempt + 1));
  }
  return null;
}

async function fetchMostRecentQaLogForQuestion(question: string): Promise<any | null> {
  const q = encodeURIComponent(question.slice(0, 80));
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/qa_logs?user_id=eq.${USER_ID}&question=ilike.${q}*&order=created_at.desc&limit=1&select=id,answer,metadata,footnotes,total_footnotes,task_mode,created_at`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${JWT}` } },
  );
  if (!r.ok) return null;
  const arr = await r.json();
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function toCsv(rows: SmokeRow[]): string {
  const cols = [
    "index", "qa_log_id", "pipeline_used", "ok", "fallback_reason", "wallclock_ms",
    "claims_count",
    "verifier_calls_before_estimate", "verifier_calls_after",
    "verifier_batch_size_avg", "verifier_duration_ms",
    "prompt_tokens", "completion_tokens", "total_tokens",
    "missing_verdict_count", "malformed_batch_count",
    "zero_parseable_verdict_claim_count",
    "http_error_count", "json_parse_error_count", "batch_fallback_count",
    "citation_quality_status", "supported_claims_count", "claims_lost_all_support",
    "footnotes_count",
    "cite_ls_leftovers", "orphan_superscripts", "citation_missing_placeholder_hits",
    "question", "error",
  ];
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(cols.map((c) => esc((r as any)[c])).join(","));
  }
  return lines.join("\n");
}

function summarize(rows: SmokeRow[]) {
  const ok = rows.filter((r) => r.ok);
  const sum = (k: keyof SmokeRow) => ok.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const avg = (k: keyof SmokeRow) => (ok.length ? sum(k) / ok.length : 0);
  const totalBefore = sum("verifier_calls_before_estimate");
  const totalAfter = sum("verifier_calls_after");
  return {
    runs_total: rows.length,
    runs_ok: ok.length,
    verifier_calls_before_total: totalBefore,
    verifier_calls_after_total: totalAfter,
    verifier_call_reduction_pct: totalBefore > 0 ? +(100 * (1 - totalAfter / totalBefore)).toFixed(1) : 0,
    verifier_duration_ms_avg: +avg("verifier_duration_ms").toFixed(0),
    missing_verdict_total: sum("missing_verdict_count"),
    malformed_batch_total: sum("malformed_batch_count"),
    zero_parseable_verdict_claim_total: sum("zero_parseable_verdict_claim_count"),
    http_error_total: sum("http_error_count"),
    json_parse_error_total: sum("json_parse_error_count"),
    batch_fallback_total: sum("batch_fallback_count"),
    cite_ls_leftovers_total: sum("cite_ls_leftovers"),
    orphan_superscripts_total: sum("orphan_superscripts"),
    citation_missing_placeholder_total: sum("citation_missing_placeholder_hits"),
    claims_lost_all_support_total: sum("claims_lost_all_support"),
    citation_quality_status_breakdown: rows.reduce((acc: Record<string, number>, r) => {
      const k = r.citation_quality_status ?? "unknown";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

(async () => {
  console.log(`[deep-smoke] label=${LABEL} depth=${RESEARCH_DEPTH} questions=${QUESTIONS_TO_RUN.length}`);
  const rows: SmokeRow[] = [];
  for (let i = 0; i < QUESTIONS_TO_RUN.length; i++) {
    const q = QUESTIONS_TO_RUN[i];
    console.log(`\n[${i + 1}/${QUESTIONS_TO_RUN.length}] ${q}`);
    const row = await runOne(i + 1, q);
    rows.push(row);
    console.log(
      `  → ok=${row.ok} qa_log=${row.qa_log_id ?? "?"} ` +
      `verify: before=${row.verifier_calls_before_estimate} after=${row.verifier_calls_after} ` +
      `dur=${row.verifier_duration_ms}ms fallback=${row.batch_fallback_count} ` +
      `missing=${row.missing_verdict_count} malformed=${row.malformed_batch_count} ` +
      `zero=${row.zero_parseable_verdict_claim_count}`,
    );
  }

  const summary = summarize(rows);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `/tmp/deep-smoke-${LABEL}-${stamp}`;
  const fs = await import("node:fs/promises");
  await fs.writeFile(`${base}.json`, JSON.stringify({ label: LABEL, summary, rows }, null, 2));
  await fs.writeFile(`${base}.csv`, toCsv(rows));
  console.log(`\n[deep-smoke] wrote ${base}.json and ${base}.csv`);
  console.log("[deep-smoke] summary:", JSON.stringify(summary, null, 2));
})().catch((e) => {
  console.error("[deep-smoke] fatal:", e);
  process.exit(1);
});
