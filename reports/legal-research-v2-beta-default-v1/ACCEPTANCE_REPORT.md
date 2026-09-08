# legal_research_v2_beta_default_v1 — acceptance report

## 1. Files changed (routing / configuration only)

| File | LOC | Change |
|---|---|---|
| `src/config/researchPipeline.ts` (new) | 40 | `RESEARCH_PIPELINE = "v2"`, function map, attachment rule, V1/V2 stage lists |
| `src/components/LegalResearchV1Panel.tsx` | ~20 | invoke target from config; stage list chosen per job (V1 or V2 keys) |
| `supabase/functions/legal-research-v2/beta/progress.ts` (new) | 78 | monotonic user-facing progress persisted on the job row |
| `supabase/functions/legal-research-v2/beta/job.ts` (new) | 130 | job result mapping, delivery test, refund, terminal job writes |
| `supabase/functions/legal-research-v2/index.ts` | ~130 | authenticated beta entry (auth, idempotency, credits, job row, background run), job-aware `driveRun`, progress calls |
| `supabase/functions/legal-research-v2/agent/researchAgent.ts` | 6 | presentation-only `onActivity` hook (no loop change) |
| `supabase/functions/legal-research-v2/shared/model.ts` | 1 | agent default `google/gemini-3.1-pro-preview` → `openai/gpt-5.6-terra` |
| `supabase/functions/legal-research-v2/tools/search.ts` | 1 | pre-existing `Deno` typing error fixed |
| `supabase/config.toml` | 2 | register `legal-research-v2` (JWT verified in-function) |

No V1 file was modified. No research stage, gate, quota, freshness rule, fallback, mode, or verifier behaviour was added or changed.

## 2. Routing / models

| | Before | After |
|---|---|---|
| Beta research function | `legal-research-v1` | `legal-research-v2` (attachments still V1) |
| V2 Research Agent | `google/gemini-3.1-pro-preview` | `openai/gpt-5.6-terra` (`V2_AGENT_MODEL` override kept) |
| Verifier | `google/gemini-3.7-flash` | unchanged |
| Drafter | `google/gemini-3.1-pro-preview` | unchanged |

## 3. Rollback

One line: `RESEARCH_PIPELINE = "v1"` in `src/config/researchPipeline.ts`. V1 stays deployed, unmodified and fully functional; its job/credit/progress semantics are untouched.

## 4. Credits

Identical to before: 5 credits charged with `consume_credits` on the user's own session, `(user_id, client_request_id)` idempotency (a retried submit reattaches, never double-charges), admin zero-delta consumes never refunded, refund via `refund_credits_for_user` when no cited answer is produced or the run fails, existing stale-job reaper still refunds abandoned jobs.

## 5. Progress UX

Persisted on `legal_research_jobs` exactly as before; V2 stages are presentation-only and monotonic:
`searching (מחפש מקורות) → reading (קורא מקורות) → verifying (מאמת מקורות) → writing (כותב תשובה)`.
Observed live trace on a completed run: `searching → reading → verifying → writing → done`, `completed_stages = [searching, reading, verifying, writing]`.

## 6. Smoke runs

Batch 1 (before the ordering fix) — A and B produced real V2 answers with footnotes, but the edge worker shut down between the internal write and the job write, so the job rows were left running. Fixed by finalizing the user-facing job row first and awaiting progress writes; redeployed.

Batch 2 (after the fix) — routing, auth, credits, job creation, full progress trace and terminal `status = done` with `pipeline_version = v2` all verified. **All model calls returned 403 `credit_limit_reached`**, so the answers are empty.

## 7. Blocker

Workspace AI-gateway monthly credit limit (85 credits, action "block usage") is currently triggered, so every gateway call is refused with 403. Until the workspace limit is raised, V2 cannot produce answers. Blocked runs now fail the job and refund rather than delivering an empty answer.

Other known blockers unchanged: official court egress, high token cost per run.
