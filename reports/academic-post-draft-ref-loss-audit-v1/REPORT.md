# academic_post_draft_ref_loss_audit_v1 — read-only audit (AW4)

Run audited: latest AW4 after `academic_drafter_source_ref_coverage_v2`
(`qa_logs.id = 43b3fbae-a64e-47aa-bb2a-1993b26b0861`, 2026-09-01 20:38 UTC).
Genre `theoretical_background`. No code changed.

## Pack (3 sources reached the drafter)

| ref | title | source_type | classification | body chars | verifier | topical fit | doctrinal eligible |
|-----|-------|-------------|----------------|-----------|----------|-------------|--------------------|
| s1 | בג"ץ 9134/12 | caselaw | judgment | **72** (metadata only) | partial, role_match | — | no (`not_doctrinal_type`, correct) |
| s2 | ביקורת שיפוטית על רשויות אכיפת החוק: בין מינהלי לפלילי (HUJI Law Review) | journal_article | scholarship | 16,000 | partial, role_match | passed | **yes** |
| s3 | אחרי עשרים שנה: הרהורים על מוסכמות מקובלות בשיח המידתיות (Cohn, Haifa) | **academic** | unknown | 16,000 | **direct**, role_match | passed | **no — `not_doctrinal_type`** |

## Emitted refs → drop stage → reason → correctness

Model emitted 9 `source_ref`s over 5 substantive blocks.

| # | ref | block | declared → final claim_category | proposition | drop stage | reason | correct? |
|---|-----|-------|-------------------------------|-------------|-----------|--------|----------|
| 1 | s3 | 0 | critique_or_counterposition | critique | CSM | `commentary_in_substantive_block` | **false** |
| 2 | s3 | 1 | critique_or_counterposition | critique | CSM | `commentary_in_substantive_block` | **false** |
| 3 | s3 | 2 | theoretical_explanation | theoretical | CSM | `commentary_in_substantive_block` | **false** |
| 4 | s3 | 3 | critique_or_counterposition | critique | CSM | `commentary_in_substantive_block` | **false** |
| 5 | s3 | 4 | critique_or_counterposition | critique | CSM | `commentary_in_substantive_block` | **false** |
| 6 | s1 | (2 blocks) | — | — | metadata-only holding gate | judgment body never acquired (72 chars) | correct |
| 7 | s1 | " | — | — | same | same | correct |
| 8 | s2 | 1 | critique_or_counterposition | critique | **kept** (doctrinal_secondary; Rule D area mismatch overridden with warning) | — | correct |
| 9 | s2 | 3 | critique_or_counterposition | critique | **kept** | — | correct |

Structured validation dropped 0 (`unknown_refs: 0`). Authority-category
drops: 0. Rule D drops: 0 (1 override kept-with-warning). Rendering dedupe:
s2 cited in 2 blocks → 1 footnote (2 inline markers, 1 footnote row) — correct
by design, `footnote_invariant_passed: true`.

**Correct drops: 2 (both s1). False drops: 5 (all s3).**

## Answers to the specific questions

**1. The 2 metadata-only holding gate drops are correct.** s1 has 72 chars of
acquired text — caption only. The drafter did not phrase academic claims as
court holdings: the gate is unconditional on judgment sources without body
text, regardless of block wording. `source_role_map` did not push primary-style
citation — s1 appears in no role bucket (`source_role_map_summary` maps only
s2). Softening the wording would not help and should not: nothing was read from
that judgment. Both blocks kept other support, `blocks_left_unsupported: 0`.

**2. The 5 CSM drops are all one rule and all false.** Not claim_mismatch
(`claim_mismatch_drops_before/after: 0`), not unrelated_legal_area (s3 area =
constitutional = block area), not authority-category (0), not dedupe, not
role-fit. Every drop is `commentary_in_substantive_block`, fired by Rule
"non-primary + background/commentary support subtype + not a *doctrinal
eligible* source". s3 fails `doctrinal_authority` only because its
`source_type` is `academic` (assigned by domain classification for `*.ac.il`)
and `academic` is absent from `EXISTING_DOCTRINAL_TYPES`
(`stages/doctrinalSourceTyping.ts:37`) — the same gap exists in
`DOCTRINAL_TYPES` in `stages/sourceSufficiency.ts:185` and
`stages/doctrinalCandidateStabilization.ts:207`. Meanwhile
`secondaryBodyAcquisition.ts:99` *does* list `academic`, which is why 16,000
chars of body were fetched and then never allowed to support anything.

s3 is the single best source in the pack for this question: a Haifa law-faculty
article on proportionality discourse, verifier verdict **direct**, topical fit
passed, full body acquired. It was dropped from all five blocks.

**3. The rendered footnote count of 1 is not justified.** With the type gap
fixed, s3 supports blocks 0, 2 and 4 (currently
`blocks_missing_ref_despite_available_source: 3`) and reinforces 1 and 3,
yielding roughly 2 distinct footnotes (s2, s3) across 5 cited blocks instead of
1 footnote across 2 blocks. The over-dropping rule is precisely the
`doctrinal_authority` type whitelist, not CSM's logic.

**4. Not AW4-specific.** Any answer whose best secondary sits on a university
domain (`*.ac.il`, `law.haifa.ac.il`, faculty PDFs) is typed `academic` and is
structurally barred from supporting substantive blocks — across all genres, not
just `theoretical_background`. AW4 exposes it because its top-fit source
happened to be a faculty PDF rather than a journal-hosted article; AW8's
sources were journal-typed, which is why AW8 passed.

## Minimal fix

One-line class of change, no new logic:

1. Add `"academic"` (and, for symmetry, `"working_paper"`/`"faculty_pdf"` if
   they occur) to `EXISTING_DOCTRINAL_TYPES` in
   `stages/doctrinalSourceTyping.ts`, so a body-acquired university-domain
   article becomes `doctrinal_secondary` like any journal article. The existing
   `MIN_CITABLE_TEXT_CHARS` (400) guard still excludes stubs, and primary-law
   claims stay blocked by the unchanged authority-alignment rules.
2. Mirror the same addition in `DOCTRINAL_TYPES` in
   `stages/sourceSufficiency.ts` and `stages/doctrinalCandidateStabilization.ts`
   so sufficiency and pool stabilization agree with CSM.
3. Optional telemetry: record `doctrinal_typing.ineligible_reason_counts`
   alongside the CSM drop reasons already logged, so a future type-whitelist gap
   is visible without a manual join.

No source enrichment is warranted: a fully usable, direct-verdict, on-topic
source was already in the pack.

## Sequencing

Fix this first. It is a three-line whitelist correction that recovers the
majority of post-draft citation loss in academic mode; Hebrew naturalness work
would otherwise be evaluated on answers that are still under-cited for a
mechanical reason.
