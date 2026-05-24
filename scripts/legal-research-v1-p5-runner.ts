// P5 smoke runner — service-role only. Triggers L3 + L4 against
// legal-research-v1, polls qa_logs for the resulting metadata blob (which
// now includes the drafter block), and writes JSON reports to reports/.
//
// Usage:  bun scripts/legal-research-v1-p5-runner.ts

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const FIXTURES: Array<{ id: string; question: string }> = [
  { id: "L1", question: "מהם התנאים למתן צו מניעה זמני?" },
  { id: "L2", question: "מהי דוקטרינת ההבטחה המנהלית?" },
  { id: "L3", question: "מתי בית המשפט יפחית פיצוי מוסכם לפי סעיף 15 לחוק החוזים תרופות?" },
  { id: "L4", question: "מהי דוקטרינת השתק פלוגתא?" },
  { id: "L5", question: "מהי עילת הסבירות ומה היקף הביקורת השיפוטית עליה?" },
  { id: "L6", question: "רשות מקומית נתנה הבטחה מנהלית לאזרח אשר הסתמך עליה, ולאחר מכן חל שינוי נסיבות מהותי. מהם השיקולים והכללים החלים על אכיפת ההבטחה אל מול שינוי הנסיבות, ומה היחס בין סמכות הרשות, אינטרס ההסתמכות של האזרח, והאינטרס הציבורי?" },
];

async function trigger(question: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, smoke_user_id: SMOKE_USER_ID }),
  });
  const j = await r.json();
  return { status: r.status, ...j };
}

async function pollByRunId(run_id: string, timeoutMs = 300_000): Promise<any | null> {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url =
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,metadata&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`;
    const r = await fetch(url, { headers });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) return rows[0];
    }
    await new Promise((res) => setTimeout(res, 4000));
  }
  return null;
}

function summarise(fixtureId: string, qaRow: any) {
  const md = qaRow?.metadata ?? {};
  const d = md.drafter ?? {};
  const mv = d.marker_validation ?? {};
  console.log(`\n=== ${fixtureId} ===`);
  console.log(`run_id=${md.run_id} qa_log_id=${qaRow.id}  phase=${md.phase}`);
  const p = md.planning ?? {};
  const r = md.retrieval ?? {};
  const v = md.verifier ?? {};
  console.log(
    `timings ms: total=${md.total_ms} analyzer=${p.analyzer?.ms} planner=${p.planner?.ms} ` +
      `retrieval=${r.ms} verifier=${v.ms} drafter=${d.ms}`,
  );
  console.log(
    `drafter ok=${d.ok} escalated=${d.escalated} model=${d.model_final} ` +
      `sources_passed=${d.sources_passed} sources_used=${d.sources_used} footnotes=${d.footnote_count}`,
  );
  console.log(
    `marker.ok=${mv.ok} repaired=${mv.repaired} markers=${JSON.stringify(mv.markers_in_answer)} ` +
      `missing=${JSON.stringify(mv.missing_sources)} unused=${JSON.stringify(mv.unused_sources)} ` +
      `internal_id_leak=${mv.internal_id_leak} leaked=${JSON.stringify(mv.leaked_tokens)}`,
  );
  const pl = mv.placement ?? {};
  console.log(
    `placement.ok=${pl.ok} clusters=${pl.cluster_count} out_of_order=${pl.out_of_order_count} ` +
      `end_dumps=${pl.end_paragraph_dump_count} repaired=${pl.repaired ?? false} repair_failed=${pl.repair_failed ?? false}`,
  );
  const sup = v.counts?.by_support ?? {};
  console.log(
    `support: direct=${sup.direct ?? 0} partial=${sup.partial ?? 0} ` +
      `tangential=${sup.tangential ?? 0} unrelated=${sup.unrelated ?? 0}`,
  );

  // Coverage per claim: how many usable candidates each claim has.
  const usable = v.usable ?? [];
  const claims = md.claims ?? [];
  const usableByClaim = new Map<string, number>();
  for (const u of usable) {
    for (const cid of u.verdict_claim_ids ?? []) {
      usableByClaim.set(cid, (usableByClaim.get(cid) ?? 0) + 1);
    }
  }
  const claimsZeroUsable = claims.filter((c: any) => (usableByClaim.get(c.claim_id) ?? 0) === 0);
  console.log(
    `claims=${claims.length} claims_with_zero_usable=${claimsZeroUsable.length}` +
      (claimsZeroUsable.length
        ? ` (${claimsZeroUsable.map((c: any) => c.claim_id).join(",")})`
        : ""),
  );

  // Local vs Perplexity footnote split.
  const candById = new Map((md.candidates ?? []).map((c: any) => [c.candidate_id, c]));
  const used = d.used_sources ?? [];
  let localN = 0, pplxN = 0;
  for (const u of used) {
    const c = candById.get(u.candidate_id);
    if (c?.origin === "local_db") localN++;
    else if (c?.origin === "perplexity") pplxN++;
  }
  console.log(`footnote_origin: local_db=${localN} perplexity=${pplxN}`);

  // Omitted-due-to-weakness: candidates passed to drafter but not used.
  console.log(
    `omitted_candidate_ids=${(d.omitted_candidate_ids ?? []).length}`,
  );

  if (d.error) console.log(`drafter_error: ${d.error}`);
  console.log("\n--- ANSWER ---");
  console.log(qaRow.answer);
  console.log("--- FOOTNOTES ---");
  for (const f of qaRow.footnotes ?? []) {
    console.log(`  [${f.number}] ${f.title} — ${f.url ?? "(no url)"}`);
  }
  const usableIds = new Set(usable.map((u: any) => u.candidate_id));
  const offUsable = used.filter((u: any) => !usableIds.has(u.candidate_id));
  console.log(
    `acceptance: all_used_from_usable=${offUsable.length === 0} ` +
      `(${offUsable.length} not in verifier.usable)`,
  );
}

async function main() {
  if (!SUPABASE_URL || !SR_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const triggered: Array<{ id: string; run_id: string; question: string }> = [];
  for (const fx of FIXTURES) {
    const t = await trigger(fx.question);
    console.log(`triggered ${fx.id} status=${t.status} run_id=${t.run_id}`);
    if (!t.run_id) {
      console.error(`Failed to trigger ${fx.id}:`, t);
      continue;
    }
    triggered.push({ id: fx.id, run_id: t.run_id, question: fx.question });
  }

  for (const t of triggered) {
    console.log(`\nPolling for ${t.id} run_id=${t.run_id}...`);
    const row = await pollByRunId(t.run_id, 300_000);
    if (!row) {
      console.error(`TIMEOUT ${t.id}`);
      continue;
    }
    summarise(t.id, row);
    const reportPath = `reports/legal-research-v1-p5-${t.id}.json`;
    await Bun.write(
      reportPath,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          fixture: { id: t.id, question: t.question },
          qa_log_id: row.id,
          run_id: t.run_id,
          answer: row.answer,
          footnotes: row.footnotes,
          metadata: row.metadata,
        },
        null,
        2,
      ),
    );
    console.log(`wrote ${reportPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
