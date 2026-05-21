// Rerun S7 only with the patched greedy-split harness.
import { createClient } from "@supabase/supabase-js";
const URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY;
const EMAIL = "ofekgrinshpon@gmail.com";
const UID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";
const Q = "מהי עילת הסבירות במשפט המנהלי ומה היקף הביקורת השיפוטית עליה?";

const admin = createClient(URL, SR, { auth: { persistSession: false } });
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const v = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = v.data.session.access_token;

const submitTs = new Date().toISOString();
const ctl = new AbortController();
const timer = setTimeout(() => ctl.abort(), 290_000);
try {
  await fetch(`${URL}/functions/v1/legal-qa`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: ANON },
    body: JSON.stringify({ question: Q, taskMode: "research", depth: "deep" }),
    signal: ctl.signal,
  }).then((r) => r.json().catch(() => null));
} catch (_e) {}
clearTimeout(timer);

let row = null;
for (let k = 0; k < 90; k++) {
  await new Promise((r) => setTimeout(r, 4000));
  const { data: rows } = await admin.from("qa_logs")
    .select("id,answer,footnotes,metadata,created_at,question")
    .eq("user_id", UID).gte("created_at", submitTs)
    .order("created_at", { ascending: false }).limit(5);
  const match = rows?.find((r) => r.question === Q);
  const pu = match?.metadata?.pipeline_used;
  if (match && pu && pu !== "core_running") { row = match; break; }
}
if (!row) { console.log("NO_COMPLETION"); process.exit(1); }

const ans = row.answer || "";
const fns = row.footnotes || [];
const fnNums = new Set(fns.map((f) => f.number));
const maxFnLen = Math.max(1, ...[...fnNums].map((n) => String(n).length));
const splitRun = (digits) => {
  const dp = (i) => {
    if (i === digits.length) return [];
    for (let L = Math.min(maxFnLen, digits.length - i); L >= 1; L--) {
      const n = parseInt(digits.slice(i, i + L), 10);
      if (fnNums.has(n)) { const rest = dp(i + L); if (rest) return [n, ...rest]; }
    }
    return null;
  };
  return dp(0);
};
const supRe = /[\u00B9\u00B2\u00B3\u2070-\u209F]+/g;
const sups = [];
const orphans = [];
for (const m of ans.matchAll(supRe)) {
  const digits = m[0].split("").map((c) => "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c)).join("");
  const parts = splitRun(digits);
  if (parts) sups.push(...parts); else orphans.push(parseInt(digits, 10));
}
console.log(JSON.stringify({
  qa_id: row.id,
  pipeline_used: row.metadata?.pipeline_used,
  footnotes_count: fns.length,
  fn_numbers: [...fnNums].sort((a, b) => a - b),
  sup_runs_total: sups.length,
  orphan_superscripts: orphans,
  core_fallback_reason: row.metadata?.core_fallback_reason ?? null,
}, null, 2));
