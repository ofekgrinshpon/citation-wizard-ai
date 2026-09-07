# direct_authority_variety_cap_survival_v1 — Acceptance Report

**Verdict: PASS on the stated criterion.** A strongly identified, directly
relevant authority is no longer lost solely because of the per-origin variety
cap or late rank trimming, while ordinary candidates remain fully capped.

## What was implemented

New module `stages/directAuthoritySurvival.ts` (deterministic, existing signals
only) plus a narrow integration in `stages/candidatePool.ts`:

- **Two-sided evidence requirement.** A candidate is protected only when it has
  *identity* evidence — `protected:exact_docket_identity` /
  `exact_authority_candidate` / `judgment_document` / `official_primary_page` /
  `official_statute_page`, `retrieval_method=exact_authority`,
  integrity `is_judgment_document`, confirmed identity, or
  `detectJudgmentEvidence` docket identity — **and** *direct-relevance*
  evidence — nominated required authority, question docket match, doctrine/facet
  registry match, or issue topicality ≥ 0.15 against the current question.
  Registry presence alone never qualifies. Listing-like, integrity-rejected and
  URL-less candidates are ineligible.
- **Bounded.** `DIRECT_AUTHORITY_EXEMPTION_BUDGET = 3`, one representation per
  normalized authority (duplicates recorded as `duplicate_representation`), and
  the budget is allocated by *strength of evidence*, not pool rank, so a weaker
  judgment appearing earlier cannot consume it.
- **Scope.** The exemption only prevents the drop at
  `backfill_origin_diversity_cap` and at late `max_candidates_cap` trimming
  (bounded overflow ≤ budget). It does not reorder anything, does not cite, and
  does not bypass dedupe, body acquisition, integrity, verifier, CSM,
  topicality/alignment, drafter or footnote building.
- **Telemetry** `retrieval.pool.direct_authority_survival`: authority, original
  rank, `cap_that_would_drop`, protection signals, `exemption_applied`,
  `exemption_budget_used`, `representation_kept`, `next_stage_reached`.

Untouched: retrieval queries, nomination, registry mappings, duplicate
resolution, URL normalization, same-authority body fallback, body acquisition,
integrity, verifier, CSM, alignment, drafter, footnote builder, source-count
targets, ordinary diversity behaviour.

Tests: `src/test/directAuthorityVarietyCapSurvival.test.ts` (A–G, 8 tests).
Full suite green (44 files / 496 tests before the strength-ordering tweak, new
file re-run green after). Function deployed.

## Live validation — original question only

Run `3328d5b6-844f-4035-9db6-39e1f3d416d2` (terminal).
(Two earlier attempts, `8fa13b4f…` and `e3f086d0…`, were reaped as
infrastructure failures and are not counted.)

`direct_authority_survival`: budget 3, used 3.

| candidate | rank | cap that would drop it | protection signals | next stage |
|---|---|---|---|---|
| בג"ץ 6641/11 פלונית נ' בית הדין הרבני הגדול | 102 | `backfill_origin_diversity_cap:perplexity:2` | exact_docket_identity, integrity_judgment_document, document_judgment_identity, topicality 0.24 | **pool_admitted** |
| בג"ץ 9734/03 | 108 | `backfill_origin_diversity_cap:perplexity:2` | exact_docket_identity, integrity_judgment_document, document_judgment_identity, topicality 0.18 | **pool_admitted** |
| דנ"א 10901-08 בייזמן | 122 | `max_candidates_cap:30` | official_primary_page, topicality 0.24 | admitted, then normally dropped by `vector_quota_per_claim` |

Weaker eligible judgments (ranks 22–124, family-court decisions with only
`integrity_judgment_document` + topicality 0.18) correctly received
`exemption_budget_exhausted` — the cap stayed bounded, no pool expansion.

### Bavli funnel this run

| stage | result |
|---|---|
| found | yes — `בג"ץ 1000/92 בבלי נ' בית הדין הרבני הגדול` (מאגרי דין), perplexity |
| survives dedupe | yes |
| original rank / variety cap decision | not dropped by the variety cap; admitted through the pre-existing pool exemption `protected:exact_docket_identity` (origin-cap drops this run: 0) |
| direct-authority protection signals | exact_docket_identity |
| pool | **admitted** |
| pack | **in_pack: true** (`s4`, role `binding_case_law`, citable_as `judgment`) |
| body acquisition | **failed — `body_acquired: false`** |
| identity / verifier / CSM | not reached (`survived_csm: false`) |
| cited | no — `loss_stage: not_selected_as_representative`, `loss_reason: no_acquired_body_or_weak_fit` |

The Wikipedia Bavli page was dropped as `bad_source`; the daat.ac.il record was
dropped as `class_academic_not_admitted_for_binding_case_law`.

**Exact next loss stage: body acquisition for the pack representative —
`not_selected_as_representative / no_acquired_body_or_weak_fit` (no body text
obtained for the מאגרי דין Bavli record).** Per the track instruction this is
reported and not fixed here.

## Final answer quality

Footnotes: **1** — "הזכות המנהלית והסעד הכספי במשפט המקובל המנהלי"
(TAU Law Review, journal_article). Support quality: topical scholarship on
administrative remedies; it supports the general judicial-review framing but is
**not** a direct authority for the rabbinical-court review standard — the answer
itself carries a `מגבלת ביסוס` (grounding-limitation) notice saying so.

Unrelated authorities: none cited. The three judgments found without a read body
(בג"ץ 3752/10, בג"ץ 6641/11, בג"ץ 9734/03) appear only in the explicit
"found but body not read — reference only" block, not as authority-bearing
citations.

Full answer text and run payload:
`reports/direct-authority-variety-cap-survival-v1/run.json`.
