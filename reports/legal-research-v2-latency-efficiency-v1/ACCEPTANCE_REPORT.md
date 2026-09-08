# legal_research_v2_latency_efficiency_v1 — acceptance report

V1 untouched. Models, budgets, verifier strictness and deliverable-aware depth logic unchanged.

## 1. Files changed

Created
- `supabase/functions/legal-research-v2/shared/timing.ts` — `RunTimer`, per-phase totals/counts, per-turn records, serializable across worker chunks.
- `supabase/functions/legal-research-v2/agent/contextWindow.ts` — rolling context compaction + single rolling research-state message.
- `supabase/functions/legal-research-v2/verification/repairPolicy.ts` — selective memo repair decision.

Edited
- `agent/researchAgent.ts` — timed turns, per-turn telemetry, context compaction, deterministic no-op `already_read` suppression, heartbeats.
- `agent/commitPolicy.ts` — `repeatCount()`.
- `tools/acquisitionLedger.ts` — `attemptOn()`, `state()`, host tracking.
- `tools/fetch.ts` — same-authority body reuse, dead-path suppression (explicit `refetch_reason` still overrides).
- `shared/model.ts` — local-only message digests stripped from provider payloads.
- `index.ts` — phase timing around verification/temporal/drafting/rendering, resume-gap accounting, selective repair, new telemetry.
- `types.ts` — optional latency/efficiency telemetry fields.
- `beta/progress.ts` — throttled heartbeat writing `last_progress_at`.
- `beta/job.ts` — terminal-state guard so a late worker can't overwrite a finished job.
- Database migration — `legal_research_jobs.last_progress_at`; stale-job reaper now inactivity-based with a 45-minute absolute ceiling.

Tests: `src/test/legalResearchV2.latency.test.ts` (9 tests). Full suite: **50 files / 553 tests pass**; Deno typecheck of the function clean; deployed.

## 2. Primary validation — HCJ / rabbinical property review

Run `e4be95ea` (job `b878b6d3`), same question as run `708092db`.

| Metric | Before (708092db) | After |
|---|---|---|
| Internal latency | 340.9 s | **254.0 s** |
| Prompt tokens (total) | 336,927 | **184,710** |
| Max prompt tokens, single call | 46,500 | **12,431** |
| Agent steps | 13 | 22 |
| No-op re-reads sent to the model | 16 | **8 suppressed** (of 90 already-read actions) |
| Memo repair cycles | 1 | **0** (`no_unsupported_core_claims`) |
| Verified claims / cited sources | ? / 1 | 3 / **2** |
| User-facing job outcome | wrongly reaped as `timed_out` | **delivered `done`** |

Phase breakdown (new telemetry, ms): agent_model 166,872 · search 59,751 · drafting_model 13,281 · verification_model 7,921 · fetch 1,985 · resume_gap 2,043 · lookup 70 · rendering 2.
Context compaction: 99 compactions, 195,734 chars saved. Authority re-acquisitions prevented: 0 (no duplicate-host acquisition occurred this run). Chunks executed: 3.

Remaining bottleneck is now honest work: agent model thinking (66%) and search (24%); orchestration waste is ~1%.

## 3. Regression — narrow named authority (Bavli)

Run `7fe52592`: 150.2 s, 17 steps, 144,188 prompt tokens, max single call 12,816, 3 documents fetched, 1 verified citation, correct and focused answer (civil property law applies in the rabbinical court; sharing presumption; order made absolute).

Latency is higher than the 77 s baseline. Cause is not orchestration waste (0 suppressed no-ops, no repeated acquisition): the agent submitted a memo at step 6 and then chose to keep researching for a second memo. That is agentic depth behaviour, not the latency work; per-turn telemetry now makes it visible if you want it addressed in a follow-up track.

## 4. Confirmations

- No research modes, quotas, gates or new architecture added.
- Verification identity/span/support semantics untouched; no fabricated citations, no invariant errors in either run.
- Heartbeats confirmed live (`last_progress_at` refreshing during the long run), and the long run delivered instead of being reaped.
