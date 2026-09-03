// local_retrieval_precision_tuning_v1 — validation runner.
// Runs AW4 / AW9 (primary) and AW7 (light smoke) and extracts local-lane
// telemetry: vector quota tuning, reranking, Hebrew FTS normalization/term
// selection, candidate flow by method, pool composition, footnotes, latency.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const ALL = [
  {
    id: "AW4",
    query:
      `כתוב פרק רקע תיאורטי לעבודה אקדמית על עקרון המידתיות בביקורת חוקתית, הכולל את מקורותיו ואת שלבי המבחן`,
  },
  {
    id: "AW9",
    query:
      `כתוב פרק רקע תיאורטי על עקרון ההסתמכות והציפייה הלגיטימית במשפט המנהלי הישראלי`,
  },
  {
    id: "AW7",
    query:
      `כתוב פסקת טיעון אקדמית התומכת בגישה לפיה בית המשפט רשאי להתערב במדיניות מקצועית של רשויות מנהליות במקרים חריגים`,
  },
];

const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const QUERIES = ONLY.length ? ALL.filter((q) => ONLY.includes(q.id)) : ALL;

const OUT = "reports/local-retrieval-precision-tuning-v1";
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
  const t = await trigger(q.query).catch(() => ({} as { run_id?: string }));
  console.log(`[${q.id}] run_id=${t.run_id}`);
  if (!t.run_id) { results.push({ ...q, error: "trigger_failed" }); continue; }
  const row = await poll(t.run_id, since);
  const ms = Date.now() - t0;
  if (!row) { results.push({ ...q, run_id: t.run_id, ms, error: "poll_timeout" }); continue; }
  // deno-lint-ignore no-explicit-any
  const md = (row.metadata ?? {}) as Record<string, any>;
  const ret = md.retrieval ?? {};
  // deno-lint-ignore no-explicit-any
  const perQuery: any[] = ret.local?.per_query ?? [];
  const drops = ret.pool?.drop_reason_counts ?? {};
  // deno-lint-ignore no-explicit-any
  const cands: any[] = Array.isArray(md.candidates) ? md.candidates : [];
  const byMethod: Record<string, number> = {};
  const bySourceType: Record<string, number> = {};
  for (const c of cands) {
    byMethod[c.retrieval_method ?? "?"] = (byMethod[c.retrieval_method ?? "?"] ?? 0) + 1;
    bySourceType[c.source_type ?? "?"] = (bySourceType[c.source_type ?? "?"] ?? 0) + 1;
  }
  const out = {
    id: q.id,
    question: q.query,
    run_id: t.run_id,
    qa_log_id: row.id,
    ms,
    latency: {
      total_ms: ms,
      retrieval_ms: ret.ms ?? null,
      local_ms: ret.local?.ms ?? null,
      local_text_ms_sum: perQuery.reduce((a, p) => a + (p.diag?.text_ms ?? 0), 0),
      local_vector_ms_sum: perQuery.reduce((a, p) => a + (p.diag?.vector_ms ?? 0), 0),
    },
    local_lane: {
      queries: perQuery.length,
      text_hits: perQuery.reduce((a, p) => a + (p.text_hits ?? 0), 0),
      vector_hits: perQuery.reduce((a, p) => a + (p.vector_hits ?? 0), 0),
      exact_hits: perQuery.reduce((a, p) => a + (p.exact_hits ?? 0), 0),
      lanes_used: perQuery.reduce((acc: Record<string, number>, p) => {
        const l = p.diag?.text_lane ?? "unknown";
        acc[l] = (acc[l] ?? 0) + 1;
        return acc;
      }, {}),
      local_candidates: ret.local?.candidates ?? null,
    },
    hebrew_fts_samples: perQuery.slice(0, 6).map((p) => ({
      compact_query_he: p.compact_query_he,
      term_selection: p.diag?.hebrew_fts_term_selection ?? null,
      preserved_phrases: p.diag?.hebrew_fts_normalization?.preserved_phrases ?? null,
      added_variants_n: p.diag?.hebrew_fts_normalization?.added_variants?.length ?? 0,
      text_hits: p.text_hits,
      top_text_titles: p.diag?.top_text_titles ?? [],
    })),
    vector_tuning: ret.local_vector_quota_tuning ?? null,
    reranking: ret.local_candidate_reranking ?? [],
    pool: {
      found: ret.pool?.found ?? null,
      after_dedup: ret.pool?.after_dedup ?? null,
      drop_reason_counts: drops,
      by_method: byMethod,
      by_source_type: bySourceType,
    },
    listing_suppression: {
      suppressed: ret.discovery_precision?.suppressed?.length ?? null,
      discovery_listing_suppressed_drops: drops.discovery_listing_suppressed ?? 0,
    },
    footnotes_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
    footnotes: row.footnotes ?? [],
    answer: String(row.answer ?? ""),
  };
  results.push(out);
  console.log(
    `[${q.id}] fn=${out.footnotes_count} pool=${out.pool.after_dedup} ` +
      `text=${out.local_lane.text_hits} vec=${out.local_lane.vector_hits} ` +
      `tuning=${JSON.stringify(out.vector_tuning ? {
        before: out.vector_tuning.vector_candidates_admitted_before,
        after: out.vector_tuning.vector_candidates_admitted_after,
        pool_before: out.vector_tuning.final_pool_size_before,
        pool_after: out.vector_tuning.final_pool_size_after,
        displaced: out.vector_tuning.text_candidates_displaced,
      } : null)} ${ms}ms`,
  );
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}/results.json`);
