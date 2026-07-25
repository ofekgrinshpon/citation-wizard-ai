// Step 3b — slim analyzer answer_intent → drafter validation runner.
// Runs only Q01, Q02, Q03, Q13, Q18 against the deployed pipeline
// (analyzer now emits only { output_shape }; drafter treats it as a
// format hint, not a confidence signal).

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

if (!SUPABASE_URL || !SR_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const VALIDATION_IDS = ["Q01", "Q02", "Q03", "Q13", "Q18"];

type Golden = { id: string; category: string; query: string };
const goldenRaw = JSON.parse(
  readFileSync("reports/quality-audit/golden-set.json", "utf8"),
);
const GOLDEN: Golden[] = goldenRaw.questions.filter((q: Golden) =>
  VALIDATION_IDS.includes(q.id),
);

const OUT_DIR = "reports/quality-audit/runs-step3b";
const ART_DIR = "/mnt/documents/quality-audit/runs-step3b";
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
  return await r.json().catch(() => ({}));
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

console.log(`[step3b] triggering ${GOLDEN.length} runs (concurrency=3)`);
const triggered: Array<{ g: Golden; run_id: string | null }> = [];
const CONCURRENCY = 3;
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
  if (i + CONCURRENCY < GOLDEN.length) await new Promise((r) => setTimeout(r, 4000));
}

console.log(`[step3b] polling for completions...`);
const perQ = await Promise.all(triggered.map(async ({ g, run_id }) => {
  const base: any = { id: g.id, category: g.category, query: g.query, run_id };
  if (!run_id) return { ...base, error: "trigger_failed" };
  const row = await pollByRunId(run_id);
  if (!row) return { ...base, error: "poll_timeout" };
  const md: any = row.metadata ?? {};
  const d: any = md.drafter ?? {};
  const answer_intent = md?.planning?.analyzer?.answer_intent ?? null;
  const raw = {
    id: g.id,
    category: g.category,
    query: g.query,
    run_id,
    ok: d.ok === true,
    total_ms: md.total_ms ?? null,
    answer_intent,
    answer: row.answer ?? "",
    footnotes: row.footnotes ?? [],
    used_sources: d.used_sources ?? [],
    verifier_counts: md?.verifier?.counts ?? null,
  };
  writeFileSync(`${OUT_DIR}/${g.id}.json`, JSON.stringify(raw, null, 2));
  writeFileSync(`${ART_DIR}/${g.id}.json`, JSON.stringify(raw, null, 2));
  console.log(`[${g.id}] done ok=${raw.ok} shape=${answer_intent?.output_shape ?? "-"}`);
  return raw;
}));

// ---- Build markdown diff report ---------------------------------------
function loadBaseline(id: string) {
  // Prefer the Step 3 (v1) run as "before" — it has the ambitious schema
  // whose behaviour we are comparing against. Fall back to the 2026-07-23
  // baseline if the Step 3 file is missing.
  for (const p of [
    `reports/quality-audit/runs-step3/${id}.json`,
    `reports/quality-audit/runs/${id}.json`,
  ]) {
    if (existsSync(p)) {
      try {
        const j = JSON.parse(readFileSync(p, "utf8"));
        return { source: p, ...j };
      } catch { /* fallthrough */ }
    }
  }
  return null;
}

function fmtSources(list: any[]): string {
  if (!Array.isArray(list) || list.length === 0) return "_(none)_";
  return list.map((s, i) =>
    `${i + 1}. **${s.title ?? s.canonical_title ?? "(no title)"}** — ${s.source_type ?? "?"} — ${s.url ?? ""}`,
  ).join("\n");
}
function fmtFootnotes(list: any[]): string {
  if (!Array.isArray(list) || list.length === 0) return "_(none)_";
  return list.map((f: any, i: number) => `[${f.index ?? i + 1}] ${f.text ?? f.markdown ?? JSON.stringify(f)}`).join("\n\n");
}

const lines: string[] = [];
lines.push(`# Step 3b — slim \`answer_intent\` (output_shape only) — validation diff`);
lines.push("");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("");
lines.push(`Validation set: ${VALIDATION_IDS.join(", ")}`);
lines.push("");
lines.push(`**Schema now:** \`answer_intent = { output_shape }\` only.`);
lines.push(`Allowed shapes: quote, definition, list, timeline, case_holding, analysis, comparison, unknown.`);
lines.push(`Removed: \`confidence_posture\`, \`must_include\`, \`must_avoid\`.`);
lines.push(`Confidence/caveat behaviour continues to be driven by downstream evidence only (missing anchors, verifier support, snippet coverage).`);
lines.push("");
lines.push(`**Before** = Step 3 (v1) run in \`reports/quality-audit/runs-step3/*.json\`, or the 2026-07-23 baseline where the Step 3 run is missing.`);
lines.push(`**After**  = this run (slim schema).`);
lines.push("");

for (const r of perQ) {
  const before = loadBaseline(r.id);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## ${r.id} — ${r.category ?? "?"}`);
  lines.push(``);
  lines.push(`**Query:**\n\n> ${r.query}`);
  lines.push(``);
  lines.push(`### analyzer.answer_intent`);
  lines.push(`- **BEFORE:** \`${JSON.stringify(before?.answer_intent ?? null)}\``);
  lines.push(`- **AFTER:**  \`${JSON.stringify(r.answer_intent ?? null)}\``);
  lines.push(``);
  if (r.error) {
    lines.push(`> ⚠ Runner error: \`${r.error}\``);
    continue;
  }
  lines.push(`### Answer body`);
  lines.push(``);
  lines.push(`<details><summary>BEFORE (${before ? before.source ?? "baseline" : "no baseline"})</summary>\n\n${before?.answer ?? "_(baseline missing)_"}\n\n</details>`);
  lines.push(``);
  lines.push(`<details><summary>AFTER</summary>\n\n${r.answer || "_(empty)_"}\n\n</details>`);
  lines.push(``);
  lines.push(`### Footnotes`);
  lines.push(``);
  lines.push(`<details><summary>BEFORE</summary>\n\n${fmtFootnotes(before?.footnotes ?? [])}\n\n</details>`);
  lines.push(``);
  lines.push(`<details><summary>AFTER</summary>\n\n${fmtFootnotes(r.footnotes ?? [])}\n\n</details>`);
  lines.push(``);
  lines.push(`### used_sources`);
  lines.push(``);
  lines.push(`<details><summary>BEFORE (${(before?.used_sources ?? []).length})</summary>\n\n${fmtSources(before?.used_sources ?? [])}\n\n</details>`);
  lines.push(``);
  lines.push(`<details><summary>AFTER (${(r.used_sources ?? []).length})</summary>\n\n${fmtSources(r.used_sources ?? [])}\n\n</details>`);
  lines.push(``);
  const notes: string[] = [];
  const shape = r.answer_intent?.output_shape ?? "-";
  if (r.id === "Q01") {
    notes.push(`Acceptance: no contradictory language like "the law passed constitutional review and was void"; holding should stay grounded in the judgment. Shape received: \`${shape}\` (expected \`case_holding\`).`);
  }
  if (r.id === "Q02") {
    notes.push(`Acceptance: must still refuse to invent the missing district holding. Shape received: \`${shape}\` (expected \`case_holding\`). Refusal now comes from missingRequiredAnchors, not from posture.`);
  }
  if (r.id === "Q03") {
    notes.push(`Acceptance: keep the improved definition/elements-first opening. Shape received: \`${shape}\` (expected \`definition\`).`);
  }
  if (r.id === "Q13") {
    notes.push(`Acceptance: include concrete timeframes when extracted; otherwise say exact timeframes were not extracted. Shape received: \`${shape}\` (expected \`timeline\` or \`list\`).`);
  }
  if (r.id === "Q18") {
    notes.push(`Acceptance: quote §1 directly if snippet contains it; no meta-response asking the user to re-request. Shape received: \`${shape}\` (expected \`quote\`).`);
  }
  if (notes.length) {
    lines.push(`### Notes`);
    lines.push(``);
    for (const n of notes) lines.push(`- ${n}`);
    lines.push(``);
  }
}

const md = lines.join("\n");
writeFileSync("reports/quality-audit/step3b-intent-diff.md", md);
writeFileSync("/mnt/documents/quality-audit/step3b-intent-diff.md", md);
console.log(`[step3b] wrote reports/quality-audit/step3b-intent-diff.md (${md.length} bytes)`);
