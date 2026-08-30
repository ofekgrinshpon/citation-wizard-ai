// academic_writing_intent_and_drafting_v1 — Stage 2 mini smoke + Stage 3 eval.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const ALL = [
  // Stage 2 — mini smoke
  {
    id: "AW1",
    query:
      `כתוב פרק מבוא לסמינריון שלי ששאלת המחקר שלו היא: האם הסעד החוקתי של קריאה לתוך החוק חורג מסמכות הרשות השופטת ומפר את עקרון הפרדת הרשויות? (נוסח טיוטה)`,
  },
  { id: "AW2", query: `תן לי מקורות לסמינריון על עילת הסבירות במשפט המנהלי` },
  { id: "AW3", query: `מה נקבע בבג"ץ 9999/99 פלוני נ' אלמוני?` },
  // Stage 3 — academic writing evaluation
  {
    id: "AW4",
    query:
      `כתוב פרק רקע תיאורטי לעבודה אקדמית על עקרון המידתיות בביקורת חוקתית, הכולל את מקורותיו ואת שלבי המבחן`,
  },
  {
    id: "AW5",
    query:
      `נסח שאלת מחקר מדויקת לסמינריון שעוסק בביקורת שיפוטית על החלטות שרים בעניין מינויים פוליטיים`,
  },
  {
    id: "AW6",
    query: `כתוב מתווה פרקים לסמינריון על תורת הפרשנות התכליתית בחוקת משפחה`,
  },
  {
    id: "AW7",
    query:
      `כתוב פסקת טיעון אקדמית התומכת בגישה לפיה בית המשפט רשאי להתערב במדיניות מקצועית של רשויות מנהליות במקרים חריגים`,
  },
  {
    id: "AW8",
    query: `כתוב הצגת נושא קצרה לעבודת גמר על דוקטרינת ההבטחה המנהלית והסתמכות הציבור`,
  },
];

const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const QUERIES = ONLY.length ? ALL.filter((q) => ONLY.includes(q.id)) : ALL;

const OUT = "reports/academic-citation-authority-alignment";
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
        if (body && body !== "STUB_ANSWER" && !body.startsWith("[stub]")) return row;
      }
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

const GAP_OPENERS = [
  "במקורות שאותרו לא נמצא",
  "לא נמצא עיגון מספק",
  "לא אותר במקורות",
  "להמשך המחקר",
];

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
  const sui = md.drafter?.source_use_intent ?? md.source_use_intent ?? null;
  const answer = String(row.answer ?? "");
  const firstLine = answer.split("\n").map((l: string) => l.trim()).find(Boolean) ?? "";
  const gapOpener = GAP_OPENERS.some((g) => firstLine.includes(g));
  const bulletCount = (answer.match(/^\s*[-•*]\s+/gm) ?? []).length;
  const out = {
    id: q.id,
    question: q.query,
    run_id: t.run_id,
    ms,
    plan: sui?.plan ?? null,
    overrides: sui?.overrides ?? [],
    deterministic_branch: md.drafter?.deterministic_branch ?? null,
    sufficiency_reason: md.drafter?.sufficiency?.reason ?? null,
    footnotes_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
    style_model: md.drafter?.academic_style_model ?? null,
    answer_len: answer.length,
    first_line: firstLine,
    gap_opener: gapOpener,
    bullet_count: bulletCount,
    has_academic_notice: answer.includes("הטיוטה מנוסחת כטיוטה אקדמית ראשונית"),
    claim_source_match: md.drafter?.claim_source_match ?? null,
    academic_authority_alignment: md.drafter?.academic_authority_alignment ?? null,
    answer,
  };
  results.push(out);
  console.log(
    `[${q.id}] task=${out.plan?.user_task_intent} strategy=${out.plan?.answer_strategy} ` +
      `genre=${out.plan?.academic_genre} branch=${out.deterministic_branch} ` +
      `gapOpener=${gapOpener} bullets=${bulletCount} fn=${out.footnotes_count} len=${out.answer_len} ${ms}ms`,
  );
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}/results.json`);
