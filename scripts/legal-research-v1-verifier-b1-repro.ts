// B1 verifier live-reproduction.
//
// Loads the exact question + analyzer claims + candidate pool from a saved
// qa_logs row and replays only the verifier call — first as one full batch
// (the original failure), then one candidate at a time — so we can isolate
// whether the failure is payload-size, tool-schema, malformed content,
// serialization, fetch/timeout, or response parsing.
//
// Usage:
//   deno run -A --env-file=.env scripts/legal-research-v1-verifier-b1-repro.ts <run_id>
//
// Default run_id = B1 from runs-stable-baseline10 (see reports/quality-audit/
// verifier-diagnostic.md).

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { runVerifier } from "../supabase/functions/legal-research-v1/stages/verifier.ts";
import type { Candidate, Claim } from "../supabase/functions/legal-research-v1/lib/types.ts";

const RUN_ID = Deno.args[0] ?? "8c8b0645-c445-47ae-a266-4be6580f1efa";
const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
if (!SUPABASE_URL || !KEY) {
  console.error("Missing SUPABASE_URL / KEY env.");
  Deno.exit(2);
}

const url =
  `${SUPABASE_URL}/rest/v1/qa_logs?select=metadata,question&metadata->>run_id=eq.${RUN_ID}&order=created_at.desc&limit=1`;
const r = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
if (!r.ok) {
  console.error("qa_logs fetch failed:", r.status, await r.text());
  Deno.exit(1);
}
const rows = await r.json();
if (!Array.isArray(rows) || rows.length === 0) {
  console.error("no qa_logs row for run_id=", RUN_ID);
  Deno.exit(1);
}
const md = rows[0].metadata ?? {};
const question: string = rows[0].question ?? md.question ?? "";
const claims: Claim[] = md.claims ?? md?.planning?.analyzer?.claims ?? [];
const candidates: Candidate[] = md.candidates ?? md?.retrieval?.candidates ?? [];

console.log(`\n== B1 verifier repro ==`);
console.log(`run_id: ${RUN_ID}`);
console.log(`question: ${question.slice(0, 120)}...`);
console.log(`claims: ${claims.length}`);
console.log(`candidates: ${candidates.length}`);
if (!claims.length || !candidates.length) {
  console.error("missing claims or candidates in metadata; cannot replay.");
  Deno.exit(1);
}

function summarize(label: string, res: Awaited<ReturnType<typeof runVerifier>>) {
  const cf = res.call_failures ?? [];
  console.log(`\n-- ${label} --`);
  console.log(`  wall_ms=${res.total_wall_ms} batches=${res.batch_count} call_failed=${res.call_failed}`);
  console.log(`  model verdicts=${res.counts.model_verdicts} synthetic=${res.counts.synthetic_verdicts}`);
  console.log(`  by_support_model:`, res.counts.by_support_model);
  console.log(`  by_support_synth:`, res.counts.by_support_synthetic);
  console.log(`  usable=${res.candidates_usable} dropped=${res.candidates_dropped}`);
  for (const f of cf) {
    console.log(
      `  FAIL ${f.stage} model=${f.model} ms=${f.ms} http=${f.http_status ?? "-"} candidates=${f.candidate_count} payload=${f.request_payload_size}B esc=${f.escalation_attempted}`,
    );
    console.log(`       reason: ${f.failure_reason.slice(0, 300)}`);
  }
}

// (1) Full batch — the original failing shape.
const full = await runVerifier(question, claims, candidates);
summarize("full batch (original shape)", full);

// (2) One-candidate-per-batch probe. We reuse the same claims; for each
//     candidate we call the verifier with only that single candidate. If the
//     large payload was the trigger, these should succeed. If the schema /
//     candidate content / fetch shape itself is the trigger, they will fail
//     the same way.
let modelOk = 0;
let modelFail = 0;
const perCandFailures: Array<{ id: string; reason: string; http?: number; ms: number }> = [];
const probeMax = Math.min(candidates.length, 6);
console.log(`\n-- per-candidate probe (first ${probeMax} of ${candidates.length}) --`);
for (let i = 0; i < probeMax; i++) {
  const c = candidates[i];
  const cl = claims.find((x) => x.claim_id === c.claim_id) ?? claims[0];
  const singleCand: Candidate = { ...c, claim_id: cl.claim_id };
  const one = await runVerifier(question, [cl], [singleCand]);
  const ok = one.counts.model_verdicts > 0;
  if (ok) modelOk++;
  else {
    modelFail++;
    const f = one.call_failures[0];
    perCandFailures.push({
      id: c.candidate_id,
      reason: f?.failure_reason ?? "(no failure recorded)",
      http: f?.http_status,
      ms: f?.ms ?? one.total_wall_ms,
    });
  }
  console.log(`  [${i + 1}/${probeMax}] ${c.candidate_id.slice(0, 8)} role=${c.role} title="${(c.title ?? "").slice(0, 40)}" -> ${ok ? "OK" : "FAIL"} (ms=${one.total_wall_ms})`);
}
console.log(`\nper-candidate summary: ok=${modelOk} fail=${modelFail}`);
for (const f of perCandFailures) {
  console.log(`  FAIL ${f.id.slice(0, 8)} http=${f.http ?? "-"} ms=${f.ms} reason=${f.reason.slice(0, 200)}`);
}

// Verdict summary line the reader can grep.
console.log(`\nREPRO VERDICT:`);
console.log(
  `  full_batch.call_failed=${full.call_failed} full_batch.model_verdicts=${full.counts.model_verdicts} ` +
    `single_ok=${modelOk} single_fail=${modelFail}`,
);
if (full.call_failed && modelFail === 0) {
  console.log(`  → payload-size / batch-size dependent failure`);
} else if (full.call_failed && modelFail > 0) {
  console.log(`  → failure is not batch-size dependent (single-candidate call also fails)`);
} else if (!full.call_failed) {
  console.log(`  → full batch now succeeded — original failure is not reproducing right now`);
}
