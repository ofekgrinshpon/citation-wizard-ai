// Lead_ref full 18-question regression.
// Assumes lead_ref is enabled in-code for eligible shapes (case_holding / definition / quote).
// Captures lead_ref telemetry alongside answer / footnotes / used_sources
// and diffs against the Step 3b baseline in reports/quality-audit/runs-step3b-full/*.json.

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

const OUT = "reports/quality-audit/runs-leadref-full";
const ART = "/mnt/documents/quality-audit/runs-leadref-full";
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

console.log(`[leadref-full] triggering ${golden.length} runs`);
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

const perQ = await Promise.all(triggered.map(async ({ g, run_id }) => {
  const base: any = { id: g.id, category: g.category, query: g.query, run_id };
  if (!run_id) return { ...base, error: "trigger_failed" };
  const row = await poll(run_id);
  if (!row) return { ...base, error: "poll_timeout" };
  const md: any = row.metadata ?? {};
  const d: any = md.drafter ?? {};
  const raw = {
    ...base,
    ok: d.ok === true,
    total_ms: md.total_ms ?? null,
    answer_intent: md?.planning?.analyzer?.answer_intent ?? null,
    lead_ref: d.lead_ref ?? null,
    missing_required_anchors: md?.retrieval?.missingRequiredAnchors ?? md?.missingRequiredAnchors ?? null,
    answer: row.answer ?? "",
    footnotes: row.footnotes ?? [],
    used_sources: d.used_sources ?? [],
    verifier_counts: md?.verifier?.counts ?? null,
  };
  writeFileSync(`${OUT}/${g.id}.json`, JSON.stringify(raw, null, 2));
  writeFileSync(`${ART}/${g.id}.json`, JSON.stringify(raw, null, 2));
  console.log(
    `[${g.id}] ok=${raw.ok} shape=${raw.answer_intent?.output_shape ?? "-"} lead_ref=${raw.lead_ref?.ref ?? "-"} reason=${raw.lead_ref?.reason ?? "-"} src=${raw.used_sources.length}`,
  );
  return raw;
}));

// ----- Report -----
function loadBase(id: string) {
  const p = `reports/quality-audit/runs-step3b-full/${id}.json`;
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
const isStub = (a: string) => !a || /\[stub\]|התשובה תיווצר בשלב/.test(a);
const fabricated = (a: string, fn: any[], us: any[]) => {
  const n = Math.max(fn?.length ?? 0, us?.length ?? 0);
  return [...a.matchAll(/\[(\d+)\]/g)].some((m) => Number(m[1]) > n);
};
const norm = (u: string) => (u ?? "").split("#")[0].replace(/\/$/, "").toLowerCase();

const rows: string[] = [
  "| Q | shape | lead_ref | reason | src B→A | Δsrc | stub | fab | notes |",
  "|---|---|---|---|---:|---:|---|---|---|",
];
const lines: string[] = [];
lines.push(`# Lead_ref — full 18-question regression`);
lines.push(``);
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(``);
lines.push(`**Pipeline:** \`legal-research-v1\` with lead_ref enabled deterministically for eligible shapes only (\`case_holding\`, \`definition\`, \`quote\`).`);
lines.push(`**Baseline:** Step 3b full regression (\`reports/quality-audit/runs-step3b-full/*.json\`) — same pipeline without lead_ref.`);
lines.push(``);
lines.push(`## Per-question detail`);
lines.push(``);

for (const r of perQ) {
  const before = loadBase(r.id);
  const shape = r.answer_intent?.output_shape ?? "-";
  const stub = isStub(r.answer);
  const fab = fabricated(r.answer, r.footnotes ?? [], r.used_sources ?? []);
  const bUrls = new Set((before?.used_sources ?? []).map((s: any) => norm(s.url)).filter(Boolean));
  const aUrls = new Set((r.used_sources ?? []).map((s: any) => norm(s.url)).filter(Boolean));
  const common = [...aUrls].filter((u) => bUrls.has(u)).length;
  const added = [...aUrls].filter((u) => !bUrls.has(u));
  const removed = [...bUrls].filter((u) => !aUrls.has(u));
  const dSrc = (r.used_sources?.length ?? 0) - (before?.used_sources?.length ?? 0);
  const eligible = ["case_holding", "definition", "quote"].includes(shape);
  const leadRef = r.lead_ref?.ref ?? null;
  const leadReason = r.lead_ref?.reason ?? "-";
  const flags: string[] = [];
  if (eligible && !leadRef) flags.push(`lead_absent(${leadReason})`);
  if (!eligible && leadRef) flags.push("lead_on_ineligible_shape");
  if (Array.isArray(r.missing_required_anchors) && r.missing_required_anchors.length > 0 && leadRef) {
    flags.push("lead_despite_missing_anchor");
  }
  if (stub) flags.push("stub");
  if (fab) flags.push("fabricated_citation");
  if (r.id === "Q02") {
    const refuses = /אין במקורות שסופקו|לא ניתן לקבוע|לא הובא פסק הדין|יש להביא את פסק הדין|לא נמצא|לא אותר/.test(r.answer);
    flags.push(refuses ? "Q02_refusal_preserved" : "Q02_refusal_LOST");
  }
  if (r.id === "Q18") {
    const knesset = (r.used_sources ?? []).some((s: any) => (s.url ?? "").includes("knesset.gov.il"));
    flags.push(knesset ? "Q18_official_kept" : "Q18_official_LOST");
  }

  rows.push(
    `| ${r.id} | ${shape} | ${leadRef ?? "-"} | ${leadReason} | ${(before?.used_sources?.length ?? 0)}→${r.used_sources?.length ?? 0} | ${dSrc >= 0 ? "+" : ""}${dSrc} | ${stub ? "YES" : "no"} | ${fab ? "YES" : "no"} | ${flags.join(", ") || "-"} |`,
  );

  lines.push(`---`);
  lines.push(``);
  lines.push(`## ${r.id} — ${r.category ?? "?"}`);
  lines.push(``);
  lines.push(`**Query:**\n\n> ${r.query}`);
  lines.push(``);
  lines.push(`- **shape:** \`${shape}\` (eligible=${eligible})`);
  lines.push(`- **lead_ref:** \`${leadRef ?? "null"}\` — reason: \`${leadReason}\``);
  lines.push(`- **used_sources:** BEFORE ${before?.used_sources?.length ?? 0} → AFTER ${r.used_sources?.length ?? 0} (common ${common}, added ${added.length}, removed ${removed.length})`);
  lines.push(`- **missing_required_anchors:** ${JSON.stringify(r.missing_required_anchors)}`);
  lines.push(`- **verifier_counts:** ${JSON.stringify(r.verifier_counts)}`);
  lines.push(`- **flags:** ${flags.length ? flags.map((f) => `\`${f}\``).join(", ") : "_(none)_"}`);
  lines.push(``);
  lines.push(`### Answer body`);
  lines.push(``);
  lines.push(`<details><summary>BEFORE (Step 3b baseline)</summary>\n\n${before?.answer || "_(baseline missing)_"}\n\n</details>`);
  lines.push(``);
  lines.push(`<details><summary>AFTER (lead_ref)</summary>\n\n${r.answer || "_(empty)_"}\n\n</details>`);
  lines.push(``);
  lines.push(`### used_sources AFTER`);
  lines.push((r.used_sources ?? []).map((s: any, i: number) => `${i + 1}. **${s.title ?? "(no title)"}** — ${s.source_type ?? "?"} — ${s.url ?? ""}`).join("\n") || "_(none)_");
  lines.push(``);
}

const top = [
  `# Lead_ref — full 18-question regression`,
  ``,
  `Generated: ${new Date().toISOString()}`,
  ``,
  `## Summary matrix`,
  ``,
  ...rows,
  ``,
];
const md = top.concat(lines).join("\n");
writeFileSync("reports/quality-audit/leadref-full-regression.md", md);
writeFileSync("/mnt/documents/quality-audit/leadref-full-regression.md", md);
console.log(`[leadref-full] wrote reports/quality-audit/leadref-full-regression.md (${md.length} bytes)`);
