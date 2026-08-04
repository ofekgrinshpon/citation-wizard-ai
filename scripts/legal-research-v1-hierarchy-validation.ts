// research_pack_hierarchy_v1 validation runner (8 fixtures).
import { mkdirSync, writeFileSync } from "node:fs";
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const ALL = [
  { id: "R08", query: `כתוב סקירת פסיקה על מבחן המידתיות בביקורת שיפוטית על חקיקה.` },
  { id: "R03", query: `מה הפסיקה אומרת על הלכת השיתוף?` },
  { id: "R04", query: `מה הפסיקה אומרת על הרמת מסך ההתאגדות?` },
  { id: "R09", query: `כתוב סקירת פסיקה על מבחן ההשתלבות בדיני עבודה.` },
  { id: "R02", query: `מה נקבע בבנק המזרחי ביחס לסמכות בית המשפט לבטל חקיקה?` },
  { id: "R01", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל?` },
  { id: "B8", query: `צטט את הקביעה המרכזית בעניין המידתיות במבחן האמצעי שפגיעתו פחותה.` },
  { id: "P02", query: `סכם את פסק הדין בע"א 99999/99 פלוני נ' אלמוני.` },
];
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const QUERIES = only.length ? ALL.filter((q) => only.includes(q.id)) : ALL;
const OUT = "reports/hierarchy-validation";
mkdirSync(OUT, { recursive: true });
async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string };
}
async function poll(run_id: string, timeoutMs = 900_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
    if (r.ok) { const rows = await r.json(); if (Array.isArray(rows) && rows.length) return rows[0]; }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}
const summary: any[] = [];
for (const q of QUERIES) {
  const t = await trigger(q.query);
  if (!t.run_id) { summary.push({ id: q.id, error: "no run_id" }); continue; }
  const row = await poll(t.run_id);
  if (!row) { summary.push({ id: q.id, error: "timeout" }); continue; }
  const md = row.metadata ?? {};
  const dr = md.drafter ?? {};
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify({ query: q, answer: row.answer, drafter: dr, footnotes: row.footnotes }, null, 2));
  summary.push({
    id: q.id,
    branch: dr.deterministic_branch ?? null,
    ok: dr.ok,
    used: (dr.used_sources ?? []).map((u: any) => ({ n: u.number, cit: u.citable_as, tier: u.authority_tier, usab: u.text_usability, title: String(u.title ?? "").slice(0, 60) })),
    hierarchy: dr.hierarchy ?? null,
    carried_pack_size: dr.carried_pack_size,
    unrelated_excluded: dr.unrelated_excluded_from_carried_pack_count,
  });
  console.log(q.id, JSON.stringify(summary[summary.length - 1].hierarchy));
}
writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(summary, null, 2));
console.log("DONE");
