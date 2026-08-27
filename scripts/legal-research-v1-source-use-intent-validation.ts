// source_use_intent_planning_v1 — acceptance validation runner.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) {
  console.error("Missing env");
  process.exit(1);
}

const ALL = [
  {
    id: "ACADEMIC",
    question: `אני כותב סמינריון על עילת הסבירות במשפט המנהלי — אילו מקורות מרכזיים כדאי לקרוא?`,
  },
  {
    id: "NATION-STATE-ACADEMIC",
    question:
      `כיצד מנתחת הספרות האקדמית את חוק יסוד: ישראל – מדינת הלאום של העם היהודי ואת שאלת הזהות החוקתית?`,
  },
  {
    id: "PAYWALL",
    question: `מה נכתב במאמרים בכתב העת "עיוני משפט" על תורת הפרשנות התכליתית של אהרן ברק?`,
  },
  {
    id: "MMM",
    question:
      `מה עולה ממחקרי מרכז המחקר והמידע של הכנסת ומדוחות רגולטוריים בנוגע לאכיפת חוקי עבודה בישראל?`,
  },
  { id: "B8", question: `מהי דוקטרינת ההבטחה המנהלית?` },
  {
    id: "D1",
    question: `מהם מבחני המידתיות בביקורת חוקתית בישראל, וכיצד יישם אותם בית המשפט העליון?`,
  },
  { id: "D3", question: `מה הדין לגבי פיטורי עובדת בהיריון, ומהו היקף ההגנה?` },
  {
    id: "DARKPATTERNS",
    question:
      `מהי הגישה המשפטית והאקדמית ל"דפוסים אפלים" (dark patterns) בהגנת הצרכן, ואילו מקורות מחקריים דנים בכך?`,
  },
  { id: "R02", question: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
  { id: "P02", question: `מה נקבע בבג"ץ 9999/99 פלוני נ' אלמוני?` },
];

const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const QUERIES = ONLY.length ? ALL.filter((q) => ONLY.includes(q.id)) : ALL;

const OUT = "reports/source-use-intent";
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

// deno-lint-ignore no-explicit-any
const results: any[] = [];
for (const q of QUERIES) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const t0 = Date.now();
  const t = await trigger(q.question).catch(() => ({} as { run_id?: string }));
  console.log(`[${q.id}] run_id=${t.run_id}`);
  if (!t.run_id) {
    results.push({ ...q, error: "trigger_failed" });
    continue;
  }
  const row = await poll(t.run_id, since);
  const ms = Date.now() - t0;
  if (!row) {
    results.push({ ...q, run_id: t.run_id, ms, error: "poll_timeout" });
    continue;
  }
  // deno-lint-ignore no-explicit-any
  const md = (row.metadata ?? {}) as Record<string, any>;
  const sui = md.drafter?.source_use_intent ?? md.source_use_intent ?? null;
  const answer = String(row.answer ?? "");
  const out = {
    id: q.id,
    question: q.question,
    run_id: t.run_id,
    qa_log_id: row.id,
    ms,
    plan: sui?.plan ?? null,
    model_plan_present: sui?.model_plan_present ?? null,
    overrides: sui?.overrides ?? [],
    planned_sufficiency: sui?.planned_sufficiency ?? null,
    deterministic_branch: md.drafter?.deterministic_branch ?? md.deterministic_branch ?? null,
    sufficiency_reason: md.drafter?.source_sufficiency?.reason ?? md.source_sufficiency?.reason ?? null,
    footnotes_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
    answer_len: answer.length,
    answer,
  };
  results.push(out);
  console.log(
    `[${q.id}] task=${out.plan?.user_task_intent} strategy=${out.plan?.answer_strategy} ` +
      `mixed=${out.plan?.mixed_plan} conf=${out.plan?.plan_confidence} ` +
      `branch=${out.deterministic_branch} fn=${out.footnotes_count} len=${out.answer_len} ${ms}ms`,
  );
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}/results.json`);
