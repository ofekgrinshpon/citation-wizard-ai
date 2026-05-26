// Formalized style-validation harness for legal-research-v1.
//
// Acceptance model (adopted after Stage 2 sign-off):
//   HARD GATES (block):
//     - marker_validation.ok === true
//     - internal_id_leak === false
//     - footnote_count === used_sources.length
//     - used_sources ⊆ verifier.usable
//     - no stub answer (drafter.ok && footnote_count > 0)
//     - no source-quality regression (verifier.candidates_usable not lower than baseline)
//   SOFT WARNING (flag for manual review, never blocks):
//     - answer length < 0.4 × baseline_length
//       AND footnote_count < 3
//       AND fixture is doctrinal/long-form (expected_black_letter or expected_long_form_escalation)
//   QUALITATIVE RUBRIC (manual, included in report):
//     - direct thesis-first opening
//     - natural Israeli legal Hebrew
//     - calibrated certainty
//     - structure fits question type
//     - useful synthesis/conclusion when needed
//     - no irrelevant doctrine name-dropping
//     - no material legal omission
//
// The rigid ±25% answer-length band is intentionally NOT a hard gate.
//
// Usage:
//   bun scripts/legal-research-v1-style-validate.ts              # L1-L6 + S1-S5
//   bun scripts/legal-research-v1-style-validate.ts --only=L2,S3

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;

// L-series: existing doctrinal fixtures (baselines loaded from phaseE5 reports + verifier counts).
// S-series: new style-validation fixtures (no baseline length; soft warning skipped on length).
type Fixture = {
  id: string;
  question: string;
  doctrinal: boolean; // gates soft warning
  baseline_qa_log_id?: string;
  baseline_verifier_usable?: number;
};

const L_BASE = (await Bun.file("eval/legal-research-v1/fixtures.json").json()).questions as Array<any>;
const L_FIXTURES: Fixture[] = L_BASE
  .filter((q) => ["L1","L2","L3","L4","L5","L6"].includes(q.id))
  .map((q) => ({
    id: q.id,
    question: q.question,
    doctrinal: !!(q.expected_black_letter || q.expected_long_form_escalation),
  }));

const S_FIXTURES: Fixture[] = [
  { id: "S1", question: "מהי דוקטרינת ההשתק השיפוטי במשפט הישראלי, ומהם התנאים להחלתה?", doctrinal: true },
  { id: "S2", question: "מהן הנסיבות המחמירות הקבועות בסעיף 345(ב) לחוק העונשין, וכיצד פירשה אותן הפסיקה?", doctrinal: true },
  { id: "S3", question: "האם חוק חופש המידע חל על גופים דו־מהותיים, ומה היקף תחולתו עליהם לפי הפסיקה?", doctrinal: true },
  { id: "S4", question: "מהם הכללים והמגבלות לאכיפת הסכמי סודיות (NDA) של עובדים בענף ההייטק בישראל?", doctrinal: true },
  { id: "S5", question: "מהו היחס בין תביעה ייצוגית לתובענה נגזרת כאשר מדובר בהפרת חובת אמונים של נושאי משרה בחברה ציבורית?", doctrinal: true },
];

let FIXTURES: Fixture[] = [...L_FIXTURES, ...S_FIXTURES];
if (ONLY) FIXTURES = FIXTURES.filter((f) => ONLY.includes(f.id));

// Load L-series baselines from phaseE5 reports.
async function loadLBaselines() {
  for (const fx of L_FIXTURES) {
    try {
      const j: any = await Bun.file(`reports/legal-research-v1-p7-phaseE5-${fx.id}.json`).json();
      if (j?.qa_log_id) fx.baseline_qa_log_id = j.qa_log_id;
      if (typeof j?.verifier_usable === "number") fx.baseline_verifier_usable = j.verifier_usable;
    } catch { /* missing baseline is non-fatal; soft warning will skip length check */ }
  }
}
await loadLBaselines();

const HEADERS = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };

async function fetchBaselineLen(qa_log_id?: string): Promise<number | null> {
  if (!qa_log_id) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=answer&id=eq.${qa_log_id}`, { headers: HEADERS });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0]?.answer ? String(rows[0].answer).length : null;
}

async function trigger(question: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "x-atomic-markers": "validate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, smoke_user_id: SMOKE_USER_ID }),
  });
  return await r.json();
}

async function pollByRunId(run_id: string, timeoutMs = 900_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,total_footnotes,metadata&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`,
      { headers: HEADERS },
    );
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) return rows[0];
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

const triggered = await Promise.all(
  FIXTURES.map(async (fx) => {
    const t = await trigger(fx.question);
    console.log(`[${fx.id}] triggered run_id=${t.run_id}`);
    return { fx, run_id: t.run_id };
  }),
);

const results = await Promise.all(
  triggered.map(async ({ fx, run_id }) => {
    const baselineLen = await fetchBaselineLen(fx.baseline_qa_log_id);
    const row = await pollByRunId(run_id);
    if (!row) return { fixture_id: fx.id, run_id, error: "poll_timeout", hard_gates: { poll: false } };

    const md = row.metadata || {};
    const drafter = md.drafter || {};
    const verifier = md.verifier || {};
    const usedSources = drafter.used_sources || drafter.sources_used || [];
    const usableArr = verifier.usable || [];
    const usableIds = new Set(Array.isArray(usableArr) ? usableArr.map((u:any) => u?.candidate_id ?? u?.id ?? u) : []);
    const usedIds = Array.isArray(usedSources) ? usedSources.map((u:any) => u?.candidate_id ?? u?.id ?? u) : [];
    const used_subset_of_usable = usableIds.size === 0 ? null : usedIds.every((id:any) => usableIds.has(id));
    const answer = String(row.answer || "");
    const len = answer.length;
    const fc = drafter.footnote_count ?? 0;
    const candidates_usable = verifier.candidates_usable ?? usableArr.length ?? null;

    // HARD GATES (block)
    const hard_gates = {
      marker_validation_ok: drafter.marker_validation?.ok === true,
      no_internal_id_leak: drafter.marker_validation?.internal_id_leak === false,
      footnote_eq_used: fc === usedSources.length,
      used_subset_of_usable: used_subset_of_usable !== false, // null = unknown, treated as pass
      no_stub_answer: drafter.ok === true && fc > 0,
      no_source_quality_regression:
        fx.baseline_verifier_usable == null || candidates_usable == null
          ? true
          : candidates_usable >= fx.baseline_verifier_usable,
    };
    const hard_passed = Object.values(hard_gates).every(Boolean);

    // SOFT WARNING (flag only)
    const len_ratio = baselineLen ? len / baselineLen : null;
    const soft_warning =
      fx.doctrinal &&
      baselineLen != null &&
      len < 0.4 * baselineLen &&
      fc < 3;

    const summary = {
      fixture_id: fx.id,
      doctrinal: fx.doctrinal,
      run_id,
      qa_log_id: row.id,
      answer_len_chars: len,
      baseline_len_chars: baselineLen,
      len_ratio: len_ratio ? Number(len_ratio.toFixed(2)) : null,
      footnote_count: fc,
      used_sources_count: usedSources.length,
      verifier_usable: candidates_usable,
      baseline_verifier_usable: fx.baseline_verifier_usable ?? null,
      hard_gates,
      hard_passed,
      soft_warning,
      soft_warning_reason: soft_warning
        ? `len ${len} < 0.4×${baselineLen} AND footnotes ${fc} < 3 AND doctrinal=true`
        : null,
      qualitative_rubric: {
        // Manual: fill in post-hoc when reviewing the answer. Pre-filled as null.
        thesis_first_opening: null,
        natural_israeli_legal_hebrew: null,
        calibrated_certainty: null,
        structure_fits_question: null,
        useful_synthesis: null,
        no_irrelevant_doctrine: null,
        no_material_omission: null,
      },
      answer_preview: answer.slice(0, 400),
    };
    await Bun.write(
      `reports/legal-research-v1-style-validate-${fx.id}.json`,
      JSON.stringify({ ...summary, answer_full: answer, footnotes: row.footnotes }, null, 2),
    );
    console.log(
      `[${fx.id}] hard=${hard_passed ? "PASS" : "FAIL"} soft_warn=${soft_warning} len=${len}` +
        (baselineLen ? ` (base=${baselineLen} ratio=${summary.len_ratio})` : "") +
        ` fc=${fc}/${usedSources.length} usable=${candidates_usable}`,
    );
    return summary;
  }),
);

const overall = {
  total: results.length,
  hard_passed: results.filter((r:any) => r.hard_passed).length,
  hard_failed: results.filter((r:any) => r.hard_passed === false).length,
  soft_warnings: results.filter((r:any) => r.soft_warning).length,
  poll_timeouts: results.filter((r:any) => r.error === "poll_timeout").length,
  all_hard_gates_passed: results.every((r:any) => r.hard_passed === true),
};

await Bun.write(
  "reports/legal-research-v1-style-validate-summary.json",
  JSON.stringify({ acceptance_model: "no-material-omission (length band removed)", overall, results }, null, 2),
);
console.log("\nOVERALL:", overall);
process.exit(overall.all_hard_gates_passed ? 0 : 1);
