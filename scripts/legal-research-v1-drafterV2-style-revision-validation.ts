// Validation for the prompt-only style revision in drafterV2.ts SYSTEM_PROMPT_V2.
// Six fixtures: national-identity codification, doctrinal (admin promise),
// reasonableness, long-form admin escalation, procedural, theoretical/comparative.

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

const SUP_RUN_RE = /[\u2070-\u209F\u00B2\u00B3\u00B9]+/gu;
function adjRuns(s: string): number {
  let prevEnd = -1, count = 0;
  for (const m of s.matchAll(SUP_RUN_RE)) {
    const start = m.index ?? 0;
    if (prevEnd >= 0 && /^\s*$/.test(s.slice(prevEnd, start))) count++;
    prevEnd = start + m[0].length;
  }
  return count;
}

// Failure-class scan: the specific anti-examples named in the prompt + general
// over-abstract patterns. Prompt-guidance only — no blocking, telemetry only.
const FAILURE_COMPOUNDS = [
  "מכניזמים משפטיים", "מכניזם משפטי",
  "פורמליזציה מדודה", "פורמליזציה",
  "עמידות חוקתית",
  "מעמד על־תיקתי", "מעמד על-תיקתי",
  "מרכיבי זהות מדגמית",
  "סיגנוניהם המשמעיים", "סיגנון משמעי",
  "המשגה",
];
function scanFailureCompounds(s: string) {
  const hits: string[] = [];
  for (const t of FAILURE_COMPOUNDS) if (s.includes(t)) hits.push(t);
  return hits;
}

// Concrete-anchor proxy: count named statute sections, ruling-style refs (בג"ץ/ע"א/דנ"א/ע"פ + number/year), and statute names.
function countConcreteAnchors(s: string) {
  const sec = (s.match(/סעיף\s*\d+[א-ת]?/g) ?? []).length;
  const rulings = (s.match(/(?:בג"ץ|בג״ץ|ע"א|ע״א|דנ"א|דנ״א|ע"פ|ע״פ|רע"א|רע״א|בש"א|בש״א)\s*\d+\/\d+/g) ?? []).length;
  const statuteWord = (s.match(/חוק[־ -][א-ת]/g) ?? []).length;
  const basicLaw = (s.match(/חוק[- ]יסוד/g) ?? []).length;
  return { section_refs: sec, ruling_refs: rulings, statute_mentions: statuteWord, basic_law_mentions: basicLaw, total: sec + rulings + statuteWord + basicLaw };
}

function countHeadings(blocks: any[] | null | undefined) {
  if (!Array.isArray(blocks)) return { total: 0, level2: 0, level3: 0 };
  let l2 = 0, l3 = 0;
  for (const b of blocks) {
    if (b?.kind === "heading") {
      if (b.level === 3) l3++; else l2++;
    }
  }
  return { total: l2 + l3, level2: l2, level3: l3 };
}

console.log(`[validation] revision=drafterV2-style-revision triggering ${FIXTURES.length} fixtures`);

const CONCURRENCY = 3;
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
  const d: any = md.drafter ?? {};
  const qw: any = d.quality_warning ?? null;
  const buckets: Record<string, number> = {};
  for (const h of (qw?.hits ?? [])) buckets[h.bucket] = (buckets[h.bucket] ?? 0) + 1;
  const answer: string = row.answer ?? "";
  const fns: any[] = row.footnotes ?? [];
  const fn_with_sources = fns.filter((f) => Array.isArray(f.sources) ? f.sources.length > 0 : !!f.url).length;
  const blocks = d?.structured_draft?.blocks ?? d?.blocks ?? null;
  return {
    fixture_id: fx.id,
    tag: fx.tag,
    question: fx.question,
    run_id,
    ms: d.ms ?? null,
    sources_used: d.sources_used ?? 0,
    escalated: d.escalated === true,
    model_initial: d.model_initial ?? null,
    model_final: d.model_final ?? null,
    drafter_version: d.drafter_version ?? null,
    footnote_count: fns.length,
    footnotes_with_sources: fn_with_sources,
    unknown_source_refs: d?.builder_report?.unknown_source_refs ?? [],
    adjacent_runs_in_answer: adjRuns(answer),
    builder_adj: d?.builder_report?.adjacent_marker_count ?? null,
    headings: countHeadings(blocks),
    concrete_anchors: countConcreteAnchors(answer),
    failure_compounds: scanFailureCompounds(answer),
    quality_warning_buckets: buckets,
    prose_length: answer.length,
    answer_preview_first_800: answer.slice(0, 800),
    answer_preview_last_400: answer.slice(-400),
  };
}));

const ok = rows.filter((r: any) => !r.error);
const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

const summary = {
  phase: "drafterV2-style-revision-validation",
  fixtures_total: FIXTURES.length,
  fixtures_completed: ok.length,
  errors: rows.length - ok.length,
  acceptance: {
    failure_compounds_total: ok.reduce((a: number, r: any) => a + r.failure_compounds.length, 0),
    failure_compounds_per_fixture: ok.map((r: any) => ({ id: r.fixture_id, hits: r.failure_compounds })),
    unknown_source_refs_total: ok.reduce((a: number, r: any) => a + (Array.isArray(r.unknown_source_refs) ? r.unknown_source_refs.length : 0), 0),
    answers_with_adjacent_runs: ok.filter((r: any) => (r.adjacent_runs_in_answer ?? 0) > 0).length,
    avg_headings: avg(ok.map((r: any) => r.headings.total)),
    avg_concrete_anchors: avg(ok.map((r: any) => r.concrete_anchors.total)),
    avg_prose_length: avg(ok.map((r: any) => r.prose_length)),
    runs_with_all_footnotes_having_sources: ok.filter((r: any) => r.footnote_count > 0 && r.footnotes_with_sources === r.footnote_count).length,
    runs_with_zero_footnotes: ok.filter((r: any) => r.footnote_count === 0).length,
    models_final: ok.map((r: any) => ({ id: r.fixture_id, model: r.model_final, escalated: r.escalated })),
  },
  latency: {
    avg_ms: avg(ok.map((r: any) => r.ms ?? 0)),
    max_ms: Math.max(0, ...ok.map((r: any) => r.ms ?? 0)),
  },
  fixtures: rows,
};

await Bun.write(
  "reports/legal-research-v1-drafterV2-style-revision-validation.json",
  JSON.stringify(summary, null, 2),
);
console.log("\n[done] acceptance:", summary.acceptance);
console.log("[done] latency:", summary.latency);
