// Step 3 — analyzer answer_intent → drafter validation runner.
// Runs Q01, Q02, Q03, Q08, Q09, Q13, Q14, Q17, Q18 against the deployed
// pipeline (which now carries the answer_intent extension), captures raw
// output + analyzer.answer_intent, then writes reports/quality-audit/
// step3-intent-diff.md diffing against the prior baseline in
// reports/quality-audit/runs/*.json.

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";

if (!SUPABASE_URL || !SR_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const VALIDATION_IDS = ["Q01","Q02","Q03","Q08","Q09","Q13","Q14","Q17","Q18"];

type Golden = { id: string; category: string; query: string; test_intent?: string };
const goldenRaw = JSON.parse(
  readFileSync("reports/quality-audit/golden-set.json", "utf8"),
);
const GOLDEN: Golden[] = goldenRaw.questions.filter((q: Golden) =>
  VALIDATION_IDS.includes(q.id),
);

const OUT_DIR = "reports/quality-audit/runs-step3";
const ART_DIR = "/mnt/documents/quality-audit/runs-step3";
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

console.log(`[step3] triggering ${GOLDEN.length} runs (concurrency=3)`);
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

console.log(`[step3] polling for completions...`);
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
  console.log(`[${g.id}] done ok=${raw.ok} shape=${answer_intent?.output_shape ?? "-"} posture=${answer_intent?.confidence_posture ?? "-"}`);
  return raw;
}));

// ---- Build markdown diff report ----------------------------------------
function loadBaseline(id: string) {
  const p = `reports/quality-audit/runs/${id}.json`;
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
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
function fmtIntent(ai: any): string {
  if (!ai) return "_(not emitted)_";
  return [
    `- **output_shape:** \`${ai.output_shape}\``,
    `- **confidence_posture:** \`${ai.confidence_posture}\``,
    `- **must_include:** ${(ai.must_include ?? []).length ? ai.must_include.map((s:string)=>`\`${s}\``).join(", ") : "_(none)_"}`,
    `- **must_avoid:** ${(ai.must_avoid ?? []).length ? ai.must_avoid.map((s:string)=>`\`${s}\``).join(", ") : "_(none)_"}`,
  ].join("\n");
}

const lines: string[] = [];
lines.push(`# Step 3 — analyzer \`answer_intent\` → drafter — validation diff`);
lines.push("");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("");
lines.push(`Validation set: ${VALIDATION_IDS.join(", ")}`);
lines.push("");
lines.push(`**Before** = baseline from \`reports/quality-audit/runs/*.json\` (2026-07-23 rerun, no answer_intent).`);
lines.push(`**After**  = this run (analyzer emits \`answer_intent\`, drafter consumes it).`);
lines.push("");
lines.push("Verdicts (improved / regressed / neutral) below are automated placeholders where present; manual notes follow for Q03/Q13/Q14/Q18 and regression checks for Q01/Q02/Q17 based on objective signals available at generation time.");
lines.push("");

for (const r of perQ) {
  const before = loadBaseline(r.id);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## ${r.id} — ${r.category ?? "?"}`);
  lines.push(``);
  lines.push(`**Query:**\n\n> ${r.query}`);
  lines.push(``);
  lines.push(`### analyzer.answer_intent (AFTER)`);
  lines.push(fmtIntent(r.answer_intent));
  lines.push(``);
  if (r.error) {
    lines.push(`> ⚠ Runner error: \`${r.error}\``);
    continue;
  }
  lines.push(`### Answer body`);
  lines.push(``);
  lines.push(`<details><summary>BEFORE (${before ? "baseline" : "no baseline found"})</summary>\n\n${before?.answer ?? "_(baseline missing)_"}\n\n</details>`);
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
  const ai = r.answer_intent;
  if (r.id === "Q01") {
    notes.push(`Regression check — expected shape \`case_holding\`, posture \`direct_if_primary_present\`. Got shape=\`${ai?.output_shape ?? "-"}\`, posture=\`${ai?.confidence_posture ?? "-"}\`. Must preserve prior good answer; look for holding statement grounded in the judgment.`);
  }
  if (r.id === "Q02") {
    notes.push(`Regression check — expected shape \`case_holding\`, posture \`refuse_specific_holding_if_primary_missing\`. Got shape=\`${ai?.output_shape ?? "-"}\`, posture=\`${ai?.confidence_posture ?? "-"}\`. Must NOT invent a holding when the judgment is missing.`);
  }
  if (r.id === "Q03") {
    notes.push(`Manual — expected shape \`definition_elements\`. Got shape=\`${ai?.output_shape ?? "-"}\`. First paragraph should open with the statutory definition/elements, not general framing.`);
  }
  if (r.id === "Q13") {
    notes.push(`Manual — expected shape \`timeframe_table\`. Got shape=\`${ai?.output_shape ?? "-"}\`. Must show concrete numeric timeframes or explicitly say exact timeframes were not extracted.`);
  }
  if (r.id === "Q14") {
    notes.push(`Manual — expected shape \`enumerate_duties\`. Got shape=\`${ai?.output_shape ?? "-"}\`. Must enumerate AML duties + timing rather than stay general.`);
  }
  if (r.id === "Q17") {
    notes.push(`Regression check — must preserve the "not always" answer. Got shape=\`${ai?.output_shape ?? "-"}\`, posture=\`${ai?.confidence_posture ?? "-"}\`.`);
  }
  if (r.id === "Q18") {
    notes.push(`Manual — expected shape \`verbatim_quote\`. Got shape=\`${ai?.output_shape ?? "-"}\`. Must either quote §1 verbatim or plainly say the official source was found but exact text was not extracted; must NOT ask the user to re-request the quote.`);
  }
  if (notes.length) {
    lines.push(`### Notes`);
    lines.push(``);
    for (const n of notes) lines.push(`- ${n}`);
    lines.push(``);
  }
}

const md = lines.join("\n");
writeFileSync("reports/quality-audit/step3-intent-diff.md", md);
writeFileSync("/mnt/documents/quality-audit/step3-intent-diff.md", md);
console.log(`[step3] wrote reports/quality-audit/step3-intent-diff.md (${md.length} bytes)`);
