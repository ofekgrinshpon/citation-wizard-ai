# ACCEPTANCE REPORT — source_use_intent_planning_v1

Status: **ACCEPTED (stable-initial / monitor)**
Function: `legal-research-v1` (deployed)
Validation set: 10 queries (ACADEMIC, NATION-STATE-ACADEMIC, PAYWALL, MMM, B8, D1, D3, DARKPATTERNS, R02, P02)
Raw telemetry + full answers: `reports/source-use-intent/results.json`

## What shipped

1. **Analyzer contract extension** (`lib/types.ts`, `lib/schemas.ts`, `stages/claimAnalyzer.ts`)
   - New optional `source_use_plan` on the analyzer output:
     `user_task_intent` (10 values, `legal_research_guidance` replaces `practical_research`),
     `source_use_intent[]` (7 values), `answer_strategy` (8 values),
     `authority_requirements`, `mixed_plan`, `plan_confidence: high|medium|low`, `reason`.
   - Prompt is substance-based: no lexical triggers, no fixed templates. It explicitly forbids
     turning ordinary legal/doctrinal questions into bibliography-only answers.

2. **Planning stage** (`stages/sourceUseIntent.ts`)
   - Normalizes the model plan, supplies a conservative fallback when absent/invalid.
   - Safety-only deterministic overrides (can tighten, never widen):
     explicit docket → `requires_judgment_body`; explicit statute section → `requires_official_statute`;
     `case_holding` → secondary sources cannot support.
   - Invariant pinned in code and schema: `found_only_can_support_claims = false`.
   - Low confidence + plausible dual task → `mixed_plan = true` instead of forcing one intent.
   - `bucketSources()` → `read_in_full` / `found_only` / `dropped_unrelated`.

3. **Task-relative sufficiency** (`stages/sourceSufficiency.ts`)
   - Research-guidance tasks can be sufficient with at least one *acquired* body when no
     primary-law requirement applies (`research_guidance_task_supported:<intent>(was:<old reason>)`).
   - `found_titles` in limitation notices now shows only topically related titles.
   - All existing strict branches (docket, statute, case-holding, identity) unchanged.

4. **Drafter** (`stages/drafterV2.ts`)
   - Receives the plan; prompt states the task, strategy and authority rules naturally —
     mixed plans are answered proportionally, with no forced headings.
   - Acquired vs found-only sources are labelled distinctly; found-only may only appear as
     clearly marked reading candidates, never as support.
   - New deterministic scrub: internal source ids (`s1`, `s3`, …) can no longer leak into prose.

5. **Telemetry** (`index.ts`) — persisted under `metadata.drafter.source_use_intent`:
   plan, `model_plan_present`, `overrides`, `planned_sufficiency` (incl. source buckets),
   docket/statute detection flags.

## Validation results

| Run | task / strategy | mixed | conf | overrides | branch | sufficiency | buckets (full/found/dropped) | fn | len | ms |
|---|---|---|---|---|---|---|---|---|---|---|
| ACADEMIC | literature_map / map_literature | no | high | reading_list | — | research_guidance_task_supported (was generic_procedure_only) | 2/0/2 | 0 | 1567 | 184k |
| NATION-STATE-ACADEMIC | literature_map / map_literature | no | medium | reading_list | — | doctrinal_anchor_present | 3/2/0 | 1 | 2023 | 173k |
| PAYWALL | literature_map / map_literature | no | high | reading_list | — | research_guidance_task_supported (was no_anchor) | 1/0/0 | 1 | 1814 | 166k |
| MMM | doctrinal_explanation / synthesize_doctrine | no | medium | — | — | thin_governing_statute_pack_present | 0/6/0 | 0 | 1396 | 160k |
| B8 | doctrinal_explanation / explain_law | no | high | — | — | doctrinal_anchor_present | 5/0/1 | 1 | 2197 | 169k |
| D1 | doctrinal_explanation / synthesize_doctrine | no | high | — | — | limited_doctrinal_fallback_B | 2/0/2 | 2 | 2374 | 274k |
| D3 | doctrinal_explanation / explain_law | no | high | — | insufficient_sources_limitation | no_statutory_caselaw_or_doctrinal_anchor | 1/0/1 | 0 | 200 | 168k |
| DARKPATTERNS | doctrinal_explanation / synthesize_doctrine | **yes** | medium | reading_list | — | doctrinal_anchor_present | 1/1/6 | 0 | 2653 | 180k |
| R02 | case_holding / summarize_case | no | high | case_holding_blocks_secondary_support | docket_limitation | — | — | 0 | 395 | 161k |
| P02 (fake docket) | case_holding / summarize_case | no | high | — | docket_limitation | — | — | 0 | 342 | 106k |

## Acceptance checks

- **Research-guidance questions no longer over-refuse.** ACADEMIC and PAYWALL previously ended in
  `generic_procedure_only` / `no_statutory_caselaw_or_doctrinal_anchor`; both now produce usable
  research guidance grounded in acquired bodies.
- **No bibliography drift for ordinary legal questions.** MMM, B8, D1, D3 all planned as
  `doctrinal_explanation` with `explain_law` / `synthesize_doctrine`; none became a reading list.
- **Mixed plan works and stays natural.** DARKPATTERNS produced a single flowing doctrinal answer
  with research guidance woven in, no template headings.
- **Safety preserved.** R02 (real docket, no usable body) and P02 (fabricated `בג"ץ 9999/99`) both
  refuse via `docket_limitation`, explicitly declining to answer from similar cases or secondary
  literature. `case_holding` blocked secondary support on R02.
- **No authority overstatement.** No found-only source supported a claim in any run; no secondary
  source was presented as binding case law; footnotes are all built deterministically from
  acquired sources.
- **Source display hygiene.** Unrelated titles are dropped from limitation notices
  (e.g. DARKPATTERNS dropped 6 of 8), and internal `sN` ids no longer appear in prose
  (regression found in the first ACADEMIC run, fixed and re-verified).

## Known limitations / monitor

- MMM still runs on a found-only pack (`thin_governing_statute_pack_present`); its answer stays
  explanatory-with-gaps, no fabricated authority, but citation yield is low.
- D3 remains a legitimate refusal — no doctrinal anchor was acquired for the asked field.
- Two P02 attempts stalled inside retrieval (trace row only, no terminal row) before a third
  completed in 106s; retrieval-stage stalls on fabricated dockets remain a stability item.
- Runtimes are 160–275s; unchanged from the previous track.
