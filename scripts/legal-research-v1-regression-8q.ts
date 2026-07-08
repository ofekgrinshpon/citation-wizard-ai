// Regression validation across 8 diverse legal-research queries.
// Fires all queries in parallel, polls each, extracts the metrics the user
// requested, and writes a compact markdown table + a per-query JSON dump.

import { writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

type Fx = { id: string; label: string; question: string };

const FIXTURES: Fx[] = [
  {
    id: "R1_MandateIncomeTax",
    label: "Mandate-era Income Tax",
    question:
      "האם פקודת מס הכנסה, כפקודה מנדטורית שקלטה מדינת ישראל, שומרת על מעמד חוקי מלא כיום, ומה הדרך הראויה לרפורמה בה?",
  },
  {
    id: "R2_NationStateBGHC",
    label: "Nation-State Law / BGHC holding",
    question:
      "מה קבע בית המשפט העליון בפסק הדין שדחה את העתירות נגד חוק יסוד: ישראל מדינת הלאום של העם היהודי (בג\"ץ 5555/18 עדאלה נ' הכנסת)?",
  },
  {
    id: "R3_CaseLawDocket",
    label: "Case-law with specific docket",
    question:
      "מה נקבע בע\"א 8622/07 רוטמן נ' מע\"צ בעניין ייעוד מקרקעין להפקעה, ומהי משמעות ההלכה בפועל?",
  },
  {
    id: "R4_StatutoryInterp",
    label: "Statutory interpretation",
    question:
      "כיצד יש לפרש את דרישת \"תום הלב\" בסעיף 39 לחוק החוזים (חלק כללי), התשל\"ג-1973, לאחר פסק דין רע\"א 6339/97 רוקר?",
  },
  {
    id: "R5_RecentAmendment",
    label: "Recent amendment history",
    question:
      "מהם השינויים המרכזיים שהוכנסו לחוק סדר הדין הפלילי בתיקון 87 (2020) בעניין הליכי מעצר, ומה הרקע החקיקתי לתיקון?",
  },
  {
    id: "R6_ReformCodification",
    label: "Reform / codification",
    question:
      "מהו מצב הצעת חוק דיני ממונות (הקודקס האזרחי) כיום, ומהם עיקרי המחלוקות סביב הקודיפיקציה של דיני החיובים בישראל?",
  },
  {
    id: "R7_AcademicHeavy",
    label: "Academic-scholarship-heavy",
    question:
      "מהי ביקורתו של הפרופ' דניאל פרידמן על ההלכה בעניין תום הלב במשא ומתן, וכיצד היא מתייחסת להלכת רבינאי?",
  },
  {
    id: "R8_InsufficientSources",
    label: "Likely insufficient sources",
    question:
      "מה הדין הישראלי החל על טוקניזציה של מקרקעין באמצעות NFT, ומה עמדת רשות ניירות ערך והמפקח על הבנקים בסוגיה?",
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

interface Extracted {
  fx: Fx;
  run_id?: string;
  ok: boolean;
  error?: string;
  answer: string;
  footnote_count: number;
  footnotes: any[];
  sources_retrieved: number;
  sources_used: number;
  verifier_dist: Record<string, number>;
  demotions_by_rule: Record<string, number>;
  perplexity_hygiene: any;
  required_anchors: {
    declared: number;
    retrieved: number;
    cited: number;
    statuses: any[];
  };
  answer_style_triggers: string[];
  completeness_initial: any;
  completeness: any;
  truncation_retry: any;
  unsafe_titles: string[];
  total_ms?: number;
  drafter_ms?: number;
}

function extract(fx: Fx, row: any, err?: string): Extracted {
  if (!row) {
    return {
      fx,
      ok: false,
      error: err ?? "no row",
      answer: "",
      footnote_count: 0,
      footnotes: [],
      sources_retrieved: 0,
      sources_used: 0,
      verifier_dist: {},
      demotions_by_rule: {},
      perplexity_hygiene: {},
      required_anchors: { declared: 0, retrieved: 0, cited: 0, statuses: [] },
      answer_style_triggers: [],
      completeness_initial: null,
      completeness: null,
      truncation_retry: null,
      unsafe_titles: [],
    };
  }
  const md = row.metadata ?? {};
  const drafter = md.drafter ?? {};
  const verifier = md.verifier ?? {};
  const candidates = md.candidates ?? [];
  const dropped = md.dropped_sources ?? [];
  const anchors = md.required_anchors ?? {};

  // Verifier support distribution.
  const dist: Record<string, number> = { direct: 0, partial: 0, tangential: 0, unrelated: 0 };
  const verdicts = verifier.verdicts ?? [];
  for (const v of verdicts) {
    if (dist[v.support] !== undefined) dist[v.support]++;
  }

  // demotions_by_rule.
  const dbr = verifier.demotions_by_rule ?? {};

  // Perplexity hygiene: count dropped from perplexity origin.
  const pxDrops = dropped.filter((d: any) => d.origin === "perplexity");
  const pxHygiene = {
    dropped: pxDrops.length,
    reasons: pxDrops.reduce((acc: Record<string, number>, d: any) => {
      acc[d.drop_reason] = (acc[d.drop_reason] ?? 0) + 1;
      return acc;
    }, {}),
  };

  // Required anchors.
  const statuses = Array.isArray(anchors.statuses) ? anchors.statuses : [];
  const anchorMeta = {
    declared: statuses.length,
    retrieved: statuses.filter((s: any) => s.retrieved).length,
    cited: statuses.filter((s: any) => s.cited).length,
    statuses,
  };

  // answerStyleGate triggers.
  const asr = drafter.answer_style_report ?? {};
  const triggers: string[] = [];
  for (const [k, v] of Object.entries(asr)) {
    if (typeof v === "boolean" && v) triggers.push(k);
    else if (Array.isArray(v) && v.length > 0) triggers.push(`${k}(${v.length})`);
    else if (typeof v === "number" && v > 0 && !k.endsWith("_ms")) triggers.push(`${k}=${v}`);
  }

  // Unsafe titles = footnote sources whose title matches known unsafe patterns
  const unsafe: string[] = [];
  for (const fn of row.footnotes ?? []) {
    const srcs = fn.sources ?? [{ title: fn.title }];
    for (const s of srcs) {
      const t = s.title ?? "";
      if (/מסמך מאתר|אתר ממשלתי \(gov\.il\)|^\[PDF\]/i.test(t) || t.length < 8) {
        unsafe.push(t);
      }
    }
  }

  return {
    fx,
    run_id: md.run_id,
    ok: drafter.ok === true,
    error: drafter.error,
    answer: row.answer ?? "",
    footnote_count: (row.footnotes ?? []).length,
    footnotes: row.footnotes ?? [],
    sources_retrieved: candidates.length,
    sources_used: drafter.sources_used ?? 0,
    verifier_dist: dist,
    demotions_by_rule: dbr,
    perplexity_hygiene: pxHygiene,
    required_anchors: anchorMeta,
    answer_style_triggers: triggers,
    completeness_initial: drafter.completeness_initial ?? null,
    completeness: drafter.completeness ?? null,
    truncation_retry: drafter.truncation_retry ?? null,
    unsafe_titles: unsafe,
    total_ms: md.total_ms,
    drafter_ms: drafter.ms,
  };
}

(async () => {
  console.log(`Firing ${FIXTURES.length} queries in parallel...`);
  const trigs = await Promise.all(FIXTURES.map(async (fx) => {
    const t = await trigger(fx.question);
    const run_id = t.body?.run_id ?? t.body?.metadata?.run_id;
    console.log(`  ${fx.id}: run_id=${run_id ?? "(none)"} status=${t.status}`);
    return { fx, run_id };
  }));

  console.log("\nPolling qa_logs for each run...");
  const results: Extracted[] = await Promise.all(trigs.map(async ({ fx, run_id }) => {
    if (!run_id) return extract(fx, null, "no run_id from trigger");
    try {
      const row = await pollByRunId(run_id);
      return extract(fx, row, row ? undefined : "poll timeout");
    } catch (e) {
      return extract(fx, null, String(e));
    }
  }));

  // Dump full per-query JSON.
  writeFileSync(
    "/tmp/legal-research-v1-regression-full.json",
    JSON.stringify(results, null, 2),
  );

  // Compact table.
  console.log("\n=========================== COMPACT TABLE ===========================");
  console.log("id | retr | used | dir/par/tan/unr | demotions | pxDrop | anchors d/r/c | style trig | retry | trunc | unsafe | ms");
  for (const r of results) {
    const dist = r.verifier_dist;
    const distStr = `${dist.direct}/${dist.partial}/${dist.tangential}/${dist.unrelated}`;
    const demStr = Object.entries(r.demotions_by_rule)
      .filter(([_, n]) => (n as number) > 0)
      .map(([k, n]) => `${k}:${n}`)
      .join(",") || "-";
    const anch = `${r.required_anchors.declared}/${r.required_anchors.retrieved}/${r.required_anchors.cited}`;
    const retry = r.truncation_retry?.attempted ? (r.truncation_retry.escalated_to_full ? "yes(→full)" : "yes") : "no";
    const trunc = r.completeness?.truncated ? "YES" : "no";
    const styleN = r.answer_style_triggers.length;
    console.log(
      `${r.fx.id} | ${r.sources_retrieved} | ${r.sources_used} | ${distStr} | ${demStr} | ${r.perplexity_hygiene.dropped} | ${anch} | ${styleN} | ${retry} | ${trunc} | ${r.unsafe_titles.length} | ${Math.round((r.total_ms ?? 0) / 1000)}s`,
    );
  }

  // Per-query summary block (answer + footnotes + calibration hint).
  console.log("\n=========================== PER-QUERY BODIES ===========================");
  for (const r of results) {
    console.log(`\n----- ${r.fx.id} (${r.fx.label}) -----`);
    console.log(`Q: ${r.fx.question}`);
    if (!r.ok) {
      console.log(`ERROR: ${r.error}`);
      continue;
    }
    console.log(`ANSWER:\n${r.answer}`);
    console.log(`\nFOOTNOTES (${r.footnote_count}):`);
    for (const fn of r.footnotes) {
      const srcs = fn.sources ?? [{ title: fn.title, url: fn.url, source_type: fn.source_type }];
      console.log(`  FN${fn.number} — ${srcs.length} src(s):`);
      for (const s of srcs) console.log(`    - ${s.title} [${s.source_type}] ${s.url ?? ""}`);
    }
    if (r.answer_style_triggers.length) {
      console.log(`STYLE TRIGGERS: ${r.answer_style_triggers.join(", ")}`);
    }
    if (r.unsafe_titles.length) {
      console.log(`UNSAFE TITLES: ${r.unsafe_titles.join(" | ")}`);
    }
    console.log(`COMPLETENESS_INITIAL: ${JSON.stringify(r.completeness_initial)}`);
    console.log(`COMPLETENESS_FINAL:   ${JSON.stringify(r.completeness)}`);
    console.log(`TRUNCATION_RETRY:     ${JSON.stringify(r.truncation_retry)}`);
  }
})();
