// local_caselaw_content_aware_listing_gate_v1 — validation runner.
// AW4 / AW9 primary, AW7 light smoke. Extracts the content-gate telemetry,
// listing-suppression deltas, pool composition, footnotes and latency.
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

const OUT = "reports/local-caselaw-content-aware-listing-gate-v1";
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
  const rt = md.retrieval ?? {};
  const gate = rt.local_caselaw_content_listing_gate ?? md.local_caselaw_content_listing_gate ?? null;
  const dp = rt.discovery_precision ?? md.discovery_precision ?? {};
  const pool = rt.pool ?? md.pool ?? {};
  const answer = String(row.answer ?? "");
  const out = {
    id: q.id,
    run_id: t.run_id,
    ms,
    gate: gate
      ? {
        status: gate.status,
        candidates_checked: gate.candidates_checked,
        bypassed: gate.bypassed,
        still_suppressible: gate.still_suppressible,
        classification_counts: gate.classification_counts,
        p50_ms: gate.p50_ms,
        p95_ms: gate.p95_ms,
        elapsed_ms: gate.elapsed_ms,
        rpc_error: gate.rpc_error ?? null,
        // deno-lint-ignore no-explicit-any
        sample_rows: (gate.rows ?? []).slice(0, 8).map((r: any) => ({
          doc_id: r.doc_id,
          source_url: r.source_url,
          case_number_present: r.case_number_present,
          available_text_chars: r.available_text_chars,
          positive: r.positive_judgment_signals,
          negative: r.negative_listing_signals,
          classification: r.classification,
          decision: r.final_decision,
          reason: r.reason,
        })),
      }
      : null,
    listing_suppressed: (dp.suppressed ?? []).length,
    suppressed_reason_counts: dp.suppressed_reason_counts ?? {},
    protected_counts: dp.protected_counts ?? {},
    class_counts: dp.class_counts ?? {},
    pool_before: dp.pool_before ?? null,
    pool_after: dp.pool_after ?? null,
    pool_by_origin: pool?.counts?.by_origin ?? md.candidate_counts?.by_origin ?? null,
    footnotes_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
    // deno-lint-ignore no-explicit-any
    footnotes: (row.footnotes ?? []).map((f: any) => ({
      n: f.n ?? f.index ?? null,
      title: f.title ?? f.display_title ?? null,
      url: f.url ?? null,
      role: f.role ?? f.synthesis_role ?? null,
    })),
    answer_len: answer.length,
    answer,
  };
  results.push(out);
  console.log(
    `[${q.id}] gate_checked=${out.gate?.candidates_checked ?? 0} bypassed=${out.gate?.bypassed ?? 0} ` +
      `still=${out.gate?.still_suppressible ?? 0} p95=${out.gate?.p95_ms ?? 0}ms ` +
      `suppressed=${out.listing_suppressed} pool=${out.pool_after} fn=${out.footnotes_count} ${ms}ms`,
  );
}

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}/results.json`);
