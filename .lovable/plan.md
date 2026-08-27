# source_use_intent_planning_v1

Teach the pipeline to plan *what the user is asking the system to do* — and how sources may be used for that task — instead of treating every question as a black-letter legal question. Substance-based planning only: no phrase→template mapping, no rigid output modes.

## Why this is needed

Today the analyzer emits only a light `answer_intent.output_shape` format hint, and everything downstream (research mode, router profile, source-depth policy, sufficiency, drafter) assumes the user wants a legal ruling. Source-seeking, literature and seminar-planning questions therefore hit case-law sufficiency gates, get refused, or come back with generic law plus unrelated "found" sources.

## What gets added

### 1. Analyzer contract: a source-use plan

Extend the analyzer tool schema (`lib/schemas.ts`, `lib/types.ts`) and prompt (`stages/claimAnalyzer.ts`) with a new optional `source_use_plan` object, emitted in the same LLM call (no extra call, no extra cost):

- `user_task_intent` — case_holding | statute_explanation | doctrinal_explanation | case_law_synthesis | source_recommendation | literature_map | seminar_planning | argument_development | practical_research | document_check
- `source_use_intent[]` — binding_authority | statutory_text | doctrinal_support | scholarly_discussion | institutional_findings | reading_recommendations | bibliography_only
- `answer_strategy` — explain_law | summarize_case | synthesize_doctrine | recommend_sources | map_literature | plan_research_section | compare_views | limited_answer_with_gaps
- `authority_requirements` — requires_judgment_body, requires_official_statute, secondary_sources_can_support, found_only_allowed_as_reading_list, found_only_can_support_claims (always false)
- `mixed_plan` + `secondary_task_intent` for questions that ask for law *and* literature

The prompt states planning principles as reasoning guidance (docket/holding → binding authority; statute → official text; doctrine → mixed; literature/seminar → recommendation), never as phrase lists.

### 2. Deterministic safety floor (not a template)

A small `stages/sourceUseIntent.ts` normalizes the model output and enforces only safety-direction overrides — it can make requirements *stricter*, never looser:

- An explicit docket or an explicit "what did the court hold" claim forces `requires_judgment_body = true` regardless of the model's plan (keeps R02/P02 safe).
- An explicit statute section forces `requires_official_statute = true`.
- `found_only_can_support_claims` is hard-pinned to false.
- If the model omits the field, the stage derives a conservative default from the existing research mode / router profile, so behaviour matches today.

### 3. Sufficiency becomes task-relative

`stages/sourceSufficiency.ts` receives the plan and evaluates adequacy against the planned task:

- `requires_judgment_body` / `requires_official_statute` keep today's strict gates untouched.
- Recommendation / literature-map / seminar-planning tasks are adequate when there are acquired secondary bodies (or, for the reading-list portion, credible found-only candidates) — they are no longer refused for lack of direct case law.
- Any *substantive claim about what a source says* still requires acquired body text; the existing claim-source-match rules stay in force.

### 4. Source presentation buckets

Candidates are partitioned into three explicit buckets carried into the drafter and telemetry:

- `read_in_full` — acquired body text (citable per existing rules)
- `found_only` — discovered but not acquired; usable only as marked reading candidates, never as claim support
- `dropped_unrelated` — off-topic found-only sources are suppressed from display (fixes B8 noise)

### 5. Drafter follows the plan, does not template it

`stages/drafterV2.ts` receives the plan as guidance alongside the existing evidence contract:

- Answer the planned task naturally; no fixed sections, no forced headings.
- For mixed plans: legal framework from primary sources first, literature/recommendations as a separate part.
- Never present a secondary source as binding case law; never support a legal claim with a found-only source; reading candidates are clearly marked as "to be checked".
- Existing confidence/caveat behaviour keeps deriving from evidence, not from intent.

### 6. Telemetry

Persist under `metadata.source_use_intent`: planned intents, strategy, authority requirements, mixed flag, source presented from the model vs. deterministic override, bucket counts, and the sufficiency decision path.

## Validation

Run the 10-query sequence — ACADEMIC, NATION-STATE-ACADEMIC, PAYWALL, MMM, B8, D1, D3, DARKPATTERNS, R02, P02 — via a new runner (`scripts/legal-research-v1-source-use-intent-validation.ts`), polling `qa_logs` by `metadata->>'run_id'`.

Per run: user_task_intent, source_use_intent, answer_strategy, authority_requirements, mixed?, read-in-full sources, found-only sources, dropped-unrelated sources, final answer shape, authority-overstatement check, footnote integrity, runtime/stability.

Acceptance criteria as specified: ACADEMIC planned as recommendation/seminar/literature-map; NATION-STATE-ACADEMIC not refused for lack of case law; PAYWALL separates acquired from paywalled candidates; MMM uses acquired reports or logs precise claim-match reasons; B8 shows no unrelated found-only sources; D1/D3/DARKPATTERNS no regression; R02/P02 unchanged; no found-only source supports a claim; no secondary presented as binding; no CPU kills, stubs, dangling markers or orphan rows.

Report written to `reports/source-use-intent/ACCEPTANCE_REPORT.md` with a verdict of accepted / partial / not accepted.

## Technical notes

- Files touched: `lib/types.ts`, `lib/schemas.ts`, `stages/claimAnalyzer.ts`, new `stages/sourceUseIntent.ts`, `stages/sourceSufficiency.ts`, `stages/claimSourceMatch.ts` (bucket awareness), `stages/drafterV2.ts`, `index.ts` (wiring + telemetry), new validation script + report.
- No changes to judgment identity validation, cache writes, official fetch/relay policy or docket detection.
- Field absent → conservative fallback = today's behaviour, so the change is additive.
