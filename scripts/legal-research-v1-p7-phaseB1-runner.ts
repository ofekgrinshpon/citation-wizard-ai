// P7 Phase B runner — explicitly enables Rule 37 via header x-rule37:1
// regardless of edge-function env default. Triggers all 6 fixtures, polls
// qa_logs, and writes per-fixture + summary reports.
//
// Usage:  bun scripts/legal-research-v1-p7-phaseB1-runner.ts

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const TAG = "p7-phaseB1";

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
      "x-rule37": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, smoke_user_id: SMOKE_USER_ID }),
  });
  const j = await r.json();
  return { status: r.status, ...j };
}

async function pollByRunId(run_id: string, timeoutMs = 360_000): Promise<any | null> {
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

// Count adjacent superscript-marker clusters in the FINAL (post-Rule-37) answer.
function countClusters(answer: string): number {
  const re = /[⁰¹²³⁴⁵⁶⁷⁸⁹]{2,}/gu;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) n += m[0].length - 1;
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
    const row = await pollByRunId(t.run_id, 360_000);
    if (!row) {
      console.error(`TIMEOUT ${t.id}`);
      continue;
    }
    const md = row.metadata ?? {};
    const d = md.drafter ?? {};
    const mv = d.marker_validation ?? {};
    const pl = mv.placement ?? {};
    const v = md.verifier ?? {};
    const r37 = d.rule37 ?? null;
    const usableIds = new Set((v.usable ?? []).map((u: any) => u.candidate_id));
    const used = d.used_sources ?? [];
    const usedAllInUsable = used.every((u: any) => usableIds.has(u.candidate_id));
    const finalAnswer = row.answer ?? "";
    const finalFootnotes = row.footnotes ?? [];
    const fullCount = finalFootnotes.filter((f: any) => !f.is_short_form).length;
    const shortCount = finalFootnotes.filter((f: any) => f.is_short_form).length;
    const postClusters = countClusters(finalAnswer);

    const row_summary = {
      fixture_id: t.id,
      marker_validation_ok: !!mv.ok,
      internal_id_leak: !!mv.internal_id_leak,
      used_sources_count: used.length,
      used_sources_subset_of_usable: usedAllInUsable,
      pre_cluster_count: pl.cluster_count ?? null,
      post_cluster_count: postClusters,
      placement_ok_pre: pl.ok ?? null,
      footnote_count_pre: fullCount, // full footnotes = pre-Rule-37 count
      footnote_count_post: finalFootnotes.length,
      short_form_count: shortCount,
      rule37_enabled: r37?.enabled ?? null,
      rule37_applied: r37?.applied ?? null,
      rule37_discarded_reason: r37?.discarded_reason ?? null,
      rule37_validation_failed: r37?.validation_failed ?? null,
      rule37_shem_count: r37?.shem_count ?? 0,
      rule37_supra_count: r37?.supra_count ?? 0,
      rule37_wrong_back_references: r37?.wrong_back_references ?? 0,
      rule37_shortname_fallback: r37?.shortname_fallback_count ?? 0,
    };
    summary.fixtures.push(row_summary);

    console.log(`=== ${t.id} ===`);
    console.log(JSON.stringify(row_summary, null, 2));
    console.log(`--- ANSWER ---\n${finalAnswer}`);
    console.log(`--- FOOTNOTES ---`);
    for (const f of finalFootnotes) {
      const tag = f.is_short_form ? `[short:${f.short_form_kind}→${f.short_form_of}]` : `[full]`;
      console.log(`  ${f.number}. ${tag} ${f.title}`);
    }

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
          rule37: r37,
          answer: finalAnswer,
          footnotes: finalFootnotes,
          metadata: row.metadata,
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
    rule37_enabled_count: f.filter((x: any) => x.rule37_enabled === true).length,
    rule37_applied_count: f.filter((x: any) => x.rule37_applied === true).length,
    rule37_discarded_count: f.filter((x: any) => x.rule37_discarded_reason || x.rule37_validation_failed).length,
    total_shem: f.reduce((s: number, x: any) => s + (x.rule37_shem_count ?? 0), 0),
    total_supra: f.reduce((s: number, x: any) => s + (x.rule37_supra_count ?? 0), 0),
    total_wrong_back_refs: f.reduce((s: number, x: any) => s + (x.rule37_wrong_back_references ?? 0), 0),
    total_pre_clusters: f.reduce((s: number, x: any) => s + (x.pre_cluster_count ?? 0), 0),
    total_post_clusters: f.reduce((s: number, x: any) => s + (x.post_cluster_count ?? 0), 0),
  };
  await Bun.write(
    `reports/legal-research-v1-${TAG}-summary.json`,
    JSON.stringify(summary, null, 2),
  );
  console.log("\n=== Phase B summary ===");
  console.log(JSON.stringify(summary.aggregate, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
