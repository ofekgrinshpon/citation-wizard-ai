// source_label_quality_v1 — 12-query validation runner.
// Focus: user-facing source lists and labels (titles, classification,
// duplicates), plus the existing invariant / regression guards.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) {
  console.error("Missing env");
  process.exit(1);
}
const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
const TERMINAL = new Set(["done", "error", "failed", "timeout", "completed"]);

const ALL = [
  { id: "F01", query: `מה נטל ההוכחה בעתירות לבג״ץ? על מי מוטל הנטל? על העותר תמיד?` },
  { id: "F02", query: `בסוגייה של חלוקת רכוש לאחר גירושי בני זוג, מה היא אמת המידה לביקורת שיפוטית של בג״ץ כאשר יש חשד שבית הדין הרבני הסתמך על שיקול חיצוני לדין האזרחי?` },
  { id: "F03", query: `מה נקבע בבג"ץ 1000/92 בבלי נ' בית הדין הרבני הגדול?` },
  { id: "F04", query: `מה נקבע בבג"ץ 2232/03 פלונית נ' בית הדין הרבני האזורי תל אביב (עניין אמיר)?` },
  { id: "F05", query: `מה קובע סעיף 6 לחוק החברות, תשנ"ט-1999 בעניין הרמת מסך?` },
  { id: "F06", query: `מהו היקף חובת תום הלב במשא ומתן לפי סעיף 12 לחוק החוזים (חלק כללי)?` },
  { id: "F07", query: `מהם מבחני המידתיות בביקורת חוקתית בישראל?` },
  { id: "R02", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
  { id: "P02", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
  { id: "N01", query: `על מי מוטל נטל ההוכחה בתביעה אזרחית כספית רגילה?` },
  { id: "N02", query: `מהי עילת הסבירות במשפט המינהלי הישראלי?` },
];
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const QUERIES = only.length ? ALL.filter((q) => only.includes(q.id)) : ALL;

const B8_CANON =
  "זכויות היסוד של האדם בישראל מושתתות על ההכרה בערך האדם, בקדושת חייו ובהיותו בן-חורין, והן יכובדו ברוח העקרונות שבהכרזה על הקמת מדינת ישראל.";

const OUT = "reports/classification-validation";
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SUP_MAP: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};
const RUN_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu;

function markersIn(answer: string, valid: Set<number>) {
  const found: number[] = [];
  let dangling = 0;
  for (const m of answer.matchAll(RUN_RE)) {
    const digits = m[0].split("").map((c) => SUP_MAP[c] ?? c).join("");
    let i = 0;
    while (i < digits.length) {
      let matched = -1;
      let len = 1;
      for (let l = Math.min(digits.length - i, 4); l >= 1; l--) {
        const n = parseInt(digits.slice(i, i + l), 10);
        if (Number.isFinite(n) && valid.has(n)) { matched = n; len = l; break; }
      }
      if (matched > 0) found.push(matched); else dangling++;
      i += len;
    }
  }
  return { found, dangling };
}

// ── label-quality detectors (applied to the RENDERED titles) ───────────────
const FILENAME_RE = /\.(pdf|docx?|xlsx?|pptx?|rtf|txt|html?|aspx?)\s*$/i;
const FILENAME_SHAPE_RE = /^[\w~%\-. ]*[_-]?\d{4,}[\w~%\-. ]*$/;
const BARE_INSTITUTIONS = [
  "בית המשפט העליון", "בית המשפט המחוזי", "הרשות השופטת", "בתי המשפט",
  "משרד המשפטים", "הכנסת", "מרכז המחקר והמידע", "נבו", "מאגר נבו",
  "אתר בית המשפט העליון", "supreme court", "the knesset",
];
const norm = (s: string) => s.replace(/[\s"'׳״,.\u05BE\-–—]+/g, " ").trim().toLowerCase();

function isFilenameTitle(t: string) {
  const s = t.trim();
  return FILENAME_RE.test(s) || (FILENAME_SHAPE_RE.test(s) && !/[\u05D0-\u05EA]/.test(s));
}
function isBareInstitution(t: string) {
  const n = norm(t);
  return BARE_INSTITUTIONS.some((b) => norm(b) === n);
}
function lev(a: string, b: string) {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
function similarity(a: string, b: string) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  return 1 - lev(x, y) / Math.max(x.length, y.length);
}
function nearDuplicatePairs(titles: string[]) {
  const pairs: Array<[string, string, number]> = [];
  for (let i = 0; i < titles.length; i++) {
    for (let j = i + 1; j < titles.length; j++) {
      if (norm(titles[i]) === norm(titles[j])) continue;
      const s = similarity(titles[i], titles[j]);
      if (s >= 0.88) pairs.push([titles[i], titles[j], Number(s.toFixed(3))]);
    }
  }
  return pairs;
}

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string; job_id?: string };
}

async function jobById(job_id: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,error&id=eq.${job_id}&limit=1`,
    { headers },
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function qaByRun(run_id: string, sinceIso: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,metadata` +
      `&metadata->>run_id=eq.${run_id}&created_at=gte.${encodeURIComponent(sinceIso)}` +
      `&order=created_at.desc&limit=5`,
    { headers },
  );
  if (!r.ok) return [];
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

function isPlaceholder(row: any): boolean {
  const a: string = row?.answer ?? "";
  const md = row?.metadata ?? {};
  if (md.trace_status === "in_progress") return true;
  if (md.status === "running" || md.status === "queued") return true;
  if (!String(a).trim()) return true;
  if (a.includes("מעבד") && a.length < 80) return true;
  return false;
}

const results: any[] = [];

for (const q of QUERIES) {
  const t0 = Date.now();
  const launchIso = new Date(t0 - 5_000).toISOString();
  const t = await trigger(q.query).catch(() => ({} as any));
  console.log(`[${q.id}] launch job_id=${t.job_id} run_id=${t.run_id}`);
  if (!t.run_id || !t.job_id) {
    const rec = { id: q.id, pass: false, failures: ["trigger_failed"] };
    results.push(rec);
    writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
    continue;
  }

  let job: any = null;
  const deadline = Date.now() + 900_000;
  while (Date.now() < deadline) {
    job = await jobById(t.job_id);
    if (job && TERMINAL.has(String(job.status))) break;
    console.log(`[${q.id}] poll ${Math.round((Date.now() - t0) / 1000)}s status=${job?.status} stage=${job?.current_stage}`);
    await sleep(10_000);
  }
  const terminal = !!job && TERMINAL.has(String(job.status));

  let row: any = null;
  if (terminal) {
    for (let i = 0; i < 6 && !row; i++) {
      const rows = await qaByRun(t.run_id, launchIso);
      row = rows.find((r: any) => !isPlaceholder(r)) ?? null;
      if (!row) await sleep(5_000);
    }
  }

  const md: any = row?.metadata ?? {};
  const d: any = md.drafter ?? {};
  const answer: string = (row?.answer ?? d.answer_markdown ?? "") as string;
  const fns: any[] = (row?.footnotes ?? d.footnotes ?? []) as any[];
  const usedSources: any[] = d.used_sources ?? [];
  const labelReport = d.source_label_quality ?? null;
  const report = d.footnote_render_report ?? null;
  const branch = d.deterministic_branch ?? md.deterministic_branch ?? null;

  const valid = new Set<number>(fns.map((f: any) => Number(f.number)));
  const { found, dangling } = markersIn(answer, valid);
  const markerSet = new Set(found);
  const maxMarker = found.length ? Math.max(...found) : 0;
  const orphanRows = fns.filter((f: any) => !markerSet.has(Number(f.number))).length;

  // Rendered source list = footnote rows (+ their sub-sources).
  const renderedRows = fns.map((f: any) => ({
    number: f.number,
    title: String(f.title ?? ""),
    citable_as: f.citable_as ?? f.sources?.[0]?.citable_as ?? null,
    sub_titles: Array.isArray(f.sources) ? f.sources.map((s: any) => String(s.title ?? "")) : [],
  }));
  const renderedTitles = renderedRows.flatMap((r) => [r.title, ...r.sub_titles]).filter(Boolean);

  const filenameTitles = renderedTitles.filter(isFilenameTitle);
  const bareInstitutionTitles = renderedTitles.filter(isBareInstitution);
  const dupPairs = nearDuplicatePairs(renderedTitles);

  // Classification checks on used_sources (label after the quality pass).
  const scholarshipAsStatute = usedSources.filter((s: any) =>
    String(s.citable_as) === "statute" &&
    /(מסמך רקע|מרכז המחקר|נייר עמדה|סקירה משווה|\.docx|\.pdf|מאמר)/i.test(String(s.title ?? ""))
  ).map((s: any) => s.title);
  const commentaryAsJudgment = usedSources.filter((s: any) =>
    String(s.citable_as) === "judgment" &&
    !/\d{1,5}\s*\/\s*\d{2,4}|\d{4,6}-\d{2}-\d{2}/.test(String(s.title ?? "") + String(s.url ?? ""))
  ).map((s: any) => s.title);

  const metadataOnlyHoldings = d.metadata_only_holding_gate?.metadata_only_holdings_remaining ?? 0;
  const isStub = !!md.is_stub || answer.includes("STUB_ANSWER");
  const verifierFailed = !!d.verifier_call_failed || md.verifier_error != null;
  const cpuKill = /CPU|isolate|stale_worker/i.test(String(job?.error ?? ""));

  const failures: string[] = [];
  if (!terminal) failures.push("job_not_terminal_or_stale");
  if (terminal && !row) failures.push("no_terminal_qa_row");
  if (!String(answer).trim()) failures.push("empty_answer_body");
  if (dangling > 0) failures.push("dangling_marker");
  if (orphanRows > 0) failures.push("orphan_source_row");
  if (fns.length > 0 && maxMarker !== fns.length) failures.push("invariant_max_marker_mismatch");
  if (filenameTitles.length) failures.push("raw_filename_visible");
  if (bareInstitutionTitles.length) failures.push("bare_institution_visible");
  if (dupPairs.length) failures.push("ocr_duplicate_visible");
  if (scholarshipAsStatute.length) failures.push("scholarship_labelled_statute");
  if (commentaryAsJudgment.length) failures.push("commentary_labelled_judgment");
  if (metadataOnlyHoldings > 0) failures.push("metadata_only_holding");
  if (isStub) failures.push("stub_answer");
  if (verifierFailed) failures.push("verifier_failure");
  if (cpuKill) failures.push("cpu_kill");
  if (q.id === "B8" && answer && !answer.includes(B8_CANON)) failures.push("b8_canonical_quote_changed");
  if (q.id === "P02" && branch !== "docket_limitation") failures.push("p02_not_deterministic_docket_refusal");
  if (q.id === "R02" && !(answer.includes("6821/93") || answer.includes("המזרחי"))) {
    failures.push("r02_missing_exact_body");
  }

  const labelRows: any[] = labelReport?.rows ?? [];
  const changed = labelRows.filter((r: any) =>
    r.classification_before && r.classification_after && r.classification_before !== r.classification_after);
  const uncertainCount = labelRows.filter((r: any) => r.uncertain_identity === true).length;
  const downgrades = labelRows.filter((r: any) => r.downgrade_reason)
    .map((r: any) => ({ title: r.title, downgrade_reason: r.downgrade_reason }));

  const rec = {
    id: q.id,
    classification_changed: changed.map((r: any) => ({
      title: r.title, before: r.classification_before, after: r.classification_after,
      reason: r.classification_reason ?? null,
    })),
    classification_rows: labelRows.map((r: any) => ({
      title: r.title,
      classification_before: r.classification_before ?? null,
      classification_after: r.classification_after ?? null,
      judgment_identity_signals: r.judgment_identity_signals ?? [],
      commentary_identity_signals: r.commentary_identity_signals ?? [],
      uncertain_identity: r.uncertain_identity === true,
      downgrade_reason: r.downgrade_reason ?? null,
      url: r.url ?? null,
    })),
    uncertain_identity_count: uncertainCount,
    downgrades,
    query: q.query,
    job_id: t.job_id,
    run_id: t.run_id,
    ms: Date.now() - t0,
    terminal_status: job?.status ?? "none",
    job_error: job?.error ?? null,
    branch,
    answer_length: answer.length,
    inline_marker_count: found.length,
    max_marker: maxMarker,
    footnotes_length: fns.length,
    used_sources_length: usedSources.length,
    dangling_marker_count: dangling,
    orphan_source_row_count: orphanRows,
    invariant_passed: dangling === 0 && orphanRows === 0 &&
      (fns.length === 0 || maxMarker === fns.length),
    rendered_rows: renderedRows,
    label_report: labelReport,
    filename_titles: filenameTitles,
    bare_institution_titles: bareInstitutionTitles,
    ocr_duplicate_pairs: dupPairs,
    scholarship_as_statute: scholarshipAsStatute,
    commentary_as_judgment: commentaryAsJudgment,
    metadata_only_holdings: metadataOnlyHoldings,
    used_sources: usedSources.map((s: any) => ({
      number: s.number, title: s.title, citable_as: s.citable_as,
      text_usability: s.text_usability, url: s.url,
    })),
    footnote_render_report: report,
    pass: failures.length === 0,
    failures,
    answer,
  };
  results.push(rec);
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
  console.log(
    `[${q.id}] ${rec.pass ? "PASS" : "FAIL"} branch=${branch} fns=${fns.length} used=${usedSources.length} dangling=${dangling} orphan=${orphanRows} fallback=${labelReport?.fallback_used_count ?? "-"} reclass=${labelReport?.reclassified_count ?? "-"} ${rec.failures.join(",")}`,
  );
  writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(results.map((r: any) => ({
    id: r.id, pass: r.pass, failures: r.failures, branch: r.branch,
    footnotes_length: r.footnotes_length, used_sources_length: r.used_sources_length,
    dangling: r.dangling_marker_count, orphan: r.orphan_source_row_count,
    uncertain_identity_count: r.uncertain_identity_count,
    metadata_only_holdings: r.metadata_only_holdings,
    invariant_passed: r.invariant_passed,
    fallback_used_count: r.label_report?.fallback_used_count ?? null,
    reclassified_count: r.label_report?.reclassified_count ?? null,
  })), null, 2));
}
console.log("done");
