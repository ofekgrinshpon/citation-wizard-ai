// Fresh 5-query manual review batch (post narrow default-on merge).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) {
  console.error("Missing env"); process.exit(1);
}

const QUERIES = [
  { id: "F1", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי ביחס למעמדם של חוקי היסוד ולסמכות הביקורת השיפוטית על חקיקה ראשית?` },
  { id: "F2", query: `מה קובע סעיף 6 לחוק החברות ביחס להרמת מסך, ומהם התנאים המרכזיים להפעלת הסמכות?` },
  { id: "F3", query: `מהי דוקטרינת השימוש לרעה בסמכות המכוננת במשפט החוקתי הישראלי, וכיצד היא התפתחה בפסיקה המרכזית של בית המשפט העליון?` },
  { id: "F4", query: `מהם המבחנים המרכזיים שנקבעו בפסיקה לסיווג אדם כעובד ולא כקבלן עצמאי, ומה המשמעות של הסיווג לעניין זכויות סוציאליות?` },
  { id: "F5", query: `מה נקבע בת"א 12345-01-20 פלוני נ' אלמוני ביחס לאחריות דירקטורים להחלטות שהתקבלו באמצעות מערכת AI?` },
];

const OUT = "reports/quality-audit/runs-fresh5";
const ART = "/mnt/documents/quality-audit/runs-fresh5";
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
async function poll(run_id: string, timeoutMs = 900_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
    if (r.ok) { const rows = await r.json(); if (Array.isArray(rows) && rows.length) return rows[0]; }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

console.log(`[fresh5] triggering ${QUERIES.length}`);
const triggered: Array<{ id: string; query: string; run_id: string | null }> = [];
for (const q of QUERIES) {
  try {
    const t = await trigger(q.query);
    console.log(`[${q.id}] run_id=${t.run_id}`);
    triggered.push({ ...q, run_id: t.run_id ?? null });
  } catch (e) { console.error(`[${q.id}] trigger err`, e); triggered.push({ ...q, run_id: null }); }
  await new Promise((r) => setTimeout(r, 2000));
}

const results = await Promise.all(triggered.map(async ({ id, query, run_id }) => {
  const base: any = { id, query, run_id };
  if (!run_id) return { ...base, error: "trigger_failed" };
  const row = await poll(run_id);
  if (!row) return { ...base, error: "poll_timeout" };
  const md: any = row.metadata ?? {};
  const d: any = md.drafter ?? {};
  const anchors = md?.requiredAnchors?.statuses ?? md?.retrieval?.requiredAnchors?.statuses ?? [];
  const raw = {
    ...base,
    ok: d.ok === true,
    total_ms: md.total_ms ?? null,
    answer_intent: md?.planning?.analyzer?.answer_intent ?? null,
    lead_ref: d.lead_ref ?? null,
    deterministic_branch: d.deterministic_branch ?? null,
    missing_docket_limitation_fired: d.missing_docket_limitation_fired === true,
    statute_section_limitation_fired: d.statute_section_limitation_fired === true,
    canonical_quote_fired: d.canonical_quote_fired === true,
    missing_anchor_caveat_injected: d.missing_anchor_caveat_injected === true,
    missing_anchor_descriptions: d.missing_anchor_descriptions ?? [],
    anchor_statuses: anchors,
    missing_required_anchors: md?.retrieval?.missingRequiredAnchors ?? md?.missingRequiredAnchors ?? null,
    verifier_counts: md?.verifier?.counts ?? null,
    answer: row.answer ?? "",
    footnotes: row.footnotes ?? [],
    used_sources: d.used_sources ?? [],
    used_sources_count: (d.used_sources ?? []).length,
  };
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify(raw, null, 2));
  writeFileSync(`${ART}/${id}.json`, JSON.stringify(raw, null, 2));
  console.log(`[${id}] ok=${raw.ok} shape=${raw.answer_intent?.output_shape ?? "-"} lead=${raw.lead_ref?.ref ?? "-"} branch=${raw.deterministic_branch ?? "-"} src=${raw.used_sources_count}`);
  return raw;
}));

writeFileSync(`${OUT}/_summary.json`, JSON.stringify(results, null, 2));
console.log("[fresh5] done");
