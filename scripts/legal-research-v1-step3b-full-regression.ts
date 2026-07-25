// Step 3b — full 18-question regression runner.
// Runs the entire golden set against the deployed pipeline (analyzer emits
// only { output_shape }, drafter treats it as a format hint) and produces
// reports/quality-audit/step3b-full-regression.md diffing against the
// 2026-07-23 baseline in reports/quality-audit/runs/*.json.
//
// Does NOT modify code. Read-only relative to the pipeline.

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";

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
};
const goldenRaw = JSON.parse(
  readFileSync("reports/quality-audit/golden-set.json", "utf8"),
);
const GOLDEN: Golden[] = goldenRaw.questions;
console.log(`[reg] golden set size = ${GOLDEN.length}`);

const OUT_DIR = "reports/quality-audit/runs-step3b-full";
const ART_DIR = "/mnt/documents/quality-audit/runs-step3b-full";
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

console.log(`[reg] triggering ${GOLDEN.length} runs (concurrency=3)`);
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
  if (i + CONCURRENCY < GOLDEN.length) {
    await new Promise((r) => setTimeout(r, 4000));
  }
}

console.log(`[reg] polling for completions...`);
const perQ = await Promise.all(triggered.map(async ({ g, run_id }) => {
  const base: any = {
    id: g.id, category: g.category, query: g.query, run_id,
  };
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
    missing_required_anchors: md?.retrieval?.missingRequiredAnchors ?? md?.missingRequiredAnchors ?? null,
  };
  writeFileSync(`${OUT_DIR}/${g.id}.json`, JSON.stringify(raw, null, 2));
  writeFileSync(`${ART_DIR}/${g.id}.json`, JSON.stringify(raw, null, 2));
  console.log(`[${g.id}] done ok=${raw.ok} shape=${answer_intent?.output_shape ?? "-"} sources=${raw.used_sources.length}`);
  return raw;
}));

// ---- Objective checks + report -----------------------------------------
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
  return list.map((f: any, i: number) =>
    `[${f.index ?? i + 1}] ${f.text ?? f.markdown ?? JSON.stringify(f)}`,
  ).join("\n\n");
}

function isStub(answer: string): boolean {
  if (!answer) return true;
  return /\[stub\]|התשובה תיווצר בשלב/.test(answer);
}

function checkFabricated(answer: string, footnotes: any[], used: any[]): boolean {
  // Rough heuristic: any [n] cite in answer must be within footnotes count.
  const nMax = Math.max(footnotes?.length ?? 0, used?.length ?? 0);
  const cites = Array.from(answer.matchAll(/\[(\d+)\]/g)).map((m) => Number(m[1]));
  return cites.some((n) => n > nMax);
}

function checkHebrewIssues(answer: string): string[] {
  const issues: string[] = [];
  if (/lorem|placeholder|TODO/i.test(answer)) issues.push("english_placeholder");
  if (/\b(as an AI|I cannot|I am unable)\b/i.test(answer)) issues.push("english_refusal");
  if (answer.length && !/[\u0590-\u05FF]/.test(answer)) issues.push("no_hebrew_chars");
  return issues;
}

function overlapUrls(a: any[], b: any[]): { added: string[]; removed: string[]; common: number } {
  const norm = (u: string) => (u ?? "").split("#")[0].replace(/\/$/, "").toLowerCase();
  const A = new Set((a ?? []).map((s: any) => norm(s.url ?? "")).filter(Boolean));
  const B = new Set((b ?? []).map((s: any) => norm(s.url ?? "")).filter(Boolean));
  const added = [...A].filter((u) => !B.has(u));
  const removed = [...B].filter((u) => !A.has(u));
  const common = [...A].filter((u) => B.has(u)).length;
  return { added, removed, common };
}

const summaryRows: string[] = [
  "| Q | shape | src B→A | Δsrc | stub | fabricated | direct? | overclaim? | quote/def/list/tl improved? | notes |",
  "|---|---|---:|---:|---|---|---|---|---|---|",
];

const lines: string[] = [];
lines.push(`# Step 3b — full 18-question regression`);
lines.push(``);
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(``);
lines.push(`**Pipeline:** \`legal-research-v1\` with slim \`answer_intent = { output_shape }\` (deployed).`);
lines.push(`**Baseline:** 2026-07-23 rerun in \`reports/quality-audit/runs/*.json\` (no \`answer_intent\`).`);
lines.push(``);
lines.push(`## Per-question detail`);
lines.push(``);

for (const r of perQ) {
  const before = loadBaseline(r.id);
  const beforeAnswer: string = before?.answer ?? "";
  const afterAnswer: string = r.answer ?? "";
  const shape = r.answer_intent?.output_shape ?? "-";
  const stubBefore = isStub(beforeAnswer);
  const stubAfter = isStub(afterAnswer);
  const fabAfter = checkFabricated(afterAnswer, r.footnotes ?? [], r.used_sources ?? []);
  const heb = checkHebrewIssues(afterAnswer);
  const truncated = afterAnswer.length > 0 && afterAnswer.length < 400;
  const overlap = overlapUrls(r.used_sources ?? [], before?.used_sources ?? []);
  const dSrc = (r.used_sources?.length ?? 0) - (before?.used_sources?.length ?? 0);

  // Heuristic flags
  const flags: string[] = [];
  // source soup increased/decreased (arbitrary threshold: >2 net change)
  if (dSrc > 2) flags.push("source_soup_increased");
  else if (dSrc < -2) flags.push("source_soup_decreased");
  // becoming more direct: shorter opening paragraph, fewer hedges
  const hedgeRe = /(ייתכן|יש להדגיש|באופן כללי|באופן עקרוני|מבלי להיכנס)/g;
  const hedgeBefore = (beforeAnswer.match(hedgeRe) ?? []).length;
  const hedgeAfter = (afterAnswer.match(hedgeRe) ?? []).length;
  if (hedgeAfter < hedgeBefore - 1) flags.push("more_direct");
  if (hedgeAfter > hedgeBefore + 1) flags.push("more_hedged");
  // overclaim heuristic: any strong holding/definitive words when missing anchors
  if (
    r.missing_required_anchors && Array.isArray(r.missing_required_anchors) &&
    r.missing_required_anchors.length > 0 &&
    /(נקבע כי|בית המשפט קבע|החוק בטל|התקבל(ה)? על ידי בית המשפט)/.test(afterAnswer)
  ) flags.push("possible_overclaim");
  // missing-source behavior preserved (Q02-style)
  if (r.id === "Q02") {
    const refuses = /אין במקורות שסופקו|לא ניתן לקבוע|לא הובא פסק הדין|יש להביא את פסק הדין/.test(afterAnswer);
    flags.push(refuses ? "missing_source_behavior_preserved" : "missing_source_behavior_LOST");
  }
  // format hint tangible improvement
  if (shape === "quote" && /^\s*["״].*["״]|סעיף 1\.?\s|\.\s*1\s/.test(afterAnswer)) flags.push("quote_ok");
  if (shape === "definition" && /(הגדרה|כדלקמן|יסודות|רכיבים)/.test(afterAnswer.slice(0, 400))) flags.push("definition_first_ok");
  if (shape === "list" && /(- |•|1\.\s|2\.\s)/.test(afterAnswer)) flags.push("list_ok");
  if (shape === "timeline" && /(\d+\s*(ימים|חודש|שנה|שנים))/.test(afterAnswer)) flags.push("timeline_ok");
  // register / Hebrew regressions
  for (const h of heb) flags.push(`hebrew:${h}`);
  if (truncated) flags.push("severe_truncation");
  if (stubAfter && !stubBefore) flags.push("new_stub");
  if (fabAfter) flags.push("fabricated_citation");

  summaryRows.push(
    `| ${r.id} | ${shape} | ${(before?.used_sources?.length ?? 0)}→${r.used_sources?.length ?? 0} | ${dSrc >= 0 ? "+" : ""}${dSrc} | ${stubAfter ? "YES" : "no"} | ${fabAfter ? "YES" : "no"} | ${flags.includes("more_direct") ? "yes" : flags.includes("more_hedged") ? "less" : "="} | ${flags.includes("possible_overclaim") ? "MAYBE" : "no"} | ${["quote_ok","definition_first_ok","list_ok","timeline_ok"].some(f=>flags.includes(f)) ? "yes" : "-"} | ${flags.filter(f=>!["quote_ok","definition_first_ok","list_ok","timeline_ok","more_direct","more_hedged"].includes(f)).join(", ") || "-"} |`,
  );

  lines.push(`---`);
  lines.push(``);
  lines.push(`## ${r.id} — ${r.category ?? "?"}`);
  lines.push(``);
  lines.push(`**Query:**\n\n> ${r.query}`);
  lines.push(``);
  lines.push(`- **shape:** \`${shape}\``);
  lines.push(`- **used_sources:** BEFORE ${(before?.used_sources?.length ?? 0)} → AFTER ${r.used_sources?.length ?? 0} (common ${overlap.common}, added ${overlap.added.length}, removed ${overlap.removed.length})`);
  lines.push(`- **verifier_counts:** ${JSON.stringify(r.verifier_counts)}`);
  lines.push(`- **missing_required_anchors:** ${JSON.stringify(r.missing_required_anchors)}`);
  lines.push(`- **flags:** ${flags.length ? flags.map((f) => `\`${f}\``).join(", ") : "_(none)_"}`);
  lines.push(``);
  lines.push(`### Answer body`);
  lines.push(``);
  lines.push(`<details><summary>BEFORE</summary>\n\n${beforeAnswer || "_(baseline missing)_"}\n\n</details>`);
  lines.push(``);
  lines.push(`<details><summary>AFTER</summary>\n\n${afterAnswer || "_(empty)_"}\n\n</details>`);
  lines.push(``);
  lines.push(`### Footnotes`);
  lines.push(``);
  lines.push(`<details><summary>BEFORE</summary>\n\n${fmtFootnotes(before?.footnotes ?? [])}\n\n</details>`);
  lines.push(``);
  lines.push(`<details><summary>AFTER</summary>\n\n${fmtFootnotes(r.footnotes ?? [])}\n\n</details>`);
  lines.push(``);
  lines.push(`### used_sources`);
  lines.push(``);
  lines.push(`<details><summary>BEFORE (${before?.used_sources?.length ?? 0})</summary>\n\n${fmtSources(before?.used_sources ?? [])}\n\n</details>`);
  lines.push(``);
  lines.push(`<details><summary>AFTER (${r.used_sources?.length ?? 0})</summary>\n\n${fmtSources(r.used_sources ?? [])}\n\n</details>`);
  lines.push(``);
}

const top = [
  `# Step 3b — full 18-question regression`,
  ``,
  `Generated: ${new Date().toISOString()}`,
  ``,
  `## Summary matrix`,
  ``,
  ...summaryRows,
  ``,
  `Legend: \`Δsrc\` = net change in used_sources count vs baseline. \`direct?\` = fewer hedging phrases than baseline. \`overclaim?\` heuristic fires only when a required primary anchor is missing but the answer contains a strong holding statement.`,
  ``,
];
const md = top.concat(lines).join("\n");
writeFileSync("reports/quality-audit/step3b-full-regression.md", md);
writeFileSync("/mnt/documents/quality-audit/step3b-full-regression.md", md);
console.log(`[reg] wrote reports/quality-audit/step3b-full-regression.md (${md.length} bytes)`);
