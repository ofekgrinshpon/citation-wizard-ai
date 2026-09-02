// academic_candidate_admission_and_slotting_v1 — validation runner.
// AW4 primary fixture, AW1/AW7/AW8 smoke, AW9 non-proportionality generalization.
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
    id: "AW1",
    query:
      `כתוב פרק מבוא לסמינריון שלי ששאלת המחקר שלו היא: האם הסעד החוקתי של קריאה לתוך החוק חורג מסמכות הרשות השופטת ומפר את עקרון הפרדת הרשויות? (נוסח טיוטה)`,
  },
  {
    id: "AW7",
    query:
      `כתוב פסקת טיעון אקדמית התומכת בגישה לפיה בית המשפט רשאי להתערב במדיניות מקצועית של רשויות מנהליות במקרים חריגים`,
  },
  { id: "AW8", query: `כתוב הצגת נושא קצרה לעבודת גמר על דוקטרינת ההבטחה המנהלית והסתמכות הציבור` },
  {
    id: "AW9",
    query:
      `כתוב פרק רקע תיאורטי לעבודה אקדמית על תורת ההסתמכות והציפייה הלגיטימית בדיני חוזים ובמשפט המנהלי`,
  },
];

const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const QUERIES = ONLY.length ? ALL.filter((q) => ONLY.includes(q.id)) : ALL;

const OUT = "reports/academic-candidate-admission-and-slotting-v1";
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
  const answer = String(row.answer ?? "");
  const out = {
    id: q.id,
    question: q.query,
    run_id: t.run_id,
    qa_log_id: row.id,
    ms,
    genre: md.drafter?.source_use_intent?.plan?.academic_genre ?? null,
    task_intent: md.drafter?.source_use_intent?.plan?.user_task_intent ?? null,
    footnotes_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
    footnotes: row.footnotes ?? [],
    admission_gate: md.academic_scholarship_admission_gate ?? [],
    role_slotting: md.academic_role_slotting_decision ?? [],
    pack_admission_summary: md.academic_pack_admission_summary ?? null,
    primary_anchor_status: md.academic_primary_anchor_acquisition_status ?? null,
    csm_drops: md.drafter?.claim_source_match ?? null,
    answer_len: answer.length,
    answer,
  };
  results.push(out);
  const s = out.pack_admission_summary;
  console.log(
    `[${q.id}] genre=${out.genre} fn=${out.footnotes_count} ` +
      `admitted=${s?.admitted_count ?? 0} rejected=${s?.rejected_count ?? 0} ` +
      `diversity=${s?.role_diversity_score ?? 0} ` +
      `primary_usable=${out.primary_anchor_status?.usable_primary_anchor_count ?? 0} ${ms}ms`,
  );
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}/results.json`);
