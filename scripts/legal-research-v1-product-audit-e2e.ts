// Fresh end-to-end product audit (post synthesis source-pack separation v1).
// Read-only: triggers the live function and records telemetry. No code changes.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  { id: "P01", kind: "specific_case_holding", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל ביחס להקצאת קרקע על בסיס השתייכות לאומית?` },
  { id: "P02", kind: "missing_fake_docket", query: `מה נקבע בע"א 99887-04-22 לוי נ' כהן ביחס לאחריות פלטפורמה מקוונת לתוכן משתמשים?` },
  { id: "P03", kind: "statute_section_definition", query: `כיצד מגדיר סעיף 1 לחוק החוזים (חלק כללי), תשל"ג-1973 את דרך הכריתה של חוזה?` },
  { id: "P04", kind: "canonical_quote", query: `מהו הנוסח המדויק של סעיף 8 לחוק יסוד: כבוד האדם וחירותו (פסקת ההגבלה)?` },
  { id: "P05", kind: "case_law_synthesis", query: `מה הפסיקה אומרת על הלכת תום הלב במשא ומתן לפי סעיף 12 לחוק החוזים?` },
  { id: "P06", kind: "misframed_doctrine", query: `מה הפסיקה אומרת על הלכת ההסתמכות ההפוכה בדיני עבודה?` },
  { id: "P07", kind: "doctrine_explanation", query: `מהי דוקטרינת הביטול היחסי במשפט המנהלי הישראלי וכיצד היא מיושמת?` },
  { id: "P08", kind: "practical_steps", query: `מהם השלבים המעשיים להגשת תביעה קטנה בישראל, כולל סכום התביעה המרבי ואגרות?` },
  { id: "P09", kind: "worker_classification", query: `כיצד קובעת הפסיקה אם מתכנת שעבד כפרילנסר במשך חמש שנים הוא למעשה עובד, ומה ההשלכות הכספיות?` },
  { id: "P10", kind: "inheritance_mutual_wills", query: `מה הדין ביחס לצוואות הדדיות וביטולן לאחר פטירת אחד מבני הזוג לפי סעיף 8א לחוק הירושה?` },
  { id: "P11", kind: "constitutional_doctrine", query: `מהי דוקטרינת הפגיעה החוקתית והמידתיות בביקורת שיפוטית על חקיקה ראשית בישראל?` },
  { id: "P12", kind: "tenant_deposit", query: `בעל דירה מסרב להחזיר לי את הפיקדון בסיום שכירות למרות שהחזרתי את הדירה במצב תקין. מה הדין ומה הצעדים המעשיים?` },
  { id: "P13", kind: "specific_case_holding", query: `מה נקבע בע"א 6821/93 בנק המזרחי נ' מגדל כפר שיתופי ביחס לסמכות בית המשפט לבטל חוק הסותר חוק יסוד?` },
  { id: "P14", kind: "case_law_synthesis", query: `מה הפסיקה אומרת על הרמת מסך ההתאגדות בחברות משפחתיות?` },
];

const OUT = "reports/quality-audit/runs-product-audit-e2e";
const ART = "/mnt/documents/quality-audit/runs-product-audit-e2e";
mkdirSync(OUT, { recursive: true });
mkdirSync(ART, { recursive: true });

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string };
}
async function poll(run_id: string, timeoutMs = 1_200_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
    if (r.ok) { const rows = await r.json(); if (Array.isArray(rows) && rows.length) return rows[0]; }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

console.log(`[audit] triggering ${QUERIES.length}`);
const triggered: Array<{ id: string; kind: string; query: string; run_id: string | null }> = [];
for (const q of QUERIES) {
  try {
    const t = await trigger(q.query);
    console.log(`[${q.id}] run_id=${t.run_id}`);
    triggered.push({ ...q, run_id: t.run_id ?? null });
  } catch (e) { console.error(`[${q.id}] trigger err`, e); triggered.push({ ...q, run_id: null }); }
  await new Promise((r) => setTimeout(r, 2500));
}

const results = await Promise.all(triggered.map(async ({ id, kind, query, run_id }) => {
  const base: any = { id, kind, query, run_id };
  if (!run_id) return { ...base, error: "trigger_failed" };
  const row = await poll(run_id);
  if (!row) return { ...base, error: "poll_timeout" };
  const md: any = row.metadata ?? {};
  const d: any = md.drafter ?? {};
  const raw = {
    ...base,
    ok: d.ok === true,
    total_ms: md.total_ms ?? null,
    research_mode: md?.research_mode ?? md?.planning?.research_mode ?? null,
    answer_intent: md?.planning?.analyzer?.answer_intent ?? null,
    deterministic_branch: d.deterministic_branch ?? null,
    lead_ref: d.lead_ref ?? null,
    sufficiency: md?.sufficiency ?? null,
    named_doctrine: md?.namedDoctrine ?? d?.named_doctrine ?? null,
    synthesis_rendering: md?.synthesis_rendering ?? d?.synthesis_rendering ?? null,
    source_integrity_counts: md?.sourceIntegrity?.counts ?? null,
    missing_anchor_descriptions: d.missing_anchor_descriptions ?? [],
    verifier_counts: md?.verifier?.counts ?? null,
    used_sources: d.used_sources ?? [],
    used_sources_count: (d.used_sources ?? []).length,
    footnotes: row.footnotes ?? [],
    answer: row.answer ?? "",
  };
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify(raw, null, 2));
  writeFileSync(`${ART}/${id}.json`, JSON.stringify(raw, null, 2));
  console.log(`[${id}] ok=${raw.ok} mode=${raw.research_mode ?? "-"} shape=${raw.answer_intent?.output_shape ?? "-"} branch=${raw.deterministic_branch ?? "-"} src=${raw.used_sources_count}`);
  return raw;
}));

writeFileSync(`${OUT}/_summary.json`, JSON.stringify(results, null, 2));
console.log("[audit] done");
