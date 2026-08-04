// Diagnostic-only: research-pack hierarchy and source composition.
// Read-only against the deployed function. No pipeline changes.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SMOKE_USER_ID = process.env.SMOKE_USER_ID ?? "65600563-6bc3-4f54-867b-d532c377f522";
if (!SUPABASE_URL || !SR_KEY) { console.error("Missing env"); process.exit(1); }

const ALL = [
  { id: "R03", query: `מה הפסיקה אומרת על הלכת השיתוף?` },
  { id: "R08", query: `כתוב סקירת פסיקה על מבחן המידתיות בביקורת שיפוטית על חקיקה.` },
  { id: "R04", query: `מה הפסיקה אומרת על הרמת מסך ההתאגדות?` },
  { id: "R09", query: `כתוב סקירת פסיקה על מבחן ההשתלבות בדיני עבודה.` },
  { id: "R02", query: `מה נקבע בבנק המזרחי ביחס לסמכות בית המשפט לבטל חקיקה?` },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const QUERIES = only.length ? ALL.filter((q) => only.includes(q.id)) : ALL;
const OUT = "reports/pack-hierarchy-diagnostic";
mkdirSync(OUT, { recursive: true });

async function trigger(q: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/legal-research-v1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SR_KEY}`, "x-smoke-mode": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ question: q, smoke_user_id: SMOKE_USER_ID }),
  });
  return (await r.json().catch(() => ({}))) as { run_id?: string };
}

async function poll(run_id: string, timeoutMs = 900_000) {
  const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/qa_logs?select=id,created_at,metadata,answer,footnotes&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`, { headers });
    if (r.ok) { const rows = await r.json(); if (Array.isArray(rows) && rows.length) return rows[0]; }
    const j = await fetch(`${SUPABASE_URL}/rest/v1/legal_research_jobs?select=status,current_stage,error&run_id=eq.${run_id}&limit=1`, { headers });
    if (j.ok) { const jr = await j.json(); if (Array.isArray(jr) && jr[0]?.status === "failed") return { failed: jr[0] }; }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

type Bucket =
  | "primary_judgment_usable"
  | "primary_judgment_metadata_only"
  | "statute"
  | "official_other"
  | "scholarship"
  | "commentary"
  | "listing_not_citable"
  | "unclassified";

function bucketOf(r: any): Bucket {
  const cit = r.citable_as ?? r.citable ?? null;
  const tier = r.tier ?? r.authority_tier ?? null;
  const usab = r.text_usability ?? null;
  const url = String(r.url ?? "");
  if (cit === "not_citable" || usab === "listing_page" || tier === "index_or_listing") return "listing_not_citable";
  if (cit === "judgment") {
    const usable = usab === "full_text" || r.holding_text === true || r.has_holding_text === true;
    return usable ? "primary_judgment_usable" : "primary_judgment_metadata_only";
  }
  if (cit === "statute" || cit === "statute_mirror" || r.source_type === "statute") return "statute";
  if (tier === "official_primary") return "official_other";
  if (/\.ac\.il|law\.biu|tau\.ac|huji|colman|idc|academ|\.edu/i.test(url)) return "scholarship";
  if (cit === "commentary" || tier === "secondary_commentary") return "commentary";
  return "unclassified";
}

const PRIMARY: Bucket[] = ["primary_judgment_usable", "primary_judgment_metadata_only", "statute", "official_other"];
const SECONDARY: Bucket[] = ["scholarship", "commentary"];

function tally(rows: any[]) {
  const t: Record<string, number> = {};
  for (const r of rows) { const b = bucketOf(r); t[b] = (t[b] ?? 0) + 1; }
  return t;
}

function summarize(q: { id: string; query: string }, run_id: string, row: any, ms: number) {
  const md = (row.metadata ?? {}) as any;
  const dr = md?.drafter ?? {};
  const ret = md?.retrieval ?? {};
  const si = ret?.source_integrity ?? {};
  const admitted: any[] = si?.admitted ?? [];
  const ver = md?.verifier ?? {};
  const verdicts: any[] = ver?.verdicts ?? [];
  const answer = String(row.answer ?? "");
  const used: any[] = dr.used_sources ?? [];
  const footnotes: any[] = row.footnotes ?? [];

  const verdictFor = (cid: string) =>
    verdicts.filter((v: any) => v.candidate_id === cid || v.ref === cid)
      .map((v: any) => v.support ?? v.verified_support);

  const admittedRows = admitted.map((r: any, i: number) => ({
    rank: i + 1, ref: r.ref, title: r.title, url: r.url,
    bucket: bucketOf(r), role: r.role, tier: r.authority_tier,
    citable_as: r.citable_as, text_usability: r.text_usability,
    synthesis_role: r.synthesis_role, origin: r.origin ?? null,
    verifier: verdictFor(r.candidate_id ?? r.ref),
    flags: r.integrity_flags,
  }));
  const admittedById = new Map(admitted.map((r: any) => [r.candidate_id ?? r.ref, r]));

  const usedRows = used.map((u: any, i: number) => {
    const a = admittedById.get(u.candidate_id) ?? {};
    return {
      order: i + 1, footnote_number: u.number, title: u.title, url: u.url,
      bucket: bucketOf(u), origin: u.origin, tier: u.authority_tier,
      citable_as: u.citable_as, text_usability: u.text_usability,
      synthesis_role: u.synthesis_role,
      admitted_rank: admittedRows.find((r) => r.url && r.url === u.url)?.rank ?? null,
      verifier: verdictFor(u.candidate_id) ?? (a as any)?.verifier ?? [],
    };
  });

  const firstPrimaryIdx = usedRows.findIndex((u) => PRIMARY.includes(u.bucket as Bucket));
  const firstSecondaryIdx = usedRows.findIndex((u) => SECONDARY.includes(u.bucket as Bucket));
  const head = usedRows.slice(0, 5);

  const fnAnalysis = footnotes.map((f: any) => {
    const buckets = (f.sources ?? []).map((s: any) => {
      const m = used.find((u: any) => u.url === s.url);
      return m ? bucketOf(m) : (s.source_type === "caselaw" ? "primary_judgment_metadata_only" : "commentary");
    });
    const hasP = buckets.some((b: string) => PRIMARY.includes(b as Bucket));
    const hasS = buckets.some((b: string) => SECONDARY.includes(b as Bucket));
    return {
      number: f.number, size: (f.sources ?? []).length, buckets,
      compound: (f.sources ?? []).length > 1,
      mixes_primary_and_secondary: hasP && hasS,
      leads_with_secondary: buckets.length > 0 && SECONDARY.includes(buckets[0] as Bucket) && hasP,
    };
  });

  return {
    id: q.id, query: q.query, run_id, total_ms: ms,
    research_mode: md?.research_mode ?? md?.planner?.mode_plan?.mode ?? null,
    deterministic_branch: dr.deterministic_branch ?? null,
    is_stub: /\[stub\]/.test(answer),
    sufficiency: dr.source_sufficiency ?? md?.source_sufficiency ?? null,
    commentary_share_of_admitted_pack:
      (ret?.judgment_discovery ?? {})?.commentary_share_of_admitted_pack ?? null,

    A_admitted_composition: {
      total: admitted.length,
      buckets: tally(admitted),
      primary_count: admittedRows.filter((r) => PRIMARY.includes(r.bucket as Bucket)).length,
      secondary_count: admittedRows.filter((r) => SECONDARY.includes(r.bucket as Bucket)).length,
      noise_count: admittedRows.filter((r) => r.bucket === "listing_not_citable").length,
      verifier_counts: ver?.counts ?? null,
      rows: admittedRows,
    },

    B_used_composition: {
      total: usedRows.length,
      buckets: tally(used),
      primary_count: usedRows.filter((u) => PRIMARY.includes(u.bucket as Bucket)).length,
      secondary_count: usedRows.filter((u) => SECONDARY.includes(u.bucket as Bucket)).length,
      first_primary_position: firstPrimaryIdx < 0 ? null : firstPrimaryIdx + 1,
      first_secondary_position: firstSecondaryIdx < 0 ? null : firstSecondaryIdx + 1,
      secondary_precedes_primary:
        firstSecondaryIdx >= 0 && (firstPrimaryIdx < 0 || firstSecondaryIdx < firstPrimaryIdx),
      head5_primary: head.filter((u) => PRIMARY.includes(u.bucket as Bucket)).length,
      head5_secondary: head.filter((u) => SECONDARY.includes(u.bucket as Bucket)).length,
      rows: usedRows,
    },

    C_footnotes: {
      total: footnotes.length,
      compound_count: fnAnalysis.filter((f) => f.compound).length,
      mixed_hierarchy_count: fnAnalysis.filter((f) => f.mixes_primary_and_secondary).length,
      secondary_leading_count: fnAnalysis.filter((f) => f.leads_with_secondary).length,
      rows: fnAnalysis,
    },

    answer_len: answer.length,
    answer,
  };
}

const CONCURRENCY = Number(process.env.CONC ?? 3);
const results: any[] = [];
for (let i = 0; i < QUERIES.length; i += CONCURRENCY) {
  const batch = QUERIES.slice(i, i + CONCURRENCY);
  const out = await Promise.all(batch.map(async (q) => {
    const t0 = Date.now();
    const t = await trigger(q.query).catch(() => ({} as { run_id?: string }));
    console.log(`[${q.id}] run_id=${t.run_id}`);
    if (!t.run_id) return { id: q.id, query: q.query, error: "trigger_failed" };
    const row: any = await poll(t.run_id);
    if (!row) return { id: q.id, query: q.query, run_id: t.run_id, error: "poll_timeout" };
    if (row.failed) return { id: q.id, query: q.query, run_id: t.run_id, error: "job_failed", detail: row.failed };
    const rec = summarize(q, t.run_id, row, Date.now() - t0);
    writeFileSync(`${OUT}/${q.id}.json`, JSON.stringify(rec, null, 2));
    console.log(
      `[${q.id}] mode=${rec.research_mode} branch=${rec.deterministic_branch} ` +
      `adm=${rec.A_admitted_composition.total}(P${rec.A_admitted_composition.primary_count}/S${rec.A_admitted_composition.secondary_count}/N${rec.A_admitted_composition.noise_count}) ` +
      `used=${rec.B_used_composition.total}(P${rec.B_used_composition.primary_count}/S${rec.B_used_composition.secondary_count}) ` +
      `head5=P${rec.B_used_composition.head5_primary}/S${rec.B_used_composition.head5_secondary} ` +
      `sec_first=${rec.B_used_composition.secondary_precedes_primary} ` +
      `fn=${rec.C_footnotes.total} mixed=${rec.C_footnotes.mixed_hierarchy_count}`,
    );
    return rec;
  }));
  results.push(...out);
  writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(results, null, 2));
}
writeFileSync(`${OUT}/SUMMARY.json`, JSON.stringify(results, null, 2));
console.log("DONE");
