// Post-simplification validation runner.
// Confirms the stripped-down citation pipeline (drafter → chronological
// renumber → punctuation normalization → marker validation → placement
// telemetry) holds on L1–L6 + PROT.
//
// Acceptance per fixture:
//   * marker_validation.ok === true
//   * marker_validation.internal_id_leak === false
//   * used_sources ⊆ verifier.usable
//   * footnotes.length === used_sources.length
//   * answer is non-empty and not STUB_ANSWER
//   * citation_cleanup.phase1 is present and phase2 is present
//   * placement carries cluster_count / cluster_run_count / max_cluster_len /
//     end_paragraph_dump_count / final_summary_dump
//   * no `quality_gate` and no `atomic` keys anywhere in metadata.drafter

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const STUB_ANSWER =
  "[stub] התשובה תיווצר בשלב P5. כרגע הצינור מבצע רק ניתוח טענות ותכנון שאילתות מחקר.";

const FIXTURES: Array<{ id: string; question: string }> = [
  { id: "L1", question: "מהי הלכת רים נסראלדין בעניין דיני עבודה?" },
  { id: "L2", question: "מהי דוקטרינת הביצוע בקירוב בדיני חוזים?" },
  { id: "L3", question: "מהם תנאי תקנת השוק לפי חוק המכר?" },
  { id: "L4", question: "מהי חזקת השיתוף בנכסים בין בני זוג?" },
  { id: "L5", question: "מהי עילת אי הסבירות במשפט המינהלי הישראלי?" },
  { id: "L6", question: "מהם יסודות עוולת הרשלנות בדיני הנזיקין הישראליים?" },
  {
    id: "PROT",
    question:
      "האם כישלון מערכתי באכיפת עבירת גביית דמי חסות (פרוטקשן) יכול להוות מחדל חקיקתי בהגנה על הזכות לחיים וביטחון?",
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
  return await r.json();
}

async function pollByRunId(run_id: string, timeoutMs = 540_000) {
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

function summarize(row: any, fx: { id: string }, run_id: string) {
  const md = row?.metadata ?? {};
  const drafter = md.drafter ?? {};
  const verifier = md.verifier ?? {};
  const mv = drafter.marker_validation ?? {};
  const placement = mv.placement ?? {};
  const cc = mv.citation_cleanup ?? {};
  const usedSources = drafter.used_sources ?? [];
  const answer: string = row?.answer ?? drafter.answer_markdown ?? "";
  const footnotes: any[] = row?.footnotes ?? [];

  const verifierUsableIds: string[] = (verifier.usable ?? []).map(
    (u: any) => u.candidate_id ?? u,
  );
  const usedIds: string[] = usedSources
    .map((u: any) => u.candidate_id)
    .filter(Boolean);
  const subset = usedIds.every((id) => verifierUsableIds.includes(id));

  const tokenLeakCount = (answer.match(/\[\[fn:\d+\]\]/g) ?? []).length;
  const isStub = answer === STUB_ANSWER;
  const removedKeysPresent = {
    quality_gate: md.quality_gate !== undefined,
    quality_gate_drafter_initial: md.quality_gate_drafter_initial !== undefined,
    drafter_atomic: drafter.atomic !== undefined,
    mv_occurrence_mode: mv.occurrence_mode !== undefined,
    cc_phase3: cc.phase3 !== undefined,
    any_compound_footnote: footnotes.some((f) => f?.is_compound === true),
  };

  return {
    fixture_id: fx.id,
    run_id,
    qa_log_id: row?.id ?? null,
    total_ms: md.total_ms ?? null,
    acceptance: {
      marker_validation_ok: mv.ok === true,
      internal_id_leak: mv.internal_id_leak === true,
      used_subset_of_usable: subset,
      footnote_eq_used: footnotes.length === usedSources.length,
      answer_non_empty: typeof answer === "string" && answer.length > 0,
      answer_not_stub: !isStub,
      cleanup_phase1_present: !!cc.phase1,
      cleanup_phase1_applied: cc.phase1?.applied === true,
      cleanup_phase2_present: !!cc.phase2,
      placement_telemetry_present:
        placement.cluster_count !== undefined &&
        placement.cluster_run_count !== undefined &&
        placement.max_cluster_len !== undefined &&
        placement.end_paragraph_dump_count !== undefined &&
        placement.final_summary_dump !== undefined,
      no_token_leak: tokenLeakCount === 0,
      no_removed_keys: Object.values(removedKeysPresent).every((v) => !v),
    },
    placement: {
      cluster_count: placement.cluster_count ?? null,
      cluster_run_count: placement.cluster_run_count ?? null,
      max_cluster_len: placement.max_cluster_len ?? null,
      end_paragraph_dump_count: placement.end_paragraph_dump_count ?? null,
      final_summary_dump: placement.final_summary_dump ?? null,
    },
    counts: {
      used_sources: usedSources.length,
      footnotes: footnotes.length,
    },
    removed_keys_present: removedKeysPresent,
    answer_tail: answer.slice(-200),
  };
}

console.log(
  `[cleanup-validation] triggering ${FIXTURES.length} fixtures: ${FIXTURES.map((f) => f.id).join(",")}`,
);

const triggered = await Promise.all(
  FIXTURES.map(async (fx) => {
    try {
      const t = await trigger(fx.question);
      console.log(`[${fx.id}] triggered run_id=${t.run_id}`);
      return { fx, run_id: t.run_id };
    } catch (e) {
      console.error(`[${fx.id}] trigger error`, e);
      return { fx, run_id: null as string | null };
    }
  }),
);

const results = await Promise.all(
  triggered.map(async ({ fx, run_id }) => {
    if (!run_id) return { fixture_id: fx.id, error: "trigger_failed" };
    const row = await pollByRunId(run_id);
    if (!row) return { fixture_id: fx.id, run_id, error: "poll_timeout" };
    const s = summarize(row, fx, run_id);
    await Bun.write(
      `reports/legal-research-v1-cleanup-${fx.id}.json`,
      JSON.stringify(s, null, 2),
    );
    const accept = s.acceptance;
    const allOk =
      accept.marker_validation_ok &&
      !accept.internal_id_leak &&
      accept.used_subset_of_usable &&
      accept.footnote_eq_used &&
      accept.answer_non_empty &&
      accept.answer_not_stub &&
      accept.cleanup_phase1_present &&
      accept.cleanup_phase2_present &&
      accept.placement_telemetry_present &&
      accept.no_token_leak &&
      accept.no_removed_keys;
    console.log(
      `[${fx.id}] all=${allOk} mvOK=${accept.marker_validation_ok} subset=${accept.used_subset_of_usable} fn=${s.counts.footnotes}/${s.counts.used_sources} clusters=${s.placement.cluster_count}/${s.placement.cluster_run_count} maxLen=${s.placement.max_cluster_len} endDump=${s.placement.end_paragraph_dump_count} summaryDump=${s.placement.final_summary_dump} ms=${s.total_ms}`,
    );
    return s;
  }),
);

// Sources-only smoke
console.log("[cleanup-validation] sources_only smoke …");
let sourcesOnlyOk = false;
try {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      question: "מהי דוקטרינת הביצוע בקירוב בדיני חוזים?",
      mode: "sources_only",
      smoke_user_id: SMOKE_USER_ID,
    }),
  });
  const j = await r.json();
  sourcesOnlyOk = !!(j && (j.run_id || j.job_id));
  console.log("[sources_only] ok=", sourcesOnlyOk, "status=", r.status);
} catch (e) {
  console.error("[sources_only] error", e);
}

const ok = results.filter((r: any) => !r.error);
const summary = {
  phase: "cleanup-validation",
  ran: ok.length,
  errors: results.length - ok.length,
  all_acceptance_pass:
    ok.length === FIXTURES.length &&
    ok.every((r: any) => {
      const a = r.acceptance;
      return (
        a.marker_validation_ok &&
        !a.internal_id_leak &&
        a.used_subset_of_usable &&
        a.footnote_eq_used &&
        a.answer_non_empty &&
        a.answer_not_stub &&
        a.cleanup_phase1_present &&
        a.cleanup_phase2_present &&
        a.placement_telemetry_present &&
        a.no_token_leak &&
        a.no_removed_keys
      );
    }),
  sources_only_ok: sourcesOnlyOk,
  fixtures: results,
};
await Bun.write(
  "reports/legal-research-v1-cleanup-summary.json",
  JSON.stringify(summary, null, 2),
);
console.log(
  "\n[cleanup-validation] allPass=",
  summary.all_acceptance_pass,
  "sourcesOnly=",
  summary.sources_only_ok,
);
