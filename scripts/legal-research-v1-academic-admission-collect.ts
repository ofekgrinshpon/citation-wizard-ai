// Collector for academic_candidate_admission_and_slotting_v1 validation runs.
// Reads finished qa_logs rows by run_id and emits the acceptance tables.
import { mkdirSync, writeFileSync } from "node:fs";

const U = process.env.SUPABASE_URL!;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RUNS: Record<string, string> = JSON.parse(process.env.RUNS ?? "{}");
const OUT = "reports/academic-candidate-admission-and-slotting-v1";
mkdirSync(OUT, { recursive: true });

// deno-lint-ignore no-explicit-any
const rows: any[] = [];
for (const [id, run_id] of Object.entries(RUNS)) {
  const r = await fetch(
    `${U}/rest/v1/qa_logs?select=id,created_at,answer,footnotes,metadata&metadata->>run_id=eq.${run_id}&order=created_at.desc&limit=1`,
    { headers: { apikey: K, Authorization: `Bearer ${K}` } },
  );
  const [row] = await r.json();
  if (!row) { rows.push({ id, run_id, error: "not_found" }); continue; }
  const md = row.metadata ?? {};
  const d = md.drafter ?? {};
  rows.push({
    id,
    run_id,
    qa_log_id: row.id,
    genre: d.source_use_intent?.plan?.academic_genre ?? null,
    footnotes_count: Array.isArray(row.footnotes) ? row.footnotes.length : 0,
    footnotes: row.footnotes ?? [],
    pack_admission_summary: d.academic_pack_admission_summary ?? null,
    admission_gate: d.academic_scholarship_admission_gate ?? [],
    role_slotting: d.academic_role_slotting_decision ?? [],
    primary_anchor: d.academic_primary_anchor_acquisition_status ?? null,
    answer: String(row.answer ?? ""),
  });
  const s = rows.at(-1)!;
  const p = s.pack_admission_summary ?? {};
  console.log(
    `[${id}] genre=${s.genre} fn=${s.footnotes_count} reviewed=${p.reviewed_candidates ?? 0} ` +
      `admitted=${p.admitted_count ?? 0} rejected=${p.rejected_count ?? 0} ` +
      `slotting=${(s.role_slotting ?? []).length} ` +
      `primary_usable=${s.primary_anchor?.usable_primary_anchor_count ?? 0}`,
  );
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(rows, null, 2));
console.log(`\nWrote ${OUT}/results.json`);
