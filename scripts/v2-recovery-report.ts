/**
 * ReLex V2 — exact-authority-recovery validation reader (read-only).
 * Usage: bun scripts/v2-recovery-report.ts recovery-fix-Q23
 */
const { Client } = await import("pg");
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const label = process.argv[2];
const { rows } = await c.query("select result from v2_eval_runs where label=$1", [label]);
const r = rows[0]?.result ?? {};
const t = r.telemetry ?? {};
console.log(JSON.stringify({
  label,
  answer_chars: (r.answer_markdown ?? "").length,
  footnotes: (r.footnotes ?? []).length,
  verified_claims: (r.verified_evidence?.claims ?? []).length,
  unsupported_core_claims: t.unsupported_core_claims,
  invariant_errors: (r.invariant_errors ?? []).length,
  central_issue_covered: t.central_issue_covered,
  unresolved_authorities: t.unresolved_authorities,
  steps: t.agent_steps,
  prompt_tokens: t.prompt_tokens,
  latency_ms: t.latency_ms,
  temporal_unresolved: t.temporal_unresolved,
  recovery: t.authority_recovery,
  recovery_triggered: t.authority_recovery_triggered,
  recovery_success: t.authority_recovery_success,
  recovery_candidates_attached: t.authority_recovery_candidates_attached,
  ledger: (t.acquisition_ledger ?? []),
}, null, 2));
console.log("\n--- ANSWER ---\n" + (r.answer_markdown ?? "").slice(0, 2500));
await c.end();
