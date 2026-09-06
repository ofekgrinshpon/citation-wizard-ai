// natural_literature_mode_and_topic_guard_v1 — pull telemetry for finished runs.
import { mkdirSync, writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OUT = "reports/natural-literature-mode-and-topic-guard-v1";
mkdirSync(OUT, { recursive: true });

const RUNS = (process.env.RUNS ?? "").split(",").filter(Boolean).map((p) => {
  const [id, run_id] = p.split("=");
  return { id, run_id };
});

const headers = { apikey: SR_KEY, Authorization: `Bearer ${SR_KEY}` };
// deno-lint-ignore no-explicit-any
const out: any[] = [];
for (const r of RUNS) {
  const url =
    `${SUPABASE_URL}/rest/v1/qa_logs?select=metadata,answer,footnotes&metadata->>run_id=eq.${r.run_id}&order=created_at.desc&limit=1`;
  const res = await fetch(url, { headers });
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) {
    out.push({ ...r, error: "not_found" });
    continue;
  }
  // deno-lint-ignore no-explicit-any
  const md = (rows[0].metadata ?? {}) as Record<string, any>;
  const d = md.drafter ?? {};
  out.push({
    ...r,
    activation: md.natural_literature_mode_activation ?? null,
    literature_mode: md.academic_literature_mode ?? null,
    center_of_gravity: md.literature_source_center_of_gravity ?? null,
    unused_pack: md.unused_literature_pack_sources ?? [],
    facet_guard: md.facet_contamination_guard ?? [],
    gate_trace: md.academic_literature_gate_trace ?? null,
    pack_size: Array.isArray(d.input_sources) ? d.input_sources.length : null,
    pack: Array.isArray(d.input_sources)
      // deno-lint-ignore no-explicit-any
      ? d.input_sources.map((s: any) => ({
        ref: s.ref,
        title: s.title,
        citable_as: s.citable_as ?? null,
      }))
      : [],
    used_sources: d.used_sources ?? [],
    footnotes: rows[0].footnotes ?? [],
    footnotes_count: Array.isArray(rows[0].footnotes) ? rows[0].footnotes.length : 0,
  });
  writeFileSync(`${OUT}/${r.id}_answer.md`, String(rows[0].answer ?? ""));
  const a = md.natural_literature_mode_activation;
  console.log(
    `[${r.id}] lit_mode=${md.academic_literature_mode} after=${a?.academic_literature_mode_after} signals=${
      (a?.activation_signals ?? []).join("|")
    } pack=${Array.isArray(d.input_sources) ? d.input_sources.length : "?"} fn=${
      Array.isArray(rows[0].footnotes) ? rows[0].footnotes.length : 0
    } guard_rejected=${(md.facet_contamination_guard ?? []).filter((g: { accepted: boolean }) => !g.accepted).length}`,
  );
}
writeFileSync(`${OUT}/telemetry.json`, JSON.stringify(out, null, 2));
console.log(`Wrote ${OUT}/telemetry.json`);
