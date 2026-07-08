// Docket-anchor validation harness (R2, R3, R_district).
// Runs 3 queries in parallel and dumps rich per-run telemetry focused on
// docket-anchor lifecycle, docket_match candidates, drafter behavior, and
// final answer/footnotes. No fixes are applied.

import { writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

type Fx = { id: string; label: string; question: string };

const FIXTURES: Fx[] = [
  {
    id: "R2_NationStateBGHC",
    label: "בג\"ץ 5555/18 עדאלה נ' הכנסת",
    question:
      "מה קבע בית המשפט העליון בפסק הדין שדחה את העתירות נגד חוק יסוד: ישראל מדינת הלאום של העם היהודי (בג\"ץ 5555/18 עדאלה נ' הכנסת)?",
  },
  {
    id: "R3_RotmanCA",
    label: "ע\"א 8622/07 רוטמן נ' מע\"צ",
    question:
      "מה נקבע בע\"א 8622/07 רוטמן נ' מע\"צ בעניין ייעוד מקרקעין להפקעה, ומהי משמעות ההלכה בפועל?",
  },
  {
    id: "R_District_Tax",
    label: "ע\"מ 39040-12-21 (מחוזי / מסים)",
    question:
      "מה נפסק בע\"מ 39040-12-21 בבית המשפט המחוזי בעניין סיווג הכנסה לצורכי מס, ומהי המשמעות המעשית של ההחלטה?",
  },
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
  return { status: r.status, body: j };
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

function summarize(fx: Fx, row: any) {
  if (!row) return { fx, ok: false, error: "no row" };
  const md = row.metadata ?? {};
  const drafter = md.drafter ?? {};
  const verifier = md.verifier ?? {};
  const candidates: any[] = md.candidates ?? [];
  const dropped: any[] = md.dropped_sources ?? [];
  const anchors = md.required_anchors ?? {};
  const statuses: any[] = Array.isArray(anchors.statuses) ? anchors.statuses : [];

  // Verifier distribution.
  const dist: Record<string, number> = { direct: 0, partial: 0, tangential: 0, unrelated: 0 };
  for (const v of verifier.verdicts ?? []) if (dist[v.support] !== undefined) dist[v.support]++;

  // Docket-matched candidates.
  const docketMatched = candidates
    .filter((c) => (c.metadata as any)?.docket_match === true)
    .map((c) => ({
      id: c.id,
      title: c.display_title ?? c.title,
      url: c.url,
      origin: c.origin,
      support: (verifier.verdicts ?? []).find((v: any) => v.candidate_id === c.id)?.support,
    }));

  // Adjacent/background case-law that was NOT docket-matched.
  const adjacentCases = candidates
    .filter((c) => (c.role ?? c.source_type)?.toString().includes("case") && !(c.metadata as any)?.docket_match)
    .slice(0, 12)
    .map((c) => ({
      id: c.id,
      title: c.display_title ?? c.title,
      support: (verifier.verdicts ?? []).find((v: any) => v.candidate_id === c.id)?.support,
    }));

  const pxDrops = dropped.filter((d) => d.origin === "perplexity");

  return {
    fx,
    ok: drafter.ok === true,
    error: drafter.error,
    run_id: md.run_id,
    total_ms: md.total_ms,
    drafter_ms: drafter.ms,
    docket_anchors: statuses.filter((s) => s.is_docket_anchor),
    all_anchors: statuses,
    docket_matched_candidates: docketMatched,
    adjacent_case_candidates: adjacentCases,
    verifier_dist: dist,
    demotions_by_rule: verifier.demotions_by_rule ?? {},
    perplexity_hygiene: {
      dropped: pxDrops.length,
      reasons: pxDrops.reduce((a: Record<string, number>, d: any) => {
        a[d.drop_reason] = (a[d.drop_reason] ?? 0) + 1;
        return a;
      }, {}),
    },
    completeness_initial: drafter.completeness_initial ?? null,
    completeness: drafter.completeness ?? null,
    truncation_retry: drafter.truncation_retry ?? null,
    sources_retrieved: candidates.length,
    sources_used: drafter.sources_used ?? 0,
    answer: row.answer ?? "",
    footnotes: row.footnotes ?? [],
    used_sources: (drafter.used_sources ?? []).map((s: any) => ({
      id: s.id,
      title: s.title ?? s.display_title,
      role: s.role,
      support: s.support,
    })),
  };
}

(async () => {
  console.log(`Firing ${FIXTURES.length} docket-anchor queries in parallel...`);
  const trigs = await Promise.all(FIXTURES.map(async (fx) => {
    const t = await trigger(fx.question);
    const run_id = t.body?.run_id ?? t.body?.metadata?.run_id;
    console.log(`  ${fx.id}: run_id=${run_id ?? "(none)"} status=${t.status}`);
    return { fx, run_id };
  }));

  console.log("\nPolling qa_logs...");
  const results = await Promise.all(trigs.map(async ({ fx, run_id }) => {
    if (!run_id) return summarize(fx, null);
    const row = await pollByRunId(run_id);
    return summarize(fx, row);
  }));

  writeFileSync("/tmp/docket-anchor-validation.json", JSON.stringify(results, null, 2));
  console.log("\nWrote /tmp/docket-anchor-validation.json");

  for (const r of results as any[]) {
    console.log(`\n\n=================== ${r.fx.id} — ${r.fx.label} ===================`);
    console.log(`Q: ${r.fx.question}`);
    if (!r.ok) { console.log(`ERROR: ${r.error}`); continue; }
    console.log(`run_id=${r.run_id}  total=${Math.round((r.total_ms ?? 0)/1000)}s  drafter=${Math.round((r.drafter_ms ?? 0)/1000)}s`);
    console.log(`retrieved=${r.sources_retrieved} used=${r.sources_used}`);
    console.log(`verifier: ${JSON.stringify(r.verifier_dist)}  demotions=${JSON.stringify(r.demotions_by_rule)}`);
    console.log(`perplexity_hygiene: ${JSON.stringify(r.perplexity_hygiene)}`);
    console.log(`completeness_initial: ${JSON.stringify(r.completeness_initial)}`);
    console.log(`completeness_final:   ${JSON.stringify(r.completeness)}`);
    console.log(`truncation_retry:     ${JSON.stringify(r.truncation_retry)}`);

    console.log(`\n-- DOCKET ANCHORS (${r.docket_anchors.length}) --`);
    for (const a of r.docket_anchors) console.log(JSON.stringify(a, null, 2));

    console.log(`\n-- ALL REQUIRED ANCHORS (${r.all_anchors.length}) --`);
    for (const a of r.all_anchors) {
      console.log(`  ${a.anchor_id}  type=${a.anchor_type}  docket=${a.is_docket_anchor}  retrieved=${a.retrieved} verified=${a.verified_support ?? "-"} cited=${a.cited} status=${a.status ?? "-"}`);
    }

    console.log(`\n-- DOCKET_MATCH CANDIDATES (${r.docket_matched_candidates.length}) --`);
    for (const c of r.docket_matched_candidates) console.log(`  [${c.id}] support=${c.support ?? "-"} origin=${c.origin}  ${c.title}\n     ${c.url ?? ""}`);

    console.log(`\n-- ADJACENT/BACKGROUND CASE CANDIDATES (up to 12) --`);
    for (const c of r.adjacent_case_candidates) console.log(`  [${c.id}] support=${c.support ?? "-"}  ${c.title}`);

    console.log(`\n-- USED SOURCES (${r.used_sources.length}) --`);
    for (const u of r.used_sources) console.log(`  [${u.id}] role=${u.role} support=${u.support}  ${u.title}`);

    console.log(`\n-- ANSWER --\n${r.answer}`);

    console.log(`\n-- FOOTNOTES (${r.footnotes.length}) --`);
    for (const fn of r.footnotes) {
      const srcs = fn.sources ?? [{ title: fn.title, url: fn.url, source_type: fn.source_type }];
      console.log(`  FN${fn.number} — ${srcs.length} src(s):`);
      for (const s of srcs) console.log(`    - ${s.title} [${s.source_type}] ${s.url ?? ""}`);
    }
  }
})();
