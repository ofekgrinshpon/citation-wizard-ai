// Phase C.1 per-fixture runner. Usage: bun scripts/legal-research-v1-p7-phaseC1-one.ts L1
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
const TAG = "p7-phaseC1";

const FIXTURES: Record<string, string> = {
  L1: "מהם התנאים למתן צו מניעה זמני?",
  L2: "מהי דוקטרינת ההבטחה המנהלית?",
  L3: "מתי בית המשפט יפחית פיצוי מוסכם לפי סעיף 15 לחוק החוזים תרופות?",
  L4: "מהי דוקטרינת השתק פלוגתא?",
  L5: "מהי עילת הסבירות ומה היקף הביקורת השיפוטית עליה?",
  L6: "רשות מקומית נתנה הבטחה מנהלית לאזרח אשר הסתמך עליה, ולאחר מכן חל שינוי נסיבות מהותי. מהם השיקולים והכללים החלים על אכיפת ההבטחה אל מול שינוי הנסיבות, ומה היחס בין סמכות הרשות, אינטרס ההסתמכות של האזרח, והאינטרס הציבורי?",
};

async function trigger(question: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "x-rule37": "0",
      "x-atomic-markers": "emit",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question, smoke_user_id: SMOKE_USER_ID }),
  });
  const j = await r.json();
  return { status: r.status, ...j };
}

async function pollByRunId(run_id: string, timeoutMs = 480_000): Promise<any | null> {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,metadata&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`;
    const r = await fetch(url, { headers });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) return rows[0];
    }
    await new Promise((res) => setTimeout(res, 4000));
  }
  return null;
}

function countAtomic(a: string) { return (a.match(/\[\[fn:\d+\]\]/g) ?? []).length; }
function countSuper(a: string) { let n = 0; for (const ch of a) if ("⁰¹²³⁴⁵⁶⁷⁸⁹".includes(ch)) n++; return n; }

async function main() {
  const id = process.argv[2];
  const q = FIXTURES[id];
  if (!q) { console.error("Unknown fixture id:", id); process.exit(1); }
  const t = await trigger(q);
  console.log(`triggered ${id} status=${t.status} run_id=${t.run_id}`);
  if (!t.run_id) { console.error("no run_id:", t); process.exit(2); }
  const row = await pollByRunId(t.run_id);
  if (!row) { console.error(`TIMEOUT ${id}`); process.exit(3); }
  const md = row.metadata ?? {};
  const d = md.drafter ?? {};
  const mv = d.marker_validation ?? {};
  const v = md.verifier ?? {};
  const a = d.atomic ?? null;
  const r37 = d.rule37 ?? null;
  const usableIds = new Set((v.usable ?? []).map((u: any) => u.candidate_id));
  const used = d.used_sources ?? [];
  const finalAnswer = row.answer ?? "";
  const row_summary = {
    fixture_id: id,
    marker_validation_ok: !!mv.ok,
    internal_id_leak: !!mv.internal_id_leak,
    used_sources_count: used.length,
    used_sources_subset_of_usable: used.every((u: any) => usableIds.has(u.candidate_id)),
    marker_format: d.marker_format ?? null,
    atomic_mode: a?.mode ?? null,
    atomic_normalize_ok: a?.normalize_ok ?? null,
    atomic_normalize_reason: a?.normalize_reason ?? null,
    atomic_validation_ok: a?.validation?.ok ?? null,
    atomic_validation_error: a?.validation?.error ?? null,
    atomic_used_sources_byte_equal: a?.used_sources_byte_equal ?? null,
    atomic_superscript_count: a?.superscript_marker_count ?? null,
    atomic_token_count: a?.atomic_marker_count ?? null,
    atomic_emit_fallback_reason: a?.emit_fallback_reason ?? null,
    final_answer_atomic_token_count: countAtomic(finalAnswer),
    final_answer_superscript_count: countSuper(finalAnswer),
    rule37_enabled: r37?.enabled ?? null,
    rule37_applied: r37?.applied ?? null,
    rule37_discarded_reason: r37?.discarded_reason ?? null,
  };
  console.log(JSON.stringify(row_summary, null, 2));
  await Bun.write(
    `reports/legal-research-v1-${TAG}-${id}.json`,
    JSON.stringify({
      generated_at: new Date().toISOString(),
      fixture: { id, question: q },
      qa_log_id: row.id,
      run_id: t.run_id,
      row_summary,
      atomic: a,
      rule37: r37,
      answer_preview: finalAnswer.slice(0, 600),
      marker_format: d.marker_format ?? null,
    }, null, 2),
  );
  console.log(`wrote reports/legal-research-v1-${TAG}-${id}.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
