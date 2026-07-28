// Drafter sharpness patch validation: prose targets (B1,B3,B4,B9,B10) + safety controls (Q18/B8,B2,B7).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  { id: "B1", category: "case_holding", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי ביחס למעמדם של חוקי היסוד ולסמכות הביקורת השיפוטית על חקיקה ראשית?` },
  { id: "B4", category: "statute_section", query: `מה קובע סעיף 12 לחוק החוזים (חלק כללי), התשל"ג-1973 בעניין תום לב במשא ומתן, ומה הסעד?` },
  { id: "B9", category: "practical", query: `מהם הצעדים המשפטיים שעומדים לרשות שוכר דירה כאשר המשכיר מסרב להחזיר את הפיקדון בתום תקופת השכירות, וכיצד מוכיחים נזק?` },
  { id: "B10", category: "practical", query: `מהם המבחנים המרכזיים שנקבעו בפסיקה לסיווג אדם כעובד ולא כקבלן עצמאי, ומה המשמעות של הסיווג לעניין זכויות סוציאליות?` },
  { id: "B8", category: "quote", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
  { id: "B2", category: "case_holding", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל ביחס להקצאת קרקעות למגורים על בסיס לאום?` },
];

const _x=0;
const HEDGES = ["עולה בזהירות", "ניתן להסיק בזהירות", "יש להתייחס בזהירות", "בזהירות"];
const META = ["מן החומר שבדקתי", "המקורות שסופקו", "מן המקורות עולה", "החומר שנמסר", "מוצג כמקור מרכזי"];

const OUT = "reports/quality-audit/runs-sharpness-control";
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

const triggered: Array<{ id: string; category: string; query: string; run_id: string | null }> = [];
for (const q of QUERIES) {
  const t = await trigger(q.query).catch(() => ({} as any));
  console.log(`[${q.id}] run_id=${t.run_id}`);
  triggered.push({ ...q, run_id: t.run_id ?? null });
  await new Promise((r) => setTimeout(r, 1500));
}

const results = await Promise.all(triggered.map(async ({ id, category, query, run_id }) => {
  const base: any = { id, category, query, run_id };
  if (!run_id) return { ...base, error: "trigger_failed" };
  const row = await poll(run_id);
  if (!row) return { ...base, error: "poll_timeout" };
  const md: any = row.metadata ?? {};
  const d: any = md.drafter ?? {};
  const v: any = md.verifier ?? {};
  const answer: string = row.answer ?? "";
  const first = (answer.split("\n").find((l) => l.trim().length > 40) ?? "").trim();
  const raw = {
    ...base,
    ok: d.ok === true,
    shape: md?.planning?.analyzer?.answer_intent?.output_shape ?? null,
    lead_ref: d.lead_ref ?? null,
    deterministic_branch: d.deterministic_branch ?? null,
    limitation_flags: {
      missing_docket: d.missing_docket_limitation_fired === true,
      statute_section: d.statute_section_limitation_fired === true,
      canonical_quote: d.canonical_quote_fired === true,
    },
    verifier_call_failed: v.call_failed === true,
    synthetic_verdicts: v.counts?.synthetic_verdicts ?? 0,
    stub: answer.includes("[stub]") || answer.includes("שלב P5"),
    hedge_hits: HEDGES.map((h) => [h, (answer.split(h).length - 1)]).filter(([, n]) => (n as number) > 0),
    meta_hits: META.map((h) => [h, (answer.split(h).length - 1)]).filter(([, n]) => (n as number) > 0),
    first_sentence: first.slice(0, 240),
    used_sources_count: (d.used_sources ?? d.sources_used ?? []).length,
    footnotes_count: (row.footnotes ?? []).length,
    quality_warnings: d.quality_warnings ?? md.quality_warnings ?? [],
    answer,
  };
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify(raw, null, 2));
  console.log(`[${id}] shape=${raw.shape} branch=${raw.deterministic_branch} hedges=${JSON.stringify(raw.hedge_hits)} meta=${JSON.stringify(raw.meta_hits)} src=${raw.used_sources_count} fn=${raw.footnotes_count}`);
  return raw;
}));

writeFileSync(`${OUT}/_summary.json`, JSON.stringify(results, null, 2));
console.log("done ->", OUT);
