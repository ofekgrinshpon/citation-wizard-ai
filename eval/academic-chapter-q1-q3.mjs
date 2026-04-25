// Academic-chapter eval harness — 3 chapter writes × 1 rep, depth=deep (forced).
//
// Mirrors `deep-mode-q1-q6-q21.mjs`. Captures the new `chapter_qa_guard` and
// `profile_used_academic` blocks alongside `chapter_engine` so we can run a
// before/after comparison the same way we did for Deep research.
//
// PHASE=before/after controls the output filename, allowing diff runs.
//
// Each fixture is a (research_question, outline, chapterTitle, chapterIndex,
// previousChapters) tuple chosen to span:
//   • Q1 — constitutional/admin-law chapter (high-density caselaw)
//   • Q2 — statutory chapter (anchored to a single act, list-friendly)
//   • Q3 — theoretical/comparative chapter (heavier on journal_article)
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
const PHASE = process.env.PHASE || "before";
const RUN_ID = `academic-${PHASE}-${randomUUID().slice(0, 8)}`;
const OUT_FILE = `${OUT_DIR}/academic-chapter-${PHASE}.json`;
const LOG_FILE = `${OUT_DIR}/academic-chapter-${PHASE}.log`;

const log = (m) => { const l = `[${new Date().toISOString()}] ${m}`; console.log(l); appendFileSync(LOG_FILE, l + "\n"); };

// ─── Fixtures ───
// outline format mirrors what `propose_outline` produces; the chapter prompt
// extracts thesis / line-of-argument / chapter description / counter-arguments
// / sibling titles by regex (see getAcademicSubModePrompt write_chapter).
const Q1_OUTLINE = `**מבוא**
- שאלת המחקר: האם הממשלה מוסמכת לפטר את היועצת המשפטית לממשלה, ואם כן באילו מגבלות?
- התזה המרכזית: סמכות הפיטורים קיימת אך כפופה למגבלות נורמטיביות חמורות הנובעות מעקרון אי-תלות היועץ.
- קו הטיעון: מציג את הדין המצוי, מנתח אותו ביקורתית, ומציע מסגרת נורמטיבית מוצעת.

**רשימת הפרקים**
1. **המסגרת הנורמטיבית הקיימת לפיטורי היועצת המשפטית לממשלה** – הדין המצוי
   - הרחבה: הפרק יבחן את החקיקה והפסיקה הקובעות את סמכות הפיטורים, ויטען כי המסגרת הקיימת היא חלקית ומבוססת רובה על הסכמות פוליטיות ופסיקה ולא על חקיקה ראשית מפורשת.
   - טיעוני נגד אפשריים: יש הטוענים שדי בכללי המשפט המנהלי הכלליים. הפרק יראה מדוע אין די בכך.
2. **ניתוח ביקורתי של ההלכה הקיימת** – ניתוח ביקורתי
   - הרחבה: ניתוח ביקורתי של פסיקת בג"ץ.
   - טיעוני נגד אפשריים: ...

**סיכום ומסקנות (משוערות)**
- מסקנה משוערת: יש לעגן את ההגנה על אי-תלות היועצת בחקיקה ראשית.`;

const Q2_OUTLINE = `**מבוא**
- שאלת המחקר: מה קובע סעיף 17 לחוק שירות המדינה (מינויים) לעניין פיטורים והפסקת כהונה?
- התזה המרכזית: סעיף 17 מקנה לוועדת השירות סמכות מהותית אך הליכית מוגבלת.
- קו הטיעון: ניתוח לשוני, השוואתי ופסיקתי.

**רשימת הפרקים**
1. **לשונו של סעיף 17 וההיסטוריה החקיקתית שלו** – הדין המצוי
   - הרחבה: הפרק ינתח את לשון הסעיף, את תיקוניו לאורך השנים ואת המנגנון הפרוצדורלי שהוא מכונן. הטענה היא שמדובר בהסדר ייחודי המעניק לוועדת השירות הן סמכות מהותית והן סמכות הליכית.
   - טיעוני נגד אפשריים: ניתן לטעון שהסעיף הוא טכני בלבד; הפרק יראה שאין זה כך.
2. **פסיקה רלוונטית** – ניתוח ביקורתי
   - הרחבה: ...
   - טיעוני נגד אפשריים: ...`;

const Q3_OUTLINE = `**מבוא**
- שאלת המחקר: מהן ההגנות החוקתיות על חופש הביטוי הפוליטי בישראל?
- התזה המרכזית: ההגנה החוקתית קיימת אך מצומצמת יחסית למשפט המשווה.
- קו הטיעון: השוואה בין הדין הישראלי לדין האמריקאי והאירופי.

**רשימת הפרקים**
1. **הגנת חופש הביטוי הפוליטי במשפט הישראלי** – הדין המצוי
   - הרחבה: הפרק יציג את ההלכות המרכזיות (קול העם, להב, חברת החדשות) ויטען כי ההגנה היא פסיקתית ולא חוקתית כתובה, מה שמייצר חוסר ודאות נורמטיבי.
   - טיעוני נגד אפשריים: יש הטוענים שכבוד האדם וחירותו מספק עוגן חוקתי מספק.
2. **השוואה לדין האמריקאי** – משפט משווה
   - הרחבה: ...
   - טיעוני נגד אפשריים: ...`;

const FIXTURES = [
  {
    id: 1,
    bucket: "constitutional_admin",
    researchQuestion: "האם הממשלה מוסמכת לפטר את היועצת המשפטית לממשלה, ואם כן באילו מגבלות נורמטיביות ומנהליות?",
    outline: Q1_OUTLINE,
    chapterTitle: "המסגרת הנורמטיבית הקיימת לפיטורי היועצת המשפטית לממשלה",
    chapterIndex: 1,
    previousChapters: [],
  },
  {
    id: 2,
    bucket: "statute_anchored",
    researchQuestion: "מה קובע סעיף 17 לחוק שירות המדינה (מינויים) לעניין פיטורים או הפסקת כהונה?",
    outline: Q2_OUTLINE,
    chapterTitle: "לשונו של סעיף 17 וההיסטוריה החקיקתית שלו",
    chapterIndex: 1,
    previousChapters: [],
  },
  {
    id: 3,
    bucket: "constitutional_speech",
    researchQuestion: "מהן ההגנות החוקתיות על חופש הביטוי הפוליטי בישראל?",
    outline: Q3_OUTLINE,
    chapterTitle: "הגנת חופש הביטוי הפוליטי במשפט הישראלי",
    chapterIndex: 1,
    previousChapters: [],
  },
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
    question: q.researchQuestion, // legal-qa requires `question`; for chapters this is the RQ
    taskMode: "academic_writing",
    academicStep: "write_chapter",
    researchQuestion: q.researchQuestion,
    outline: q.outline,
    chapterTitle: q.chapterTitle,
    chapterIndex: q.chapterIndex,
    previousChapters: q.previousChapters,
    isAbstract: false,
    evalRunId,
    requestId: `eval:${evalRunId}`,
  });
  const wall = Date.now() - start;
  const ok = r.status === 200 && r.body?.answer;
  const row = await fetchLog(evalRunId);
  const md = row?.metadata ?? {};
  const ans = ok ? r.body.answer : (row?.answer ?? "");
  const fn = ok ? (r.body.footnotes ?? []) : (row?.footnotes ?? []);
  const profile = md.profile_used || {};
  const academicProfile = md.profile_used_academic || {};
  const chapterEngine = md.chapter_engine || null;
  const qaGuard = md.chapter_qa_guard || null;
  return {
    ok, http_status: r.status, http_error: ok ? null : (r.body?.error || r.raw),
    wall_ms: wall,
    drafting_path: md.drafting_path,
    profile_depth: profile.depth, profile_drafter: profile.drafterVariant,
    profile_word_min: profile.wordRangeMin, profile_word_max: profile.wordRangeMax,
    academic_step: academicProfile.step,
    academic_inherits_from: academicProfile.inheritsFrom,
    academic_credit_cost: academicProfile.creditCost,
    academic_doc_chars: academicProfile.documentContextChars,
    answer_words: wordsOf(ans),
    answer_full: ans, // for qualitative diff
    footnotes_count: Array.isArray(fn) ? fn.length : 0,
    anchored_count: anchored(fn),
    engine_resolved: chapterEngine?.resolved_count ?? null,
    engine_unresolved: chapterEngine?.unresolved_count ?? null,
    engine_drop_reasons: chapterEngine?.drop_reasons ?? null,
    qa_word_count: qaGuard?.word_count ?? null,
    qa_word_floor_threshold: qaGuard?.word_floor_threshold ?? null,
    qa_unresolved_share: qaGuard?.unresolved_share ?? null,
    qa_narrative_violation_count: qaGuard?.narrative_violation_count ?? null,
    qa_flag_high_unresolved: qaGuard?.flags?.high_unresolved_share ?? null,
    qa_flag_under_word_floor: qaGuard?.flags?.under_word_floor ?? null,
    qa_flag_narrative_violation: qaGuard?.flags?.narrative_violation ?? null,
    qa_any_flag: qaGuard?.any_flag ?? null,
    qa_log_id: row?.id, eval_run_id: evalRunId,
  };
}

async function main() {
  log(`=== Academic-chapter ${RUN_ID} (${FIXTURES.length} chapters × 1) ===`);
  const jwt = await getJwt();
  const state = { run_id: RUN_ID, started_at: new Date().toISOString(), runs: [] };
  for (const q of FIXTURES) {
    log(`---- Q${q.id} (${q.bucket}) ----`);
    const r = await runOne(jwt, q);
    log(`  -> step=${r.academic_step} inherits=${r.academic_inherits_from} words=${r.answer_words} anch=${r.anchored_count} fn=${r.footnotes_count} eng_resolved=${r.engine_resolved}/${r.engine_unresolved} qa_any=${r.qa_any_flag} | ${r.wall_ms}ms`);
    state.runs.push({ qid: q.id, bucket: q.bucket, ...r });
    writeFileSync(OUT_FILE, JSON.stringify(state, null, 2));
  }
  state.completed_at = new Date().toISOString();

  // Summary
  const lines = [
    `# Academic-Chapter Eval — ${RUN_ID}`,
    ``,
    `| Q | step | words | anch | fn | eng res/unr | qa flags | wall |`,
    `|---|---|---|---|---|---|---|---|`,
  ];
  let pass = { step_chapter: 0, words_floor: 0, qa_clean: 0 };
  for (const r of state.runs) {
    const flags = [
      r.qa_flag_high_unresolved && "unresolved",
      r.qa_flag_under_word_floor && "underWords",
      r.qa_flag_narrative_violation && "narrative",
    ].filter(Boolean).join(",") || "—";
    lines.push(`| Q${r.qid} | ${r.academic_step} | ${r.answer_words} | ${r.anchored_count} | ${r.footnotes_count} | ${r.engine_resolved}/${r.engine_unresolved} | ${flags} | ${(r.wall_ms / 1000).toFixed(1)}s |`);
    if (r.academic_step === "chapter") pass.step_chapter++;
    if (r.answer_words >= (r.profile_word_min || 1200)) pass.words_floor++;
    if (r.qa_any_flag === false) pass.qa_clean++;
  }
  lines.push(``, `## Acceptance gates`,
    `- profile_used_academic.step === "chapter": ${pass.step_chapter}/${FIXTURES.length}`,
    `- words >= ${state.runs[0]?.profile_word_min || 1200}: ${pass.words_floor}/${FIXTURES.length}`,
    `- chapter_qa_guard.any_flag === false: ${pass.qa_clean}/${FIXTURES.length}`,
  );
  const summary = lines.join("\n");
  writeFileSync(`${OUT_DIR}/academic-chapter-${PHASE}.summary.md`, summary);
  log(`\n${summary}`);
}

main().catch((e) => { log(`FATAL: ${e?.stack || e?.message}`); process.exit(1); });
