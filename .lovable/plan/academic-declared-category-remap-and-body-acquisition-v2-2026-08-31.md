# academic_declared_category_remap_and_body_acquisition_v2

Make the academic authority alignment actually fire in live runs, rescue direct short-body academic sources, remove doctrinal-sufficiency false negatives, and keep off-topic scholarship out of the drafter pack.

## Why the previous track under-delivered

`deriveClaimCategory` takes the drafter's `declared` tag first and stops there (`basis: "declared_claim_category"`). The academic branch only runs for untagged blocks — and in live runs almost every block arrives tagged. That is why live metadata still shows only `doctrinal_synthesis`, `contextual_background`, `court_holding`, `scholarly_commentary`.

Sufficiency profile 5 ends in `no_statutory_caselaw_or_doctrinal_anchor` unless a domain statute, usable judgment, or `topicalAuthority` entry exists — an acquired, on-topic, verifier-direct commentary body is not counted, which is the AW8 false negative.

## What changes

### 1. Declared-category remap in academic mode — `stages/claimSupportCategory.ts`
- `deriveClaimCategory` gains academic-mode inputs: `declaredCategory`, block text, `acquiredPrimaryAvailable`, `acquiredDoctrinalAvailable`.
- In academic mode a declared **legacy** category (`doctrinal_synthesis`, `contextual_background`, `scholarly_commentary`, `court_holding`, `statutory`) is no longer trusted blindly. Order of decision:
  1. Docket-identity escalation (unchanged) → `court_holding`.
  2. Binding-law wording (`בית המשפט קבע`, `נפסק כי`, `ההלכה היא`, `החוק קובע`, `סעיף … קובע`, explicit docket outcome, quoted statutory text) → keep/escalate to `court_holding` / `statutory`; acquired primary is required, and if absent the language guard suppresses or reports the phrasing (no secondary substitution).
  3. Otherwise map the block by wording + proposition type into one of the six academic categories: `academic_framing`, `doctrinal_background`, `theoretical_explanation`, `literature_synthesis`, `critique_or_counterposition`, `methodological_framing`.
- Remap emits `basis: "academic_declared_remap"` plus the reason, so live metadata shows the new categories.

Telemetry `academic_declared_category_remap`: `declared_category, final_category, basis, remap_reason, binding_language_detected, acquired_primary_available, acquired_doctrinal_available, remapped_count, kept_primary_count`.

### 2. Bounded body re-acquisition — `stages/secondaryBodyAcquisition.ts` (+ hook in `index.ts`)
- After the first acquisition pass, select sources that are verifier `direct`, subject-fit strong, academic/doctrinal/commentary typed, and under the substantive threshold (~1500 chars) while not metadata-only by nature.
- One extra bounded attempt per source using already-known fulltext/PDF/alternate links from the same candidate record. Hard cap 3 attempts per run, budget-governed through `RetrievalGovernor`, no new crawling, no integrity loosening.
- Still short → stays bibliography-only, with a recorded failure reason.

Telemetry `academic_body_reacquisition`: `attempted_count, source_title, initial_chars, final_chars, success, failure_reason`.

### 3. Academic doctrinal anchor in sufficiency — `stages/sourceSufficiency.ts`
- For `user_task_intent = academic_writing` and genres introduction / theoretical_background / topic_presentation / generic_academic / argument_paragraph, an acquired, on-topic, verifier-direct doctrinal **or commentary** body counts as a doctrinal anchor in profile 5 (and equivalent doctrinal profiles).
- Not applied when the user explicitly asked for a case holding, statutory text, a docket-specific outcome, a canonical quote, or a binding-law answer — those keep today's requirements.
- The anchor licenses academic framing/background/theory/synthesis/critique claims only; holding and statutory claims remain primary-only via claim-source-match.

Telemetry `academic_sufficiency_anchor`: `doctrinal_anchor_present, commentary_anchor_present, anchor_sources, anchor_chars, verifier_verdicts, previous_sufficiency_reason, final_sufficiency_reason, overridden_false_negative`.

### 4. Pack-level subject-matter fit — `stages/academicAuthorityAlignment.ts` + drafter pack assembly
- Reuse the existing question/topic overlap scorer, applied **before** the drafter pack is built rather than only at ref level: long-but-off-topic bodies (contract-gift theory under administrative promise, family-law or interim-appeal material in an administrative pack) are rejected or demoted below on-topic material.
- Borderline scores are kept but flagged, never silently dropped; length alone never buys admission.

Telemetry `academic_pack_subject_fit`: `passed_count, rejected_count, rejected_titles, rejected_reasons, borderline_kept`.

### 5. Listing pollution — monitor only
Report listing/index pages still occupying pool slots, whether they displaced usable academic sources, and whether a dedicated suppression track is warranted. No behavioural change here.

## Out of scope
Judgment identity validation, docket limitation, source integrity, footnote rendering, found-only support rules, any fixed citation-count target. Secondary sources still never support exact holdings, statutory text, docket outcomes, canonical quotes, or binding-law claims.

## Validation
- Unit tests extending `src/test/academicAuthorityAlignment.test.ts`: declared-legacy → academic remap, binding-language override of a declared academic category, re-acquisition selection bounds, commentary-anchor sufficiency (and its explicit-holding exclusion), pack fit rejection.
- Live run of AW1, AW4, AW7, AW8 via `scripts/legal-research-v1-authority-alignment-validation.ts`, checked against: the six academic categories present in live metadata; AW1 attempts re-acquisition for the Barak and Bel Yosef sources; AW4 no longer loses refs to spurious `court_holding` blocks; AW7 unchanged (no forced citation density); AW8 no longer refuses with `no_statutory_caselaw_or_doctrinal_anchor`; off-topic scholarship reduced; no secondary under a primary claim; rendering invariants clean.
- Report + full answers to `reports/academic-declared-category-remap-v2/` and delivered in chat.
