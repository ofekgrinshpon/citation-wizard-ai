// Diagnostic-only 4-question drafter A/B pilot: gpt-5-mini (A, production) vs
// gpt-5 (B). Single live pipeline run per question; drafterV2 is invoked twice
// on the IDENTICAL input pack (same retrieval, verifier verdicts, claims,
// sufficiency, source-integrity, snippets). Only the model varies.
// No production defaults are changed.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

type Fx = { id: string; kind: string; question: string };

const FIXTURES: Fx[] = [
  {
    id: "P10",
    kind: "inheritance_mutual_wills (statute-based accuracy)",
    question:
      "מה הדין ביחס לצוואות הדדיות וביטולן לאחר פטירת אחד מבני הזוג לפי סעיף 8א לחוק הירושה?",
  },
  {
    id: "C2",
    kind: "case_law_synthesis (rendering)",
    question: "מה הפסיקה אומרת על הלכת השיתוף?",
  },
  {
    id: "P14",
    kind: "case_law_synthesis (doctrine)",
    question: "מה הפסיקה אומרת על הרמת מסך ההתאגדות בחברות משפחתיות?",
  },
  {
    id: "P12",
    kind: "practical_steps (statutory practical answer)",
    question:
      "בעל דירה מסרב להחזיר לי את הפיקדון בסיום שכירות למרות שהחזרתי את הדירה במצב תקין. מה הדין ומה הצעדים המעשיים?",
  },
];

async function trigger(question: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "x-drafter-v2-compare-models": "full",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, smoke_user_id: SMOKE_USER_ID }),
  });
  return await r.json();
}

async function pollByRunId(run_id: string, timeoutMs = 1_200_000) {
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

const SUP_RUN_RE = /[\u2070-\u209F\u00B2\u00B3\u00B9]+/gu;
const supCount = (s: string) => (s.match(SUP_RUN_RE) ?? []).length;

function latinArtifacts(answer: string): string[] {
  const out = new Set<string>();
  for (const line of answer.split("\n")) {
    if (line.startsWith("[^") || /https?:\/\//.test(line)) continue;
    for (const t of line.match(/[A-Za-z]{2,}/g) ?? []) out.add(t);
  }
  return [...out];
}
function nonHebrewForeign(answer: string): string[] {
  // Greek/Cyrillic stray tokens (Hebrew output hygiene probe)
  return [...new Set(answer.match(/[\u0370-\u03FF\u0400-\u04FF]+/g) ?? [])];
}
function bucketsOf(qw: any): Record<string, number> {
  const o: Record<string, number> = {};
  for (const h of qw?.hits ?? []) o[h.bucket] = (o[h.bucket] ?? 0) + 1;
  return o;
}

function sourcePackDiagnosis(md: any) {
  const cands: any[] = md?.candidates ?? [];
  const usable: string[] = md?.verifier?.usable ?? [];
  const byId = new Map(cands.map((c: any) => [c.id ?? c.candidate_id, c]));
  let judgments = 0, statutes = 0, metadataOnly = 0, other = 0;
  for (const id of usable) {
    const c: any = byId.get(id) ?? {};
    const t =
      c.judgment_type ?? c.source_integrity?.authority_type ?? c.source_type ?? c.type ?? "";
    const s = String(t);
    if (/metadata/i.test(s)) metadataOnly++;
    else if (/judg|psika|case|ruling/i.test(s)) judgments++;
    else if (/statute|law|regulation|chok|takanot/i.test(s)) statutes++;
    else other++;
  }
  return {
    usable_count: usable.length,
    candidates_count: cands.length,
    usable_judgments: judgments,
    usable_statutes_regulations: statutes,
    metadata_only: metadataOnly,
    other,
    sufficiency: md?.sufficiency ?? null,
    source_integrity_counts: md?.source_integrity_counts ?? null,
    synthesis_partition: md?.synthesis_rendering?.partition ?? null,
    deterministic_branch: md?.deterministic_branch ?? null,
    research_mode: md?.research_mode ?? null,
    output_shape: md?.answer_intent?.output_shape ?? null,
  };
}

const results = await Promise.all(
  FIXTURES.map(async (fx) => {
    let run_id: string | null = null;
    try {
      const t = await trigger(fx.question);
      run_id = t.run_id ?? null;
      console.log(`[${fx.id}] run_id=${run_id}`);
    } catch (e) {
      console.error(`[${fx.id}] trigger error`, e);
      return { fixture_id: fx.id, kind: fx.kind, question: fx.question, error: "trigger_failed" };
    }
    if (!run_id) {
      return { fixture_id: fx.id, kind: fx.kind, question: fx.question, error: "no_run_id" };
    }
    const row = await pollByRunId(run_id);
    if (!row) {
      return { fixture_id: fx.id, kind: fx.kind, question: fx.question, run_id, error: "poll_timeout" };
    }
    const md: any = row.metadata ?? {};
    const A: any = md.drafter ?? {};
    const B: any = md.drafter_v2_full_compare ?? null;
    const aAnswer: string = row.answer ?? "";
    const bAnswer: string = B?.answer_markdown ?? "";
    const aFn: any[] = row.footnotes ?? [];
    const bFn: any[] = B?.footnotes ?? [];

    return {
      fixture_id: fx.id,
      kind: fx.kind,
      question: fx.question,
      run_id,
      source_pack: sourcePackDiagnosis(md),
      A: {
        model: A.model_final ?? "openai/gpt-5-mini",
        ok: A.ok === true,
        ms: A.ms ?? null,
        sources_used: A.unique_source_count ?? A.used_sources?.length ?? 0,
        answer_length: aAnswer.length,
        footnote_count: aFn.length,
        superscripts: supCount(aAnswer),
        quality_warning_buckets: bucketsOf(A.quality_warning),
        latin_tokens: latinArtifacts(aAnswer),
        foreign_tokens: nonHebrewForeign(aAnswer),
        answer: aAnswer,
        footnotes: aFn,
      },
      B: B
        ? {
            model: B.model_final ?? "openai/gpt-5",
            ok: B.ok === true,
            ms: B.ms ?? null,
            sources_used: B.used_sources?.length ?? 0,
            answer_length: bAnswer.length,
            footnote_count: bFn.length,
            superscripts: supCount(bAnswer),
            quality_warning_buckets: bucketsOf(B.quality_warning),
            latin_tokens: latinArtifacts(bAnswer),
            foreign_tokens: nonHebrewForeign(bAnswer),
            schema_failure_reason: B.schema_failure_reason ?? null,
            error: B.error ?? null,
            answer: bAnswer,
            footnotes: bFn,
          }
        : { error: "compare_run_missing" },
    };
  }),
);

await Bun.write(
  "reports/drafter-ab-pilot-4q.json",
  JSON.stringify({ generated_at: new Date().toISOString(), fixtures: results }, null, 2),
);

for (const r of results as any[]) {
  console.log(`\n=== ${r.fixture_id} (${r.kind}) ===`);
  if (r.error) { console.log("ERROR", r.error); continue; }
  console.log("pack:", JSON.stringify(r.source_pack));
  console.log(`A ms=${r.A.ms} len=${r.A.answer_length} fn=${r.A.footnote_count} latin=${r.A.latin_tokens.length} foreign=${JSON.stringify(r.A.foreign_tokens)}`);
  console.log(`B ms=${r.B.ms} len=${r.B.answer_length} fn=${r.B.footnote_count} latin=${(r.B.latin_tokens ?? []).length} foreign=${JSON.stringify(r.B.foreign_tokens ?? [])} err=${r.B.error ?? "-"}`);
}
console.log("\n[done] reports/drafter-ab-pilot-4q.json");
