// internal_dogfooding_6 — export-only run. No product code changes.
// Runs 6 real legal-research questions sequentially and exports the exact
// user-facing answers + telemetry to reports/internal-dogfooding-6/REPORT.md.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }
const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
const TERMINAL = new Set(["done", "error", "failed", "timeout", "completed"]);

const ALL = [
  { id: "D1", topic: "מידתיות / ביקורת חוקתית", query: `מהם מבחני המידתיות בביקורת חוקתית בישראל, וכיצד הם מיושמים כאשר חוק פוגע בזכות יסוד?` },
  { id: "D2", topic: "עילת הסבירות / מינהלי", query: `מהי עילת הסבירות במשפט המינהלי הישראלי, ומה ההבדל בינה לבין שיקולים זרים וחריגה מסמכות?` },
  { id: "D3", topic: "בג״ץ ובית דין רבני / רכוש", query: `מתי בג״ץ יתערב בהחלטה של בית דין רבני בענייני רכוש בין בני זוג, במיוחד כאשר נטען שבית הדין החיל דין דתי במקום דין אזרחי?` },
  { id: "D4", topic: "תום לב במו״מ / סעיף 12", query: `מהו היקף חובת תום הלב במשא ומתן לפי סעיף 12 לחוק החוזים, ומהם הסעדים האפשריים בגין הפרתה?` },
  { id: "D5", topic: "הרמת מסך / סעיף 6", query: `באילו נסיבות בית המשפט יורה על הרמת מסך לפי סעיף 6 לחוק החברות, ומה ההבדל בין הרמת מסך לבין אחריות אישית של נושא משרה?` },
  { id: "D6", topic: "טרור / ענישה ושוויון באכיפה", query: `כיצד הסיווג של עבירה כ"מעשה טרור" או של אדם כמעורב בטרור משפיע בדין הישראלי על הענישה ועל הפעלת סמכויות חריגות, והאם הדבר מעורר קשיים של שוויון באכיפה?` },
  { id: "R02", topic: "control — exact body (בנק המזרחי)", query: `מה נקבע בע"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי?` },
  { id: "P02", topic: "control — fake docket", query: `מה נקבע בע"א 99887-04-22 לוי נ' מדינת ישראל?` },
  { id: "B8", topic: "control — canonical quote", query: `צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו.` },
  { id: "NOISE", topic: "control — generic legal query", query: `מהם השלבים העיקריים בהגשת תביעה אזרחית בבית משפט השלום בישראל?` },
];
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const QUERIES = only.length ? ALL.filter((q) => only.includes(q.id)) : ALL;

const OUT = "reports/canonical-judgment-text-acquisition";
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SUP_MAP: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
  "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};
const RUN_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu;

function markersIn(answer: string, valid: Set<number>) {
  const found: number[] = [];
  let dangling = 0;
  for (const m of answer.matchAll(RUN_RE)) {
    const digits = m[0].split("").map((c) => SUP_MAP[c] ?? c).join("");
    let i = 0;
    while (i < digits.length) {
      let matched = -1; let len = 1;
      for (let l = Math.min(digits.length - i, 4); l >= 1; l--) {
        const n = parseInt(digits.slice(i, i + l), 10);
        if (Number.isFinite(n) && valid.has(n)) { matched = n; len = l; break; }
      }
      if (matched > 0) found.push(matched); else dangling++;
      i += len;
    }
  }
  return { found, dangling };
}

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string; job_id?: string };
}

async function jobById(job_id: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/legal_research_jobs?select=id,status,current_stage,error&id=eq.${job_id}&limit=1`,
    { headers });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function qaByRun(run_id: string, sinceIso: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,metadata` +
      `&metadata->>run_id=eq.${run_id}&created_at=gte.${encodeURIComponent(sinceIso)}` +
      `&order=created_at.desc&limit=5`, { headers });
  if (!r.ok) return [];
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

function isPlaceholder(row: any): boolean {
  const a: string = row?.answer ?? "";
  const md = row?.metadata ?? {};
  if (md.trace_status === "in_progress") return true;
  if (md.status === "running" || md.status === "queued") return true;
  if (!String(a).trim()) return true;
  if (a.includes("מעבד") && a.length < 80) return true;
  return false;
}

function limitationNotices(answer: string): string[] {
  const out: string[] = [];
  const re = /\*\*[^*\n]*(מגבל|הבהרה|הערה)[^*\n]*:?\*\*[^\n]*(?:\n(?!\n)[^\n]*)*/g;
  for (const m of answer.matchAll(re)) out.push(m[0].trim());
  return out;
}

function renderSourceList(fns: any[]): string {
  if (!fns.length) return "_(אין מקורות מצוטטים)_";
  return fns.map((f: any) => {
    const subs = Array.isArray(f.sources) && f.sources.length
      ? f.sources.map((s: any) => `    - ${s.title ?? s.display_title ?? ""}${s.url ? ` — ${s.url}` : ""}`).join("\n")
      : "";
    const url = f.url ? ` — ${f.url}` : "";
    return `${f.number}. ${f.title ?? f.display_title ?? "(ללא כותרת)"}${url}${subs ? `\n${subs}` : ""}`;
  }).join("\n");
}

const results: any[] = [];

for (const q of QUERIES) {
  const t0 = Date.now();
  const launchIso = new Date(t0 - 5_000).toISOString();
  const t = await trigger(q.query).catch(() => ({} as any));
  console.log(`[${q.id}] launch job_id=${t.job_id} run_id=${t.run_id}`);
  if (!t.run_id || !t.job_id) {
    results.push({ ...q, pass: false, failures: ["trigger_failed"] });
    continue;
  }

  let job: any = null;
  const deadline = Date.now() + 900_000;
  while (Date.now() < deadline) {
    job = await jobById(t.job_id);
    if (job && TERMINAL.has(String(job.status))) break;
    console.log(`[${q.id}] poll ${Math.round((Date.now() - t0) / 1000)}s status=${job?.status} stage=${job?.current_stage}`);
    await sleep(10_000);
  }
  const terminal = !!job && TERMINAL.has(String(job.status));

  let row: any = null;
  if (terminal) {
    for (let i = 0; i < 6 && !row; i++) {
      const rows = await qaByRun(t.run_id, launchIso);
      row = rows.find((r: any) => !isPlaceholder(r)) ?? null;
      if (!row) await sleep(5_000);
    }
  }

  const md: any = row?.metadata ?? {};
  const d: any = md.drafter ?? {};
  const answer: string = (row?.answer ?? d.answer_markdown ?? "") as string;
  const fns: any[] = (row?.footnotes ?? d.footnotes ?? []) as any[];
  const usedSources: any[] = d.used_sources ?? [];
  const branch = d.deterministic_branch ?? md.deterministic_branch ?? null;
  const csm = d.claim_source_match ?? md.claim_source_match ?? null;
  const report = d.footnote_render_report ?? md.footnote_render_report ?? null;

  const valid = new Set<number>(fns.map((f: any) => Number(f.number)));
  const { found, dangling } = markersIn(answer, valid);
  const markerSet = new Set(found);
  const orphanRows = fns.filter((f: any) => !markerSet.has(Number(f.number))).length;

  const metadataOnly = (d.metadata_only_holdings_count ?? md.metadata_only_holdings_count ??
    (Array.isArray(md.metadata_only_holdings) ? md.metadata_only_holdings.length : null)) ?? null;

  const interruption = {
    job_error: job?.error ?? null,
    retrieval_interrupted: md.retrieval_interrupted ?? d.retrieval_interrupted ?? null,
    partial_retrieval: md.partial_retrieval ?? null,
    extraction_ledger: md.extraction_ledger ?? d.extraction_ledger ?? null,
    pdf_preflight: md.pdf_preflight ?? d.pdf_preflight ?? null,
    cpu_or_stale: /CPU|isolate|stale_worker|interrupt/i.test(String(job?.error ?? "")),
  };

  const registry = md.core_authority_registry ?? d.core_authority_registry ?? null;
  const verdicts: any[] = md.verifier?.verdicts ?? md.verdicts ?? [];
  const supportDist: Record<string, number> = {};
  for (const v of verdicts) supportDist[String(v.support ?? "unknown")] = (supportDist[String(v.support ?? "unknown")] ?? 0) + 1;
  const cands: any[] = md.candidate_pool?.candidates ?? md.pool?.candidates ?? [];
  const listing = cands.filter((c: any) => /listing|spokmanship|dynamiccollectors/i.test(`${c.source_url ?? ""} ${c.metadata?.citable_as ?? ""}`)).length;
  const metaOnly = cands.filter((c: any) => /metadata/i.test(String(c.metadata?.text_usability ?? ""))).length;

  const rec = {
    ...q,
    core_authority_registry: registry,
    support_distribution: supportDist,
    candidate_count: cands.length,
    listing_page_candidates: listing,
    metadata_only_candidates: metaOnly,
    job_id: t.job_id, run_id: t.run_id,
    ms: Date.now() - t0,
    terminal_status: job?.status ?? "none",
    branch,
    answer,
    footnotes: fns,
    footnotes_length: fns.length,
    used_sources_length: usedSources.length,
    inline_marker_count: found.length,
    dangling_marker_count: dangling,
    orphan_source_row_count: orphanRows,
    metadata_only_holdings: metadataOnly,
    limitation_notices: limitationNotices(answer),
    claim_source_match: csm,
    footnote_render_report: report,
    interruption,
    canonical: md.retrieval?.canonical_authority_acquisition ?? null,
  };
  results.push(rec);
  writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
  console.log(`[${q.id}] ${rec.terminal_status} ${Math.round(rec.ms / 1000)}s fns=${fns.length} dangling=${dangling} orphan=${orphanRows}`);
}

// ─── report ────────────────────────────────────────────────────────────────
const lines: string[] = [];
lines.push(`# canonical_judgment_text_acquisition_v1 — validation run (D1–D6 + controls)\n`);
lines.push(`Generated: ${new Date().toISOString()}  \nMode: export only — no code, prompt, retrieval, verifier, drafter, label, footnote or gate changes. Questions executed sequentially.\n`);
lines.push(`## Overview\n`);
lines.push(`| ID | Topic | Runtime | Terminal status | Branch | Footnotes | Dangling | Orphan rows | Metadata-only holdings | Interruption |`);
lines.push(`|---|---|---|---|---|---|---|---|---|---|`);
for (const r of results) {
  lines.push(`| ${r.id} | ${r.topic} | ${Math.round((r.ms ?? 0) / 1000)}s | ${r.terminal_status ?? "n/a"} | ${r.branch ?? "—"} | ${r.footnotes_length ?? 0} | ${r.dangling_marker_count ?? "—"} | ${r.orphan_source_row_count ?? "—"} | ${r.metadata_only_holdings ?? "—"} | ${r.interruption?.cpu_or_stale ? "YES" : "none"} |`);
}
lines.push("");

for (const r of results) {
  lines.push(`\n---\n\n## ${r.id} — ${r.topic}\n`);
  lines.push(`**Query**\n\n> ${r.query}\n`);
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Runtime | ${Math.round((r.ms ?? 0) / 1000)}s |`);
  lines.push(`| Terminal status | ${r.terminal_status ?? "n/a"} |`);
  lines.push(`| Branch | ${r.branch ?? "—"} |`);
  lines.push(`| Footnote count | ${r.footnotes_length ?? 0} |`);
  lines.push(`| Inline markers | ${r.inline_marker_count ?? 0} |`);
  lines.push(`| Dangling markers | ${r.dangling_marker_count ?? 0} |`);
  lines.push(`| Orphan source rows | ${r.orphan_source_row_count ?? 0} |`);
  lines.push(`| used_sources | ${r.used_sources_length ?? 0} |`);
  lines.push(`| Metadata-only holdings | ${r.metadata_only_holdings ?? "—"} |`);
  const c = r.claim_source_match;
  lines.push(`| CSM applied | ${c ? c.applied : "n/a"} |`);
  lines.push(`| CSM source_ref_mismatch_count | ${c ? c.source_ref_mismatch_count : "n/a"} |`);
  lines.push(`| CSM unsupported_block_count | ${c ? c.unsupported_block_count : "n/a"} |`);
  lines.push(`| CSM commentary_only_claims | ${c ? JSON.stringify(c.commentary_only_claims) : "n/a"} |`);
  lines.push(`| CSM primary_support_by_main_claim | ${c ? c.primary_support_by_main_claim : "n/a"} |`);
  lines.push(`| Canonical acquisition | ${JSON.stringify(r.canonical ?? null)} |`);
  lines.push(`| Registry triggered | ${r.core_authority_registry?.triggered ?? false} |`);
  lines.push(`| Registry doctrine_id | ${r.core_authority_registry?.doctrine_id ?? "—"} |`);
  lines.push(`| Registry matched_facet | ${r.core_authority_registry?.matched_facet ?? "—"} |`);
  lines.push(`| Registry queries added | ${r.core_authority_registry?.queries_added ?? 0} — ${JSON.stringify(r.core_authority_registry?.queries ?? [])} |`);
  lines.push(`| Registry skipped (already present) | ${JSON.stringify(r.core_authority_registry?.skipped_because_already_present ?? [])} |`);
  lines.push(`| Statute-title normalisation | ${JSON.stringify(r.core_authority_registry?.statute_title_normalization ?? null)} |`);
  lines.push(`| Support distribution | ${JSON.stringify(r.support_distribution ?? {})} |`);
  lines.push(`| Candidates (listing / metadata-only) | ${r.candidate_count ?? 0} (${r.listing_page_candidates ?? 0} / ${r.metadata_only_candidates ?? 0}) |`);
  lines.push(`| Retrieval interruption / CPU / stale worker | ${r.interruption?.cpu_or_stale ? "YES" : "none"} |`);
  lines.push(`| Job error | ${r.interruption?.job_error ?? "none"} |`);
  lines.push("");
  if (c && Array.isArray(c.dropped_source_refs) && c.dropped_source_refs.length) {
    lines.push(`**Dropped source refs**\n`);
    lines.push(`| ref | block | reason | block claim | block area | source area |`);
    lines.push(`|---|---|---|---|---|---|`);
    for (const dr of c.dropped_source_refs) {
      lines.push(`| ${dr.ref} | ${dr.block_index} | ${dr.reason} | ${dr.block_claim_id ?? "—"} | ${dr.block_legal_area ?? "—"} | ${dr.source_legal_area ?? "—"} |`);
    }
    lines.push("");
  }
  if (r.core_authority_registry?.authorities?.length) {
    lines.push(`**Registry authority outcomes**\n`);
    lines.push(`| authority | role | expected | seeded query | skipped(present) | retrieved | admitted | body | used |`);
    lines.push(`|---|---|---|---|---|---|---|---|---|`);
    for (const a of r.core_authority_registry.authorities) {
      lines.push(`| ${a.label} | ${a.role} | ${a.source_type_expected} | ${a.query_he ? "yes" : "—"} | ${a.skipped_because_already_present} | ${a.retrieved} | ${a.admitted} | ${a.body_acquired} | ${a.used} |`);
    }
    lines.push("");
  }
  lines.push(`**Hebrew limitation notices**\n`);
  lines.push(r.limitation_notices?.length ? r.limitation_notices.map((n: string) => `> ${n.replace(/\n/g, "\n> ")}`).join("\n\n") : "_none_");
  lines.push(`\n**Full final user-facing answer**\n`);
  lines.push("```markdown");
  lines.push(r.answer ?? "");
  lines.push("```\n");
  lines.push(`**Full rendered source list**\n`);
  lines.push(renderSourceList(r.footnotes ?? []));
  lines.push("");
}

lines.push(`\n---\n\n## Human readthrough checklist (fill manually)\n`);
lines.push(`| ID | Grade (Good/Acceptable/Limited/Fail) | Answered the question? | Sources legally relevant? | Primary source when needed? | Any unrelated source? | Topic contamination? | Broken Hebrew / awkward phrasing? | Over-refusal? | Overclaiming? | Main failure pattern |`);
lines.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
for (const r of results) lines.push(`| ${r.id} |  |  |  |  |  |  |  |  |  |  |`);
lines.push("");

writeFileSync(`${OUT}/REPORT.md`, lines.join("\n"));
writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(results.map((r) => ({
  id: r.id, ms: r.ms, terminal_status: r.terminal_status, branch: r.branch,
  footnotes_length: r.footnotes_length, dangling: r.dangling_marker_count,
  orphan: r.orphan_source_row_count, csm: r.claim_source_match,
})), null, 2));
console.log("done");
