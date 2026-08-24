// statute_nomination_to_text_acquisition_v1 — sequential 7-run validation.
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
  { id: "R02", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
  { id: "MAYA", query: MAYA },
  { id: "MAYA-AMIR", query: `${MAYA} התייחסו לעניין סימה אמיר.` },
  { id: "B8", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
  { id: "P02", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
];

const OUT = "reports/statute-nomination-acquisition";
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
    if (run_id) row = await poll(run_id);
  } catch (e) { console.error(`[${q.id}] error`, e); }
  const md: any = row?.metadata ?? {};
  const d: any = md.drafter ?? {};
  const nom: any = d.source_nomination ?? md.source_nomination ?? {};
  const disc: any = d.official_source_discovery ?? md.official_source_discovery ?? {};
  const answer = row?.answer ?? "";
  const footnotes = row?.footnotes ?? [];
  const markers = Array.from(answer.matchAll(/\[(\d+)\]/g)).map((m: any) => Number(m[1]));
  const dangling = markers.filter((n) => n < 1 || n > footnotes.length);
  const statuteNoms = (nom.candidates ?? nom.nominations ?? []).filter?.((c: any) =>
    c?.category === "statute"
  ) ?? [];
  const rec = {
    id: q.id, query: q.query, run_id, terminal: !!row, ms: Date.now() - t0,
    total_ms: md.total_ms ?? null,
    branch: d.deterministic_branch ?? null,
    nomination: {
      actionable_count: nom.actionable_count ?? null,
      category_mix: nom.category_mix ?? {},
      statute_nominations: statuteNoms,
    },
    discovery: {
      enabled: disc.enabled ?? null,
      skip_reason: disc.skip_reason ?? null,
      targets: disc.targets ?? null,
      bodies_acquired: disc.bodies_acquired ?? null,
      cache_hits: disc.cache_hits ?? null,
      cache_misses: disc.cache_misses ?? null,
      cache_writes: disc.cache_writes ?? null,
      injected_candidate_ids: disc.injected_candidate_ids ?? [],
      attempts: disc.attempts ?? [],
    },
    statute_acquisition: d.statute_text_acquisition ?? md.statute_text_acquisition ?? null,
    used_sources: d.used_sources ?? [],
    footnotes_count: footnotes.length,
    dangling_markers: dangling.length,
    answer_len: answer.length,
    answer,
    footnotes,
  };
  results.push(rec);
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
  const st = rec.discovery.attempts.filter((a: any) => a?.statute);
  console.log(
    `[${q.id}] terminal=${rec.terminal} targets=${rec.discovery.targets} statute_attempts=${st.length} ` +
      `results=${st.map((a: any) => `${a.result}/${a.reason ?? "-"}`).join("|")} bodies=${rec.discovery.bodies_acquired} fn=${rec.footnotes_count} ${rec.ms}ms`,
  );
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(results.map(({ answer, footnotes, ...r }) => r), null, 2));
console.log("done");
