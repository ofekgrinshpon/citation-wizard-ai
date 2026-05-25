// Phase C.1 runner — atomic normalization + validation.
// Forces atomic emit via header x-atomic-markers:emit and Rule 37 OFF via
// x-rule37:0. Validates 6 fixtures and writes per-fixture + summary reports.
//
// Usage:  bun scripts/legal-research-v1-p7-phaseC1-runner.ts

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const TAG = "p7-phaseC1";

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
      "x-rule37": "0",
      "x-atomic-markers": "emit",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, smoke_user_id: SMOKE_USER_ID }),
  });
  const j = await r.json();
  return { status: r.status, ...j };
}

async function pollByRunId(run_id: string, timeoutMs = 600_000): Promise<any | null> {
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

function countAtomic(answer: string): number {
  return (answer.match(/\[\[fn:\d+\]\]/g) ?? []).length;
}
function countSuper(answer: string): number {
  let n = 0;
  for (const ch of answer) if ("⁰¹²³⁴⁵⁶⁷⁸⁹".includes(ch)) n++;
  return n;
}

async function main() {
  if (!SUPABASE_URL || !SR_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const triggered: Array<{ id: string; run_id: string; question: string }> = [];
  const summary: { tag: string; generated_at: string; fixtures: any[]; aggregate?: any } = {
    tag: TAG,
    generated_at: new Date().toISOString(),
    fixtures: [],
  };
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
    const row = await pollByRunId(t.run_id, 600_000);
    if (!row) {
      console.error(`TIMEOUT ${t.id}`);
      continue;
    }
    const md = row.metadata ?? {};
    const d = md.drafter ?? {};
    const mv = d.marker_validation ?? {};
    const v = md.verifier ?? {};
    const a = d.atomic ?? null;
    const r37 = d.rule37 ?? null;
    const marker_format = d.marker_format ?? null;
    const usableIds = new Set((v.usable ?? []).map((u: any) => u.candidate_id));
    const used = d.used_sources ?? [];
    const usedAllInUsable = used.every((u: any) => usableIds.has(u.candidate_id));
    const finalAnswer = row.answer ?? "";
    const atomicMarkers = countAtomic(finalAnswer);
    const supMarkers = countSuper(finalAnswer);

    const row_summary = {
      fixture_id: t.id,
      marker_validation_ok: !!mv.ok,
      internal_id_leak: !!mv.internal_id_leak,
      used_sources_count: used.length,
      used_sources_subset_of_usable: usedAllInUsable,
      marker_format,
      atomic_mode: a?.mode ?? null,
      atomic_normalize_ok: a?.normalize_ok ?? null,
      atomic_normalize_reason: a?.normalize_reason ?? null,
      atomic_validation_ok: a?.validation?.ok ?? null,
      atomic_validation_error: a?.validation?.error ?? null,
      atomic_used_sources_byte_equal: a?.used_sources_byte_equal ?? null,
      atomic_superscript_count: a?.superscript_marker_count ?? null,
      atomic_token_count: a?.atomic_marker_count ?? null,
      atomic_emit_fallback_reason: a?.emit_fallback_reason ?? null,
      final_answer_atomic_token_count: atomicMarkers,
      final_answer_superscript_count: supMarkers,
      rule37_enabled: r37?.enabled ?? null,
      rule37_applied: r37?.applied ?? null,
      rule37_discarded_reason: r37?.discarded_reason ?? null,
    };
    summary.fixtures.push(row_summary);

    console.log(`=== ${t.id} ===`);
    console.log(JSON.stringify(row_summary, null, 2));

    const reportPath = `reports/legal-research-v1-${TAG}-${t.id}.json`;
    await Bun.write(
      reportPath,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          fixture: { id: t.id, question: t.question },
          qa_log_id: row.id,
          run_id: t.run_id,
          row_summary,
          atomic: a,
          rule37: r37,
          answer_preview: finalAnswer.slice(0, 600),
          marker_format,
        },
        null,
        2,
      ),
    );
    console.log(`wrote ${reportPath}`);
  }

  const f = summary.fixtures;
  summary.aggregate = {
    count: f.length,
    marker_ok: f.filter((x: any) => x.marker_validation_ok).length,
    no_leak: f.filter((x: any) => !x.internal_id_leak).length,
    all_used_in_usable: f.filter((x: any) => x.used_sources_subset_of_usable).length,
    atomic_normalize_ok: f.filter((x: any) => x.atomic_normalize_ok === true).length,
    atomic_validation_ok: f.filter((x: any) => x.atomic_validation_ok === true).length,
    atomic_byte_equal: f.filter((x: any) => x.atomic_used_sources_byte_equal === true).length,
    marker_format_atomic: f.filter((x: any) => x.marker_format === "atomic").length,
    marker_format_fallback: f.filter((x: any) => x.marker_format === "legacy_superscript_fallback").length,
    rule37_disabled_or_unapplied: f.filter(
      (x: any) => x.rule37_enabled === false || x.rule37_applied === false,
    ).length,
  };
  await Bun.write(
    `reports/legal-research-v1-${TAG}-summary.json`,
    JSON.stringify(summary, null, 2),
  );
  console.log("\n=== Phase C.1 summary ===");
  console.log(JSON.stringify(summary.aggregate, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
