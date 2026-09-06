// literature_only_richness_validation_v1 — live validation only (no code/prompt changes).
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const ALL = [
  {
    id: "L1",
    query:
      `כתוב סקירת ספרות אקדמית לסמינריון בנושא הביקורת על עילת הסבירות במשפט הציבורי הישראלי.\n` +
      `אל תכתוב סקירה של פסיקה. התמקד בספרות המשפטית בלבד: ביקורת על עמימות העילה, טענות בדבר אקטיביזם שיפוטי, טענות בדבר נחיצותה לשלטון החוק, היחס בין סבירות למידתיות, והשפעת הדיון החוקתי העכשווי על הספרות.\n` +
      `כתוב בעברית אקדמית, עם הערות שוליים לספרות משפטית בלבד. אם אין מספיק ספרות ישירה, אמור זאת במפורש ואל תמלא את החסר בפסיקה, חוקים או מקורות כלליים.`,
  },
  {
    id: "L2",
    query:
      `כתוב סקירת ספרות אקדמית לסמינריון בנושא ההבטחה המנהלית, ההסתמכות והציפייה הלגיטימית במשפט המנהלי הישראלי.\n` +
      `אל תכתוב סקירה של פסיקה. התמקד בספרות המשפטית בלבד: התשתית התיאורטית של הבטחה מנהלית, ההבחנה בין הבטחה להסתמכות ולציפייה לגיטימית, ההצדקות להגנה על אינטרס ההסתמכות, הביקורת על אכיפת הבטחות שלטוניות, והמתח בין הגינות מנהלית לבין גמישות שלטונית ושינוי מדיניות.\n` +
      `כתוב בעברית אקדמית, עם הערות שוליים לספרות משפטית בלבד. אם אין מספיק ספרות ישירה, אמור זאת במפורש ואל תמלא את החסר בפסיקה, חוקים או מקורות כלליים.`,
  },
];

const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const QUERIES = ONLY.length ? ALL.filter((q) => ONLY.includes(q.id)) : ALL;

const OUT = "reports/academic-literature-gate-repair-and-thin-pack-recovery-v1";
mkdirSync(OUT, { recursive: true });

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string };
}

async function poll(run_id: string, since: string, timeoutMs = 900_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url =
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes` +
      `&metadata->>run_id=eq.${run_id}&created_at=gte.${since}&order=created_at.desc&limit=1`;
    const r = await fetch(url, { headers });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) {
        const body = String(rows[0].answer ?? "").trim();
        if (body && body !== "STUB_ANSWER" && !body.startsWith("[stub]")) return rows[0];
      }
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

// deno-lint-ignore no-explicit-any
const results: any[] = [];
for (const q of QUERIES) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const t0 = Date.now();
  const t = await trigger(q.query).catch(() => ({} as { run_id?: string }));
  console.log(`[${q.id}] run_id=${t.run_id}`);
  if (!t.run_id) { results.push({ ...q, error: "trigger_failed" }); continue; }
  const row = await poll(t.run_id, since);
  const ms = Date.now() - t0;
  if (!row) { results.push({ ...q, run_id: t.run_id, ms, error: "poll_timeout" }); continue; }
  // deno-lint-ignore no-explicit-any
  const md = (row.metadata ?? {}) as Record<string, any>;
  const d = md.drafter ?? {};
  results.push({
    id: q.id,
    run_id: t.run_id,
    ms,
    metadata: md,
    answer: String(row.answer ?? ""),
    footnotes: row.footnotes ?? [],
    pack_size: Array.isArray(d.input_sources) ? d.input_sources.length : null,
    footnotes_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
  });
  console.log(`[${q.id}] pack=${Array.isArray(d.input_sources) ? d.input_sources.length : "?"} fn=${Array.isArray(row.footnotes) ? row.footnotes.length : 0} ${ms}ms`);
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}/results.json`);
