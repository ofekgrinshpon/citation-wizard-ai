// topic_aware_claim_source_alignment_v1 — validation runner.
// AW4 / AW9 / AW7 primary; Q3 / Q2 secondary smoke.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const ALL = [
  { id: "AW4", query: `כתוב פרק רקע תיאורטי לעבודה אקדמית על עקרון המידתיות בביקורת חוקתית, הכולל את מקורותיו ואת שלבי המבחן` },
  { id: "AW9", query: `כתוב פרק רקע תיאורטי על עקרון ההסתמכות והציפייה הלגיטימית במשפט המנהלי הישראלי` },
  { id: "AW7", query: `כתוב פסקת טיעון אקדמית התומכת בגישה לפיה בית המשפט רשאי להתערב במדיניות מקצועית של רשויות מנהליות במקרים חריגים` },
  { id: "Q3", query: `מה ההלכה המרכזית בפסיקה לגבי מבחן המידתיות?` },
  { id: "Q2", query: `מה אומר חוק-יסוד: כבוד האדם וחירותו לגבי פגיעה בזכויות?` },
];

const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const QUERIES = ONLY.length ? ALL.filter((q) => ONLY.includes(q.id)) : ALL;

const OUT = "reports/topic-aware-claim-source-alignment-v1";
mkdirSync(OUT, { recursive: true });

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string };
}

async function poll(run_id: string, since: string, timeoutMs = 900_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes` +
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
  const t = await trigger(q.query).catch(() => ({} as { run_id?: string }));
  console.log(`[${q.id}] run_id=${t.run_id}`);
  if (!t.run_id) { results.push({ ...q, error: "trigger_failed" }); continue; }
  const row = await poll(t.run_id, since);
  const ms = Date.now() - t0;
  if (!row) { results.push({ ...q, run_id: t.run_id, ms, error: "poll_timeout" }); continue; }
  // deno-lint-ignore no-explicit-any
  const md = (row.metadata ?? {}) as Record<string, any>;
  const dr = (md.drafter ?? {}) as Record<string, any>;
  const ta = dr.topic_aware_alignment ?? md.topic_aware_alignment ?? null;
  const answer = String(row.answer ?? "");
  results.push({
    id: q.id,
    query: q.query,
    run_id: t.run_id,
    ms,
    pool_after: md.retrieval?.discovery_precision?.pool_after ?? null,
    claim_source_plan: dr.claim_source_plan ?? md.claim_source_plan ?? null,
    drafter_block_source_compliance: dr.drafter_block_source_compliance ?? md.drafter_block_source_compliance ?? null,
    post_draft_alignment_filter: dr.post_draft_alignment_filter ?? md.post_draft_alignment_filter ?? null,
    topic_aware_alignment: ta,
    limitation_note_alignment: dr.limitation_note_alignment ?? md.limitation_note_alignment ?? null,
    claim_source_match: dr.claim_source_match ?? md.claim_source_match ?? null,
    footnotes_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
    // deno-lint-ignore no-explicit-any
    footnotes: (row.footnotes ?? []).map((f: any) => ({
      n: f.n ?? f.index ?? null, title: f.title ?? f.display_title ?? null, url: f.url ?? null,
    })),
    answer,
  });
  console.log(
    `[${q.id}] plan_rows=${dr.claim_source_plan?.rows?.length ?? 0} ` +
      `compliance_violations=${dr.drafter_block_source_compliance?.violations ?? "-"} ` +
      `filter_kept=${dr.post_draft_alignment_filter?.kept ?? "-"}/dropped=${dr.post_draft_alignment_filter?.dropped ?? "-"} ` +
      `role_fixes=${(ta?.source_role_sanity_check ?? []).filter((r: { changed: boolean }) => r.changed).length} ` +
      `fn=${Array.isArray(row.footnotes) ? row.footnotes.length : 0} ${ms}ms`,
  );
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}/results.json`);
