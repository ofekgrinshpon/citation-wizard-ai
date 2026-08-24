// judgment_url_guess_suppression_v1 — sequential 9-run validation.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const MAYA =
  `בסוגייה של חלוקת רכוש לאחר גירושי בני זוג, מה היא אמת המידה לביקורת שיפוטית של בג״ץ כאשר יש חשד שבית הדין הרבני הסתמך על שיקול חיצוני לדין האזרחי?`;

const QUERIES = [
  { id: "R02", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
  { id: "NATION-STATE", query: `מה נקבע בבג"ץ 5555/18 חסון נ' כנסת ישראל בעניין חוק יסוד: ישראל - מדינת הלאום של העם היהודי?` },
  { id: "FRESH-SC", query: `מה נקבע בבג"ץ 6427/02 התנועה למען איכות השלטון בישראל נ' הכנסת בעניין חוק דחיית שירות לתלמידי ישיבות?` },
  { id: "D1", query: `מהם מבחני המידתיות בביקורת חוקתית בישראל, וכיצד הם מיושמים כאשר חוק פוגע בזכות יסוד?` },
  { id: "D3", query: `מתי בג״ץ יתערב בהחלטה של בית דין רבני בענייני רכוש בין בני זוג, במיוחד כאשר נטען שבית הדין החיל דין דתי במקום דין אזרחי?` },
  { id: "MAYA", query: MAYA },
  { id: "MAYA-AMIR", query: `${MAYA} התייחסו לעניין סימה אמיר.` },
  { id: "P02", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
];

const OUT = "reports/url-guess-suppression";
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
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`,
      { headers },
    );
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length && rows[0]?.metadata?.trace_status === "terminal") return rows[0];
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
    if (run_id) row = await poll(run_id);
  } catch (e) { console.error(`[${q.id}] error`, e); }
  const md: any = row?.metadata ?? {};
  const d: any = md.drafter ?? {};
  const disc: any = d.official_source_discovery ?? md.official_source_discovery ?? {};
  const cache: any = d.verified_source_cache ?? md.verified_source_cache ?? {};
  const of: any = d.official_fetch ?? md.official_fetch ?? {};
  const eg: any = d.court_egress ?? md.court_egress ?? {};
  const ju: any = d.judgment_url_eligibility ?? md.judgment_url_eligibility ?? {};
  const nom: any = d.source_nomination ?? md.source_nomination ?? {};
  const answer = row?.answer ?? "";
  const footnotes = row?.footnotes ?? [];
  const markers = Array.from(String(answer).matchAll(/\[(\d+)\]/g)).map((m: any) => Number(m[1]));
  const dangling = markers.filter((n) => n < 1 || n > footnotes.length);
  const rec = {
    id: q.id, query: q.query, run_id, terminal: !!row, ms: Date.now() - t0,
    total_ms: md.total_ms ?? null,
    nominations: {
      count: nom.nomination_candidates_count ?? null,
      judgments: nom.category_mix?.judgment ?? null,
      actionable: nom.actionable_count ?? null,
    },
    judgment_url_eligibility: ju,
    official_discovery: {
      bodies_acquired: disc.bodies_acquired ?? null,
      cache_hits: cache.cache_hits ?? null,
      cache_writes: disc.cache_writes ?? null,
      attempts: (disc.attempts ?? []).map((a: any) => ({
        label: a.label, category: a.category, docket: a.normalized_docket,
        cache_lookup: a.cache_lookup, search_first: a.search_first,
        urls: a.urls_attempted, url_candidates: a.url_candidates,
        guessed_urls_suppressed: a.guessed_urls_suppressed,
        path: a.acquisition_path, result: a.result, identity: a.identity,
        body_chars: a.body_chars, cache_written: a.cache_written,
        injected: a.injected_candidate_id, reason: a.reason, ms: a.ms,
      })),
    },
    official_fetch: {
      official_calls: of.official_calls ?? null,
      stopped_reason: of.stopped_reason ?? null,
      block_pages_detected: of.block_pages_detected ?? null,
      attempts: of.attempts ?? [],
    },
    court_egress: {
      configured: eg.configured ?? null, calls: eg.calls ?? null,
      stopped_reason: eg.stopped_reason ?? null, attempts: eg.attempts ?? [],
    },
    footnotes_count: footnotes.length,
    dangling_markers: dangling.length,
    answer_len: String(answer).length,
    answer, footnotes,
  };
  results.push(rec);
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
  console.log(`[${q.id}] terminal=${rec.terminal} egress_calls=${rec.court_egress.calls} suppressed=${ju.suppressed ?? "-"} saved=${ju.relay_slots_saved ?? "-"} bodies=${rec.official_discovery.bodies_acquired} fn=${rec.footnotes_count} dangling=${rec.dangling_markers} ${rec.ms}ms`);
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(results.map(({ answer, footnotes, ...r }) => r), null, 2));
console.log("done");
