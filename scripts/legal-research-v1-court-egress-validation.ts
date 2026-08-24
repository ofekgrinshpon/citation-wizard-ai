// official_court_egress_path_v1 — sequential 9-run validation.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const MAYA =
  `בסוגייה של חלוקת רכוש לאחר גירושי בני זוג, מה היא אמת המידה לביקורת שיפוטית של בג״ץ כאשר יש חשד שבית הדין הרבני הסתמך על שיקול חיצוני לדין האזרחי?`;

const QUERIES = [
  { id: "D1", query: `מהם מבחני המידתיות בביקורת חוקתית בישראל, וכיצד הם מיושמים כאשר חוק פוגע בזכות יסוד?` },
  { id: "D3", query: `מתי בג״ץ יתערב בהחלטה של בית דין רבני בענייני רכוש בין בני זוג, במיוחד כאשר נטען שבית הדין החיל דין דתי במקום דין אזרחי?` },
  { id: "MAYA-AMIR", query: `${MAYA} התייחסו לעניין סימה אמיר.` },
  { id: "R02", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
  { id: "MAYA", query: MAYA },
  { id: "NATION-STATE", query: `מה נקבע בבג"ץ 5555/18 חסון נ' כנסת ישראל בעניין חוק יסוד: ישראל - מדינת הלאום של העם היהודי?` },
  { id: "P02", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
  { id: "FRESH-SC", query: `מה נקבע בבג"ץ 6427/02 התנועה למען איכות השלטון בישראל נ' הכנסת בעניין חוק דחיית שירות לתלמידי ישיבות?` },
];

const OUT = "reports/court-egress";
mkdirSync(OUT, { recursive: true });

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string; job_id?: string };
}

async function poll(run_id: string, timeoutMs = 900_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`,
      { headers },
    );
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) {
        const md = rows[0]?.metadata ?? {};
        if (md.trace_status === "terminal") return rows[0];
      }
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

const results: any[] = [];
for (const q of QUERIES) {
  const t0 = Date.now();
  console.log(`[${q.id}] triggering…`);
  let row: any = null; let run_id: string | null = null;
  try {
    const t = await trigger(q.query);
    run_id = t.run_id ?? null;
    console.log(`[${q.id}] run_id=${run_id}`);
    if (run_id) row = await poll(run_id);
  } catch (e) { console.error(`[${q.id}] error`, e); }
  const md: any = row?.metadata ?? {};
  const d: any = md.drafter ?? {};
  const nom: any = d.source_nomination ?? md.source_nomination ?? {};
  const qm: any = d.query_merge ?? md.query_merge ?? {};
  const disc: any = d.official_source_discovery ?? md.official_source_discovery ?? {};
  const cache: any = d.verified_source_cache ?? md.verified_source_cache ?? {};
  const of: any = d.official_fetch ?? md.official_fetch ?? {};
  const eg: any = d.court_egress ?? md.court_egress ?? {};
  const answer = row?.answer ?? "";
  const footnotes = row?.footnotes ?? [];
  const markers = Array.from(answer.matchAll(/\[(\d+)\]/g)).map((m: any) => Number(m[1]));
  const dangling = markers.filter((n) => n < 1 || n > footnotes.length);
  const rec = {
    id: q.id, query: q.query, run_id,
    terminal: !!row,
    ms: Date.now() - t0,
    total_ms: md.total_ms ?? null,
    branch: d.deterministic_branch ?? null,
    source_nomination: {
      enabled: nom.enabled ?? null,
      skipped: nom.enabled === false || !!nom.skip_reason,
      skip_reason: nom.skip_reason ?? null,
      stage_failed: nom.stage_failed ?? null,
      model_first: nom.model_first ?? nom.model_initial ?? null,
      model_final: nom.model_final ?? null,
      escalated: nom.escalated ?? null,
      escalation_reason: nom.escalation_reason ?? null,
      mini_retry_used: nom.mini_retry_used ?? null,
      mini_before: nom.mini_candidates_count_before_hardening ?? null,
      mini_after: nom.mini_candidates_count_after_hardening ?? null,
      fallback_to_mini_used: nom.fallback_to_mini_used ?? null,
      finish_reason: nom.finish_reason ?? null,
      reasoning_tokens: nom.reasoning_tokens ?? null,
      parse_error: nom.parse_error ?? null,
      candidates_count: nom.nomination_candidates_count ?? null,
      dropped_count: nom.dropped_count ?? null,
      dropped_reasons: nom.dropped_reasons ?? [],
      identifier_bearing_count: nom.identifier_bearing_count ?? null,
      category_mix: nom.category_mix ?? {},
      actionable_count: nom.actionable_count ?? null,
      exploratory_count: nom.exploratory_count ?? null,
      actionability_mix: nom.actionability_mix ?? {},
      known_name_no_docket_count: nom.known_name_no_docket_count ?? null,
      topic_only_count: nom.topic_only_count ?? null,
      identifier_confidence_histogram: nom.identifier_confidence_histogram ?? {},
      stripped_identifiers: nom.stripped_identifiers ?? [],
      demoted_identifiers: nom.demoted_identifiers ?? [],
      queries_by_bucket: nom.source_nomination_queries_by_bucket ?? {},
      actionable_queries_preserved: nom.actionable_queries_preserved ?? null,
      exploratory_queries_preserved: nom.exploratory_queries_preserved ?? null,
      ms: nom.ms ?? null,
    },
    query_merge: {
      final_query_count: qm.final_count ?? qm.final_query_count ?? null,
      from_nomination: qm.by_producer?.source_nomination ?? qm.queries_added_from_nomination ?? null,
      skipped_duplicate: qm.dropped_duplicate ?? qm.queries_skipped_duplicate ?? null,
      skipped_budget: qm.dropped_budget ?? qm.queries_skipped_budget ?? null,
      raw: qm,
    },
    official_discovery: {
      enabled: disc.enabled ?? null,
      skip_reason: disc.skip_reason ?? null,
      targets: disc.targets ?? null,
      bodies_acquired: disc.bodies_acquired ?? null,
      injected_candidate_ids: disc.injected_candidate_ids ?? [],
      cache_lookups: (cache.cache_hits ?? 0) + (cache.cache_misses ?? 0),
      cache_hits: cache.cache_hits ?? null,
      cache_misses: cache.cache_misses ?? null,
      cache_writes: disc.cache_writes ?? null,
      attempts: (disc.attempts ?? []).map((a: any) => ({
        label: a.label, category: a.category, docket: a.normalized_docket,
        cache_lookup: a.cache_lookup, cooldown_strategy: a.cooldown_strategy,
        ignored_other_strategy_failures: a.ignored_other_strategy_failures,
        search_first: a.search_first, urls: a.urls_attempted,
        path: a.acquisition_path, result: a.result, identity: a.identity,
        body_chars: a.body_chars, cache_written: a.cache_written,
        cache_write_error: a.cache_write_error, reason: a.reason, ms: a.ms,
      })),
    },
    official_fetch: {
      version: of.version ?? null,
      official_calls: of.official_calls ?? null,
      max_per_run: of.max_per_run ?? null,
      stopped_reason: of.stopped_reason ?? null,
      block_pages_detected: of.block_pages_detected ?? null,
      rate_limited_events: of.rate_limited_events ?? null,
      attempts: of.attempts ?? [],
    },
    court_egress: {
      version: eg.version ?? null,
      configured: eg.configured ?? null,
      calls: eg.calls ?? null,
      max_per_run: eg.max_per_run ?? null,
      stopped_reason: eg.stopped_reason ?? null,
      attempts: eg.attempts ?? [],
    },
    footnotes_count: footnotes.length,
    dangling_markers: dangling.length,
    answer_len: answer.length,
    answer,
    footnotes,
  };
  results.push(rec);
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
  console.log(`[${q.id}] terminal=${rec.terminal} of_calls=${rec.official_fetch.official_calls} of_blocks=${rec.official_fetch.block_pages_detected} bodies=${rec.official_discovery.bodies_acquired} nom_cands=${rec.source_nomination.candidates_count} act=${rec.source_nomination.actionable_count} exp=${rec.source_nomination.exploratory_count} esc=${rec.source_nomination.escalated} parse_error=${rec.source_nomination.parse_error} fn=${rec.footnotes_count} ${rec.ms}ms`);
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(results.map(({ answer, footnotes, ...r }) => r), null, 2));
console.log("done");
