// academic_richness_last_mile_and_doctrine_mapping_v1 — live validation.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const ALL = [
  {
    id: "Q1",
    query:
      `כתוב פרק רקע תיאורטי לסמינריון במשפט מנהלי בנושא: עילת הסבירות והביקורת השיפוטית על שיקול דעת מנהלי בישראל.\n` +
      `בפרק יש להסביר: 1. מהי עילת הסבירות ומה תפקידה בביקורת שיפוטית; 2. כיצד התפתחה העילה בפסיקה הישראלית; ` +
      `3. מה היחס בין סבירות, מידתיות ושיקול דעת מקצועי; 4. מהן הביקורות המרכזיות על עילת הסבירות; ` +
      `5. כיצד השינויים החוקתיים האחרונים משפיעים על מעמדה של העילה; 6. האם ניתן לראות בעילת הסבירות כלי הכרחי לשלטון החוק.\n` +
      `כתוב בעברית אקדמית, עם הערות שוליים למקורות משפטיים ואקדמיים.`,
  },
  {
    id: "Q2",
    query:
      `כתוב פרק רקע תיאורטי לסמינריון בנושא ההבטחה המנהלית והציפייה הלגיטימית במשפט המנהלי הישראלי.\n` +
      `בפרק יש להסביר: 1. מהי הבטחה מנהלית; 2. מהי ציפייה לגיטימית; 3. מה ההבחנה בין הבטחה מנהלית, הסתמכות וציפייה לגיטימית; ` +
      `4. מהם התנאים להכרה בהבטחה מנהלית; 5. כיצד התפתחה הדוקטרינה בפסיקה הישראלית; ` +
      `6. מה היחס בין הגינות מנהלית, אינטרס ציבורי ושינוי מדיניות; 7. מהם הסעדים האפשריים.\n` +
      `כתוב בעברית אקדמית, עם הערות שוליים למקורות משפטיים ואקדמיים.`,
  },
  {
    id: "Q2S",
    query: `מהו נוסח סעיף 15(ד)(2) לחוק יסוד: השפיטה ומה תחולתו על ביקורת שיפוטית של בג"ץ?`,
  },
  {
    id: "Q3",
    query:
      `מהם מבחני המידתיות בפסקת ההגבלה שבחוק-יסוד: כבוד האדם וחירותו, וכיצד יושם מבחן האמצעי שפגיעתו פחותה בפסיקה?`,
  },
  {
    id: "AW7",
    query:
      `כתוב פסקת טיעון אקדמית התומכת בגישה לפיה בית המשפט רשאי להתערב במדיניות מקצועית של רשויות מנהליות במקרים חריגים`,
  },
];

const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const QUERIES = ONLY.length ? ALL.filter((q) => ONLY.includes(q.id)) : ALL;

const OUT = "reports/canonical-body-acquisition-and-csm-survival-v1";
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
        const body = String(rows[0].answer ?? "").trim();
        if (body && body !== "STUB_ANSWER" && !body.startsWith("[stub]")) return rows[0];
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
  const d = md.drafter ?? {};
  const out = {
    id: q.id,
    run_id: t.run_id,
    ms,
    doctrine_mapping: md.doctrine_mapping_v1?.doctrine_mapping ??
      md.core_authority_registry?.doctrine_mapping ?? null,
    canonical_registry_selection: md.doctrine_mapping_v1?.canonical_registry_selection ??
      md.core_authority_registry?.canonical_registry_selection ?? null,
    pool_collapse: md.pool_collapse_v1 ?? null,
    footnote_richness: d.footnote_builder_richness_summary ?? null,
    footnote_materialization: d.footnote_materialization ?? null,
    representative: d.representative_sources?.selected_count ?? null,
    pack_size: Array.isArray(d.input_sources) ? d.input_sources.length : null,
    footnotes_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
    distinct_cited: Array.isArray(row.footnotes)
      ? new Set(row.footnotes.map((f: { citation?: string }) => f.citation)).size
      : 0,
    canonical_acquisition: (md.retrieval?.canonical_authority_acquisition ?? null) && {
      attempts: (md.retrieval.canonical_authority_acquisition.attempts ?? []).map((a: any) => ({
        authority: a.authority_name,
        urls: a.attempted_urls,
        url_source: a.url_source,
        result: a.acquisition_result,
        body_chars: a.body_chars,
        identity: a.body_identity_validated,
        rejection: a.rejection_reason,
      })),
      gaps: md.retrieval.canonical_authority_acquisition.canonical_authority_gaps ?? [],
    },
    relay_diagnostics: md.court_relay_fetch_diagnostics ?? md.retrieval?.court_relay_fetch_diagnostics ?? null,
    official_fetch: md.official_fetch ?? md.retrieval?.official_fetch ?? null,
    csm: md.claim_source_match ?? null,
    answer: String(row.answer ?? ""),
    footnotes: row.footnotes ?? [],
  };
  results.push(out);
  console.log(
    `[${q.id}] doctrine=${out.doctrine_mapping?.primary_doctrine} pool=${
      out.pool_collapse?.final_pool
    }/${out.pool_collapse?.raw_found} pack=${out.pack_size} rep=${out.representative} fn=${out.footnotes_count} ${ms}ms`,
  );
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}/results.json`);
