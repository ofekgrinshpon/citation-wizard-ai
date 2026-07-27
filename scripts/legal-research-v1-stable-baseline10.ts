// Stable-baseline 10-query manual review batch (post narrow default-on merge + docket-upload).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const QUERIES = [
  // 2 case_holding — known
  { id: "B1", category: "case_holding", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי ביחס למעמדם של חוקי היסוד ולסמכות הביקורת השיפוטית על חקיקה ראשית?` },
  { id: "B2", category: "case_holding", query: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל ביחס להקצאת קרקעות למגורים על בסיס לאום?` },
  // 2 statute-section
  { id: "B3", category: "statute_section", query: `מה קובע סעיף 6 לחוק החברות, התשנ"ט-1999 בעניין הרמת מסך ומהם התנאים להפעלת הסמכות?` },
  { id: "B4", category: "statute_section", query: `מה קובע סעיף 12 לחוק החוזים (חלק כללי), התשל"ג-1973 בעניין תום לב במשא ומתן, ומה הסעד?` },
  // 2 broad analysis
  { id: "B5", category: "analysis", query: `מהי דוקטרינת השימוש לרעה בסמכות המכוננת במשפט החוקתי הישראלי, וכיצד היא התפתחה בפסיקה המרכזית של בית המשפט העליון?` },
  { id: "B6", category: "analysis", query: `מהי דוקטרינת הביצוע בקירוב (cy-près) במשפט הישראלי, וכיצד היא מיושמת בהקשר של הקדשות ונאמנויות ציבוריות?` },
  // 1 missing/fake docket
  { id: "B7", category: "missing_docket", query: `מה נקבע בת"א 98765-04-22 חברת אלפא נ' חברת בטא ביחס לאחריות מנהלים בעת חדלות פירעון?` },
  // 1 quote
  { id: "B8", category: "quote", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
  // 1 practical multi-source
  { id: "B9", category: "practical", query: `מהם הצעדים המשפטיים שעומדים לרשות שוכר דירה כאשר המשכיר מסרב להחזיר את הפיקדון בתום תקופת השכירות, וכיצד מוכיחים נזק?` },
  { id: "B10", category: "practical", query: `מהם המבחנים המרכזיים שנקבעו בפסיקה לסיווג אדם כעובד ולא כקבלן עצמאי, ומה המשמעות של הסיווג לעניין זכויות סוציאליות?` },
];

const OUT = "reports/quality-audit/runs-stable-baseline10";
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
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

const triggered: Array<{ id: string; category: string; query: string; run_id: string | null }> = [];
for (const q of QUERIES) {
  try {
    const t = await trigger(q.query);
    console.log(`[${q.id}] run_id=${t.run_id}`);
    triggered.push({ ...q, run_id: t.run_id ?? null });
  } catch (e) { console.error(`[${q.id}] trigger err`, e); triggered.push({ ...q, run_id: null }); }
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
  const anchors = md?.requiredAnchors?.statuses ?? md?.retrieval?.requiredAnchors?.statuses ?? [];
  const usedSources = d.used_sources ?? d.sources_used ?? [];
  const raw = {
    ...base,
    ok: d.ok === true,
    total_ms: md.total_ms ?? null,
    answer_intent: md?.planning?.analyzer?.answer_intent ?? null,
    lead_ref: d.lead_ref ?? null,
    deterministic_branch: d.deterministic_branch ?? null,
    limitation_flags: {
      missing_docket: d.missing_docket_limitation_fired === true,
      statute_section: d.statute_section_limitation_fired === true,
      canonical_quote: d.canonical_quote_fired === true,
      missing_anchor_caveat_injected: d.missing_anchor_caveat_injected === true,
    },
    missing_anchor_descriptions: d.missing_anchor_descriptions ?? [],
    anchor_statuses: anchors,
    verifier_counts: v.counts ?? {
      candidates_verified: v.candidates_verified,
      usable: v.candidates_usable ?? v.usable?.length,
      dropped: v.candidates_dropped ?? v.dropped?.length,
    },
    verifier_labels: v.labels ?? null,
    used_sources_count: usedSources.length,
    used_sources: usedSources,
    footnotes_count: (row.footnotes ?? []).length,
    footnotes: row.footnotes ?? [],
    quality_warnings: d.quality_warnings ?? md.quality_warnings ?? [],
    answer: row.answer ?? "",
  };
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify(raw, null, 2));
  console.log(`[${id}] shape=${raw.answer_intent?.output_shape ?? "-"} lead=${raw.lead_ref?.ref ?? "-"} branch=${raw.deterministic_branch ?? "-"} src=${raw.used_sources_count} fn=${raw.footnotes_count}`);
  return raw;
}));

writeFileSync(`${OUT}/_summary.json`, JSON.stringify(results, null, 2));

// Build compact markdown report
const md = [`# Stable Baseline 10Q — ${new Date().toISOString()}`, ""];
for (const r of results as any[]) {
  md.push(`## ${r.id} — ${r.category}`);
  md.push(`**Q:** ${r.query}`);
  md.push("");
  if (r.error) { md.push(`ERROR: ${r.error}`); md.push(""); continue; }
  md.push(`- shape: \`${r.answer_intent?.output_shape ?? "-"}\` | lead_ref: \`${r.lead_ref?.ref ?? "-"}\` (${r.lead_ref?.reason ?? "-"}) | branch: \`${r.deterministic_branch ?? "-"}\``);
  md.push(`- flags: docket=${r.limitation_flags.missing_docket} statute=${r.limitation_flags.statute_section} canonical=${r.limitation_flags.canonical_quote} caveat=${r.limitation_flags.missing_anchor_caveat_injected}`);
  md.push(`- verifier: ${JSON.stringify(r.verifier_counts)} | sources=${r.used_sources_count} | footnotes=${r.footnotes_count}`);
  md.push(`- warnings: ${JSON.stringify(r.quality_warnings)}`);
  md.push("");
  md.push("### Answer");
  md.push(r.answer);
  md.push("");
  md.push("### Used sources");
  for (const s of r.used_sources ?? []) md.push(`- \`${s.ref ?? s.id ?? "?"}\` ${s.title ?? ""} — ${s.url ?? ""}`);
  md.push("");
  md.push("### Footnotes");
  for (const f of r.footnotes ?? []) md.push(`- ${typeof f === "string" ? f : JSON.stringify(f)}`);
  md.push("");
  md.push("---");
  md.push("");
}
writeFileSync(`${OUT}/_report.md`, md.join("\n"));
console.log("[baseline10] done ->", OUT);
