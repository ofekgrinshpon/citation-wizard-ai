// Finish L6 for Phase B, then build the aggregate summary from all 6 reports.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const TAG = "p7-phaseB";

const L6_Q = "רשות מקומית נתנה הבטחה מנהלית לאזרח אשר הסתמך עליה, ולאחר מכן חל שינוי נסיבות מהותי. מהם השיקולים והכללים החלים על אכיפת ההבטחה אל מול שינוי הנסיבות, ומה היחס בין סמכות הרשות, אינטרס ההסתמכות של האזרח, והאינטרס הציבורי?";

function countClusters(answer: string): number {
  const re = /[⁰¹²³⁴⁵⁶⁷⁸⁹]{2,}/gu;
  let n = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) n += m[0].length - 1;
  return n;
}

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
  return await r.json();
}

async function pollByRunId(run_id: string, timeoutMs = 360_000): Promise<any | null> {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,metadata&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`;
    const r = await fetch(url, { headers });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) return rows[0];
    }
    await new Promise((res) => setTimeout(res, 4000));
  }
  return null;
}

function rowSummary(id: string, row: any) {
  const md = row.metadata ?? {};
  const d = md.drafter ?? {};
  const mv = d.marker_validation ?? {};
  const pl = mv.placement ?? {};
  const v = md.verifier ?? {};
  const r37 = d.rule37 ?? null;
  const usableIds = new Set((v.usable ?? []).map((u: any) => u.candidate_id));
  const used = d.used_sources ?? [];
  const finalAnswer = row.answer ?? "";
  const finalFootnotes = row.footnotes ?? [];
  const fullCount = finalFootnotes.filter((f: any) => !f.is_short_form).length;
  const shortCount = finalFootnotes.filter((f: any) => f.is_short_form).length;
  return {
    fixture_id: id,
    marker_validation_ok: !!mv.ok,
    internal_id_leak: !!mv.internal_id_leak,
    used_sources_count: used.length,
    used_sources_subset_of_usable: used.every((u: any) => usableIds.has(u.candidate_id)),
    pre_cluster_count: pl.cluster_count ?? null,
    post_cluster_count: countClusters(finalAnswer),
    placement_ok_pre: pl.ok ?? null,
    footnote_count_pre: fullCount,
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
}

async function main() {
  // 1. Run L6
  console.log("triggering L6...");
  const t = await trigger(L6_Q);
  console.log("triggered:", t);
  if (!t.run_id) throw new Error("no run_id");
  const row = await pollByRunId(t.run_id, 360_000);
  if (!row) throw new Error("L6 timeout");
  const sumL6 = rowSummary("L6", row);
  console.log("L6 summary:", JSON.stringify(sumL6, null, 2));
  await Bun.write(
    `reports/legal-research-v1-${TAG}-L6.json`,
    JSON.stringify({
      generated_at: new Date().toISOString(),
      fixture: { id: "L6", question: L6_Q },
      qa_log_id: row.id,
      run_id: t.run_id,
      row_summary: sumL6,
      rule37: row.metadata?.drafter?.rule37 ?? null,
      answer: row.answer,
      footnotes: row.footnotes,
      metadata: row.metadata,
    }, null, 2),
  );

  // 2. Aggregate from all 6 per-fixture reports.
  const fixtures: any[] = [];
  for (const id of ["L1", "L2", "L3", "L4", "L5", "L6"]) {
    const data = JSON.parse(await Bun.file(`reports/legal-research-v1-${TAG}-${id}.json`).text());
    fixtures.push(data.row_summary);
  }
  const aggregate = {
    count: fixtures.length,
    marker_ok: fixtures.filter((x) => x.marker_validation_ok).length,
    no_leak: fixtures.filter((x) => !x.internal_id_leak).length,
    all_used_in_usable: fixtures.filter((x) => x.used_sources_subset_of_usable).length,
    rule37_enabled_count: fixtures.filter((x) => x.rule37_enabled === true).length,
    rule37_applied_count: fixtures.filter((x) => x.rule37_applied === true).length,
    rule37_discarded_count: fixtures.filter((x) => x.rule37_discarded_reason || x.rule37_validation_failed).length,
    total_shem: fixtures.reduce((s, x) => s + (x.rule37_shem_count ?? 0), 0),
    total_supra: fixtures.reduce((s, x) => s + (x.rule37_supra_count ?? 0), 0),
    total_wrong_back_refs: fixtures.reduce((s, x) => s + (x.rule37_wrong_back_references ?? 0), 0),
    total_pre_clusters: fixtures.reduce((s, x) => s + (x.pre_cluster_count ?? 0), 0),
    total_post_clusters: fixtures.reduce((s, x) => s + (x.post_cluster_count ?? 0), 0),
  };
  const summary = { tag: TAG, generated_at: new Date().toISOString(), fixtures, aggregate };
  await Bun.write(`reports/legal-research-v1-${TAG}-summary.json`, JSON.stringify(summary, null, 2));
  console.log("\n=== Phase B aggregate ===");
  console.log(JSON.stringify(aggregate, null, 2));
  console.log("\n=== Per-fixture ===");
  for (const f of fixtures) console.log(JSON.stringify(f));
}

main().catch((e) => { console.error(e); process.exit(1); });
