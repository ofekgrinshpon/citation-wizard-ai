// identity_hardening_and_cache_purge_v1 — acceptance validation runner.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const ALL = [
  { id: "R02", question: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
  { id: "R02-REPEAT", question: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
  { id: "NATION-STATE", question: `מה נקבע בבג"ץ 5555/18 חסון נ' כנסת ישראל?` },
  { id: "FRESH-SC", question: `מה נקבע בבג"ץ 1892/14 האגודה לזכויות האזרח נ' השר לביטחון פנים?` },
  { id: "D1", question: `מהם מבחני המידתיות בביקורת חוקתית בישראל, וכיצד יישם אותם בית המשפט העליון?` },
  { id: "D3", question: `מה הדין לגבי פיטורי עובדת בהיריון, ומהו היקף ההגנה?` },
  { id: "MAYA-AMIR", question: `מה נקבע בע"א 5320/90 ברנוביץ נ' רשות ניירות ערך?` },
  { id: "P02", question: `מה נקבע בבג"ץ 9999/99 פלוני נ' אלמוני?` },
  { id: "B8", question: `מהי דוקטרינת ההבטחה המנהלית?` },
];
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const QUERIES = ONLY.length ? ALL.filter((q) => ONLY.includes(q.id)) : ALL;

const OUT = "reports/identity-hardening";
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
        const row = rows[0];
        const body = String(row.answer ?? "").trim();
        if (body && body !== "STUB_ANSWER" && !body.startsWith("[stub]")) return row;
      }
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

const results: any[] = [];
for (const q of QUERIES) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const t0 = Date.now();
  const t = await trigger(q.question).catch(() => ({} as { run_id?: string }));
  console.log(`[${q.id}] run_id=${t.run_id}`);
  if (!t.run_id) { results.push({ ...q, error: "trigger_failed" }); continue; }
  const row = await poll(t.run_id, since);
  const ms = Date.now() - t0;
  if (!row) { results.push({ ...q, run_id: t.run_id, ms, error: "poll_timeout" }); continue; }
  const md = (row.metadata ?? {}) as Record<string, any>;
  const out = {
    id: q.id,
    question: q.question,
    run_id: t.run_id,
    qa_log_id: row.id,
    ms,
    branch: md.branch ?? md.drafter?.branch ?? null,
    official_discovery: md.official_discovery ?? null,
    specific_case: md.specific_case ?? md.specific_case_identity ?? null,
    claim_source_match: md.claim_source_match ?? null,
    sufficiency: md.sufficiency ?? null,
    footnotes: row.footnotes ?? [],
    footnote_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
    answer: String(row.answer ?? ""),
  };
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify({ ...out, metadata: md }, null, 2));
  const att = out.official_discovery?.attempts ?? [];
  console.log(
    `[${q.id}] ms=${ms} attempts=${att.length} ` +
      att.map((a: any) =>
        `${a.label}|${a.cache_lookup}|${a.result}|${a.body_chars ?? 0}|reval=${a.cache_revalidation?.validated ?? "-"}/${a.cache_revalidation?.reason ?? "-"}/inv=${a.cache_revalidation?.invalidated ?? "-"}|id=${a.identity?.strict?.confidence ?? "-"}:${a.identity?.strict?.reason ?? "-"}`
      ).join(" ; ") + ` fn=${out.footnote_count}`,
  );
  results.push(out);
}

writeFileSync(`${OUT}/_all.json`, JSON.stringify(results, null, 2));
console.log("[identity-hardening] done ->", OUT);
