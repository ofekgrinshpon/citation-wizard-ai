# legal-research-v1

Clean-slate research pipeline. Replaces the deleted Fast/Deep/Core/SR/Doctrine
stack with one linear, deterministic pipeline.

## Current phase: P1 + P2 only

Implemented:
- **P1 Skeleton** — auth, request validation, credit pre-flight (no consumption
  yet), telemetry row, stub answer.
- **P2 Claim Analyzer + Research Query Planner** — real OpenAI calls via the
  Lovable AI Gateway, JSON tool-call output, schema validation, deterministic
  `gpt-5-mini → gpt-5` escalation per the rules in `lib/escalation.ts`.

Not implemented yet (gated on separate approval):
- P3 retrieval (local DB + Perplexity)
- P4 candidate pool + verifier
- P5 drafter + footnote renderer
- P6 frontend hookup
- P7 GA

## Endpoint

`POST /functions/v1/legal-research-v1`

Auth: `Authorization: Bearer <jwt>` required.

Request:
```json
{ "question": "string (1–4000 chars)", "project_id": "uuid (optional)" }
```

Response (P2): stub `answer`, empty `footnotes`, and `debug.claims` /
`debug.queries` populated with the planning output.

Errors:
- `400` invalid input
- `401` missing/invalid JWT
- `402` `INSUFFICIENT_CREDITS`
- `422` planning failure after escalation — body includes `debug.planning_error`
- `500` unexpected stage failure

## Billing

P1/P2 do **not** consume credits — no answer is produced. We only check
`hasEnough` up front for early 402 feedback. Consumption begins in P5 when an
actual answer is produced.

## Escalation rules (P2)

Single retry to `openai/gpt-5` if any trigger fires; at most one retry per
stage. If the post-escalation output still fails, we return **HTTP 422** with a
structured `planning_error` instead of silently producing a degraded result.

Triggers:
- **A1** `question.length > 200` — analyzer starts on `gpt-5` directly.
- **B1–B4** analyzer schema invalid, `confidence < 0.7`, `claims < 2`, or any
  claim with empty `required_roles`.
- **C1–C5** planner schema invalid, fewer than 3 queries, any claim with 0
  queries, any black-letter claim without a `primary_statute` / `regulation` /
  `binding_case_law` query, or more than 50% of queries with fewer than 12
  Hebrew letters in `query_he`.

## Footnotes policy

v1 prioritizes **source grounding and working links** over perfect legal
citation format. When P5 lands, footnotes will be simple `title — URL` rows.
No Uniform Citation Rules (2021), no Rule 37.7 repeated-citation logic, no
Hebrew year prefix enforcement, no "שם" / "לעיל ה״ש X". Citation-formatting
upgrade is deferred to **v2**.

## Invariants

- Does not touch `legal-qa/index.ts`.
- No DoctrineClassifier / SourceRequirements / SR protected-candidates.
- No Fast/Deep modes.
- One linear pipeline, deterministic escalation only.

## Telemetry

One `qa_logs` row per run with `task_mode = "legal_research_v1"`. Full trace
under `metadata.planning` (analyzer + planner model/escalation/timings/schema
validity, claims, queries, truncation counts).
