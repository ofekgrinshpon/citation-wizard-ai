# topic_aware_source_role_and_claim_alignment_v1 — acceptance report

Precision-of-use track. No retrieval, acquisition, admission or Hebrew-prose
changes. The new module can only **remove or reorder** refs on a block, or
promote a source **already used elsewhere in the same draft** onto a compatible
block. Source integrity, judgment identity, metadata-only rules, found-only
rules, CSM and the footnote invariants run before it and are untouched.

## What was built

| Component | File | Effect |
|---|---|---|
| Source-type ↔ role sanity | `stages/topicAwareAlignment.ts` (`applySourceRoleSanity`) | A judgment can never be labelled `scholarship`; scholarship can never be `primary_statute`. Applied to the pack before the prompt is rendered. |
| Judgment legal-area fit | `judgmentLegalAreaFit` | Deterministic Hebrew/English doctrine lexicon (מידתיות, סבירות, הסתמכות, תנאי מאסר, שוויון …) + lexical fallback. Off-doctrine judgments are removed from the block. |
| Claim-type derivation | `deriveClaimType` | statutory_framework / case_holding / doctrinal_rule / theoretical_background / comparative_context / critique / implementation_example. |
| Block source plan + ranking | `applyTopicAwareBlockAlignment` | Per-block acceptable classes, scoring by area fit + role fit + lexical fit + acquired body + verdict, ceiling of 3 refs/block. |
| Compound-footnote guard | same | Weak companions in a multi-source footnote are dropped; `split_required` reported. |
| Limitation-note alignment | `assessLimitationNoteAlignment` | Adds an explicit "no directly on-point judgment" statement (merged into the single academic הערת עבודה) when judgments exist but none matches the doctrine. |
| Telemetry | `drafterV2.ts` → `metadata.topic_aware_alignment`, `metadata.limitation_note_alignment` | role-sanity rows, judgment fit rows, block plans, rankings, compound guard, unused stronger sources, refs removed/reordered/promoted, blocks left uncited. |

Claim-type → acceptable source classes:

| Claim type | Acceptable classes |
|---|---|
| statutory_framework | statute only |
| case_holding | judgment only |
| doctrinal_rule | judgment, statute, academic |
| theoretical_background | academic, institutional, statute, judgment (judgment must pass doctrine fit) |
| comparative_context | academic, judgment |
| critique | academic, judgment (judgment must pass doctrine fit) |
| implementation_example | judgment, institutional, academic |

## Validation runs

Runner: `scripts/legal-research-v1-topic-aware-alignment-validation.ts`
(results: `results.json`, answers: `ANSWERS.md`).

| Fixture | run_id | role fixes | refs removed | reordered | promoted | blocks uncited | footnotes |
|---|---|---|---|---|---|---|---|
| AW4 theoretical_background | b5398253-eebc-499a-b603-a0d0ca8b03a1 | 9 | 1 | 0 | 1 | 0 | 4 |
| AW9 theoretical_background | d9282b0e-affb-4d3f-ab3d-1c114478b637 | 4 | 0 | 1 | 2 | 0 | 6 |
| AW7 argument_paragraph | 8b3f5ada-6631-478f-b057-f5b4207e9ae5 | 14 | 1 | 0 | 0 | 1 | 0 |

### Source-role sanity (examples)

| Fixture | source | source_type | original role | final role | reason |
|---|---|---|---|---|---|
| AW4 | s3 | supreme_court_il | scholarship | binding_case_law | role_incompatible_with_judgment |
| AW4 | s4 | journal_article | binding_case_law | scholarship | role_incompatible_with_academic |
| AW9 | s10 | caselaw | primary_statute | binding_case_law | role_incompatible_with_judgment |
| AW7 | s1,s2,s4,s6,s8 | journal_article | primary_statute | scholarship | role_incompatible_with_academic |

### Judgment legal-area fit

| Fixture | judgment | claim doctrines | judgment doctrines | direct match | outcome |
|---|---|---|---|---|---|
| AW4 | s16 (supreme court PDF, מידתיות) | proportionality | proportionality | yes | kept on 4 blocks |
| AW9 | s11 בג"ץ 11437-05 קו לעובד | reliance_expectation, judicial_review, proportionality | reliance_expectation, proportionality, equality | yes | kept (case_holding + critique blocks) |
| AW7 | s7 בג"ץ 2075/23 | reasonableness, judicial_review, administrative_authority | none extracted | no | removed (`adjacent_legal_area_only`) |

### Block source plan (AW9, representative)

| block | claim type | selected | rejected (reason) |
|---|---|---|---|
| b1 | theoretical_background | s2, s4 | — |
| b3 | implementation_example | s6, s4 | — |
| b5 | case_holding | s11 | s4, s5 — academic class not acceptable for a holding claim |
| b11 | statutory_framework | s1 (Basic Law) | s5 — academic class not acceptable for statutory text |

This is the core precision win: the previous behaviour let scholarship carry a
holding claim and let an off-topic judgment carry a reliance claim.

### Compound-footnote guard

No compound pruning fired in the three accepted runs (the earlier pre-fix AW4
run pruned statutes off critique blocks). Unit tests cover the prune path:
three-source footnote with two off-topic companions collapses to the single
on-point source.

### Before / after claim-to-source support

| Fixture | before (post-local-corpus audit) | after |
|---|---|---|
| AW4 | 6 footnotes, off-topic reasonableness judgment cited decoratively, repeated compounds | 4 footnotes; the judgment cited is doctrinally on-point (proportionality), scholarship carries theory, Basic Law carries the framework |
| AW9 | 6 footnotes, prisoners'-conditions judgment cited for reliance claims, mismatched Basic Law anchor | 6 footnotes; reliance/judicial-review judgment (קו לעובד) matched on doctrine, Basic Law only on the statutory-framework block |
| AW7 | 1 footnote built from tangential articles | 0 footnotes; the only ref was a statute attached to a critique claim and was rejected, with an explicit limitation note instead of a misleading citation |

### Remaining questionable citations

- AW4 footnote 1 carries a mangled display title from a court PDF
  (`חוק כי סבור אני אף השני המידתיות…`) — a display-title hygiene issue, not an
  alignment issue.
- AW7 now emits zero footnotes. Correct but thin: promotion is deliberately
  restricted to sources already used in the same draft, so a single-block genre
  has no promotion pool. Widening it would bypass CSM and was not done.

### Safety confirmations

- Retrieval, acquisition, admission and pool size unchanged.
- Statutory-text, exact-holding and binding-law claims can still only be
  supported by primary sources (statutory_framework → statute only,
  case_holding → judgment only).
- No source is ever added that is not already in the CSM-validated draft.
- No fixed footnote target; blocks may end uncited with an accurate note.
- Tests: 24 files / 240 tests pass (10 new in `src/test/topicAwareAlignment.test.ts`). Build OK.

## Recommendation on Hebrew naturalness

Citation precision is now materially better (role sanity always correct,
off-doctrine judgments removed, holdings never carried by scholarship). The
remaining gaps are display-title hygiene and the thin single-block genres, both
narrow. Prose naturalness is now the largest remaining quality gap — moving to
Hebrew naturalness next is reasonable, with display-title hygiene as a small
parallel fix.
