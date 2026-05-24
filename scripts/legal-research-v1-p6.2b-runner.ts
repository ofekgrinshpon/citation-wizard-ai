// P6.2b smoke runner — runs all 6 fixtures, persists per-fixture reports +
// a summary report to /dev-server/reports/. Mirrors P5 runner shape and adds
// the acceptance-check fields required for P6.2b sign-off.
//
// Usage:  bun scripts/legal-research-v1-p6.2b-runner.ts

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const REPORTS_DIR = resolve(import.meta.dir, "..", "reports");
const TAG = "p6.2b";

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
  const j = await r.json().catch(() => ({}));
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

function wordCount(s: string): number {
  if (!s) return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function buildFixtureReport(fxId: string, question: string, run_id: string, qaRow: any) {
  const md = qaRow?.metadata ?? {};
  const d = md.drafter ?? {};
  const v = md.verifier ?? {};
  const mv = d.marker_validation ?? {};
  const used = d.used_sources ?? [];
  const usable = v.usable ?? [];
  const usableIds = new Set(usable.map((u: any) => u.candidate_id));
  const candById = new Map((md.candidates ?? []).map((c: any) => [c.candidate_id, c]));

  const used_sources_usability = used.map((u: any) => ({
    candidate_id: u.candidate_id,
    number: u.number,
    title: u.title,
    in_verifier_usable: usableIds.has(u.candidate_id),
  }));
  const all_used_in_usable =
    used_sources_usability.length > 0 &&
    used_sources_usability.every((u: any) => u.in_verifier_usable);

  let localN = 0, pplxN = 0;
  for (const u of used) {
    const c: any = candById.get(u.candidate_id);
    if (c?.origin === "local_db") localN++;
    else if (c?.origin === "perplexity") pplxN++;
  }

  const answer: string = qaRow.answer ?? "";
  const wc = wordCount(answer);

  return {
    fixture: { id: fxId, question },
    run_id,
    qa_log_id: qaRow.id,
    timings_ms: {
      total: md.total_ms,
      analyzer: md.planning?.analyzer?.ms,
      planner: md.planning?.planner?.ms,
      retrieval: md.retrieval?.ms,
      verifier: v.ms,
      drafter: d.ms,
    },
    answer_word_count: wc,
    answer_markdown: answer,
    footnotes: qaRow.footnotes ?? [],
    used_sources: used,
    used_sources_usability,
    acceptance: {
      marker_validation_ok: mv.ok === true,
      internal_id_leak: mv.internal_id_leak === true,
      all_used_in_verifier_usable: all_used_in_usable,
      repaired: mv.repaired === true,
      leaked_tokens: mv.leaked_tokens ?? [],
      missing_sources: mv.missing_sources ?? [],
      unused_sources: mv.unused_sources ?? [],
    },
    marker_validation: mv,
    support_distribution: v.counts?.by_support ?? {},
    footnote_origin_split: { local_db: localN, perplexity: pplxN },
    drafter: {
      ok: d.ok,
      escalated: d.escalated,
      model_final: d.model_final,
      sources_passed: d.sources_passed,
      sources_used: d.sources_used,
      footnote_count: d.footnote_count,
      omitted_candidate_ids: d.omitted_candidate_ids ?? [],
      error: d.error ?? null,
    },
    verifier_summary: {
      ms: v.ms,
      counts: v.counts,
      batches: v.batches ?? null,
      escalated_claims: v.escalated_claims ?? [],
    },
    qualitative_note: null as string | null, // filled in by author after read
    generated_at: new Date().toISOString(),
  };
}

async function main() {
  if (!SUPABASE_URL || !SR_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  mkdirSync(REPORTS_DIR, { recursive: true });

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

  const summary: any[] = [];
  for (const t of triggered) {
    console.log(`\nPolling ${t.id} run_id=${t.run_id}...`);
    const row = await pollByRunId(t.run_id, 360_000);
    if (!row) {
      console.error(`TIMEOUT ${t.id}`);
      summary.push({ id: t.id, run_id: t.run_id, status: "timeout" });
      const p = `${REPORTS_DIR}/legal-research-v1-${TAG}-${t.id}.json`;
      writeFileSync(p, JSON.stringify({ fixture: { id: t.id, question: t.question }, run_id: t.run_id, status: "timeout" }, null, 2));
      console.log(`wrote ${p} (timeout)`);
      continue;
    }
    const rep = buildFixtureReport(t.id, t.question, t.run_id, row);
    const p = `${REPORTS_DIR}/legal-research-v1-${TAG}-${t.id}.json`;
    writeFileSync(p, JSON.stringify(rep, null, 2));
    console.log(
      `wrote ${p}  total=${rep.timings_ms.total}ms verifier=${rep.timings_ms.verifier}ms drafter=${rep.timings_ms.drafter}ms wc=${rep.answer_word_count} mv.ok=${rep.acceptance.marker_validation_ok} leak=${rep.acceptance.internal_id_leak} all_used_in_usable=${rep.acceptance.all_used_in_verifier_usable}`,
    );
    summary.push({
      id: t.id,
      run_id: t.run_id,
      qa_log_id: row.id,
      timings_ms: rep.timings_ms,
      answer_word_count: rep.answer_word_count,
      footnote_count: (row.footnotes ?? []).length,
      acceptance: rep.acceptance,
      support_distribution: rep.support_distribution,
      footnote_origin_split: rep.footnote_origin_split,
      verifier_batches: rep.verifier_summary.batches,
      drafter_model_final: rep.drafter.model_final,
      drafter_escalated: rep.drafter.escalated,
    });
  }

  const sumPath = `${REPORTS_DIR}/legal-research-v1-${TAG}-summary.json`;
  writeFileSync(
    sumPath,
    JSON.stringify(
      {
        tag: TAG,
        generated_at: new Date().toISOString(),
        fixtures: summary,
        aggregate: {
          count: summary.length,
          marker_ok_count: summary.filter((s) => s.acceptance?.marker_validation_ok).length,
          no_leak_count: summary.filter((s) => s.acceptance?.internal_id_leak === false).length,
          all_used_in_usable_count: summary.filter((s) => s.acceptance?.all_used_in_verifier_usable).length,
        },
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${sumPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
