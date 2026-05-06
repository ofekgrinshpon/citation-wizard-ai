// Style-Guide eval harness — 5 chapter writes × 1 rep × 2 phases.
// Runs the same chapter fixtures with `styleGuideEnabled` set to false (PHASE=before)
// or true (PHASE=after). Both submitted as the admin user so the per-request
// override is honored. Captures answer_full + chapter_qa_guard + style_guide
// telemetry for qualitative side-by-side reading.
//
// Usage:
//   PHASE=before node eval/style-guide-q1-q5.mjs
//   PHASE=after  node eval/style-guide-q1-q5.mjs
//
// Outputs: /mnt/documents/legal-qa-eval/style-guide-<phase>.json + .log
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const ADMIN_EMAIL = "ofekgrinshpon@gmail.com";
const ADMIN_USER_ID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";
if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) { console.error("missing envs"); process.exit(1); }

const PHASE = process.env.PHASE || "before";
const STYLE_GUIDE_ENABLED = PHASE === "after";
const OUT_DIR = "/mnt/documents/legal-qa-eval";
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const RUN_ID = `style-${PHASE}-${randomUUID().slice(0, 8)}`;
const OUT_FILE = `${OUT_DIR}/style-guide-${PHASE}.json`;
const LOG_FILE = `${OUT_DIR}/style-guide-${PHASE}.log`;
const log = (m) => { const l = `[${new Date().toISOString()}] ${m}`; console.log(l); appendFileSync(LOG_FILE, l + "\n"); };

const FIXTURES = [
  { id: 1, bucket: "constitutional_admin",
    researchQuestion: "האם הממשלה מוסמכת לפטר את היועצת המשפטית לממשלה, ואם כן באילו מגבלות נורמטיביות ומנהליות?",
    chapterTitle: "המסגרת הנורמטיבית הקיימת לפיטורי היועצת המשפטית לממשלה" },
  { id: 2, bucket: "statute_anchored",
    researchQuestion: "מה קובע סעיף 17 לחוק שירות המדינה (מינויים) לעניין פיטורים או הפסקת כהונה?",
    chapterTitle: "לשונו של סעיף 17 וההיסטוריה החקיקתית שלו" },
  { id: 3, bucket: "constitutional_speech",
    researchQuestion: "מהן ההגנות החוקתיות על חופש הביטוי הפוליטי בישראל?",
    chapterTitle: "הגנת חופש הביטוי הפוליטי במשפט הישראלי" },
  { id: 4, bucket: "comparative",
    researchQuestion: "כיצד מתמודד הדין הישראלי עם תופעת ה-SLAPP בהשוואה לדין האמריקאי?",
    chapterTitle: "הסדר ה-SLAPP במשפט המשווה" },
  { id: 5, bucket: "doctrinal_critique",
    researchQuestion: "האם דוקטרינת ההסתברות הראייתית בפלילים עומדת במבחן הביקורת?",
    chapterTitle: "ניתוח ביקורתי של דוקטרינת ההסתברות הראייתית" },
];

const STUB_OUTLINE = (rq, title) => `**מבוא**
- שאלת המחקר: ${rq}
- התזה המרכזית: זוהי תזה לבחינה.
- קו הטיעון: דוקטרינרי, נורמטיבי והשוואתי.

**רשימת הפרקים**
1. **${title}** – הדין המצוי
   - הרחבה: הפרק יבחן את הסוגיה לעומק.
   - טיעוני נגד אפשריים: יש מי שיטען להפך; הפרק יבחן זאת.

**סיכום ומסקנות (משוערות)**
- מסקנה משוערת: יש לעגן את ההסדר בחקיקה.`;

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
      .select("id, answer, footnotes, metadata")
      .eq("user_id", ADMIN_USER_ID)
      .filter("metadata->>eval_run_id", "eq", evalRunId)
      .order("created_at", { ascending: false }).limit(1);
    if (data?.[0]) return data[0];
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

const wordsOf = (t) => {
  if (typeof t !== "string") return 0;
  const i = t.search(/---\s*הערות שוליים\s*---|\*\*\s*הערות שוליים\s*\*\*/);
  return (i === -1 ? t : t.slice(0, i)).trim().split(/\s+/).filter(Boolean).length;
};

async function runOne(jwt, q) {
  const evalRunId = `${RUN_ID}:Q${q.id}:r1`;
  const start = Date.now();
  const r = await callQa(jwt, {
    question: q.researchQuestion,
    taskMode: "academic_writing",
    academicStep: "write_chapter",
    researchQuestion: q.researchQuestion,
    outline: STUB_OUTLINE(q.researchQuestion, q.chapterTitle),
    chapterTitle: q.chapterTitle,
    chapterIndex: 1,
    previousChapters: [],
    isAbstract: false,
    styleGuideEnabled: STYLE_GUIDE_ENABLED, // ← admin-only override
    evalRunId,
    requestId: `eval:${evalRunId}`,
  });
  const wall = Date.now() - start;
  const row = await fetchLog(evalRunId);
  const md = row?.metadata ?? {};
  const ans = r.body?.answer ?? row?.answer ?? "";
  return {
    id: q.id, bucket: q.bucket, http_status: r.status, wall_ms: wall,
    style_guide: md.style_guide ?? null,
    chapter_qa_guard: md.chapter_qa_guard ?? null,
    profile_used_academic: md.profile_used_academic ?? null,
    answer_words: wordsOf(ans),
    answer_full: ans,
  };
}

(async () => {
  log(`PHASE=${PHASE} STYLE_GUIDE_ENABLED=${STYLE_GUIDE_ENABLED} RUN_ID=${RUN_ID}`);
  const jwt = await getJwt();
  const results = [];
  for (const q of FIXTURES) {
    log(`Q${q.id} (${q.bucket}) starting…`);
    try {
      const res = await runOne(jwt, q);
      log(`Q${q.id} done: ${res.answer_words} words, style_guide=${JSON.stringify(res.style_guide)}`);
      results.push(res);
    } catch (e) { log(`Q${q.id} ERROR: ${e.message}`); results.push({ id: q.id, error: e.message }); }
  }
  writeFileSync(OUT_FILE, JSON.stringify({ run_id: RUN_ID, phase: PHASE, results }, null, 2), "utf8");
  log(`Wrote ${OUT_FILE}`);
})();
