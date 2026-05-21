import { createClient } from "@supabase/supabase-js";
const URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY;
const EMAIL = "ofekgrinshpon@gmail.com";
const UID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

const QS = [
  ["S1", "באילו תנאים בית המשפט יפסול חוק של הכנסת כבלתי חוקתי?"],
  ["S2", "מהי דרישת מיצוי ההליכים והסעד החלופי בעתירה לבג\"ץ?"],
  ["S3", "מהי עבירת דמי החסות (פרוטקשן) ומהם יסודותיה?"],
  ["S4", "כיצד מפרשים בית המשפט חוזה לאחר הלכת אפרופים ותיקון סעיף 25 לחוק החוזים?"],
  ["S5", "מהם התנאים למתן צו עשה זמני?"],
  ["S6", "מהי חובת השימוע של רשות מנהלית לפני קבלת החלטה הפוגעת באדם?"],
  ["S7", "מהי עילת הסבירות במשפט המנהלי ומה היקף הביקורת השיפוטית עליה?"],
  ["S8", "מהי ההבחנה בין פיצויי הסתמכות לפיצויי קיום בדיני חוזים?"],
  ["S9", "מהי חובת תום הלב במשא ומתן לפי סעיף 12 לחוק החוזים?"],
  ["S10", "מהי ההבחנה בין סמכות עניינית לבין דוקטרינת הסעד החלופי?"],
];

const admin = createClient(URL, SR, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

async function runOne([tag, q]) {
  const submitTs = new Date().toISOString();
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 290_000);
  try {
    await fetch(`${URL}/functions/v1/legal-qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON },
      body: JSON.stringify({ question: q, taskMode: "research", depth: "deep" }),
      signal: ctl.signal,
    }).then((r) => r.json().catch(() => null));
  } catch (_e) {}
  clearTimeout(timer);

  let row = null;
  for (let k = 0; k < 90; k++) {
    await new Promise((r) => setTimeout(r, 4000));
    const { data: rows } = await admin.from("qa_logs")
      .select("id,answer,footnotes,metadata,created_at,question")
      .eq("user_id", UID)
      .gte("created_at", submitTs)
      .order("created_at", { ascending: false })
      .limit(5);
    const match = rows?.find((r) => r.question === q);
    const pu = match?.metadata?.pipeline_used;
    if (match && pu && pu !== "core_running") { row = match; break; }
  }
  const wall = Date.now() - t0;
  if (!row) return { tag, q, wall, error: "no_completion" };

  const md = row.metadata || {};
  const core = md.core || {};
  const ans = row.answer || "";
  const fns = row.footnotes || [];
  const supRe = /[\u00B9\u00B2\u00B3\u2070-\u209F]+/g;
  const fnNums = new Set(fns.map((f) => f.number));
  // Greedy split: mirror backend acceptance scanner. A superscript run may be a
  // single multi-digit footnote (e.g. ¹⁰) OR a sequence of adjacent single-digit
  // footnotes (e.g. ¹² = fn1+fn2). Try to partition each run into known fn numbers.
  const maxFnLen = Math.max(1, ...[...fnNums].map((n) => String(n).length));
  const splitRun = (digits) => {
    const dp = (i) => {
      if (i === digits.length) return [];
      for (let L = Math.min(maxFnLen, digits.length - i); L >= 1; L--) {
        const n = parseInt(digits.slice(i, i + L), 10);
        if (fnNums.has(n)) {
          const rest = dp(i + L);
          if (rest) return [n, ...rest];
        }
      }
      return null;
    };
    return dp(0);
  };
  const sups = [];
  const orphans = [];
  for (const m of ans.matchAll(supRe)) {
    const digits = m[0].split("").map((c) => "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c)).join("");
    const parts = splitRun(digits);
    if (parts) sups.push(...parts);
    else orphans.push(parseInt(digits, 10));
  }
  const leftovers = (ans.match(/\[cite:LS\d+\]/g) || []);
  const placeholders = fns.filter((f) => /\(ציטוט חסר\)/.test(f.citation || "")).length;
  // Bare reporter detection in final footnotes
  const REPORTER_RE = /פ["״]ד\s+[א-ת]+(?:\s*\(\s*\d+\s*\))?\s+\d+/;
  const PREFIX_RE = /(?:בג["״]ץ|ע["״]א|ע["״]פ|רע["״]א|רע["״]פ|דנ["״]א|בש["״]פ|עע["״]מ|בר["״]מ|ע["״]ע|רע["״]ב|בג["״]מ|בש["״]א|ה["״]פ|ת["״]א|ת["״]פ)/;
  const PARTIES_RE = /נ['׳]/;
  const bareFns = fns.filter((f) => {
    const t = f.citation || "";
    return REPORTER_RE.test(t) && !PREFIX_RE.test(t) && !PARTIES_RE.test(t);
  });
  // Pipe artifact in final footnotes
  const pipeFns = fns.filter((f) => /\s\|\s/.test(f.citation || ""));
  // Raw source_type leaks
  const rawTypeLeaks = fns.filter((f) =>
    /supreme_court_il|israeli_law|legislation_primary|case_law_database/.test(JSON.stringify(f)),
  );

  return {
    tag, q, wall,
    qa_id: row.id,
    pipeline_used: md.pipeline_used,
    answer_null: row.answer === null,
    answer_len: ans.length,
    footnotes_count: fns.length,
    leftover_cite_markers: leftovers.length,
    orphan_superscripts: orphans,
    placeholders_count: placeholders,
    bare_reporter_footnotes: bareFns.length,
    pipe_artifact_footnotes: pipeFns.length,
    raw_source_type_leaks: rawTypeLeaks.length,
    core_last_stage: md.core_last_stage,
    core_fallback_reason: md.core_fallback_reason ?? null,
    enrichment: core.enrichment ?? null,
    removed_citations: (core.citation_quality?.removed_citations || []).length,
    claims_lost: (core.citation_quality?.claims_lost_all_support || []).length,
    answer: ans,
    footnotes: fns,
  };
}

console.log("Wave 1:", QS.slice(0, 5).map((x) => x[0]).join(","));
const r1 = await Promise.all(QS.slice(0, 5).map(runOne));
for (const r of r1) console.log(JSON.stringify({ ...r, answer: undefined, footnotes: undefined }));
console.log("\nWave 2:", QS.slice(5).map((x) => x[0]).join(","));
const r2 = await Promise.all(QS.slice(5).map(runOne));
for (const r of r2) console.log(JSON.stringify({ ...r, answer: undefined, footnotes: undefined }));

const all = [...r1, ...r2];
const fs = await import("node:fs");
fs.writeFileSync("/tmp/smoke10_v2.json", JSON.stringify(all, null, 2));
console.log("\nSaved /tmp/smoke10_v2.json");
