// secondary_web_body_acquisition_v1 — acceptance validation runner.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const ALL = [
  { id: "D1", question: `מהם מבחני המידתיות בביקורת חוקתית בישראל, וכיצד יישם אותם בית המשפט העליון?` },
  { id: "B8", question: `מהי דוקטרינת ההבטחה המנהלית?` },
  { id: "D3", question: `מה הדין לגבי פיטורי עובדת בהיריון, ומהו היקף ההגנה?` },
  { id: "ACADEMIC", question: `אני כותב סמינריון על עילת הסבירות במשפט המנהלי — אילו מקורות מרכזיים כדאי לקרוא?` },
  { id: "DARKPATTERNS", question: `מהי הגישה המשפטית והאקדמית ל"דפוסים אפלים" (dark patterns) בהגנת הצרכן, ואילו מקורות מחקריים דנים בכך?` },
  { id: "CONTROLLING", question: `מהי חובת ההגינות של בעל שליטה בחברה ציבורית, וכיצד דנה בכך הספרות המשפטית?` },
  { id: "MMM", question: `מה עולה ממחקרי מרכז המחקר והמידע של הכנסת ומדוחות רגולטוריים בנוגע לאכיפת חוקי עבודה בישראל?` },
  { id: "NATION-STATE-ACADEMIC", question: `כיצד מנתחת הספרות האקדמית את חוק יסוד: ישראל – מדינת הלאום של העם היהודי ואת שאלת הזהות החוקתית?` },
  { id: "PAYWALL", question: `מה נכתב במאמרים בכתב העת "עיוני משפט" על תורת הפרשנות התכליתית של אהרן ברק?` },
  { id: "R02", question: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
  { id: "P02", question: `מה נקבע בבג"ץ 9999/99 פלוני נ' אלמוני?` },
  { id: "B8-REPEAT", question: `מהי דוקטרינת ההבטחה המנהלית?` },
];

const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const QUERIES = ONLY.length ? ALL.filter((q) => ONLY.includes(q.id)) : ALL;

const OUT = "reports/secondary-web-body";
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
  const sec = md.retrieval?.secondary_body_acquisition ?? md.secondary_body_acquisition ?? null;
  const out = {
    id: q.id,
    question: q.question,
    run_id: t.run_id,
    qa_log_id: row.id,
    ms,
    depth_mode: sec?.depth_mode ?? null,
    secondary: sec,
    per_candidate: sec?.per_candidate ?? [],
    sufficiency: md.drafter?.source_sufficiency ?? null,
    doctrinal_typing: md.drafter?.doctrinal_typing ?? null,
    claim_source_match: md.drafter?.claim_source_match ?? null,
    trace: md.drafter?.doctrinal_sufficiency_trace ?? md.doctrinal_sufficiency_trace ?? null,
    footnotes: row.footnotes ?? [],
    footnote_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
    answer: String(row.answer ?? ""),
  };
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify({ ...out, metadata: md }, null, 2));
  const rows = out.per_candidate as any[];
  console.log(
    `[${q.id}] ms=${ms} depth=${out.depth_mode ?? "-"} ` +
      `cand=${sec?.candidates_considered ?? "-"} local=${sec?.local_hits ?? "-"} ` +
      `webAtt=${sec?.web_attempts ?? "-"} webOk=${sec?.web_successes ?? "-"} ` +
      `meta=${rows.filter((r) => r.metadata_page_detected).length} ` +
      `follow=${rows.filter((r) => r.fulltext_link_followed).length} ` +
      `remap=${rows.filter((r) => r.type_remap?.mapped).length} ` +
      `cache=${rows.filter((r) => r.cache_write === "ok").length} ` +
      `bib=${sec?.bibliography_only_candidate_ids?.length ?? "-"} ` +
      `fn=${out.footnote_count} ` +
      `suff=${out.sufficiency?.sufficient ?? "-"}/${out.sufficiency?.reason ?? "-"} ` +
      `elig=${out.trace?.doctrinal_eligible_count ?? "-"} ` +
      `fails=${rows.filter((r) => r.web_attempted && !r.ok).map((r) => r.failure_reason).join(",")}`,
  );
  results.push(out);
}

writeFileSync(`${OUT}/_all.json`, JSON.stringify(results, null, 2));
console.log("[secondary-web-body] done ->", OUT);
