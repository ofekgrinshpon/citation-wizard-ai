// Recompute objective checks from raw per-question run files.
// No pipeline re-runs. Fixes truncation detection + stub detection.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const goldenRaw = JSON.parse(
  readFileSync("reports/quality-audit/golden-set.json", "utf8"),
);
const GOLDEN = new Map<string, any>(
  goldenRaw.questions.map((q: any) => [q.id, q]),
);

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
function fuzzyContains(needle: string, corpus: string): { hit: boolean; ratio: number } {
  const nTok = tokens(needle);
  if (!nTok.length) return { hit: false, ratio: 0 };
  const cNorm = normalize(corpus);
  const hits = nTok.filter((t) => cNorm.includes(t)).length;
  return { hit: hits / nTok.length >= 0.5, ratio: hits / nTok.length };
}
function collectUsedSourcesText(used_sources: any[], footnotes: any[]): string {
  const parts: string[] = [];
  for (const s of used_sources ?? []) parts.push(s?.title ?? "", s?.url ?? "", s?.source_type ?? "");
  for (const f of footnotes ?? []) {
    parts.push(f?.title ?? "", f?.url ?? "");
    for (const s of f?.sources ?? []) parts.push(s?.title ?? "", s?.url ?? "");
  }
  return parts.join(" | ");
}
function detectForbidden(body: string, forbidden: string[]) {
  const hits: any[] = [];
  const bNorm = normalize(body);
  for (const f of forbidden ?? []) {
    const fTok = tokens(f);
    if (fTok.length < 2) continue;
    const found = fTok.filter((t) => bNorm.includes(t)).length;
    if (found / fTok.length >= 0.75) {
      const idx = bNorm.indexOf(fTok[0]);
      hits.push({ hit: f, ratio: Number((found/fTok.length).toFixed(2)),
                  snippet: body.slice(Math.max(0, idx - 40), idx + 160) });
    }
  }
  return hits;
}
const CAVEAT_MARKERS = [
  "לא סופק","לא אותר","לא נמצא","לא הובא","לא צוטט","לא זמין","אינה זמינה",
  "אין לי גישה","לא ניתן לאתר","טרם אותר","מקורות משניים","בהסתייגות",
  "מסייג","יש לסייג","אין פסיקה","בהיעדר","ללא הפסק עצמו","לא ניתן לקבוע",
  "אין באפשרותי","זהירות וחלקיות","אין ודאות","בזהירות",
];
function hasCaveat(body: string): boolean {
  const bNorm = normalize(body);
  return CAVEAT_MARKERS.some((m) => bNorm.includes(normalize(m)));
}
function countFabricatedCitations(footnotes: any[]): number {
  return (footnotes ?? []).filter((f) => {
    const hasUrl = !!f?.url;
    const hasSources = Array.isArray(f?.sources) && f.sources.length > 0;
    return !hasUrl && !hasSources;
  }).length;
}
function q18OfficialSourcePresent(usedText: string): boolean {
  const t = normalize(usedText);
  return t.includes("knesset.gov.il") || t.includes("main.knesset.gov.il") ||
    t.includes("רשומות") || t.includes("ספר החוקים") ||
    t.includes("reshumot") || t.includes("nevo.co.il/law_html");
}
function q18HasVerbatimSection1(body: string): boolean {
  const bNorm = normalize(body);
  const anchors = [
    "זכויות היסוד של האדם בישראל","מושתתות על ההכרה",
    "בערך האדם","בקדושת חייו","בהיותו בן חורין",
  ];
  return anchors.filter((a) => bNorm.includes(normalize(a))).length >= 3;
}

const perQ: any[] = [];
const files = readdirSync("reports/quality-audit/runs").filter(f => f.endsWith(".json")).sort();
for (const fn of files) {
  const r = JSON.parse(readFileSync(`reports/quality-audit/runs/${fn}`, "utf8"));
  const g = GOLDEN.get(r.id);
  if (!g) continue;

  const answer: string = r.answer ?? "";
  const stub = answer.trim().startsWith("[stub]");
  const usedText = collectUsedSourcesText(r.used_sources, r.footnotes);
  const truncObj = r.completeness ?? null;
  const truncated_severely =
    (truncObj && truncObj.truncated === true) ||
    (r.truncation_retry && r.truncation_retry.attempted === true && r.truncation_retry.recovered !== true) ||
    (!stub && answer.length < 400);  // very short non-stub is a red flag

  const req_primary_hits = (g.required_primary ?? []).map((p: string) => {
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
    .filter((h: any) => !h.hit_in_used_sources && !h.hit_in_body)
    .map((h: any) => h.required);

  const forbidden_hits = detectForbidden(answer, g.forbidden ?? []);
  const caveat_present = hasCaveat(answer);
  const fabricated_citations = countFabricatedCitations(r.footnotes);

  let q02_invented_holding = false;
  if (r.id === "Q02" && !stub) {
    const conclusiveMarkers = [
      "בית המשפט קבע","נפסק כי","נקבע כי","הכריע כי","פסק כי",
      "קיבל את התביעה","דחה את התביעה","סיווג ההכנסה נקבע",
    ];
    const bNorm = normalize(answer);
    const hasConclusion = conclusiveMarkers.some((m) => bNorm.includes(normalize(m)));
    q02_invented_holding = hasConclusion && missing_required_primary.length > 0 && !caveat_present;
  }

  const q18_official_source = r.id === "Q18" ? q18OfficialSourcePresent(usedText) : null;
  const q18_verbatim = r.id === "Q18" ? q18HasVerbatimSection1(answer) : null;

  const hard_fail_reasons: string[] = [];
  if (stub) hard_fail_reasons.push("stub_response_p5_never_ran");
  if (!stub && missing_required_primary.length > 0) {
    // Soft version — informative but not always hard-fail; mark if EVERY required missing
    if (missing_required_primary.length === (g.required_primary ?? []).length) {
      hard_fail_reasons.push(`all_required_primary_missing`);
    }
  }
  if (fabricated_citations > 0) hard_fail_reasons.push(`fabricated_citations:${fabricated_citations}`);
  if (truncated_severely) hard_fail_reasons.push("severe_truncation");
  if (forbidden_hits.length > 0) hard_fail_reasons.push(`forbidden_claim:${forbidden_hits.map((h:any)=>h.hit).join("||")}`);
  if (q02_invented_holding) hard_fail_reasons.push("q02_invented_holding");
  if (r.id === "Q18" && !stub) {
    if (!q18_official_source) hard_fail_reasons.push("q18_no_official_source");
    if (!q18_verbatim) hard_fail_reasons.push("q18_no_verbatim_section_1_text");
  }

  perQ.push({
    id: r.id,
    category: g.category,
    query: g.query,
    run_id: r.run_id,
    ok: r.ok,
    stub,
    total_ms: r.total_ms,
    prose_length: answer.length,
    footnote_count: r.footnote_count,
    used_sources_count: r.used_sources?.length ?? 0,
    unique_source_count: r.unique_source_count,
    verifier_support: r.verifier?.counts?.by_support ?? null,
    verifier_role_match: r.verifier?.counts?.by_role_match ?? null,
    verifier_dropped_count: r.verifier?.dropped_count ?? 0,
    completeness_truncated: truncObj?.truncated ?? null,
    completeness_reasons: truncObj?.reasons ?? [],
    truncation_retry_attempted: r.truncation_retry?.attempted ?? null,
    required_anchors_count: r.required_anchors?.length ?? 0,
    missing_anchor_caveat_injected: r.missing_anchor_caveat_injected,
    checks: {
      required_primary: req_primary_hits,
      missing_required_primary,
      forbidden_hits,
      caveat_present,
      fabricated_citations,
      truncated_severely,
      q02_invented_holding: r.id === "Q02" ? q02_invented_holding : null,
      q18_official_source,
      q18_verbatim_section_1: q18_verbatim,
    },
    hard_fail_objective: hard_fail_reasons.length > 0,
    hard_fail_reasons,
    answer_preview: answer.slice(0, 400),
  });
}

const combined = {
  audit_version: "v1-recompute",
  golden_set_version: goldenRaw.version,
  fixtures_total: perQ.length,
  stubs: perQ.filter(r => r.stub).length,
  objective_hard_fails: perQ.filter(r => r.hard_fail_objective).length,
  ran_at: new Date().toISOString(),
  per_question: perQ,
};
writeFileSync("reports/quality-audit/checks.json", JSON.stringify(combined, null, 2));
writeFileSync("/mnt/documents/quality-audit/checks.json", JSON.stringify(combined, null, 2));

// CSV
const csvHeader = [
  "id","category","ok","stub","total_ms","prose_length","footnote_count",
  "used_sources_count","unique_source_count",
  "verifier_direct","verifier_partial","verifier_tangential","verifier_unrelated",
  "completeness_truncated","required_anchors_count","missing_anchor_caveat_injected",
  "missing_required_primary","forbidden_hits","caveat_present","fabricated_citations",
  "truncated_severely","q02_invented_holding","q18_official_source","q18_verbatim",
  "hard_fail_objective","hard_fail_reasons",
].join(",");
const csvRows = perQ.map((r: any) => {
  const vs = r.verifier_support ?? {};
  const q = (s: any) => `"${String(s ?? "").replace(/"/g,'""')}"`;
  return [
    r.id, r.category, r.ok, r.stub, r.total_ms, r.prose_length, r.footnote_count,
    r.used_sources_count, r.unique_source_count ?? "",
    vs.direct ?? "", vs.partial ?? "", vs.tangential ?? "", vs.unrelated ?? "",
    r.completeness_truncated ?? "", r.required_anchors_count, r.missing_anchor_caveat_injected ?? "",
    q((r.checks?.missing_required_primary ?? []).join("|")),
    q((r.checks?.forbidden_hits ?? []).map((h:any)=>h.hit).join("|")),
    r.checks?.caveat_present ?? "", r.checks?.fabricated_citations ?? "",
    r.checks?.truncated_severely ?? "", r.checks?.q02_invented_holding ?? "",
    r.checks?.q18_official_source ?? "", r.checks?.q18_verbatim_section_1 ?? "",
    r.hard_fail_objective ? "TRUE" : "FALSE",
    q((r.hard_fail_reasons ?? []).join("|")),
  ].join(",");
});
writeFileSync("reports/quality-audit/scoring-sheet.csv", [csvHeader, ...csvRows].join("\n"));
writeFileSync("/mnt/documents/quality-audit/scoring-sheet.csv", [csvHeader, ...csvRows].join("\n"));

console.log("stubs:", combined.stubs, "hard_fails:", combined.objective_hard_fails);
for (const r of perQ) {
  console.log(`${r.id} ok=${r.ok} stub=${r.stub} hf=${r.hard_fail_objective} reasons=${r.hard_fail_reasons.join(",")}`);
}
