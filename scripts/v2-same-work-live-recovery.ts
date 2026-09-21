/**
 * ReLex V2 — same-work live recovery, targeted source diagnostics (F1–F3).
 *
 * Launch:  bun scripts/v2-same-work-live-recovery.ts F1
 * Read:    bun scripts/v2-same-work-live-recovery.ts read <label>
 *
 * Read-only with respect to product code.
 */

export const PROMPTS: Record<string, string> = {
  // F1 — corporate-governance scholarship: previously lost at SSRN.
  F1:
    "אני כותב עבודה על בעיית הנציג בחברות. תעשה לי סקירה של הגישות המרכזיות בספרות לגבי הדרכים שבהן דיני החברות מנסים להתמודד עם ניגודי עניינים של בעלי שליטה.",
  // F2 — US law-review scholarship: previously lost at university repositories.
  F2:
    "תעשה לי סקירת ספרות על זכויות יוצרים בקעקועים שמופיעים במשחקי וידאו, כולל הגישות המרכזיות והמחלוקות שעולות מהספרות.",
  // F3 — institutional policy scholarship: previously lost at OECD / ECGI.
  F3:
    "מה אומרת הספרות והמדיניות הבינלאומית על הגנה על בעלי מניות מיעוט בחברות עם בעל שליטה, ואילו גישות מרכזיות מוצעות?",
  // F4 — a NAMED foreign paper whose canonical copy sits behind SSRN: the
  // discovery record carries a real title + authors, so equivalence can run.
  F4:
    "מה הטענה המרכזית במאמר \"The End of History for Corporate Law\" של Henry Hansmann ו-Reinier Kraakman? תסתמך על המאמר עצמו.",
};

const BASE = process.env.SUPABASE_URL as string;
const ANON = (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string;
const TOKEN = process.env.V2_EVAL_TOKEN_D as string;

const arg = process.argv[2];

if (arg === "read") {
  const { Client } = await import("pg");
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await c.connect();
  const { rows } = await c.query(
    "select label, status, result, error from v2_eval_runs where label=$1 order by created_at desc limit 1",
    [process.argv[3]],
  );
  const row = rows[0];
  const r = row?.result ?? {};
  const t = r.telemetry ?? {};
  console.log(JSON.stringify({
    label: row?.label,
    status: row?.status,
    error: row?.error,
    latency_ms: t.latency_ms,
    steps: t.agent_steps,
    fetches: t.fetch_calls,
    footnotes: (r.footnotes ?? []).length,
    verified_claims: (r.verified_evidence?.claims ?? []).length,
    same_work: {
      triggered: t.same_work_recovery_triggered,
      queries: t.same_work_recovery_query_count,
      candidates_seen: t.same_work_candidates_seen,
      rejected_identity: t.same_work_candidates_rejected_identity,
      rejected_host: t.same_work_candidates_rejected_host,
      success: t.same_work_recovery_success,
      failed: t.same_work_recovery_failed,
      basis: t.same_work_recovery_basis,
      hosts: t.same_work_recovered_host,
      failed_reasons: t.same_work_recovery_failed_reasons,
      skipped_no_identity: t.same_work_recovery_skipped_no_identity,
    },
    enrichment: {
      triggered: t.same_work_enrichment_triggered,
      landing_meta: t.same_work_enrichment_landing_meta,
      doi_lookup: t.same_work_enrichment_doi_lookup,
      crossref: t.same_work_enrichment_crossref,
      success: t.same_work_enrichment_success,
      still_insufficient: t.same_work_enrichment_still_insufficient,
      conflict: t.same_work_enrichment_conflict,
      basis: t.same_work_enrichment_basis,
    },
    trust_boundary: {
      trusted_fields: t.same_work_original_identity_trusted_fields,
      hint_fields: t.same_work_search_hint_fields,
      hint_used_for_query: t.same_work_agent_hint_used_for_query,
      hint_used_for_equivalence: t.same_work_agent_hint_used_for_equivalence,
    },
    academic_funnel: t.academic_source_yield ?? t.academic_yield ?? undefined,
    sources: (r.footnotes ?? []).map((f: { text?: string; url?: string }) => ({ text: f.text, url: f.url })),
  }, null, 2));
  await c.end();
} else {
  if (!PROMPTS[arg]) throw new Error(`unknown prompt ${arg}`);
  const label = `samework-${arg}-${Date.now()}`;
  const r = await fetch(`${BASE}/functions/v1/legal-research-v2`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON}`,
      apikey: ANON,
      "x-smoke-mode": "1",
      "x-smoke-token": TOKEN,
    },
    body: JSON.stringify({ question: PROMPTS[arg], background: true, label }),
  });
  console.log(arg, "launch", r.status, (await r.text()).slice(0, 300));
  console.log("label", label);
}
