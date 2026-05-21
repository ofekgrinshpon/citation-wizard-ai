import { createClient } from "@supabase/supabase-js";
const URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY;
const EMAIL = "ofekgrinshpon@gmail.com";
const UID = "c6b2fdbf-a50c-411f-9941-41f9dff80eba";

const ALL = {
  S1: "באילו תנאים בית המשפט יפסול חוק של הכנסת כבלתי חוקתי?",
  S4: "כיצד מפרשים בית המשפט חוזה לאחר הלכת אפרופים ותיקון סעיף 25 לחוק החוזים?",
  S6: "מהי חובת השימוע של רשות מנהלית לפני קבלת החלטה הפוגעת באדם?",
  S7: "מהי עילת הסבירות במשפט המנהלי ומה היקף הביקורת השיפוטית עליה?",
  S8: "מהי ההבחנה בין פיצויי הסתמכות לפיצויי קיום בדיני חוזים?",
};
const TAGS = (process.env.FOCUS || "S1,S4,S6,S8,S7").split(",");
const QS = TAGS.map((t) => [t, ALL[t]]).filter(([, q]) => q);

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
  const sups = [...ans.matchAll(supRe)].map((m) =>
    parseInt(m[0].split("").map((c) => "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c)).join(""), 10),
  );
  const fnNums = new Set(fns.map((f) => f.number));
  const orphans = sups.filter((n) => !fnNums.has(n));
  const leftovers = (ans.match(/\[cite:LS\d+\]/g) || []);
  const placeholders = fns.filter((f) => /\(ציטוט חסר\)/.test(f.citation || "")).length;
  const REPORTER_RE = /פ["״]ד\s+[א-ת]+(?:\s*\(\s*\d+\s*\))?\s+\d+/;
  const PREFIX_RE = /(?:בג["״]ץ|ע["״]א|ע["״]פ|רע["״]א|רע["״]פ|דנ["״]א|בש["״]פ|עע["״]מ|בר["״]מ|ע["״]ע|רע["״]ב|בג["״]מ|בש["״]א|ה["״]פ|ת["״]א|ת["״]פ)/;
  const PARTIES_RE = /נ['׳]/;
  const bareFns = fns.filter((f) => {
    const t = f.citation || "";
    return REPORTER_RE.test(t) && !PREFIX_RE.test(t) && !PARTIES_RE.test(t);
  });
  return {
    tag, q, wall, qa_id: row.id,
    pipeline_used: md.pipeline_used,
    answer_null: row.answer === null,
    answer_len: ans.length,
    footnotes_count: fns.length,
    leftover_cite_markers: leftovers.length,
    orphan_superscripts: orphans,
    placeholders_count: placeholders,
    bare_reporter_footnotes: bareFns.length,
    core_last_stage: md.core_last_stage,
    core_fallback_reason: md.core_fallback_reason ?? null,
    enrichment: core.enrichment ?? null,
    removed_citations: (core.citation_quality?.removed_citations || []).length,
    claims_lost: (core.citation_quality?.claims_lost_all_support || []).length,
    footnotes: fns,
  };
}

console.log("Focus:", TAGS.join(","));
const results = await Promise.all(QS.map(runOne));
const fs = await import("node:fs");
fs.writeFileSync("/tmp/smoke_focus.json", JSON.stringify(results, null, 2));
for (const r of results) {
  console.log("\n===", r.tag, "===");
  const enr = r.enrichment || {};
  console.log(JSON.stringify({
    pipeline_used: r.pipeline_used,
    answer_null: r.answer_null,
    fn_count: r.footnotes_count,
    leftover: r.leftover_cite_markers,
    orphans: r.orphan_superscripts.length,
    bare_fn: r.bare_reporter_footnotes,
    placeholders: r.placeholders_count,
    removed: r.removed_citations,
    claims_lost: r.claims_lost,
    bare_attempted: enr.bare_reporter_attempted,
    recovered: enr.bare_reporter_recovered,
    dropped: enr.bare_reporter_dropped,
    partial_enriched: enr.partial_enriched,
    regex: `${enr.text_regex_recovered}/${enr.text_regex_attempted}`,
    official: `${enr.official_fetch_recovered}/${enr.official_fetch_attempted}`,
    party_lookup: `${enr.party_lookup_hits}/${enr.party_lookup_attempted}`,
    fallback: r.core_fallback_reason,
  }));
}
console.log("\nSaved /tmp/smoke_focus.json");
