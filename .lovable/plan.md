

## 30-Question Legal Research Evaluation Harness

### Goal
Run all 30 questions twice — once on the **legacy** path, once on the **structured** path — and produce a side-by-side comparison report with per-question metrics. No user-facing UI changes.

### Approach

```text
                    ┌─────────────────────────────────┐
                    │  Node script (eval/run-eval.ts) │
                    └──────────────┬──────────────────┘
                                   │ for each of 30 questions
              ┌────────────────────┼────────────────────┐
              │                                         │
   POST legal-qa                              POST legal-qa
   { taskMode: "research",                    { taskMode: "research",
     evalForceLegacy: true }                    evalMode: "structured" }
              │                                         │
              ▼                                         ▼
   Legacy retrieval + drafter             decompose → claim_map → drafter
              │                                         │
              └────────────────────┬────────────────────┘
                                   ▼
                  Pull qa_logs row by request_id
                  Combine with HTTP response body
                                   │
                                   ▼
              Write /mnt/documents/legal-qa-eval/
                  ├─ results.json   (raw, per-question)
                  ├─ results.csv    (spreadsheet view)
                  └─ report.md      (side-by-side + summary)
```

### What gets built

**1. Tiny edge-function flag (`legal-qa/index.ts`)** — additive, internal only:
- Accept `evalForceLegacy?: boolean` in the request body.
- When true AND caller is the eval admin user, skip the `decomposeAndPlan` / `buildClaimMap` blocks (treat as if planner returned null), forcing the legacy retrieval+drafter path.
- Stamp `metadata.eval_run_id` and `metadata.eval_variant` (`"legacy"` | `"structured"`) into `qa_logs` so we can match them back later.
- Zero behavior change for normal users (flag absent → identical code path).
- Credit consumption is skipped or refunded for admin eval runs (admins already bypass via `consume_credits`).

**2. Eval runner script (`eval/run-eval.ts`)** — run once via `code--exec deno run`:
- Reads the 30-question dataset (inlined in the script).
- Authenticates as the super-admin (`ofekgrinshpon@gmail.com`) via Supabase auth using a password from a one-time prompt OR a service-role-signed JWT.
- For each question, fires both variants **sequentially** (to avoid rate-limiting Lovable AI Gateway / OpenAI) with an `evalRunId = uuid` and `evalVariant`.
- After each pair completes, queries `qa_logs` by `eval_run_id` + `eval_variant` to fetch `metadata.stage_runs`, `metadata.models_used`, `metadata.drafting_path`, `metadata.claim_map_summary`, `metadata.source_pack_summary`.
- Computes derived metrics: answer length (chars + words), footnote density (footnotes / 1000 chars), anchored vs. unverified counts (from `metadata.anchored_count` if present, else inferred from footnote `url` presence).
- Streams partial results to disk after every question so a mid-run crash doesn't lose progress.

**3. Outputs in `/mnt/documents/legal-qa-eval/`**
- `results.json` — full per-question record, both variants, all metadata.
- `results.csv` — flat spreadsheet for sorting/filtering.
- `report.md` — human-readable report with:
  - Aggregate summary (avg footnotes, avg length, structured success rate, fallback rate, mean stage durations).
  - Per-question side-by-side blocks (question → legacy answer + footnotes count → structured answer + footnotes count → which won on density / coverage).
  - Top strengths / top weaknesses bucketed by question type (constitutional/admin law, contract, procedural, doctrinal/literature).
  - Verdict: ready to flip default OR needs another tuning pass.

### Per-question fields captured
question · legacy_answer · structured_answer · legacy_footnotes_count · structured_footnotes_count · legacy_dropped_footnotes · structured_dropped_footnotes · legacy_density · structured_density · legacy_length · structured_length · legacy_drafting_path · structured_drafting_path · legacy_models_used · structured_models_used · legacy_stage_runs · structured_stage_runs · structured_completed_or_fell_back · claim_map_summary · source_pack_summary · legacy_anchored / unverified · structured_anchored / unverified

### Execution & cost notes
- 30 questions × 2 variants = **60 edge-function calls**. Average ~90–180s each → expect **90–180 min wall-clock**. Script logs progress and writes incrementally.
- Run as super-admin so no user credits are charged.
- If the structured path times out on a question, the row records `fell_back: true` with the stage that failed — that's a real evaluation signal, not an error to retry.

### What I will deliver after the run
1. Path to `/mnt/documents/legal-qa-eval/` artifacts (json + csv + md).
2. How to review them (open `report.md` for the narrative; load `results.csv` in any spreadsheet for sorting).
3. Top-level conclusion (structured vs. legacy on the 30-question set).
4. Buckets where structured is stronger / weaker (e.g., literature-heavy questions vs. statute-anchored questions vs. open doctrinal questions).
5. Recommendation on whether to flip the default to structured now or run one more tuning pass — with the specific tuning targets if so.

### Out of scope (per instructions)
- No UI changes, no provenance exposure, no pricing/credits changes, no architecture changes, no other-mode redesigns.

### Technical details
- Edge function diff is ~25 lines; gated on admin user-id check so it cannot be triggered by regular users.
- The eval runner is a standalone Deno script invoked with `code--exec` — it is not part of the deployed app.
- `eval_run_id` lets us re-query and re-export at any later time without re-running the model calls.

