// five_mode_source_depth_policy_v1 — sequential validation runner.
// Same trigger/poll-by-run_id pattern as the other legal-research-v1 runners.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const ALL_QUERIES = [
  { id: "D1", question: `מהם מבחני המידתיות בביקורת חוקתית בישראל, וכיצד יישם אותם בית המשפט העליון?` },
  { id: "D3", question: `מה הדין לגבי פיטורי עובדת בהיריון, ומהו היקף ההגנה?` },
  { id: "MAYA", question: `מה נקבע בעניין מאיה בנוגע לחובת הגילוי?` },
  { id: "MAYA-AMIR", question: `מה נקבע בע"א 5320/90 ברנוביץ נ' רשות ניירות ערך?` },
  { id: "R02", question: `מה נקבע בע"א 6821/93 בנק המזרחי נ' מגדל כפר שיתופי?` },
  { id: "NATION-STATE", question: `מה נקבע בבג"ץ 5555/18 חסון נ' כנסת ישראל?` },
  { id: "ACADEMIC", question: `אני כותב סמינריון על עילת הסבירות במשפט המנהלי — מצא לי מקורות: חקיקה, פסיקה, מאמרים אקדמיים ודוחות ועדות.` },
  { id: "P02", question: `מה נקבע בבג"ץ 9999/99 פלוני נ' אלמוני?` },
  { id: "B8", question: `מהי דוקטרינת ההבטחה המנהלית?` },
];
const QUERIES = ONLY.length ? ALL_QUERIES.filter((q) => ONLY.includes(q.id)) : ALL_QUERIES;

const CONTROL = process.env.CONTROL === "1";
const OUT = CONTROL ? "reports/source-depth/control" : "reports/source-depth";
mkdirSync(OUT, { recursive: true });

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "Content-Type": "application/json",
      ...(CONTROL ? { "x-disable-source-depth": "1" } : {}),
    },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string; job_id?: string };
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
        if (body && body !== "STUB_ANSWER") return row;
      }
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

const results: any[] = [];
for (const q of QUERIES) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const t = await trigger(q.question).catch(() => ({} as { run_id?: string }));
  console.log(`[${q.id}] run_id=${t.run_id}`);
  if (!t.run_id) { results.push({ ...q, error: "trigger_failed" }); continue; }
  const row = await poll(t.run_id, since);
  if (!row) { results.push({ ...q, run_id: t.run_id, error: "poll_timeout" }); continue; }
  const md = (row.metadata ?? {}) as Record<string, any>;
  const depth = md.drafter?.source_depth_policy ?? md.source_depth_policy ?? null;
  const out = {
    id: q.id,
    question: q.question,
    run_id: t.run_id,
    qa_log_id: row.id,
    research_mode: md.planning?.research_mode ?? md.planning?.planner?.mode_plan?.mode ?? null,
    depth_mode: depth?.depth_mode ?? null,
    depth_reasons: depth?.reasons ?? null,
    planner_queries_by_source_type: depth?.planner_queries_by_source_type ?? null,
    merge_kept_by_source_type: depth?.merge_kept_by_source_type ?? null,
    depth_slots_preserved: depth?.depth_slots_preserved ?? null,
    perplexity_called: depth?.perplexity_called ?? null,
    perplexity_reason: depth?.perplexity_reason ?? null,
    footnote_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
    answer: String(row.answer ?? ""),
  };
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify({ ...out, metadata: md }, null, 2));
  console.log(
    `[${q.id}] depth=${out.depth_mode} planner=${JSON.stringify(out.planner_queries_by_source_type)} pplx=${out.perplexity_called}/${out.perplexity_reason} fn=${out.footnote_count}`,
  );
  results.push(out);
}

writeFileSync(`${OUT}/_all.json`, JSON.stringify(results, null, 2));
const table = [
  "| id | depth_mode | planner by type | merge kept by type | pplx | footnotes |",
  "|---|---|---|---|---|---|",
  ...results.map((r) =>
    `| ${r.id} | ${r.depth_mode ?? r.error} | ${JSON.stringify(r.planner_queries_by_source_type ?? {})} | ${JSON.stringify(r.merge_kept_by_source_type ?? {})} | ${r.perplexity_called}/${r.perplexity_reason} | ${r.footnote_count ?? 0} |`
  ),
].join("\n");
writeFileSync(`${OUT}/TABLE.md`, table);
writeFileSync(
  `${OUT}/ANSWERS.md`,
  results.map((r) => `## ${r.id}\n\n**${r.question}**\n\ndepth_mode: ${r.depth_mode}\n\n${r.answer ?? r.error}\n`).join("\n---\n\n"),
);
console.log("\n" + table);
console.log("[source-depth] done ->", OUT);
