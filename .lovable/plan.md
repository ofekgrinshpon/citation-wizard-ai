# academic_utilization_stabilization_v1

Use the sources the pipeline already acquired. No new retrieval, no discovery changes, no footnote-count target.

## What changes

### 1. Rule D area override in academic mode — `stages/claimSourceMatch.ts`
Rule D currently drops any ref whose `legal_area` differs from the block's on a substantive block. In `academic_writing` mode, the drop becomes a warning when all of these hold: verifier verdict is `direct` or strong `partial`, the source profile is doctrinal/academic/commentary, a substantive body was acquired, `academicTopicalFit` (existing scorer in `academicAuthorityAlignment.ts`) passes, and the block category is one of `academic_framing`, `doctrinal_background`, `theoretical_explanation`, `literature_synthesis`, `critique_or_counterposition`, `methodological_framing`.

Rule D stays strict for `court_holding`, `statutory`, docket-specific and binding-law claims, and for every non-academic mode. Topical-fit failure still drops.

Telemetry `academic_rule_d_area_override`: `source_id, title, block_category, source_legal_area, block_legal_area, topical_fit_passed, overridden, final_decision`.

### 2. Bibliography-only references for literature/framing blocks — `claimSourceMatch.ts` + `footnoteBuilder` wording
Rule B (`commentary_in_substantive_block`) gains a narrow academic exception: a bibliography-only academic/journal/book source (direct or strong partial, subject-fit passing, real bibliographic identity) may be kept as a **reference-only** ref in `literature_synthesis`, `academic_framing`, `methodological_framing`, and `critique_or_counterposition` blocks whose wording is a literature pointer.

Reference-only refs are marked in the ref record so they can never satisfy a substantive doctrinal, holding, statutory, rule, factual, or binding-law claim, and the drafter/footnote wording presents them as reading references (e.g. "ראו" pointer phrasing), not as proof. Listing/index pages, court result pages, metadata-only pages and found-only web pages remain non-supporting. Acquired full bodies are preferred over bib-only when both fit.

Telemetry `academic_bib_reference_use`: `allowed_count, rejected_count, source_title, block_category, reference_only, reason`.

### 3. Hebrew rebinding hardening — `stages/claimSourceRebinding.ts`
`evaluateBinding` gains academic-aware inputs: source title/topic tokens (not just body/supported_points), safer Hebrew morphology normalization (clitic prefixes, construct forms, plural/definite variants), and an academic path where `verifier_verdict = direct` plus strong subject fit is sufficient to bind topically even when raw term overlap is thin.

Off-topic sources still do not bind; secondary sources still never bind to primary-law claims; binding stays claim-category aware and the exact > facet > topical > area_direct hierarchy is unchanged.

Telemetry `academic_hebrew_rebinding`: `attempted, source_id, title, old_binding_result, new_binding_result, reason, title_topic_match, verifier_verdict, topical_fit`.

### 4. Drafter block coverage — `stages/drafterV2.ts` (+ academic style/source-use block)
The academic source-use instructions state: for each substantive academic block, if the pack contains an eligible source for that block's role, emit at least one `source_ref`. Explicitly no minimum footnote count, no decorative citations, no citing sources that do not fit the block, and no extra citations forced into a single-paragraph `argument_paragraph` when one source carries the core claim.

A post-draft measurement (no rewriting) records coverage.

Telemetry `academic_source_coverage`: `substantive_blocks, blocks_with_available_source, blocks_with_source_ref, blocks_missing_ref_despite_available_source, reason`.

## Out of scope
Retrieval, discovery counts, judgment identity validation, docket limitation, source integrity, footnote rendering invariants, found-only support for substantive claims, any fixed citation count.

## Validation
- Unit tests extended in `src/test/academicAuthorityAlignment.test.ts` and `src/test/claimSourceRebinding.test.ts`: Rule D override conditions and its strict cases, bib-only allowed in literature blocks and rejected in doctrinal blocks, Hebrew title-token rebinding of "כגודל הציפייה" / "רבע מאה למהפכה החוקתית", off-topic non-rescue, drafter coverage counter.
- Live run AW1, AW4, AW7, AW8 via `scripts/legal-research-v1-academic-writing-validation.ts`, checked against: AW4/AW7 direct subject-fit sources no longer dropped for area mismatch; AW8 direct on-topic sources no longer `claim_mismatch`; AW1 bib-only Barak/Bel Yosef cited only as literature pointers; AW7 not zero-footnote when direct acquired subject-fit sources exist and not over-cited; no secondary under a holding/statutory/docket/quote claim; rendering invariants clean.
- Report + full answers to `reports/academic-utilization-stabilization/` and delivered in chat.
