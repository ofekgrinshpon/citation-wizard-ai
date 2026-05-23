
# Legal Research v1 — Revised Plan (Scoped to P1 + P2)

Architecture from the prior plan is approved. This revision narrows scope to **P1 (Skeleton)** and **P2 (Claim Analyzer + Research Query Planner)** only, and incorporates the requested model policy, schemas, caps, and Perplexity-deferred guidance.

P3 (retrieval), P4 (verifier), P5 (drafter/footnotes), P6 (frontend), P7 (GA) are documented as future phases but **not implemented** until separately approved.

## 1. Isolation & Endpoint

New, isolated edge function — does **not** touch `legal-qa/index.ts`.

```text
supabase/functions/legal-research-v1/
├── index.ts              # HTTP entry: auth, validation, billing, orchestration, telemetry
├── stages/
│   ├── claimAnalyzer.ts  # P2
│   └── queryPlanner.ts   # P2
├── lib/
│   ├── openai.ts         # Lovable AI Gateway client + JSON tool-call helper
│   ├── schemas.ts        # JSON-schema validators for analyzer + planner output
│   ├── escalation.ts     # Deterministic gpt-5-mini → gpt-5 escalation rules
│   ├── telemetry.ts      # qa_logs writer
│   └── types.ts          # Claim, Query, RequiredRole, AnalyzerOutput, PlannerOutput
└── README.md             # v1 footnotes policy + invariants
```

Registered in `supabase/config.toml` under `[functions.legal-research-v1]` (auth validated in code; `verify_jwt = false` per project convention).

**Endpoint:** `POST /functions/v1/legal-research-v1`

**Request:**
```json
{ "question": "string (required, 1–4000 chars)", "project_id": "uuid (optional)" }
```

**P1 response (stub):**
```json
{
  "answer": "[stub] תשובה תיווצר ב־P5",
  "footnotes": [],
  "debug": {
    "run_id": "uuid",
    "phase": "P1-skeleton",
    "stage_runs": [{ "stage": "stub", "ms": 0, "ok": true }],
    "claims": [], "queries": [], "candidates_found": [], "candidates_used": [], "dropped_sources": []
  }
}
```

**P2 response:** same shape; `debug.claims` and `debug.queries` populated; `answer` still stub.

**Errors:** 400 invalid input · 401 no JWT · 402 insufficient credits · 422 planning failure (after escalation) · 429 rate-limit · 500 stage error (with stage name).

## 2. P1 — Skeleton

Scope:
1. Hono-free, plain `Deno.serve` handler with CORS.
2. Zod request validation (`question` 1–4000 chars; `project_id` optional uuid).
3. Auth: extract JWT, validate via `supabase.auth.getUser()`; reject 401 if missing/invalid.
4. Billing wiring (simple, mirrors `legal-qa` pattern):
   - Pre-flight: check the user has ≥ `CREDIT_COSTS.legalQa` (currently 5) credits via `consume_credits` RPC.
   - Refund on stage failure before answer is produced (P1 never produces an answer → P1 refunds every call, so for P1 we **do not consume** yet; we only check `hasEnough`. Consumption begins in P5 when an answer is actually produced.).
5. `run_id = crypto.randomUUID()` per request.
6. Telemetry row in `qa_logs` with `task_mode = "legal_research_v1"`, `metadata.pipeline = "legal-research-v1"`, `metadata.phase = "P1-skeleton"`, `metadata.run_id`, `metadata.stage_runs = []`.
7. Stub response per Section 1.
8. No model calls.

Exit criteria: authenticated POST returns 200 stub; qa_logs row written; unauth returns 401; bad input returns 400.

## 3. P2 — Claim Analyzer + Research Query Planner

### 3a. Claim Analyzer

Single OpenAI call via Lovable AI Gateway, JSON tool-call. Default model `openai/gpt-5-mini`.

**System prompt (paraphrase):** Hebrew legal analyst. Break the question into 3–5 atomic legal claims. For each claim list the source roles needed to answer it. Do not use a fixed doctrine catalog. Output the schema exactly.

**Output schema (validated server-side):**
```json
{
  "confidence": 0.0,
  "legal_area": "string",
  "answer_type": "doctrinal_explanation | application | comparison | factual_legal | other",
  "claims": [
    {
      "claim_id": "C1",
      "text_he": "...",
      "required_roles": [
        "primary_statute" | "regulation" | "binding_case_law" |
        "persuasive_case_law" | "scholarship" | "factual_report" | "government_report"
      ],
      "is_black_letter": true,
      "reason": "..."
    }
  ]
}
```

### 3b. Research Query Planner

Single OpenAI call, JSON tool-call. Default model `openai/gpt-5-mini`. Input = analyzer output.

**Output schema:**
```json
{
  "queries": [
    {
      "claim_id": "C1",
      "role": "primary_statute | regulation | binding_case_law | persuasive_case_law | scholarship | factual_report | government_report",
      "query_he": "תקנות סדר הדין האזרחי תשע\"ט-2018 תקנה 95 צו מניעה זמני",
      "targets": ["local_db", "perplexity"],
      "expected_source_type": "statute | regulation | case | academic | report | other",
      "reason": "..."
    }
  ]
}
```

Prompt rules baked into the system message:
- Queries must be specific; avoid bare generic terms (e.g. "סבירות" alone, "חוזים" alone).
- Statute-heavy: include statute name and section when inferable.
- Case-law: include "בית המשפט העליון", "בג״ץ", "רע״א", "ע״א" when relevant.
- Scholarship: only when relevant; include author/journal hints if inferable.
- Factual: include government / Knesset / committee / official-report terms.
- Choose `targets` per query — do **not** blindly include both. Local-only when looking up a specific statute already known to be in the corpus; Perplexity-only when freshness/web is needed; both when broad coverage is useful.

### 3c. Caps (Section 7)

| Cap | Value | Behavior on overflow |
|---|---|---|
| Target claims | 3–5 | Soft target via prompt |
| Max claims | 7 | Truncate to first 7; log `truncated_claims_count` |
| Max queries per claim | 4 | Truncate; log `truncated_queries_count` |

Truncation is **non-silent**: counts persisted in telemetry.

### 3d. Deterministic Escalation (Section 4)

Single retry to `openai/gpt-5` if **any** trigger fires. Triggers split by stage so escalation is scoped to the failing stage:

**Pre-stage (analyzer) escalation triggers — bypass mini, go straight to gpt-5:**
- A1. `question.length > 200`

**Post-analyzer escalation triggers — retry analyzer once with gpt-5:**
- B1. JSON parse or schema validation fails
- B2. `confidence < 0.7`
- B3. `claims.length < 2`
- B4. any claim has `required_roles.length === 0`

**Post-planner escalation triggers — retry planner once with gpt-5 (re-using current analyzer output):**
- C1. JSON parse or schema validation fails
- C2. `queries.length < 3`
- C3. any claim has 0 queries
- C4. any claim where `is_black_letter === true` lacks at least one query with role in {`primary_statute`, `regulation`, `binding_case_law`}
- C5. >50% of queries have `query_he` shorter than 12 Hebrew characters (counting Hebrew letters only)

**Rules:**
- At most **one** escalation per stage.
- If post-escalation output still fails its checks → return **HTTP 422** with `debug.planning_error = { stage, reasons[] }`. Do not continue silently. Do not produce a stub answer pretending success. For P2 validation, the fixture is marked failed.

### 3e. Telemetry (P2)

`qa_logs.metadata.planning = {`
- `analyzer.model_initial`, `analyzer.model_final`, `analyzer.escalated_to_gpt5`, `analyzer.escalation_reason[]`, `analyzer.confidence`, `analyzer.schema_valid`, `analyzer.ms`
- `planner.model_initial`, `planner.model_final`, `planner.escalated_to_gpt5`, `planner.escalation_reason[]`, `planner.schema_valid`, `planner.ms`
- `claims_count`, `queries_count`, `truncated_claims_count`, `truncated_queries_count`
- `planning_error` (only on 422)

`metadata.stage_runs[]` carries `{stage, model, ms, ok, escalated}` entries.

Exit criteria: see Section 6 acceptance.

## 4. Footnotes Policy for v1 (README)

v1 prioritizes **source grounding and working links** over perfect legal citation format. Footnotes are simple `title — URL` rows. No Uniform Citation Rules (2021), no Rule 37.7 repeated-citation logic, no Hebrew year prefix enforcement, no "שם" / "לעיל ה״ש X". Citation-formatting upgrade is deferred to **v2**.

(This is documented in P1's README even though it only materializes in P5.)

## 5. Future Phases — Documented, Not Implemented

### P3 retrieval — Perplexity policy update (per Section 8)

When P3 is approved, Perplexity will be invoked **selectively**, not "always per claim":

Use Perplexity when **any** holds:
- local DB returns thin results for the query (fewer than a configurable threshold, e.g. <3 candidates)
- official URL / source freshness is needed
- the query's role explicitly targets web/official sources
- role ∈ {`binding_case_law`, `primary_statute`, `regulation`, `factual_report`, `government_report`} and the corresponding local DB hits lack a URL

Per-run priority order for Perplexity budget allocation:
1. `primary_statute` / `regulation`
2. `binding_case_law`
3. `government_report` / `factual_report` (when fact-sensitive)
4. `scholarship`
5. `persuasive_case_law` / background

**One-shot Perplexity retry per important role:** if a Perplexity query for a role in priority tiers 1–3 returns 0 valid candidates after filtering, generate one alternative query (LLM reformulation) and retry once. Log `{original_query, retry_query, drop_reasons[]}`. No more than one retry per role per run.

### P4, P5, P6, P7

Unchanged from prior plan. Not implemented now.

## 6. P2 Validation

Fixtures stored in `eval/legal-research-v1/fixtures.json`:

1. מהם התנאים למתן צו מניעה זמני?
2. מהי דוקטרינת ההבטחה המנהלית?
3. מתי בית המשפט יפחית פיצוי מוסכם לפי סעיף 15 לחוק החוזים תרופות?
4. מהי דוקטרינת השתק פלוגתא?
5. מהי עילת הסבירות ומה היקף הביקורת השיפוטית עליה?

Runner: `scripts/legal-research-v1-p2-smoke.ts` — calls the deployed endpoint for each fixture; for each it reports:

- `initial_model`, `final_model`, `escalated`, `escalation_reason[]`
- `analyzer.confidence`, `legal_area`, `answer_type`
- `claims[]` with `text_he`, `required_roles`, `is_black_letter`
- `queries[]` with `role`, `query_he`, `targets`, `expected_source_type`
- Heuristic "specific enough" flag per query: `query_he` has ≥12 Hebrew chars AND ≥3 distinct tokens AND is not in a generic-stopword set
- Per-claim black-letter coverage flag: for every claim with `is_black_letter`, at least one query has role ∈ {`primary_statute`, `regulation`, `binding_case_law`}

Report written to `/mnt/documents/legal-research-v1-p2-report.json`.

**Acceptance (all must pass):**
- 5/5 fixtures: analyzer output schema-valid
- 5/5 fixtures: planner output schema-valid
- 5/5 fixtures: claims read as coherent legal sub-questions (manual review)
- 5/5 fixtures: no query flagged "generic" (per heuristic above) for >25% of its queries
- Statute-heavy fixtures (1, 3) include statute/section terms in at least one query
- Doctrinal fixtures (2, 4, 5) include at least one `binding_case_law` or `primary_statute` query
- 0 reintroduction of DoctrineClassifier / SourceRequirements / SR protected-candidates
- 0 contact with `legal-qa/index.ts`

**Escalation should be observable:** at least one of the 5 fixtures is expected to trigger escalation (likely Q3 or Q5 due to `question.length > 200` or analyzer weakness). If none escalate, manually inject a long-form variant to confirm the escalation path actually fires before sign-off.

## 7. Risks (P1–P2 scope)

| Risk | Mitigation |
|---|---|
| Planner produces vague queries despite prompt rules | Heuristic check in escalation trigger C5 forces a retry on gpt-5; surfaced in validation |
| gpt-5-mini under-counts claims (returns 1) | Trigger B3 escalates to gpt-5 |
| Tool-call JSON occasionally malformed | Schema validation + single retry; 422 on second failure (no silent stub) |
| Truncation hides upstream bug | Truncation counts persisted; surfaced in P2 report |
| Billing double-charge if user retries on 422 | P1/P2 do not consume credits (no answer produced); consumption begins in P5 |
| Edge function cold-start latency on first call | Acceptable for P2; no SLO yet |

## 8. Out of Scope for P1–P2

- Local DB search
- Perplexity calls
- Verifier
- Drafter
- Footnote rendering
- Frontend tab / UI changes
- MaintenanceCard removal
- Streaming SSE
- Uniform Citation formatting

## 9. Approval Gate

After P2 passes acceptance, **stop and request approval** before starting P3. Memory file `architecture/legal-research-v1.md` is written at GA (P7), not now; an interim memory note is added after P2 sign-off summarizing the escalation policy and schemas so future sessions don't drift.

Ready to start P1 on approval of this revised plan.
