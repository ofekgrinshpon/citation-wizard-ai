import { createClient } from "@supabase/supabase-js";
const URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY;
const EMAIL = "ofekgrinshpon@gmail.com";
const UID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";
const QS = {
  Q1: "מהם התנאים למתן צו מניעה זמני?",
  Q2: "באילו תנאים בית המשפט יתערב בהחלטת רשות מנהלית שלא להפעיל סמכות, ומה ההבחנה בין אי-הפעלת סמכות לבין הפעלת סמכות פגומה?",
  Q3: "מה מעמדה של הלכת אפרופים לאחר תיקון סעיף 25 לחוק החוזים?",
};
const which = process.argv[2];
const q = QS[which];
if (!q) { console.error("usage: node pilots.mjs Q1|Q2|Q3"); process.exit(1); }

const admin = createClient(URL, SR, { auth: { persistSession: false } });
const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
if (linkErr) { console.error(linkErr); process.exit(1); }
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const t0 = Date.now();
const submitTs = new Date().toISOString();
console.log(`══ ${which} submit @ ${submitTs}`);
const ctl = new AbortController();
const timer = setTimeout(() => ctl.abort(), 300_000);
let resp, json;
try {
  resp = await fetch(`${URL}/functions/v1/legal-qa`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON },
    body: JSON.stringify({ question: q, taskMode: "research", depth: "deep" }),
    signal: ctl.signal,
  });
  json = await resp.json();
} catch (e) {
  console.log("fetch failed/aborted:", e.message);
}
clearTimeout(timer);
const wall = Date.now() - t0;
console.log(`  http_status=${resp?.status} wall=${wall}ms answer_len=${(json?.answer||"").length} footnotes=${json?.footnotes?.length ?? 0}`);

// Find the row created after submitTs for this user
const { data: rows } = await admin.from("qa_logs")
  .select("id,answer,footnotes,metadata,created_at")
  .eq("user_id", UID)
  .gte("created_at", submitTs)
  .order("created_at", { ascending: false })
  .limit(3);
const row = rows?.[0];
if (!row) { console.log("NO ROW FOUND"); process.exit(0); }

const md = row.metadata || {};
const ans = row.answer || "";
const fns = row.footnotes || [];
const supRe = /[\u00B9\u00B2\u00B3\u2070-\u209F]+/g;
const sups = [...ans.matchAll(supRe)].map(m => {
  return m[0].split("").map(c => "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c)).join("");
}).map(s => parseInt(s,10));
const fnNums = new Set(fns.map(f => f.number));
const orphanSups = sups.filter(n => !fnNums.has(n));
const leftoverCites = (ans.match(/\[cite:LS\d+\]/g) || []);
const placeholders = fns.filter(f => /\(ציטוט חסר\)/.test(f.citation || "")).map(f => f.number);

console.log(`\nqa_logs.id=${row.id}`);
console.log(`pipeline_used=${md.pipeline_used}`);
console.log(`answer_null=${row.answer === null}`);
console.log(`metadata.core_present=${!!md.core}`);
console.log(`duration_ms=${md.duration_ms ?? "n/a"}`);
console.log(`footnotes_count=${fns.length}`);
console.log(`leftover_[cite:LS#]=${leftoverCites.length} samples=${leftoverCites.slice(0,3).join(",")}`);
console.log(`orphan_superscripts=${orphanSups.length} (${orphanSups.join(",")})`);
console.log(`(ציטוט חסר)_footnotes=${placeholders.length}`);
console.log(`core_last_stage=${md.core_last_stage ?? md.core?.stage_runs?.slice(-1)?.[0]?.stage}`);
console.log(`core_fallback_reason=${md.core_fallback_reason ?? "(none)"}`);
console.log(`acceptance_errors=${JSON.stringify(md.core?.acceptance_errors ?? md.core_acceptance_errors ?? [])}`);
console.log(`\n──── ANSWER ────\n${ans}\n──── FOOTNOTES ────`);
for (const f of fns) console.log(`[${f.number}] ${f.citation}`);
