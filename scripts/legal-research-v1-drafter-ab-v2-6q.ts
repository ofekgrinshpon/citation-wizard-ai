// Diagnostic-only Draft-only A/B v2 — DRAFTING CASES ONLY.
// One live pipeline run per question; drafterV2 is invoked twice on the
// IDENTICAL input pack (same retrieval/verifier/claims/sufficiency/gates).
// Only the model varies: A = openai/gpt-5-mini (production), B = openai/gpt-5.
// Runs that end in a deterministic refusal / insufficient-source branch are
// flagged as "refusal_draw" and excluded from grading.
// No production defaults are changed.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

type Fx = { id: string; kind: string; question: string; spare?: boolean };

const ALL: Fx[] = [
  { id: "C2", kind: "case_law_synthesis", question: `מה הפסיקה אומרת על הלכת השיתוף?` },
  { id: "P12", kind: "practical_steps (statutory)", question: `בעל דירה מסרב להחזיר לי את הפיקדון בסיום שכירות למרות שהחזרתי את הדירה במצב תקין. מה הדין ומה הצעדים המעשיים?` },
  { id: "P08", kind: "practical_steps (small claims)", question: `מהם השלבים המעשיים להגשת תביעה קטנה בישראל, כולל סכום התביעה המרבי ואגרות?` },
  { id: "P05", kind: "statute_section (§12 good faith)", question: `מהי חובת תום הלב במשא ומתן לפי סעיף 12 לחוק החוזים?` },
  { id: "P14", kind: "case_law_synthesis (veil piercing)", question: `מה הפסיקה אומרת על הרמת מסך ההתאגדות בחברות משפחתיות?` },
  { id: "P01", kind: "specific_case (Ka'adan)", question: `מה נקבע בבג"ץ 6698/95 קעדאן נ' מינהל מקרקעי ישראל?` },
  // spares, used only if P14 / P01 come back as refusal draws
  { id: "S1", kind: "statute quote (spare)", question: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.`, spare: true },
  { id: "S2", kind: "specific_case (spare, Bank Mizrahi)", question: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?`, spare: true },
];

const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const FIXTURES = only.length ? ALL.filter((f) => only.includes(f.id)) : ALL.filter((f) => !f.spare);

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
const latinTokens = (a: string) => [
  ...new Set(
    a.split("\n").filter((l) => !l.startsWith("[^") && !/https?:\/\//.test(l))
      .flatMap((l) => l.match(/[A-Za-z]{2,}/g) ?? []),
  ),
];
const foreignTokens = (a: string) => [...new Set(a.match(/[\u0370-\u03FF\u0400-\u04FF]+/g) ?? [])];

function packOf(md: any) {
  const cands: any[] = md?.candidates ?? [];
  const usable: string[] = md?.verifier?.usable ?? [];
  const byId = new Map(cands.map((c: any) => [c.id ?? c.candidate_id, c]));
  let judgments = 0, statutes = 0, metadataOnly = 0, other = 0;
  for (const id of usable) {
    const c: any = byId.get(id) ?? {};
    const s = String(c.judgment_type ?? c.source_integrity?.authority_type ?? c.source_type ?? c.type ?? "");
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
    deterministic_branch: md?.deterministic_branch ?? null,
    research_mode: md?.research_mode ?? null,
    output_shape: md?.answer_intent?.output_shape ?? null,
  };
}

const REFUSAL_MARKERS = [
  "insufficient_sources_limitation",
  "docket_limitation",
  "statute_section_limitation",
  "framing_correction",
  "canonical_quote",
];

function isRefusalDraw(md: any, answer: string) {
  const br = String(md?.deterministic_branch ?? "");
  if (REFUSAL_MARKERS.some((m) => br.includes(m))) return br;
  if (/\[stub\]/i.test(answer)) return "stub";
  if (md?.sufficiency?.sufficient === false) return "sufficiency_gate";
  return null;
}

const results: any[] = [];
await Promise.all(
  FIXTURES.map(async (fx) => {
    let run_id: string | null = null;
    try {
      const t = await trigger(fx.question);
      run_id = t.run_id ?? null;
      console.log(`[${fx.id}] run_id=${run_id}`);
    } catch (e) {
      results.push({ fixture_id: fx.id, kind: fx.kind, error: "trigger_failed", detail: String(e) });
      return;
    }
    if (!run_id) return void results.push({ fixture_id: fx.id, kind: fx.kind, error: "no_run_id" });
    const row = await pollByRunId(run_id);
    if (!row) return void results.push({ fixture_id: fx.id, kind: fx.kind, run_id, error: "poll_timeout" });

    const md: any = row.metadata ?? {};
    const A: any = md.drafter ?? {};
    const B: any = md.drafter_v2_full_compare ?? null;
    const aAnswer: string = row.answer ?? "";
    const bAnswer: string = B?.answer_markdown ?? "";
    const aFn: any[] = row.footnotes ?? [];
    const bFn: any[] = B?.footnotes ?? [];

    results.push({
      fixture_id: fx.id,
      kind: fx.kind,
      question: fx.question,
      run_id,
      refusal_draw: isRefusalDraw(md, aAnswer),
      source_pack: packOf(md),
      A: {
        model: A.model_final ?? "openai/gpt-5-mini",
        ok: A.ok === true, ms: A.ms ?? null,
        sources_used: A.unique_source_count ?? A.used_sources?.length ?? 0,
        answer_length: aAnswer.length, footnote_count: aFn.length,
        superscripts: supCount(aAnswer),
        latin_tokens: latinTokens(aAnswer), foreign_tokens: foreignTokens(aAnswer),
        answer: aAnswer, footnotes: aFn,
      },
      B: B
        ? {
            model: B.model_final ?? "openai/gpt-5",
            ok: B.ok === true, ms: B.ms ?? null,
            sources_used: B.used_sources?.length ?? 0,
            answer_length: bAnswer.length, footnote_count: bFn.length,
            superscripts: supCount(bAnswer),
            latin_tokens: latinTokens(bAnswer), foreign_tokens: foreignTokens(bAnswer),
            schema_failure_reason: B.schema_failure_reason ?? null,
            error: B.error ?? null,
            answer: bAnswer, footnotes: bFn,
          }
        : { error: "compare_run_missing" },
    });
  }),
);

const outName = process.env.OUT ?? "reports/drafter-ab-v2-6q.json";
await Bun.write(outName, JSON.stringify({ generated_at: new Date().toISOString(), fixtures: results }, null, 2));

for (const r of results) {
  console.log(`\n=== ${r.fixture_id} (${r.kind}) ===`);
  if (r.error) { console.log("ERROR", r.error); continue; }
  console.log("refusal_draw:", r.refusal_draw ?? "no (drafted)");
  console.log("pack:", JSON.stringify(r.source_pack));
  console.log(`A ms=${r.A.ms} len=${r.A.answer_length} fn=${r.A.footnote_count} src=${r.A.sources_used} foreign=${JSON.stringify(r.A.foreign_tokens)}`);
  if (r.B.error) console.log("B ERROR", r.B.error);
  else console.log(`B ms=${r.B.ms} len=${r.B.answer_length} fn=${r.B.footnote_count} src=${r.B.sources_used} foreign=${JSON.stringify(r.B.foreign_tokens)}`);
}
console.log(`\nwrote ${outName}`);
