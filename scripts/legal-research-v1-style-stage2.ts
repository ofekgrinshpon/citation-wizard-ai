// Style validation Stage 2: 5 new style questions against current drafter prompt.
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

const FIXTURES = [
  { id: "S1", label: "השתק שיפוטי", question: "מהי דוקטרינת ההשתק השיפוטי במשפט הישראלי, ומהם התנאים להחלתה?" },
  { id: "S2", label: "נסיבות מחמירות 345(ב)", question: "מהן הנסיבות המחמירות הקבועות בסעיף 345(ב) לחוק העונשין, וכיצד פירשה אותן הפסיקה?" },
  { id: "S3", label: "חופש מידע גופים דו־מהותיים", question: "האם חוק חופש המידע חל על גופים דו־מהותיים, ומה היקף תחולתו עליהם לפי הפסיקה?" },
  { id: "S4", label: "NDA בהייטק", question: "מהם הכללים והמגבלות לאכיפת הסכמי סודיות (NDA) של עובדים בענף ההייטק בישראל?" },
  { id: "S5", label: "ייצוגית מול נגזרת בהפרת חובת אמונים", question: "מהו היחס בין תביעה ייצוגית לתובענה נגזרת כאשר מדובר בהפרת חובת אמונים של נושאי משרה בחברה ציבורית?" },
];

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
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,total_footnotes,metadata&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`,
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

const triggered = await Promise.all(
  FIXTURES.map(async (fx) => {
    const t = await trigger(fx.question);
    console.log(`[${fx.id}] triggered run_id=${t.run_id}`);
    return { fx, run_id: t.run_id };
  }),
);

const results = await Promise.all(
  triggered.map(async ({ fx, run_id }) => {
    const row = await pollByRunId(run_id);
    if (!row) {
      console.error(`[${fx.id}] poll timeout`);
      return { fixture_id: fx.id, label: fx.label, run_id, error: "poll_timeout" };
    }
    const md = row.metadata || {};
    const drafter = md.drafter || {};
    const verifier = md.verifier || {};
    const usedSources = drafter.used_sources || drafter.sources_used || [];
    const usableArr = verifier.usable || [];
    const usableIds = new Set(Array.isArray(usableArr) ? usableArr.map((u:any) => u?.candidate_id ?? u?.id ?? u) : []);
    const usedIds = Array.isArray(usedSources) ? usedSources.map((u:any) => u?.candidate_id ?? u?.id ?? u) : [];
    const used_subset_of_usable = usableIds.size === 0 ? null : usedIds.every((id:any) => usableIds.has(id));
    const answer = row.answer || "";
    const len = String(answer).length;

    const summary = {
      fixture_id: fx.id,
      label: fx.label,
      question: fx.question,
      run_id,
      qa_log_id: row.id,
      total_ms: md.total_ms,
      stage_ms: md.stage_ms || md.stage_runs || null,
      marker_validation_ok: drafter.marker_validation?.ok,
      internal_id_leak: drafter.marker_validation?.internal_id_leak,
      footnote_count: drafter.footnote_count,
      used_sources_count: usedSources.length,
      footnote_eq_used: drafter.footnote_count === usedSources.length,
      used_subset_of_usable,
      drafter_ok: drafter.ok,
      stub_answer: !drafter.ok || drafter.footnote_count === 0,
      verifier_usable: verifier.candidates_usable ?? usableArr.length ?? null,
      answer_len_chars: len,
      soft_warning: len < 0.4 * 3500 && (drafter.footnote_count ?? 0) < 3,
    };
    await Bun.write(
      `reports/legal-research-v1-style-stage2-${fx.id}.json`,
      JSON.stringify({ ...summary, answer_full: answer, footnotes: row.footnotes }, null, 2),
    );
    console.log(`[${fx.id}] markerOK=${summary.marker_validation_ok} leak=${summary.internal_id_leak} fc=${summary.footnote_count}/${summary.used_sources_count} sub=${summary.used_subset_of_usable} stub=${summary.stub_answer} len=${len}`);
    return summary;
  }),
);

await Bun.write("reports/legal-research-v1-style-stage2-summary.json", JSON.stringify({ results }, null, 2));
console.log("done");
