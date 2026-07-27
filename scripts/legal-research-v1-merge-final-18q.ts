// Narrow default-on merge — post-merge 18-question regression.
// Captures the new telemetry fields (deterministic_branch,
// missing_docket_limitation_fired, statute_section_limitation_fired,
// canonical_quote_fired) plus lead_ref and anchor status.
// Baseline: reports/quality-audit/runs-leadref-full/*.json (pre-merge lead_ref run).

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID =
  process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

type Golden = { id: string; category: string; query: string };
const golden = JSON.parse(
  readFileSync("reports/quality-audit/golden-set.json", "utf8"),
).questions as Golden[];

const OUT = "reports/quality-audit/runs-merge-final";
const ART = "/mnt/documents/quality-audit/runs-merge-final";
mkdirSync(OUT, { recursive: true });
mkdirSync(ART, { recursive: true });

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      "x-smoke-mode": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string };
}
async function poll(run_id: string, timeoutMs = 900_000) {
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
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

console.log(`[merge-final] triggering ${golden.length} runs`);
const triggered: Array<{ g: Golden; run_id: string | null }> = [];
const CONC = 3;
for (let i = 0; i < golden.length; i += CONC) {
  const batch = golden.slice(i, i + CONC);
  const out = await Promise.all(batch.map(async (g) => {
    try {
      const t = await trigger(g.query);
      console.log(`[${g.id}] triggered run_id=${t.run_id}`);
      return { g, run_id: t.run_id ?? null };
    } catch (e) {
      console.error(`[${g.id}] trigger err`, e);
      return { g, run_id: null };
    }
  }));
  triggered.push(...out);
  if (i + CONC < golden.length) await new Promise((r) => setTimeout(r, 4000));
}

function anchorStatusSummary(md: any) {
  const st = md?.requiredAnchors?.statuses ?? md?.retrieval?.requiredAnchors?.statuses ?? [];
  if (!Array.isArray(st)) return { direct: 0, partial: 0, missing: 0, entries: [] };
  const entries = st.map((a: any) => ({
    description: a.description ?? a.ref ?? "?",
    status: a.status ?? "?",
    verified_support: a.verified_support ?? null,
  }));
  // Anchor pipeline statuses: "cited" | "emitted" | "missing".
  // Map to D/P/M using verified_support when available (direct/partial), and
  // fall back to status: cited→direct, emitted→partial, missing→missing.
  const bucket = (e: any): "direct" | "partial" | "missing" => {
    if (e.verified_support === "direct") return "direct";
    if (e.verified_support === "partial") return "partial";
    if (e.status === "cited") return "direct";
    if (e.status === "emitted") return "partial";
    if (e.status === "missing") return "missing";
    return "missing";
  };
  const direct = entries.filter((e: any) => bucket(e) === "direct").length;
  const partial = entries.filter((e: any) => bucket(e) === "partial").length;
  const missing = entries.filter((e: any) => bucket(e) === "missing").length;
  return { direct, partial, missing, entries };
}

const perQ = await Promise.all(triggered.map(async ({ g, run_id }) => {
  const base: any = { id: g.id, category: g.category, query: g.query, run_id };
  if (!run_id) return { ...base, error: "trigger_failed" };
  const row = await poll(run_id);
  if (!row) return { ...base, error: "poll_timeout" };
  const md: any = row.metadata ?? {};
  const d: any = md.drafter ?? {};
  const anchors = anchorStatusSummary(md);
  const raw = {
    ...base,
    ok: d.ok === true,
    total_ms: md.total_ms ?? null,
    answer_intent: md?.planning?.analyzer?.answer_intent ?? null,
    lead_ref: d.lead_ref ?? null,
    deterministic_branch: d.deterministic_branch ?? null,
    missing_docket_limitation_fired: d.missing_docket_limitation_fired === true,
    statute_section_limitation_fired: d.statute_section_limitation_fired === true,
    canonical_quote_fired: d.canonical_quote_fired === true,
    anchor_status: anchors,
    missing_required_anchors: md?.retrieval?.missingRequiredAnchors ?? md?.missingRequiredAnchors ?? null,
    answer: row.answer ?? "",
    footnotes: row.footnotes ?? [],
    used_sources: d.used_sources ?? [],
    verifier_counts: md?.verifier?.counts ?? null,
  };
  writeFileSync(`${OUT}/${g.id}.json`, JSON.stringify(raw, null, 2));
  writeFileSync(`${ART}/${g.id}.json`, JSON.stringify(raw, null, 2));
  console.log(
    `[${g.id}] ok=${raw.ok} shape=${raw.answer_intent?.output_shape ?? "-"} lead=${raw.lead_ref?.ref ?? "-"}(${raw.lead_ref?.reason ?? "-"}) branch=${raw.deterministic_branch ?? "-"} anchors=D${anchors.direct}/P${anchors.partial}/M${anchors.missing} src=${raw.used_sources.length}`,
  );
  return raw;
}));

// ---------------- Report ----------------
function loadBase(id: string) {
  const p = `reports/quality-audit/runs-leadref-full/${id}.json`;
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
const isStub = (a: string) => !a || /\[stub\]|התשובה תיווצר בשלב/.test(a);
const fabricated = (a: string, fn: any[], us: any[]) => {
  const n = Math.max(fn?.length ?? 0, us?.length ?? 0);
  return [...a.matchAll(/\[(\d+)\]/g)].some((m) => Number(m[1]) > n);
};

const rows: string[] = [
  "| Q | shape | lead_ref | reason | branch | anchors D/P/M | src | stub | fab | notes |",
  "|---|---|---|---|---|---|---:|---|---|---|",
];
const lines: string[] = [];
lines.push(`# Merge-final — 18-question regression (post narrow default-on merge)`);
lines.push(``);
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(``);
lines.push(`**Pipeline:** \`legal-research-v1\` merged narrow default-on: lead_ref for case_holding/definition/quote only; deterministic branches for docket_limitation, statute_section_limitation, canonical_quote.`);
lines.push(``);
lines.push(`## Acceptance checks`);
lines.push(``);

const IGNORE = new Set([
  "output.name",
  "output.name.name",
]);
IGNORE.clear();

for (const r of perQ) {
  const before = loadBase(r.id);
  const shape = r.answer_intent?.output_shape ?? "-";
  const stub = isStub(r.answer);
  const fab = fabricated(r.answer, r.footnotes ?? [], r.used_sources ?? []);
  const eligible = ["case_holding", "definition", "quote"].includes(shape);
  const leadRef = r.lead_ref?.ref ?? null;
  const leadReason = r.lead_ref?.reason ?? "-";
  const flags: string[] = [];
  if (!eligible && leadRef) flags.push("lead_on_ineligible_shape");
  if (stub) flags.push("stub");
  if (fab) flags.push("fabricated_citation");
  if (r.id === "Q02") {
    const refuses = /לא אותר|לא נמצא|לא הובא פסק|אין במקורות|לא ניתן לקבוע/.test(r.answer);
    flags.push(refuses ? "Q02_refusal_preserved" : "Q02_refusal_LOST");
  }
  if (r.id === "Q18") {
    const knesset = (r.used_sources ?? []).some((s: any) => (s.url ?? "").includes("knesset.gov.il"));
    flags.push(knesset ? "Q18_official_kept" : "Q18_official_LOST");
    if (!r.canonical_quote_fired) flags.push("Q18_canonical_NOT_fired");
  }
  if (r.id === "Q03") {
    const partial = r.anchor_status?.partial ?? 0;
    const missing = r.anchor_status?.missing ?? 0;
    if ((partial + missing) > 0 && shape === "definition" && !r.statute_section_limitation_fired) {
      flags.push("Q03_partial_but_no_limitation");
    }
  }

  const a = r.anchor_status ?? { direct: 0, partial: 0, missing: 0 };
  rows.push(
    `| ${r.id} | ${shape} | ${leadRef ?? "-"} | ${leadReason} | ${r.deterministic_branch ?? "-"} | ${a.direct}/${a.partial}/${a.missing} | ${r.used_sources?.length ?? 0} | ${stub ? "YES" : "no"} | ${fab ? "YES" : "no"} | ${flags.join(", ") || "-"} |`,
  );

  lines.push(`---`);
  lines.push(``);
  lines.push(`## ${r.id} — ${r.category ?? "?"}`);
  lines.push(``);
  lines.push(`**Query:**\n\n> ${r.query}`);
  lines.push(``);
  lines.push(`- **shape:** \`${shape}\` (eligible=${eligible})`);
  lines.push(`- **lead_ref:** \`${leadRef ?? "null"}\` — reason: \`${leadReason}\``);
  lines.push(`- **deterministic_branch:** \`${r.deterministic_branch ?? "none"}\``);
  lines.push(`- **telemetry flags:** missing_docket_limitation=${r.missing_docket_limitation_fired}, statute_section_limitation=${r.statute_section_limitation_fired}, canonical_quote=${r.canonical_quote_fired}`);
  lines.push(`- **anchor status:** direct=${a.direct} partial=${a.partial} missing=${a.missing}`);
  lines.push(`  - entries: ${JSON.stringify(a.entries ?? [])}`);
  lines.push(`- **used_sources:** BEFORE ${before?.used_sources?.length ?? 0} → AFTER ${r.used_sources?.length ?? 0}`);
  lines.push(`- **flags:** ${flags.length ? flags.map((f) => `\`${f}\``).join(", ") : "_(none)_"}`);
  lines.push(``);
  lines.push(`### Answer body`);
  lines.push(``);
  lines.push(`<details><summary>BEFORE (lead_ref baseline)</summary>\n\n${before?.answer || "_(baseline missing)_"}\n\n</details>`);
  lines.push(``);
  lines.push(`<details open><summary>AFTER (merge-final)</summary>\n\n${r.answer || "_(empty)_"}\n\n</details>`);
  lines.push(``);
  lines.push(`### used_sources AFTER`);
  lines.push((r.used_sources ?? []).map((s: any, i: number) => `${i + 1}. **${s.title ?? "(no title)"}** — ${s.source_type ?? "?"} — ${s.url ?? ""}`).join("\n") || "_(none)_");
  lines.push(``);
}

// Aggregate telemetry
const branchCounts: Record<string, number> = {};
for (const r of perQ) {
  const b = r.deterministic_branch ?? "llm_drafter";
  branchCounts[b] = (branchCounts[b] ?? 0) + 1;
}
const top = [
  `# Merge-final — 18-question regression`,
  ``,
  `Generated: ${new Date().toISOString()}`,
  ``,
  `## Deterministic branch distribution`,
  ``,
  ...Object.entries(branchCounts).map(([k, v]) => `- \`${k}\`: ${v}`),
  ``,
  `## Summary matrix`,
  ``,
  ...rows,
  ``,
];
const md = top.concat(lines).join("\n");
writeFileSync("reports/quality-audit/merge-final-regression.md", md);
writeFileSync("/mnt/documents/quality-audit/merge-final-regression.md", md);
console.log(`[merge-final] wrote reports/quality-audit/merge-final-regression.md (${md.length} bytes)`);
