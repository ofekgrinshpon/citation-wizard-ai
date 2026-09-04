// research_richness_execution_unblock_v1_live_web_validation — read-only live run.
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

const OUT = "reports/web-source-usability-and-authority-selection-v1/live";
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
  const rt = (md.retrieval ?? {}) as Record<string, any>;
  results.push({
    id: q.id,
    query: q.query,
    run_id: t.run_id,
    ms,
    web_tier_health: rt.web_tier_health ?? md.web_tier_health ?? null,
    perplexity: rt.perplexity ?? md.perplexity ?? null,
    source_depth: md.source_depth ?? md.diagnostics?.source_depth ?? null,
    depth_flags: {
      perplexity_policy: md.perplexity_policy ?? null,
      perplexity_called: md.perplexity_called ?? null,
      perplexity_reason: md.perplexity_reason ?? null,
    },
    official_source_discovery: rt.official_source_discovery ?? md.official_source_discovery ?? null,
    canonical_authority_acquisition: rt.canonical_authority_acquisition ?? null,
    canonical_authority_acquisition_trigger: rt.canonical_authority_acquisition_trigger ?? null,
    judgment_text_acquisition: rt.judgment_text_acquisition ?? null,
    source_integrity_tiers: rt.source_integrity?.tier_counts ?? null,
    source_integrity_admitted: Array.isArray(rt.source_integrity?.admitted) ? rt.source_integrity.admitted.length : null,
    discovery_precision: rt.discovery_precision ?? null,
    claim_source_plan: dr.claim_source_plan ?? md.claim_source_plan ?? null,
    drafter_block_source_compliance: dr.drafter_block_source_compliance ?? null,
    post_draft_alignment_filter: dr.post_draft_alignment_filter ?? null,
    claim_source_match: dr.claim_source_match ?? null,
    footnotes_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
    // deno-lint-ignore no-explicit-any
    footnotes: (row.footnotes ?? []).map((f: any) => ({
      n: f.n ?? f.index ?? null, title: f.title ?? f.display_title ?? null, url: f.url ?? null, kind: f.kind ?? f.source_type ?? null,
    })),
    answer: String(row.answer ?? ""),
    metadata_keys: Object.keys(md),
  });
  const w = results[results.length - 1].web_tier_health;
  console.log(`[${q.id}] fn=${results[results.length - 1].footnotes_count} web=${JSON.stringify(w)?.slice(0, 300)} ${ms}ms`);
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}/results.json`);
