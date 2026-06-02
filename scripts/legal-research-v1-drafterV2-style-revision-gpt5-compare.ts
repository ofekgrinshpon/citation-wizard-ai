// Forced-GPT-5 comparison against the same revised SYSTEM_PROMPT_V2 and the
// same 6 fixtures. Uses the x-drafter-v2-compare-models: full header, which
// re-runs drafterV2 against the EXACT same upstream pack (claims, candidates,
// verifier verdicts, userDocs) — so source admission is frozen by construction.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

type Fx = { id: string; question: string; tag: string };
const FIXTURES: Fx[] = [
  { id: "F1-national-identity", tag: "theoretical/comparative", question: "כיצד זהות לאומית יכולה להיות אובייקט לקודיפיקציה? מבט השוואתי על קודיפיקציה של זהות במדינות דמוקרטיות" },
  { id: "F2-admin-promise",     tag: "doctrinal/admin",         question: "מהי דוקטרינת ההבטחה המנהלית ומהם תנאי האכיפה שלה?" },
  { id: "F3-reasonableness",    tag: "constitutional/admin",    question: "מהי עילת הסבירות ומה היקף הביקורת השיפוטית עליה?" },
  { id: "F4-admin-longform",    tag: "long-form admin",         question: "נניח שרשות מקומית נתנה ליזם התחייבות כתובה לקדם תב\"ע מסוימת ואף אפשרה לו להשקיע כספים בהסתמך על אותה התחייבות, אך לאחר חילופי הנהלה הרשות חזרה בה בטענה שההתחייבות ניתנה בחוסר סמכות ושקיים אינטרס ציבורי לשנות את המדיניות. מהם התנאים לאכיפת הבטחה מנהלית במקרה כזה, ומה משקלם של הסתמכות, סמכות, ושינוי נסיבות?" },
  { id: "F5-procedural",        tag: "procedural",              question: "מהם התנאים למתן צו מניעה זמני?" },
  { id: "F6-comparative",       tag: "comparative/theoretical", question: "השוו בין דוקטרינת הסבירות הישראלית לבין מבחני ה-Wednesbury האנגליים ועקרון ה-proportionality הגרמני. אילו הבדלים מבניים יש בין הדוקטרינות, וכיצד הם משפיעים על היקף הביקורת השיפוטית?" },
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
    await new Promise((res) => setTimeout(res, 6000));
  }
  return null;
}

const SUP_RUN_RE = /[\u2070-\u209F\u00B2\u00B3\u00B9]+/gu;
function adjRuns(s: string): number {
  let prev = -1, c = 0;
  for (const m of s.matchAll(SUP_RUN_RE)) {
    const i = m.index ?? 0;
    if (prev >= 0 && /^\s*$/.test(s.slice(prev, i))) c++;
    prev = i + m[0].length;
  }
  return c;
}

// User-named artifacts that must be checked specifically.
const NAMED_ARTIFACTS = [
  "כפופונקציה", "כפו פונקציה",
  "סתמכות",            // missing ה
  "מעקרתיות",
  "סאנטנס",
  "דפרנציה",           // overuse signal — count occurrences, not boolean
];
function scanArtifacts(s: string) {
  const hits: Record<string, number> = {};
  for (const t of NAMED_ARTIFACTS) {
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    const m = s.match(re);
    if (m && m.length) hits[t] = m.length;
  }
  return hits;
}

function countConcreteAnchors(s: string) {
  const sec = (s.match(/סעיף\s*\d+[א-ת]?/g) ?? []).length;
  const rulings = (s.match(/(?:בג"ץ|בג״ץ|ע"א|ע״א|דנ"א|דנ״א|ע"פ|ע״פ|רע"א|רע״א|בש"א|בש״א)\s*\d+\/\d+/g) ?? []).length;
  const statuteWord = (s.match(/חוק[־ -][א-ת]/g) ?? []).length;
  return { section_refs: sec, ruling_refs: rulings, statute_mentions: statuteWord, total: sec + rulings + statuteWord };
}

console.log(`[gpt5-compare] triggering ${FIXTURES.length} fixtures with x-drafter-v2-compare-models: full`);

const CONCURRENCY = 2; // GPT-5 is slow; keep concurrency modest
const triggered: Array<{ fx: Fx; run_id: string | null }> = [];
for (let i = 0; i < FIXTURES.length; i += CONCURRENCY) {
  const batch = FIXTURES.slice(i, i + CONCURRENCY);
  const out = await Promise.all(batch.map(async (fx) => {
    try {
      const t = await trigger(fx.question);
      console.log(`[${fx.id}] run_id=${t.run_id}`);
      return { fx, run_id: t.run_id ?? null };
    } catch (e) {
      console.error(`[${fx.id}] trigger error`, e);
      return { fx, run_id: null };
    }
  }));
  triggered.push(...out);
  if (i + CONCURRENCY < FIXTURES.length) await new Promise(r => setTimeout(r, 3000));
}

const rows = await Promise.all(triggered.map(async ({ fx, run_id }) => {
  if (!run_id) return { fixture_id: fx.id, tag: fx.tag, question: fx.question, error: "trigger_failed" };
  const row = await pollByRunId(run_id);
  if (!row) return { fixture_id: fx.id, tag: fx.tag, question: fx.question, run_id, error: "poll_timeout" };
  const md: any = row.metadata ?? {};
  const mini: any = md.drafter ?? {};
  const full: any = md.drafter_v2_full_compare ?? null;
  const miniAns: string = row.answer ?? "";
  const fullAns: string = (full?.answer_markdown) ?? "";
  const miniFns: any[] = row.footnotes ?? [];
  const fullFns: any[] = full?.footnotes ?? [];
  const qwBuckets = (d: any) => {
    const b: Record<string, number> = {};
    for (const h of (d?.quality_warning?.hits ?? [])) b[h.bucket] = (b[h.bucket] ?? 0) + 1;
    return b;
  };
  return {
    fixture_id: fx.id, tag: fx.tag, question: fx.question, run_id,
    mini: {
      ok: mini.ok, model_final: mini.model_final, escalated: mini.escalated, ms: mini.ms,
      sources_used: mini.sources_used, footnote_count: miniFns.length,
      unknown_source_refs: mini?.builder_report?.unknown_source_refs ?? [],
      adjacent_runs: adjRuns(miniAns), builder_adj: mini?.builder_report?.adjacent_marker_count ?? null,
      concrete_anchors: countConcreteAnchors(miniAns),
      artifact_hits: scanArtifacts(miniAns),
      quality_warning_buckets: qwBuckets(mini),
      prose_length: miniAns.length,
      answer: miniAns,
      footnotes: miniFns,
    },
    gpt5: full ? {
      ok: full.ok, model_final: full.model_final, escalated: full.escalated, ms: full.ms,
      sources_used: full.sources_used, footnote_count: fullFns.length,
      unknown_source_refs: full?.builder_report?.unknown_source_refs ?? [],
      adjacent_runs: adjRuns(fullAns), builder_adj: full?.builder_report?.adjacent_marker_count ?? null,
      concrete_anchors: countConcreteAnchors(fullAns),
      artifact_hits: scanArtifacts(fullAns),
      quality_warning_buckets: qwBuckets(full),
      prose_length: fullAns.length,
      usage: full.usage ?? null,
      answer: fullAns,
      footnotes: fullFns,
    } : null,
  };
}));

const ok = rows.filter((r: any) => !r.error && r.gpt5);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => xs.length ? sum(xs) / xs.length : 0;

const summary = {
  phase: "drafterV2-style-revision-gpt5-compare",
  upstream_pack_frozen: true,
  upstream_pack_note: "Same upstream pack (claims, candidates, verifier verdicts, userDocs) is reused for both mini and GPT-5 in a single run via the x-drafter-v2-compare-models: full harness header.",
  fixtures_total: FIXTURES.length,
  fixtures_completed: ok.length,
  errors: rows.length - ok.length,
  acceptance_gpt5: {
    artifact_hits_total: ok.reduce((a: number, r: any) => a + sum(Object.values(r.gpt5.artifact_hits) as number[]), 0),
    artifact_hits_per_fixture: ok.map((r: any) => ({ id: r.fixture_id, hits: r.gpt5.artifact_hits })),
    unknown_source_refs_total: ok.reduce((a: number, r: any) => a + (Array.isArray(r.gpt5.unknown_source_refs) ? r.gpt5.unknown_source_refs.length : 0), 0),
    answers_with_adjacent_runs: ok.filter((r: any) => (r.gpt5.adjacent_runs ?? 0) > 0).length,
    avg_concrete_anchors: avg(ok.map((r: any) => r.gpt5.concrete_anchors.total)),
    avg_prose_length: avg(ok.map((r: any) => r.gpt5.prose_length)),
    runs_with_zero_footnotes: ok.filter((r: any) => r.gpt5.footnote_count === 0).length,
  },
  comparison: ok.map((r: any) => ({
    id: r.fixture_id,
    mini: { ms: r.mini.ms, src: r.mini.sources_used, fn: r.mini.footnote_count, len: r.mini.prose_length, anchors: r.mini.concrete_anchors.total, artifacts: r.mini.artifact_hits },
    gpt5: { ms: r.gpt5.ms, src: r.gpt5.sources_used, fn: r.gpt5.footnote_count, len: r.gpt5.prose_length, anchors: r.gpt5.concrete_anchors.total, artifacts: r.gpt5.artifact_hits },
  })),
  latency: {
    mini_avg_ms: avg(ok.map((r: any) => r.mini.ms ?? 0)),
    gpt5_avg_ms: avg(ok.map((r: any) => r.gpt5.ms ?? 0)),
    gpt5_max_ms: Math.max(0, ...ok.map((r: any) => r.gpt5.ms ?? 0)),
  },
  usage_totals_gpt5: ok.reduce((acc: any, r: any) => {
    const u = r.gpt5.usage ?? {};
    acc.prompt = (acc.prompt ?? 0) + (u.prompt_tokens ?? 0);
    acc.completion = (acc.completion ?? 0) + (u.completion_tokens ?? 0);
    acc.total = (acc.total ?? 0) + (u.total_tokens ?? 0);
    return acc;
  }, {}),
  fixtures: rows,
};

await Bun.write(
  "reports/legal-research-v1-drafterV2-style-revision-gpt5-compare.json",
  JSON.stringify(summary, null, 2),
);
console.log("\n[done] acceptance_gpt5:", summary.acceptance_gpt5);
console.log("[done] latency:", summary.latency);
console.log("[done] usage_totals_gpt5:", summary.usage_totals_gpt5);
