// Ad-hoc validation for the drafterV2 truncation guard.
// Reruns the mandate-era Income Tax question and reports:
//   1. completeness_initial
//   2. truncation_retry
//   3. completeness (final)
//   4. final answer + footnote count
//   5. §11 (27a9fe37) still cited?
//   6. verifier demotion counts (sanity — should match prior run)

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const QUESTION =
  "האם פקודת מס הכנסה, כפקודה מנדטורית שקלטה מדינת ישראל, שומרת על מעמד חוקי מלא כיום, ומה הדרך הראויה לרפורמה בה?";

async function trigger() {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question: QUESTION, smoke_user_id: SMOKE_USER_ID }),
  });
  return await r.json();
}

async function pollByRunId(run_id: string, timeoutMs = 900_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`,
      { headers },
    );
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) return rows[0];
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

(async () => {
  console.log("Triggering mandate-era Income Tax query...");
  const trig = await trigger();
  const run_id = trig?.run_id ?? trig?.metadata?.run_id;
  console.log("run_id:", run_id);
  if (!run_id) {
    console.log("no run_id, response:", JSON.stringify(trig).slice(0, 500));
    process.exit(1);
  }

  console.log("Polling qa_logs...");
  const row = await pollByRunId(run_id);
  if (!row) {
    console.log("timeout waiting for row");
    process.exit(1);
  }

  const md = row.metadata ?? {};
  const drafter = md.drafter ?? {};
  const verifier = md.verifier ?? {};

  console.log("\n========== TRUNCATION GUARD ==========");
  console.log("max_completion_tokens_used:", drafter.max_completion_tokens_used);
  console.log("\ncompleteness_initial:");
  console.log(JSON.stringify(drafter.completeness_initial, null, 2));
  console.log("\ntruncation_retry:");
  console.log(JSON.stringify(drafter.truncation_retry, null, 2));
  console.log("\ncompleteness (final):");
  console.log(JSON.stringify(drafter.completeness, null, 2));

  console.log("\n========== STAGE RUNS (drafter) ==========");
  const drafterStages = (md.stage_runs ?? []).filter((s: any) =>
    typeof s.stage === "string" && s.stage.startsWith("drafter_v2"),
  );
  console.log(JSON.stringify(drafterStages, null, 2));

  console.log("\n========== ANSWER ==========");
  console.log(row.answer ?? "");

  console.log("\n========== FOOTNOTES ==========");
  const fns = Array.isArray(row.footnotes) ? row.footnotes : [];
  console.log(`total: ${fns.length}`);
  for (const fn of fns) {
    console.log(
      `\nFN${fn.number} — ${fn.sources?.length ?? 1} source(s):`,
    );
    if (Array.isArray(fn.sources)) {
      for (const s of fn.sources) console.log(`  - ${s.title} [${s.source_type}] ${s.url ?? ""}`);
    } else {
      console.log(`  - ${fn.title} [${fn.source_type ?? "?"}] ${fn.url ?? ""}`);
    }
  }

  console.log("\n========== §11 CHECK ==========");
  const usedSources = drafter.used_sources ?? [];
  const s11 = usedSources.find((u: any) => u.candidate_id === "27a9fe37");
  console.log("§11 (candidate 27a9fe37) cited:", !!s11);
  if (s11) console.log(JSON.stringify(s11, null, 2));

  console.log("\n========== VERIFIER SANITY ==========");
  console.log("demotions_by_rule:", JSON.stringify(verifier.demotions_by_rule ?? verifier.demotions ?? "n/a"));
  console.log("verdict counts:", JSON.stringify(verifier.verdict_counts ?? "n/a"));

  console.log("\n========== TOTAL LATENCY ==========");
  console.log("total_ms:", md.total_ms);
  console.log("drafter ms:", drafter.ms);
  if (drafter.truncation_retry?.attempted) {
    console.log("retry_ms:", drafter.truncation_retry.retry_ms);
  }
})();
