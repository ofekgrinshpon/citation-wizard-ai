

## Run the stability test myself using the existing eval harness

I claimed I needed you to run manual tests. That was wrong — the codebase already has `eval/run-eval.mjs` which solves the JWT problem cleanly. I'll use it.

### How auth gets solved (no new code needed)

The existing harness:
1. Uses `SUPABASE_SERVICE_ROLE_KEY` (already in env) to mint a magic link for the admin user `ofekgrinshpon@gmail.com`
2. Exchanges the magic-link `token_hash` for a real session JWT via the anon client
3. Sends that JWT as `Authorization: Bearer …` to `legal-qa`
4. The edge function's existing admin gate (`index.ts` line 869) accepts `evalForceLegacy` / `evalRunId` / `evalVariant` from admin callers

All env vars are present (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` — the harness already falls back from `SUPABASE_ANON_KEY` to `SUPABASE_PUBLISHABLE_KEY`).

### What I'll do this loop

**1. Build a small wrapper script** at `eval/stability-test.mjs` that:
- Reuses `getAdminJwt()` from `run-eval.mjs` (or imports its logic)
- Targets exactly Q1, Q6, Q21 from the existing question bank
- Runs each question 3× sequentially (9 total runs), structured variant only (`evalForceLegacy: false`)
- Adds a unique `requestId` per run so credit ledger idempotency doesn't merge them
- Polls `qa_logs` after each run for `metadata.drafting_path`, `metadata.stage_runs`, `metadata.models_used`, `footnotes`, `total_footnotes`
- Writes results to `/mnt/documents/legal-qa-eval/stability-v7.2.json`

**2. Execute it via `code--exec`** with a generous timeout (~15 min for 9 runs at ~70s each)

**3. Aggregate and report** the structured-vs-fallback split per question:

```text
              Run 1     Run 2     Run 3     Structured rate
Q1            ?/?       ?/?       ?/?       X/3
Q6            ?/?       ?/?       ?/?       X/3
Q21           ?/?       ?/?       ?/?       X/3
                                            ──────
                                            total /9
```

For each run I'll also report: `claimMapAllowedCount` (the gate variable), `footnotes_count`, `anchored_count`, `wall_ms`.

### Decision criteria

| Outcome | Read |
|---|---|
| ≥ 8/9 structured | Gate relaxation succeeded — path is now stable. Move to retest fallback retrofit question. |
| 6–7/9 structured | Partial win. Diagnose which question/run flipped and why (likely Q21 statute). |
| ≤ 5/9 structured | Gate relaxation insufficient — the planner is still under-flagging claims. Investigate `support_strength` distribution before further tuning. |

### What this loop does NOT do

- No edge function code changes (the v7.2 changes from the prior loop are already deployed)
- No new questions added beyond Q1/Q6/Q21
- No fallback-retrofit work yet
- No 10-question pilot

### Deliverables

- `/mnt/documents/legal-qa-eval/stability-v7.2.json` — raw per-run data
- A summary table in chat with structured/fallback split, gate values, and a single recommendation for the next move

