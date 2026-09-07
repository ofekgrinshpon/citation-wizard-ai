# legal_research_v2_vertical_slice_v1 — acceptance report

Scope: first end-to-end run of the new agentic V2 core. V1 untouched and still deployed.

## Architecture delivered

Question → Intake → Research Agent (tools: `search`, `fetch`, `lookup_authority`)
→ Research Memo → Verification (body read, identity, verbatim span, batched support)
→ Verified Evidence Pack → Drafter (evidence-only) → deterministic citation renderer.

Isolation: `supabase/functions/legal-research-v2/**`, with 11 low-level helpers vendored
under `vendor/` (no V1 orchestration). Internal-only HTTP guard (`x-smoke-mode` +
`V2_SMOKE_TOKEN` or service-role bearer). No production route, no frontend change.

## Live runs (smoke, real gateway + real web)

| Run | Question | Steps | Bodies read | Verified claims | Cited sources | Footnotes | Latency |
|---|---|---|---|---|---|---|---|
| 1 | HCJ review of rabbinical court, property division | 10 | 1 | 1/1 | 1 | 1 | 80s |
| 2 | Bavli 1000/92 (pre-fix) | 11 | 1 | 2/2 | 0 | 0 | 114s |
| 3 | Bavli 1000/92 (post-fix) | 12 | 2 | 2/2 | 1 | 1 | 105s |

Verification behaved as designed: in run 1 one claim/source pair was rejected
(`support_does_not_support`) with an explicit reason; no invariant errors in any run.

## Defects found by the live runs and fixed

1. **URL used as citation title.** `evidenceStore.displayTitleFor` now recovers a Hebrew
   title from the fetched body (first prose line, else statute, else docket) whenever
   discovery supplied a URL/filename.
2. **URL printed twice / no title.** `formatCitation` never treats a URL as a title and
   appends the URL only if not already present.
3. **Docket repeated between title and locator.** The locator's leading docket is dropped
   when the title already contains it.
4. **Draft with zero citations despite verified evidence.** Source ids are now normalized
   (`s1`/`[S1]`/`S1.` → `S1`), the drafter prompt requires a source id on every non-heading
   block, and one deterministic repair call is made if a draft cites nothing while the
   evidence pack has sources.
5. **`Deno` typecheck error** in `shared/model.ts` (project build) — local declaration added.

## Known limitations (not fixed in this track)

- `court.gov.il` / `supremedecisions.court.gov.il` refuse edge egress (connection reset);
  official acquisition falls back to third-party mirrors.
- `documents_fetched` counts store entries including failed attempts;
  `successful_body_reads` is the honest number.
- Agents can burn fetch budget re-fetching the same URL (deduped to one source but the
  budget is still spent). Candidate for a cheap "already fetched" tool response.

## Verification

- `deno check --node-modules-dir=none legal-research-v2/index.ts` — clean.
- Vitest full suite: 46 files, 511 tests, all passing (3 new V2 render/title tests).
- Project build: OK.
- `legal-research-v2` deployed; V1 unchanged.

## Recommendation

GO to the next V2 track (evaluation on the 18Q regression set with V1 as baseline).
Priority next: official-egress path for court.gov.il, fetch-budget efficiency,
and multi-source coverage (both runs converged on a single document).
