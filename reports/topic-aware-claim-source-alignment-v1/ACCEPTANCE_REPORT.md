# topic_aware_claim_source_alignment_v1 — acceptance report

Precision-of-use track, pre-draft half. No retrieval, acquisition, admission,
pool-size, footnote-cap or Hebrew-prose changes. The new module only decides
**which already-admitted sources a claim may cite**, states that plan to the
drafter, and reports compliance and the post-draft citation-level filter.
`topicAwareAlignment.ts` (post-draft role sanity, legal-area fit, block
pruning, compound guard, limitation notes) is unchanged and still enforces.

## What was built

| Component | File | Effect |
|---|---|---|
| Claim-type derivation from Hebrew claim text | `stages/claimSourcePlanning.ts` (`deriveClaimTypeFromText`) | statutory_framework / case_holding / doctrinal_rule / theoretical_background / comparative_context / critique / implementation_example |
| Claim → source plan | `buildClaimSourcePlan` | Per claim: allowed roles, up to 4 `preferred_source_ids`, explicit `disallowed_source_ids` (incompatible source class, or judgment blocked by legal-area fit), `unsupported_or_cautious` flag |
| Prompt constraint block | `renderClaimSourcePlanBlock` | Hebrew block rendered into the drafter user message after the internal claim list: which refs may be used per claim, which are forbidden |
| Drafter compliance (report-only) | `assessDrafterBlockCompliance` | Per block: allowed refs, emitted refs, disallowed refs emitted, compliant yes/no. Enforcement stays with the existing post-draft gates. |
| Post-draft alignment filter telemetry | `buildPostDraftAlignmentFilter` | Citation-level kept/dropped view with the role/legal-area reason for each drop |
| Wiring | `stages/drafterV2.ts`, `index.ts` | Plan built before the prompt; compliance + filter computed after CSM and topic alignment; three new metadata fields exposed |

Source-class compatibility reuses `classifySource` and `judgmentLegalAreaFit`
from `topicAwareAlignment.ts`, so the pre-draft plan and the post-draft filter
apply the same doctrine lexicon and role rules.

## Validation

Runner: `scripts/legal-research-v1-claim-source-alignment-validation.ts`
(telemetry: `results.json`, answers: `ANSWERS.md`).

| Fixture | run_id | pool | plan rows | blocks checked | compliance violations | filter kept/dropped | role fixes | refs removed | reordered | promoted | footnotes | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AW4 | 1b5fe080… | 13 | 4 | 7 | 0 | 9 / 2 | 12 | 2 | 0 | 0 | 3 | 161,110 |
| AW9 | 0d3a8b79… | 22 | 4 | 5 | 0 | 7 / 0 | 4 | 0 | 0 | 0 | 2 | 146,277 |
| AW7 | 501c7e83… | 28 | 4 | 1 | 0 | 3 / 0 | 5 | 0 | 0 | 0 | 1 | 130,868 |
| Q3 | e2406aa9… | 14 | 5 | 6 | 0 | 8 / 1 | 3 | 1 | 0 | 0 | 4 | 122,387 |
| Q2 | 71978f12… | 17 | 4 | 5 | 0 | 8 / 1 | 6 | 0 | 1 | 1 | 2 | 150,986 |

An earlier AW9 attempt (c5f69ac5…) ran 879s and produced no drafter telemetry
and 0 footnotes — a degraded run unrelated to this track; the clean re-run is
the one reported.

### Drafter compliance

Across all five fixtures: **24 blocks checked, 24 compliant, 0 disallowed refs
emitted.** The plan is being respected at generation time rather than only
corrected afterwards. Example (AW4):

| block | claim | allowed refs | emitted refs | compliant |
|---|---|---|---|---|
| b1 | C1 critique | s3, s9, s2, s4 | s2 | yes |
| b2 | C2 theoretical_background | s1, s9, s2, s3 | s1, s2 | yes |
| b3 | C2 | s1, s9, s2, s3 | s9, s3, s2 | yes |
| b6 | C4 implementation_example | s9, s2, s3, s4 | s3, s2, s4 | yes |

### Claim → source plans (representative)

| Fixture | claim | claim type | preferred | disallowed |
|---|---|---|---|---|
| AW4 | C2 | theoretical_background | s1, s9, s2, s3 | — |
| AW4 | C3 | implementation_example | s3, s9, s2, s4 | s1 (statute not usable as an example) |
| AW9 | C1 | theoretical_background | s3, s4, s5, s6 | s1, s2 |
| AW7 | C1 | theoretical_background | s1, s3, s8, s4 | s2, s6, s7, s9, s10, s15 |
| Q2 | C2/C3 | statutory_framework | s1 (Basic Law) only | s2–s10 |
| Q3 | C3 | critique | s5, s6, s7, s3 | s1 |

Q2 is the clearest win: the two statutory-framework claims may cite only the
Basic Law; every judgment and article is explicitly forbidden for those claims.

### Post-draft alignment filter (drops)

| Fixture | citation | reason |
|---|---|---|
| AW4 | b2 : s1 | class_statute_not_acceptable_for_implementation_example |
| AW4 | b3 : s2 | class_academic_not_acceptable_for_case_holding |
| Q3 | b3 : s6 | class_judgment_not_acceptable_for_statutory_framework |
| Q2 | 1 drop | class mismatch (statutory-framework block) |

No drop was caused by a legal-area failure in these runs (`legal_area_fit`
true throughout); all drops were class/role mismatches — exactly the failure
mode this track targets (scholarship carrying a holding, a statute carrying an
example).

### Safety confirmations

- Retrieval, acquisition, admission, pool size and footnote caps unchanged
  (pools 13–28; footnotes 1–4, all within the existing 3-refs-per-block and
  per-sentence marker caps).
- The plan can only *restrict* the drafter to sources already in the CSM-
  validated pack. It never adds, revives or re-admits a source.
- Identity, metadata-only, source-integrity, CSM Rule D/E, topic-aware
  alignment and footnote invariants all run unchanged and after the plan.
- Hebrew prose rules, limitation-note wording and the single academic
  הערת עבודה are untouched.
- Latency unchanged: 122–161s, in line with prior runs on the same fixtures.

### Tests

`src/test/claimSourcePlanning.test.ts` — 10 new tests (claim-type derivation,
statute-only plans, off-doctrine judgment blocking, prompt rendering,
compliance violations, filter telemetry). Full suite: **26 files / 263 tests
pass.** Edge function deployed successfully.

### Remaining gaps

- AW7 still ends with a single footnote: its genre produces one substantive
  block, and the plan deliberately does not promote unused stronger sources
  into new blocks (that would bypass CSM).
- Court-PDF display titles remain long/garbled (AW4 footnote 2, Q3 footnote 2)
  — display-title hygiene, not alignment.
- `post_draft_alignment_filter.csm_result` is always `"kept"`: the rows describe
  citations that already survived CSM, so the field is a constant marker rather
  than a live CSM verdict.
