// Quality audit runner — 18 golden-set questions, current production pipeline as-is.
// No pipeline code changes. Delivers raw outputs + objective/programmatic checks.
// Reads golden set from reports/quality-audit/golden-set.json.
// Writes per-question raw JSON + combined checks JSON + CSV + summary MD.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

if (!SUPABASE_URL || !SR_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

type Golden = {
  id: string;
  category: string;
  query: string;
  required_primary?: string[];
  acceptable_secondary?: string[];
  forbidden?: string[];
  key_conclusion?: string;
  required_caveat_if_partial?: string;
  test_intent?: string;
  narrowing_note?: string;
};

const goldenRaw = JSON.parse(
  readFileSync("reports/quality-audit/golden-set.json", "utf8"),
);
const GOLDEN: Golden[] = goldenRaw.questions;

const OUT_DIR = "reports/quality-audit/runs";
const ART_DIR = "/mnt/documents/quality-audit/runs";
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(ART_DIR, { recursive: true });

async function trigger(question: string): Promise<{ run_id?: string }> {
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
  return j;
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

// --- Objective check helpers --------------------------------------------

function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/["'׳״`]/g, "")
    .replace(/[\s\u00A0\-–—_.,:;()\[\]/\\]+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter((t) => t.length >= 2);
}

// Fuzzy: at least 60% of required-primary tokens appear in the corpus text.
function fuzzyContains(needle: string, corpus: string): { hit: boolean; ratio: number } {
  const nTok = tokens(needle);
  if (!nTok.length) return { hit: false, ratio: 0 };
  const cNorm = normalize(corpus);
  const hits = nTok.filter((t) => cNorm.includes(t)).length;
  const ratio = hits / nTok.length;
  return { hit: ratio >= 0.6, ratio };
}

function collectUsedSourcesText(md: any, footnotes: any[]): string {
  const parts: string[] = [];
  const used = md?.drafter?.used_sources ?? [];
  for (const s of used) {
    parts.push(s?.title ?? "", s?.url ?? "", s?.source_type ?? "");
  }
  for (const f of footnotes ?? []) {
    parts.push(f?.title ?? "", f?.url ?? "");
    for (const s of f?.sources ?? []) parts.push(s?.title ?? "", s?.url ?? "");
  }
  return parts.join(" | ");
}

function detectForbidden(body: string, forbidden: string[]): { hit: string; snippet: string }[] {
  const hits: { hit: string; snippet: string }[] = [];
  const bNorm = normalize(body);
  for (const f of forbidden ?? []) {
    const fTok = tokens(f);
    if (!fTok.length) continue;
    // require >=70% of forbidden phrase tokens in a nearby window
    const found = fTok.filter((t) => bNorm.includes(t)).length;
    if (found / fTok.length >= 0.7) {
      // grab a snippet around the first hit token
      const idx = bNorm.indexOf(fTok[0]);
      const snip = body.slice(Math.max(0, idx - 60), idx + 160);
      hits.push({ hit: f, snippet: snip });
    }
  }
  return hits;
}

// Caveat heuristic: look for explicit uncertainty / not-found language
const CAVEAT_MARKERS = [
  "לא אותר", "לא נמצא", "לא הובא", "לא צוטט", "לא צוטטה", "לא בדק", "לא נבדק",
  "אין לי גישה", "לא ניתן לאתר", "טרם אותר", "מקורות משניים", "בהסתייגות",
  "יש הסתייגות", "מסייג", "יש לסייג", "אינו מחייב", "לא מחייב",
  "אין פסיקה", "בהיעדר", "ללא הפסק עצמו", "לא זמין", "אינה זמינה",
];
function hasCaveat(body: string): boolean {
  const bNorm = normalize(body);
  return CAVEAT_MARKERS.some((m) => bNorm.includes(normalize(m)));
}

// Fabricated-citation heuristic: footnote has no sources[] and no url
function countFabricatedCitations(footnotes: any[]): number {
  return (footnotes ?? []).filter((f) => {
    const hasUrl = !!f?.url;
    const hasSources = Array.isArray(f?.sources) && f.sources.length > 0;
    return !hasUrl && !hasSources;
  }).length;
}

// Q18 official-source check: look for knesset.gov.il / reshumot / sefer-hachukim in used_sources/footnotes
function q18OfficialSourcePresent(usedSourcesText: string): boolean {
  const t = normalize(usedSourcesText);
  return (
    t.includes("knesset.gov.il") ||
    t.includes("main.knesset.gov.il") ||
    t.includes("רשומות") ||
    t.includes("ספר החוקים") ||
    t.includes("reshumot") ||
    t.includes("sefer")
  );
}

// Q18 verbatim quote check: look for the canonical text of §1 Basic Law: Human Dignity and Liberty
function q18HasVerbatimSection1(body: string): boolean {
  const bNorm = normalize(body);
  // Canonical phrases from section 1 ("עקרונות יסוד") — check for stable substrings
  const anchors = [
    "זכויות היסוד של האדם בישראל",
    "מושתתות על ההכרה",
    "בערך האדם",
    "בקדושת חייו",
    "בהיותו בן חורין",
  ];
  const hits = anchors.filter((a) => bNorm.includes(normalize(a))).length;
  return hits >= 3;
}

// --- Run all -------------------------------------------------------------

console.log(`[audit] triggering ${GOLDEN.length} runs (concurrency=4)`);

const CONCURRENCY = 4;
const triggered: Array<{ g: Golden; run_id: string | null }> = [];

for (let i = 0; i < GOLDEN.length; i += CONCURRENCY) {
  const batch = GOLDEN.slice(i, i + CONCURRENCY);
  const out = await Promise.all(batch.map(async (g) => {
    try {
      const t = await trigger(g.query);
      console.log(`[${g.id}] triggered run_id=${t.run_id}`);
      return { g, run_id: t.run_id ?? null };
    } catch (e) {
      console.error(`[${g.id}] trigger error`, e);
      return { g, run_id: null };
    }
  }));
  triggered.push(...out);
  if (i + CONCURRENCY < GOLDEN.length) {
    await new Promise((r) => setTimeout(r, 4000));
  }
}

console.log(`[audit] polling for completions...`);

const perQ = await Promise.all(triggered.map(async ({ g, run_id }) => {
  const base: any = {
    id: g.id, category: g.category, query: g.query, run_id,
    test_intent: g.test_intent ?? null,
  };
  if (!run_id) return { ...base, error: "trigger_failed" };
  const row = await pollByRunId(run_id);
  if (!row) return { ...base, error: "poll_timeout" };

  const md: any = row.metadata ?? {};
  const d: any = md.drafter ?? {};
  const v: any = md.verifier ?? {};
  const answer: string = row.answer ?? "";
  const footnotes: any[] = row.footnotes ?? [];
  const used_sources: any[] = d.used_sources ?? [];
  const required_anchors: any[] = md.required_anchors ?? [];
  const completeness = d.completeness ?? null;
  const truncation_retry = d.truncation_retry ?? null;
  const ok = d.ok === true;

  // Persist per-question full raw file
  const raw = {
    id: g.id,
    category: g.category,
    query: g.query,
    run_id,
    ok,
    total_ms: md.total_ms ?? null,
    answer,
    footnotes,
    used_sources,
    required_anchors,
    verifier: {
      counts: v.counts ?? null,
      dropped_count: Array.isArray(v.dropped) ? v.dropped.length : 0,
    },
    completeness,
    truncation_retry,
    drafter_version: d.drafter_version ?? null,
    footnote_count: footnotes.length,
    sources_used: d.sources_used ?? 0,
    unique_source_count: d.unique_source_count ?? null,
    missing_anchor_caveat_injected: d.missing_anchor_caveat_injected ?? null,
    missing_anchor_descriptions: d.missing_anchor_descriptions ?? [],
  };
  writeFileSync(
    `${OUT_DIR}/${g.id}.json`,
    JSON.stringify(raw, null, 2),
  );
  writeFileSync(
    `${ART_DIR}/${g.id}.json`,
    JSON.stringify(raw, null, 2),
  );

  // Objective checks
  const usedText = collectUsedSourcesText(md, footnotes);
  const combinedText = `${answer}\n\n${usedText}`;

  const req_primary_hits = (g.required_primary ?? []).map((p) => {
    const inUsed = fuzzyContains(p, usedText);
    const inBody = fuzzyContains(p, answer);
    return {
      required: p,
      hit_in_used_sources: inUsed.hit,
      ratio_used: Number(inUsed.ratio.toFixed(2)),
      hit_in_body: inBody.hit,
      ratio_body: Number(inBody.ratio.toFixed(2)),
    };
  });
  const missing_required_primary = req_primary_hits
    .filter((h) => !h.hit_in_used_sources && !h.hit_in_body)
    .map((h) => h.required);

  const forbidden_hits = detectForbidden(answer, g.forbidden ?? []);
  const caveat_present = hasCaveat(answer);
  const fabricated_citations = countFabricatedCitations(footnotes);

  // Truncation severity
  const truncated_severely =
    (completeness && completeness !== "complete") ||
    (truncation_retry && truncation_retry.attempted === true && truncation_retry.recovered !== true);

  // Q02: missing-source test — hard-fail if system invents a holding
  let q02_invented_holding = false;
  if (g.id === "Q02") {
    // If no primary source present but the answer contains conclusion-like verbs → fail
    const conclusiveMarkers = [
      "בית המשפט קבע", "נפסק כי", "נקבע כי", "הכריע כי",
      "פסק כי", "קיבל את התביעה", "דחה את התביעה",
    ];
    const bNorm = normalize(answer);
    const hasConclusion = conclusiveMarkers.some((m) => bNorm.includes(normalize(m)));
    q02_invented_holding = hasConclusion && missing_required_primary.length > 0 && !caveat_present;
  }

  // Q18: official source + verbatim quote
  let q18_hard_fail_reasons: string[] = [];
  if (g.id === "Q18") {
    const officialPresent = q18OfficialSourcePresent(usedText);
    const verbatim = q18HasVerbatimSection1(answer);
    if (!officialPresent) q18_hard_fail_reasons.push("no_official_source");
    if (!verbatim) q18_hard_fail_reasons.push("no_verbatim_section_1_text");
  }

  // Objective hard-fail decision
  const hard_fail_reasons: string[] = [];
  if (missing_required_primary.length > 0 && (g.required_primary ?? []).length > 0 && g.id !== "Q02") {
    hard_fail_reasons.push(`missing_required_primary:${missing_required_primary.join("|")}`);
  }
  if (fabricated_citations > 0) hard_fail_reasons.push(`fabricated_citations:${fabricated_citations}`);
  if (truncated_severely) hard_fail_reasons.push("severe_truncation");
  if (forbidden_hits.length > 0) hard_fail_reasons.push(`forbidden_claim:${forbidden_hits.map(h=>h.hit).join("||")}`);
  if (q02_invented_holding) hard_fail_reasons.push("q02_invented_holding");
  if (q18_hard_fail_reasons.length) hard_fail_reasons.push(...q18_hard_fail_reasons.map(r=>`q18_${r}`));
  if (!ok) hard_fail_reasons.push("drafter_ok_false");

  return {
    ...base,
    ok,
    total_ms: md.total_ms ?? null,
    prose_length: answer.length,
    footnote_count: footnotes.length,
    used_sources_count: used_sources.length,
    unique_source_count: d.unique_source_count ?? null,
    verifier_support: v?.counts?.by_support ?? null,
    verifier_role_match: v?.counts?.by_role_match ?? null,
    completeness,
    truncation_retry,
    required_anchors_count: required_anchors.length,
    missing_anchor_caveat_injected: d.missing_anchor_caveat_injected ?? null,
    checks: {
      required_primary: req_primary_hits,
      missing_required_primary,
      forbidden_hits,
      caveat_present,
      fabricated_citations,
      truncated_severely,
      q02_invented_holding: g.id === "Q02" ? q02_invented_holding : null,
      q18_official_source: g.id === "Q18" ? q18OfficialSourcePresent(usedText) : null,
      q18_verbatim_section_1: g.id === "Q18" ? q18HasVerbatimSection1(answer) : null,
    },
    hard_fail_objective: hard_fail_reasons.length > 0,
    hard_fail_reasons,
    answer_preview: answer.slice(0, 500),
  };
}));

// Aggregate
const total = perQ.length;
const errors = perQ.filter((r: any) => r.error).length;
const objective_hard_fails = perQ.filter((r: any) => r.hard_fail_objective).length;

const combined = {
  audit_version: "v1",
  golden_set_version: goldenRaw.version,
  fixtures_total: total,
  errors,
  objective_hard_fails,
  ran_at: new Date().toISOString(),
  per_question: perQ,
};

writeFileSync(
  "reports/quality-audit/checks.json",
  JSON.stringify(combined, null, 2),
);
writeFileSync(
  `${ART_DIR}/../checks.json`,
  JSON.stringify(combined, null, 2),
);

// CSV summary for user's manual scoring
const csvHeader = [
  "id","category","ok","total_ms","prose_length","footnote_count",
  "used_sources_count","unique_source_count",
  "verifier_direct","verifier_partial","verifier_tangential","verifier_unrelated",
  "completeness","required_anchors_count","missing_anchor_caveat_injected",
  "missing_required_primary","forbidden_hits","caveat_present","fabricated_citations",
  "truncated_severely","q02_invented_holding","q18_official_source","q18_verbatim",
  "hard_fail_objective","hard_fail_reasons",
].join(",");
const csvRows = perQ.map((r: any) => {
  if (r.error) {
    return [r.id, r.category, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "TRUE", r.error].join(",");
  }
  const vs = r.verifier_support ?? {};
  const q = (s: any) => `"${String(s ?? "").replace(/"/g,'""')}"`;
  return [
    r.id, r.category, r.ok, r.total_ms, r.prose_length, r.footnote_count,
    r.used_sources_count, r.unique_source_count ?? "",
    vs.direct ?? "", vs.partial ?? "", vs.tangential ?? "", vs.unrelated ?? "",
    r.completeness ?? "", r.required_anchors_count, r.missing_anchor_caveat_injected ?? "",
    q((r.checks?.missing_required_primary ?? []).join("|")),
    q((r.checks?.forbidden_hits ?? []).map((h:any)=>h.hit).join("|")),
    r.checks?.caveat_present ?? "", r.checks?.fabricated_citations ?? "",
    r.checks?.truncated_severely ?? "",
    r.checks?.q02_invented_holding ?? "",
    r.checks?.q18_official_source ?? "",
    r.checks?.q18_verbatim_section_1 ?? "",
    r.hard_fail_objective ? "TRUE" : "FALSE",
    q((r.hard_fail_reasons ?? []).join("|")),
  ].join(",");
});
const csv = [csvHeader, ...csvRows].join("\n");
writeFileSync("reports/quality-audit/scoring-sheet.csv", csv);
writeFileSync(`${ART_DIR}/../scoring-sheet.csv`, csv);

console.log(`[audit] done. errors=${errors} hard_fails=${objective_hard_fails}`);
console.log(`[audit] wrote reports/quality-audit/checks.json + scoring-sheet.csv`);
console.log(`[audit] artifacts under /mnt/documents/quality-audit/`);
