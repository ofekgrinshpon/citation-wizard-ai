// V2.1 harness runner.
// Triggers legal-research-v1 with `x-drafter-mode: v2_compare` so the edge
// function runs BOTH the baseline drafter and the V2 structured drafter
// against the SAME retrieval + verifier output. Then compares them.
//
// Targets: L1–L6 + PROT + 20 real qa_logs questions.
// Output: reports/legal-research-v1-v2-harness-*.json + summary.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const STUB_ANSWER =
  "[stub] התשובה תיווצר בשלב P5. כרגע הצינור מבצע רק ניתוח טענות ותכנון שאילתות מחקר.";

type Fixture = { id: string; question: string; source: "fixture" | "real" };

const FIXTURES: Fixture[] = [
  { id: "L1", question: "מהי הלכת רים נסראלדין בעניין דיני עבודה?", source: "fixture" },
  { id: "L2", question: "מהי דוקטרינת הביצוע בקירוב בדיני חוזים?", source: "fixture" },
  { id: "L3", question: "מהם תנאי תקנת השוק לפי חוק המכר?", source: "fixture" },
  { id: "L4", question: "מהי חזקת השיתוף בנכסים בין בני זוג?", source: "fixture" },
  { id: "L5", question: "מהי עילת אי הסבירות במשפט המינהלי הישראלי?", source: "fixture" },
  { id: "L6", question: "מהם יסודות עוולת הרשלנות בדיני הנזיקין הישראליים?", source: "fixture" },
  {
    id: "PROT",
    source: "fixture",
    question:
      "האם כישלון מערכתי באכיפת עבירת גביית דמי חסות (פרוטקשן) יכול להוות מחדל חקיקתי בהגנה על הזכות לחיים וביטחון?",
  },
  // 20 real qa_logs questions (deduplicated).
  { id: "R01", source: "real", question: "מתי בית המשפט יפחית פיצוי מוסכם לפי סעיף 15 לחוק החוזים תרופות?" },
  { id: "R02", source: "real", question: "מהם התנאים למתן צו מניעה זמני?" },
  { id: "R03", source: "real", question: "מהי פסקת ההגבלה בחוק יסוד: כבוד האדם וחירותו ומה הם ארבעת תנאיה?" },
  { id: "R04", source: "real", question: "מהו היחס בין עוולת הרשלנות לעוולת הפרת חובה חקוקה כאשר אותו מעשה נטען כעולה כדי שתי העוולות?" },
  { id: "R05", source: "real", question: "מהם תנאי החלת השתק פלוגתא בין הליכים אזרחיים לפליליים, וכיצד מתייחסת הפסיקה לנטל ההוכחה השונה?" },
  { id: "R06", source: "real", question: "מהי דוקטרינת הצפיות בדיני חוזים — הגדרה, יסודות, יישום וסייגים — לפי הפסיקה הישראלית המנחה?" },
  { id: "R07", source: "real", question: "מהי דוקטרינת ההבטחה המנהלית?" },
  { id: "R08", source: "real", question: "מהי הלכת אפרופים בפרשנות חוזים, וכיצד יושמה הלכה זו בפסיקה מאוחרת יותר?" },
  { id: "R09", source: "real", question: "נניח שרשות מקומית נתנה ליזם התחייבות כתובה לקדם תב\"ע מסוימת ואף אפשרה לו להשקיע כספים בהסתמך על אותה התחייבות, אך לאחר חילופי הנהלה הרשות חזרה בה בטענה שההתחייבות ניתנה בחוסר סמכות ושקיים אינטרס ציבורי לשנות את המדיניות. מהם התנאים לאכיפת הבטחה מנהלית במקרה כזה, ומה משקלם של הסתמכות, סמכות, ושינוי נסיבות?" },
  { id: "R10", source: "real", question: "מהי דוקטרינת תום הלב בקיום חוזה לפי סעיף 39 לחוק החוזים?" },
  { id: "R11", source: "real", question: "מהם יסודות עוולת הגזל לפי פקודת הנזיקין?" },
  { id: "R12", source: "real", question: "מהי הדוקטרינה של מעשה בית דין במשפט האזרחי הישראלי?" },
  { id: "R13", source: "real", question: "מהן עילות הביטול של פסק בוררות לפי חוק הבוררות?" },
  { id: "R14", source: "real", question: "מהם תנאי הפעלת סמכות מעצר עד תום ההליכים בעבירות חמורות?" },
  { id: "R15", source: "real", question: "מהי הגנת ההסתמכות בדין המינהלי הישראלי?" },
  { id: "R16", source: "real", question: "מהם הכללים החלים על גילוי מסמכים בהליך אזרחי לפי תקנות סדר הדין האזרחי?" },
  { id: "R17", source: "real", question: "מהי דוקטרינת הצדק החלוקתי בפסיקת בית המשפט העליון?" },
  { id: "R18", source: "real", question: "מהם יסודות עוולת התרמית בדיני הנזיקין?" },
  { id: "R19", source: "real", question: "מהן הסנקציות האפשריות על הפרת חוק הגבלים עסקיים?" },
  { id: "R20", source: "real", question: "מהי דוקטרינת הוויתור על זכות חוקתית?" },
];

async function trigger(question: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "x-drafter-mode": "v2_compare",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, smoke_user_id: SMOKE_USER_ID }),
  });
  return await r.json();
}

async function pollByRunId(run_id: string, timeoutMs = 600_000) {
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

const SUPERSCRIPT_RE = /[\u00B2\u00B3\u00B9\u2070-\u209F]/u;
const ADJ_RE = /[\u2070-\u209F\u00B2\u00B3\u00B9]{2,}/gu;

function countSuperscripts(s: string) {
  return (s.match(/[\u00B2\u00B3\u00B9\u2070-\u209F]/gu) ?? []).length;
}

function paragraphCount(s: string) {
  return s.split(/\n\s*\n+/).filter((p) => p.trim().length > 0).length;
}

function headingCount(s: string) {
  return s.split("\n").filter((l) => /^\*\*[^*]+\*\*$/.test(l.trim())).length;
}

function summarize(row: any, fx: Fixture, run_id: string) {
  const md = row?.metadata ?? {};
  const drafter = md.drafter ?? {};
  const drafterV2 = md.drafter_v2 ?? null;
  const verifier = md.verifier ?? {};
  const verifierUsableIds = new Set<string>(
    (verifier.usable ?? []).map((u: any) => u.candidate_id ?? u),
  );

  // Baseline metrics
  const baselineAnswer: string = row?.answer ?? drafter.answer_markdown ?? "";
  const baselineFn: any[] = row?.footnotes ?? [];
  const baselineUsed: any[] = drafter.used_sources ?? [];
  const baselineUsedIds = baselineUsed.map((u: any) => u.candidate_id).filter(Boolean);
  const baselineSubset = baselineUsedIds.every((id: string) => verifierUsableIds.has(id));
  const baselineMV = drafter.marker_validation ?? {};

  // V2 metrics
  const v2Answer: string = drafterV2?.answer_markdown ?? "";
  const v2Used: any[] = drafterV2?.used_sources ?? [];
  const v2UsedIds = v2Used.map((u: any) => u.candidate_id).filter(Boolean);
  const v2Subset = v2UsedIds.every((id: string) => verifierUsableIds.has(id));
  const v2Sv = drafterV2?.structured_validation ?? null;
  const v2Br = drafterV2?.builder_report ?? null;
  const v2Footnotes: any[] = drafterV2?.footnotes ?? [];

  const v2SupCount = countSuperscripts(v2Answer);
  const v2AdjCount = (v2Answer.match(ADJ_RE) ?? []).length;
  // count superscripts inside source text of structured draft? We only see final answer.
  // No way to inspect segments here; rely on builder_report.adjacent_marker_count.

  return {
    fixture_id: fx.id,
    source: fx.source,
    run_id,
    total_ms: md.total_ms ?? null,
    verifier_usable_count: verifierUsableIds.size,

    baseline: {
      ok: drafter.ok === true,
      marker_ok: baselineMV.ok === true,
      internal_id_leak: baselineMV.internal_id_leak === true,
      used_count: baselineUsed.length,
      footnote_count: baselineFn.length,
      used_subset_of_usable: baselineSubset,
      source_coverage:
        verifierUsableIds.size > 0
          ? baselineUsedIds.filter((id: string) => verifierUsableIds.has(id)).length /
            verifierUsableIds.size
          : 0,
      paragraph_count: paragraphCount(baselineAnswer),
      heading_count: headingCount(baselineAnswer),
      prose_length: baselineAnswer.length,
      superscript_count: countSuperscripts(baselineAnswer),
      adjacent_runs: (baselineAnswer.match(ADJ_RE) ?? []).length,
      ms: drafter.ms ?? null,
      escalated: drafter.escalated === true,
      is_stub: baselineAnswer === STUB_ANSWER,
    },

    v2: drafterV2
      ? {
          ok: drafterV2.ok === true,
          schema_failure_reason: drafterV2.schema_failure_reason ?? null,
          escalated: drafterV2.escalated === true,
          ms: drafterV2.ms ?? null,
          used_count: v2Used.length,
          footnote_count: v2Footnotes.length,
          used_subset_of_usable: v2Subset,
          source_coverage:
            verifierUsableIds.size > 0
              ? v2UsedIds.filter((id: string) => verifierUsableIds.has(id)).length /
                verifierUsableIds.size
              : 0,
          paragraph_count: paragraphCount(v2Answer),
          heading_count: headingCount(v2Answer),
          prose_length: v2Answer.length,
          superscript_count_in_answer: v2SupCount,
          adjacent_runs_in_answer: v2AdjCount,
          builder_adjacent_marker_count: v2Br?.adjacent_marker_count ?? null,
          cited_segment_count: v2Sv?.cited_segment_count ?? null,
          total_source_ref_count: v2Sv?.total_source_ref_count ?? null,
          compound_segment_count: v2Br?.compound_segment_count ?? null,
          compound_footnote_count: v2Br?.compound_footnote_count ?? null,
          avg_sources_per_cited_segment: v2Br?.avg_sources_per_cited_segment ?? null,
          unknown_source_refs: v2Sv?.unknown_source_refs ?? [],
          forbidden_text_hits: v2Sv?.forbidden_text_hits ?? [],
          structured_errors: (v2Sv?.errors ?? []).slice(0, 8),
          answer_tail: v2Answer.slice(-240),
        }
      : null,

    diff: drafterV2 && drafterV2.ok
      ? {
          source_coverage_delta:
            (v2UsedIds.filter((id: string) => verifierUsableIds.has(id)).length -
              baselineUsedIds.filter((id: string) => verifierUsableIds.has(id)).length) /
            Math.max(1, verifierUsableIds.size),
          prose_length_delta: v2Answer.length - baselineAnswer.length,
          paragraph_count_delta: paragraphCount(v2Answer) - paragraphCount(baselineAnswer),
        }
      : null,
  };
}

const args = process.argv.slice(2);
const onlyIds = args.length ? new Set(args) : null;
const TARGETS = onlyIds ? FIXTURES.filter((f) => onlyIds.has(f.id)) : FIXTURES;

console.log(
  `[v2-harness] triggering ${TARGETS.length} fixtures: ${TARGETS.map((f) => f.id).join(",")}`,
);

const CONCURRENCY = 6;
const triggered: Array<{ fx: Fixture; run_id: string | null }> = [];
for (let i = 0; i < TARGETS.length; i += CONCURRENCY) {
  const batch = TARGETS.slice(i, i + CONCURRENCY);
  const out = await Promise.all(
    batch.map(async (fx) => {
      try {
        const t = await trigger(fx.question);
        console.log(`[${fx.id}] triggered run_id=${t.run_id}`);
        return { fx, run_id: t.run_id ?? null };
      } catch (e) {
        console.error(`[${fx.id}] trigger error`, e);
        return { fx, run_id: null };
      }
    }),
  );
  triggered.push(...out);
  // small stagger to avoid rate-limit cliffs
  if (i + CONCURRENCY < TARGETS.length) {
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const results = await Promise.all(
  triggered.map(async ({ fx, run_id }) => {
    if (!run_id) return { fixture_id: fx.id, error: "trigger_failed" };
    const row = await pollByRunId(run_id);
    if (!row) return { fixture_id: fx.id, run_id, error: "poll_timeout" };
    const s = summarize(row, fx, run_id);
    await Bun.write(
      `reports/legal-research-v1-v2-harness-${fx.id}.json`,
      JSON.stringify(s, null, 2),
    );
    const b = s.baseline;
    const v = s.v2;
    console.log(
      `[${fx.id}] base ok=${b.ok} fn=${b.footnote_count}/${b.used_count} cov=${b.source_coverage.toFixed(2)} | v2 ok=${v?.ok} fn=${v?.footnote_count}/${v?.used_count} cov=${v?.source_coverage?.toFixed(2)} sup_in_text=${v?.superscript_count_in_answer} adj_builder=${v?.builder_adjacent_marker_count} fail=${v?.schema_failure_reason ?? "-"}`,
    );
    return s;
  }),
);

// Aggregate.
const ok = results.filter((r: any) => !r.error);
const v2Ok = ok.filter((r: any) => r.v2?.ok);
const v2Fail = ok.filter((r: any) => r.v2 && !r.v2.ok);
const baselineOk = ok.filter((r: any) => r.baseline?.ok);

const avg = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

const summary = {
  phase: "v2-harness",
  fixtures_total: TARGETS.length,
  fixtures_completed: ok.length,
  errors: results.length - ok.length,

  baseline_ok_count: baselineOk.length,
  v2_ok_count: v2Ok.length,
  v2_failure_count: v2Fail.length,

  v2_failure_breakdown: v2Fail.reduce((acc: Record<string, number>, r: any) => {
    const k = r.v2.schema_failure_reason ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {}),

  // Core acceptance invariants (V2 only)
  v2_zero_superscripts_in_text: v2Ok.every((r: any) => {
    // We do not have segment.text directly; check forbidden_text_hits = 0
    return (r.v2.forbidden_text_hits ?? []).length === 0;
  }),
  v2_zero_adjacent_markers: v2Ok.every(
    (r: any) => (r.v2.builder_adjacent_marker_count ?? 0) === 0,
  ),
  v2_all_used_subset_of_usable: v2Ok.every((r: any) => r.v2.used_subset_of_usable === true),
  v2_unknown_source_refs_total: v2Ok.reduce(
    (s: number, r: any) => s + (r.v2.unknown_source_refs?.length ?? 0),
    0,
  ),

  // Comparative metrics
  baseline_avg_source_coverage: avg(baselineOk.map((r: any) => r.baseline.source_coverage)),
  v2_avg_source_coverage: avg(v2Ok.map((r: any) => r.v2.source_coverage)),
  baseline_avg_prose_length: avg(baselineOk.map((r: any) => r.baseline.prose_length)),
  v2_avg_prose_length: avg(v2Ok.map((r: any) => r.v2.prose_length)),
  baseline_avg_paragraphs: avg(baselineOk.map((r: any) => r.baseline.paragraph_count)),
  v2_avg_paragraphs: avg(v2Ok.map((r: any) => r.v2.paragraph_count)),
  v2_avg_sources_per_cited_segment: avg(
    v2Ok.map((r: any) => r.v2.avg_sources_per_cited_segment ?? 0),
  ),
  v2_compound_footnote_total: v2Ok.reduce(
    (s: number, r: any) => s + (r.v2.compound_footnote_count ?? 0),
    0,
  ),
  v2_over_citation_cases: v2Ok.filter((r: any) => (r.v2.avg_sources_per_cited_segment ?? 0) > 2)
    .map((r: any) => r.fixture_id),

  baseline_avg_ms: avg(baselineOk.map((r: any) => r.baseline.ms ?? 0)),
  v2_avg_ms: avg(v2Ok.map((r: any) => r.v2.ms ?? 0)),

  fixtures: results,
};

await Bun.write(
  "reports/legal-research-v1-v2-harness-summary.json",
  JSON.stringify(summary, null, 2),
);

console.log(
  `\n[v2-harness] DONE. baseline_ok=${summary.baseline_ok_count} v2_ok=${summary.v2_ok_count} v2_fail=${summary.v2_failure_count}`,
);
console.log(
  `[v2-harness] v2_zero_sup_in_text=${summary.v2_zero_superscripts_in_text} v2_zero_adj=${summary.v2_zero_adjacent_markers} v2_all_subset=${summary.v2_all_used_subset_of_usable}`,
);
console.log(
  `[v2-harness] cov base=${summary.baseline_avg_source_coverage.toFixed(2)} v2=${summary.v2_avg_source_coverage.toFixed(2)} | prose base=${summary.baseline_avg_prose_length.toFixed(0)} v2=${summary.v2_avg_prose_length.toFixed(0)} | ms base=${summary.baseline_avg_ms.toFixed(0)} v2=${summary.v2_avg_ms.toFixed(0)}`,
);
