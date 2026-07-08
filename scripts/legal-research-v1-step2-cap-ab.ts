// Step 2 A/B validation harness — planner query fanout cap.
// Fires 8 regression + 3 docket-anchor queries, TWICE:
//   - flag-off  (no x-planner-query-cap header)  — baseline
//   - flag-on   (x-planner-query-cap: 12)        — Step 2 candidate
// Compares runtime, query counts, dropped queries, anchor preservation,
// used_sources overlap, and verifier usable/dropped counts per fixture.
//
// Runs the two arms SEQUENTIALLY (not in parallel) so shared provider
// rate-limits and system load don't skew per-arm wall clocks.

import { writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const CAP = parseInt(process.env.LR_PLANNER_QUERY_CAP_TEST ?? "12", 10);

type Fx = { id: string; label: string; question: string; anchor_expected?: boolean };

const FIXTURES: Fx[] = [
  { id: "R1_MandateIncomeTax", label: "Mandate-era Income Tax",
    question: "האם פקודת מס הכנסה, כפקודה מנדטורית שקלטה מדינת ישראל, שומרת על מעמד חוקי מלא כיום, ומה הדרך הראויה לרפורמה בה?" },
  { id: "R2_NationStateBGHC", label: "בג\"ץ 5555/18", anchor_expected: true,
    question: "מה קבע בית המשפט העליון בפסק הדין שדחה את העתירות נגד חוק יסוד: ישראל מדינת הלאום של העם היהודי (בג\"ץ 5555/18 עדאלה נ' הכנסת)?" },
  { id: "R3_CaseLawDocket", label: "ע\"א 8622/07", anchor_expected: true,
    question: "מה נקבע בע\"א 8622/07 רוטמן נ' מע\"צ בעניין ייעוד מקרקעין להפקעה, ומהי משמעות ההלכה בפועל?" },
  { id: "R4_StatutoryInterp", label: "Statutory interpretation",
    question: "כיצד יש לפרש את דרישת \"תום הלב\" בסעיף 39 לחוק החוזים (חלק כללי), התשל\"ג-1973, לאחר פסק דין רע\"א 6339/97 רוקר?" },
  { id: "R5_RecentAmendment", label: "Recent amendment history",
    question: "מהם השינויים המרכזיים שהוכנסו לחוק סדר הדין הפלילי בתיקון 87 (2020) בעניין הליכי מעצר, ומה הרקע החקיקתי לתיקון?" },
  { id: "R6_ReformCodification", label: "Reform / codification",
    question: "מהו מצב הצעת חוק דיני ממונות (הקודקס האזרחי) כיום, ומהם עיקרי המחלוקות סביב הקודיפיקציה של דיני החיובים בישראל?" },
  { id: "R7_AcademicHeavy", label: "Academic-heavy",
    question: "מהי ביקורתו של הפרופ' דניאל פרידמן על ההלכה בעניין תום הלב במשא ומתן, וכיצד היא מתייחסת להלכת רבינאי?" },
  { id: "R8_InsufficientSources", label: "Likely insufficient sources",
    question: "מה הדין הישראלי החל על טוקניזציה של מקרקעין באמצעות NFT, ומה עמדת רשות ניירות ערך והמפקח על הבנקים בסוגיה?" },
  { id: "D_R2_NationStateBGHC", label: "docket: בג\"ץ 5555/18", anchor_expected: true,
    question: "מה קבע בית המשפט העליון בפסק הדין שדחה את העתירות נגד חוק יסוד: ישראל מדינת הלאום של העם היהודי (בג\"ץ 5555/18 עדאלה נ' הכנסת)?" },
  { id: "D_R3_Rotman", label: "docket: ע\"א 8622/07", anchor_expected: true,
    question: "מה נקבע בע\"א 8622/07 רוטמן נ' מע\"צ בעניין ייעוד מקרקעין להפקעה, ומהי משמעות ההלכה בפועל?" },
  { id: "D_District_Tax", label: "docket: ע\"מ 39040-12-21", anchor_expected: true,
    question: "מה נפסק בע\"מ 39040-12-21 בבית המשפט המחוזי בעניין סיווג הכנסה לצורכי מס, ומהי המשמעות המעשית של ההחלטה?" },
];

type Arm = "off" | "on";

async function trigger(fx: Fx, arm: Arm) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${SR_KEY}`,
    "x-smoke-mode": "1",
    "Content-Type": "application/json",
  };
  if (arm === "on") headers["x-planner-query-cap"] = String(CAP);
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers,
    body: JSON.stringify({ question: fx.question, smoke_user_id: SMOKE_USER_ID }),
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

interface Extracted {
  fx_id: string;
  arm: Arm;
  ok: boolean;
  run_id?: string;
  error?: string;
  total_ms?: number;
  planner_ms?: number;
  planner_escalated?: boolean;
  queries_emitted: number;
  queries_before_cap?: number;
  queries_after_cap?: number;
  cap_enabled?: boolean;
  cap?: number;
  dropped_count?: number;
  dropped_queries?: any[];
  claims_preserved?: number;
  claims_total?: number;
  anchor_count: number;
  anchor_queries: number;
  anchor_ids: string[];
  anchor_statuses: any[];
  candidates: number;
  verifier_usable: string[];
  verifier_dropped: string[];
  used_sources: string[];
  answer_len: number;
  answer_preview: string;
  footnote_count: number;
}

function extract(fx: Fx, arm: Arm, row: any, err?: string): Extracted {
  if (!row) {
    return {
      fx_id: fx.id, arm, ok: false, error: err ?? "no row",
      queries_emitted: 0, anchor_count: 0, anchor_queries: 0, anchor_ids: [], anchor_statuses: [],
      candidates: 0, verifier_usable: [], verifier_dropped: [], used_sources: [],
      answer_len: 0, answer_preview: "", footnote_count: 0,
    };
  }
  const md = row.metadata ?? {};
  const planning = md.planning ?? {};
  const p = planning.planner ?? {};
  const cap_report = p.query_cap ?? {};
  const anchors = md.required_anchors ?? {};
  const verifier = md.verifier ?? {};
  const drafter = md.drafter ?? {};
  const candidates = md.candidates ?? [];
  const anchorStatuses = Array.isArray(anchors.statuses) ? anchors.statuses : [];
  return {
    fx_id: fx.id, arm,
    ok: drafter.ok === true,
    run_id: md.run_id,
    error: drafter.error,
    total_ms: md.total_ms,
    planner_ms: p.ms,
    planner_escalated: p.escalated_to_gpt5,
    queries_emitted: planning.queries_count ?? 0,
    queries_before_cap: cap_report.queries_before_cap,
    queries_after_cap: cap_report.queries_after_cap,
    cap_enabled: cap_report.enabled,
    cap: cap_report.cap,
    dropped_count: cap_report.dropped_count ?? 0,
    dropped_queries: cap_report.dropped_queries ?? [],
    claims_preserved: cap_report.claims_preserved,
    claims_total: cap_report.claims_total,
    anchor_count: anchors.count ?? 0,
    anchor_queries: (anchors.queries_emitted ?? []).length,
    anchor_ids: (anchors.anchors ?? []).map((a: any) => a.anchor_id),
    anchor_statuses: anchorStatuses.map((s: any) => ({
      anchor_id: s.anchor_id, retrieved: s.retrieved, cited: s.cited, is_docket: s.is_docket_anchor,
    })),
    candidates: candidates.length,
    verifier_usable: (verifier.usable ?? []).map((u: any) => u.candidate_id).sort(),
    verifier_dropped: (verifier.dropped ?? []).map((d: any) => d.candidate_id).sort(),
    used_sources: (drafter.used_sources ?? []).map((u: any) => u.candidate_id).sort(),
    answer_len: (row.answer ?? "").length,
    answer_preview: (row.answer ?? "").slice(0, 400),
    footnote_count: (row.footnotes ?? []).length,
  };
}

async function runArm(arm: Arm): Promise<Extracted[]> {
  console.log(`\n=== ARM: ${arm.toUpperCase()} (cap=${arm === "on" ? CAP : "disabled"}) ===`);
  console.log(`Firing ${FIXTURES.length} queries in parallel...`);
  const trigs = await Promise.all(FIXTURES.map(async (fx) => {
    const t = await trigger(fx, arm);
    const run_id = t.body?.run_id;
    console.log(`  ${fx.id}: run_id=${run_id ?? "(none)"} status=${t.status}`);
    return { fx, run_id };
  }));
  console.log("Polling qa_logs...");
  return Promise.all(trigs.map(async ({ fx, run_id }) => {
    if (!run_id) return extract(fx, arm, null, "no run_id");
    try {
      const row = await pollByRunId(run_id);
      return extract(fx, arm, row, row ? undefined : "poll timeout");
    } catch (e) { return extract(fx, arm, null, String(e)); }
  }));
}

(async () => {
  const off = await runArm("off");
  const on = await runArm("on");

  const byId = (arr: Extracted[]) => new Map(arr.map((e) => [e.fx_id, e]));
  const offMap = byId(off);
  const onMap = byId(on);

  const rows: any[] = [];
  for (const fx of FIXTURES) {
    const a = offMap.get(fx.id);
    const b = onMap.get(fx.id);
    if (!a || !b) continue;
    const setEq = (x: string[], y: string[]) =>
      x.length === y.length && x.every((v, i) => v === y[i]);
    const overlap = (x: string[], y: string[]) => {
      const s = new Set(y);
      const common = x.filter((v) => s.has(v)).length;
      const denom = Math.max(x.length, y.length, 1);
      return +(common / denom).toFixed(3);
    };
    const anchorsPreserved = a.anchor_statuses.length === b.anchor_statuses.length &&
      a.anchor_statuses.every((s: any, i: number) => {
        const t = b.anchor_statuses[i];
        return s.anchor_id === t.anchor_id && s.retrieved === t.retrieved && s.cited === t.cited;
      });
    rows.push({
      fx_id: fx.id,
      total_ms_off: a.total_ms, total_ms_on: b.total_ms,
      delta_ms: (a.total_ms ?? 0) - (b.total_ms ?? 0),
      planner_ms_off: a.planner_ms, planner_ms_on: b.planner_ms,
      queries_off: a.queries_emitted, queries_on: b.queries_emitted,
      cap_enabled: b.cap_enabled, cap: b.cap,
      queries_before_cap_on: b.queries_before_cap,
      dropped_count_on: b.dropped_count,
      claims_preserved_on: b.claims_preserved, claims_total_on: b.claims_total,
      anchor_count_off: a.anchor_count, anchor_count_on: b.anchor_count,
      anchor_queries_off: a.anchor_queries, anchor_queries_on: b.anchor_queries,
      anchors_preserved_1to1: anchorsPreserved,
      candidates_off: a.candidates, candidates_on: b.candidates,
      usable_off: a.verifier_usable.length, usable_on: b.verifier_usable.length,
      dropped_off: a.verifier_dropped.length, dropped_on: b.verifier_dropped.length,
      used_sources_off: a.used_sources.length, used_sources_on: b.used_sources.length,
      used_sources_overlap: overlap(a.used_sources, b.used_sources),
      answer_len_off: a.answer_len, answer_len_on: b.answer_len,
      footnotes_off: a.footnote_count, footnotes_on: b.footnote_count,
      ok_off: a.ok, ok_on: b.ok,
      dropped_queries_on: b.dropped_queries,
    });
  }

  const out = {
    cap: CAP,
    fired_at: new Date().toISOString(),
    per_fixture: rows,
    off_raw: off,
    on_raw: on,
    summary: {
      count: rows.length,
      total_ms_off_median: median(rows.map((r) => r.total_ms_off ?? 0)),
      total_ms_on_median: median(rows.map((r) => r.total_ms_on ?? 0)),
      total_ms_off_mean: mean(rows.map((r) => r.total_ms_off ?? 0)),
      total_ms_on_mean: mean(rows.map((r) => r.total_ms_on ?? 0)),
      anchors_all_preserved: rows.every((r) => r.anchors_preserved_1to1),
      any_ok_regression: rows.some((r) => r.ok_off && !r.ok_on),
      mean_used_sources_overlap: +(rows.reduce((s, r) => s + r.used_sources_overlap, 0) / rows.length).toFixed(3),
    },
  };
  writeFileSync("/tmp/legal-research-v1-step2-ab.json", JSON.stringify(out, null, 2));
  writeFileSync("reports/legal-research-v1-step2-ab.json", JSON.stringify(out, null, 2));

  console.log("\n=========================== A/B TABLE ===========================");
  console.log("fx | ms_off→ms_on (Δ) | q_off→q_on (cap? before→after, dropped) | anchors 1:1 | usable off→on | used_srcs overlap | ok");
  for (const r of rows) {
    const ms = `${Math.round((r.total_ms_off ?? 0)/1000)}s→${Math.round((r.total_ms_on ?? 0)/1000)}s (${r.delta_ms > 0 ? "-" : "+"}${Math.abs(Math.round(r.delta_ms/1000))}s)`;
    const q = `${r.queries_off}→${r.queries_on}${r.cap_enabled ? ` (cap=${r.cap}, ${r.queries_before_cap_on}→${r.queries_before_cap_on - r.dropped_count_on}, dropped=${r.dropped_count_on})` : ""}`;
    console.log(`${r.fx_id} | ${ms} | ${q} | ${r.anchors_preserved_1to1 ? "YES" : "NO"} | ${r.usable_off}→${r.usable_on} | ${r.used_sources_overlap} | ${r.ok_off}/${r.ok_on}`);
  }
  console.log("\nSummary:", JSON.stringify(out.summary, null, 2));
})();

function median(xs: number[]) { const s = [...xs].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; }
function mean(xs: number[]) { return Math.round(xs.reduce((a,b)=>a+b,0)/Math.max(1,xs.length)); }
