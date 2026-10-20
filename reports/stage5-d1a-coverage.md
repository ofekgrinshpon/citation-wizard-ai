# Stage 5 D1a coverage ledger — bounded offline batch

Baseline: `601c82478d142de6ee372caa6c177f06fe0170d0` (matched before editing).

## Primary evidence and limits
- User-verified Bluebook **21 general Rule 10.8.1(a,b)**, not Bluepages: https://drive.google.com/file/d/19dQaCAVawq9KR9dic6a71Cpy-3QCoAZ2/view . Implementation uses the rule details supplied in this turn; no PDF retrieval, search or independent full-book verification occurred.
- General R2.1 full case-name roman/procedural-phrase styling stays unchanged. Israeli 35.1/37.9/38 precedence remains; no US-document mode or Id./supra.
- Existing `foreign_bluebook_v22` compatibility identifier is not renamed and is not evidence that this batch was audited under edition 22.
- Workbook remains exactly 14 families / 78 subtypes / 12 axes / 16 institution profiles. No T1.5-as-edition-21, “51 states”, jurisdiction inheritance, or coverage percentages.

## Supported supplied-input modes
| Mode | Bounded support |
| --- | --- |
| Database-only | Existing WL / U.S. Dist. LEXIS / U.S. App. LEXIS; full alphanumeric/colon docket; full date/court; independent star and paragraph lists/ranges; note suffixes |
| Separately paginated slip | `slip op. at [pin]`; optional pinpoint, no invented page |
| Non-separately paginated slip | `slip op. [first], [pin]`; opening page separate from cited page, including equal values |
| Pending/date meaning | Full docket/court/date with supplied filed/decided/issued/argued/submitted label; filing date does not produce a decision year |
| Preservation | Unknown outside tails, per-curiam/history stay escaped and visible with warnings; missing docket/date/court warnings are independent of reporter fields |
| Classification | Existing decision.judgment; document/paragraph axes; commercial_database access; publication remains unknown unless overridden; filed gives a medium-confidence pending indication, not legal status verification |
| Callers | Shared local adapter in runCitation (single/batch/bibliography pipeline) and Index initial/edit/regeneration; formatting warns that identity/accuracy is unverified; prior exact-plan freshness guards unchanged |

US inference is bounded to the existing court aliases, numeric circuit form and the supplied D. Mass. fixture anchor. No wholesale dictionary or new country support. Effective non-US choices are not crossed by the D1a local path.

## Excluded / unverified
- BL and other database patterns (no verified identifier grammar supplied); wholesale court/state tables, table licensing/copying, and other jurisdictions.
- Full normative coverage of Rule 10, date event legal significance beyond preserving supplied labels, procedural-history formatting, unknown tail parsing, calendar-validity and source-identity verification.
- Ambiguous courtless raw forms remain on the existing nonlocal/unsupported path; they are not promoted to deterministic US. Missing supplied court is tested directly on the structured renderer.
- Hosted/live search, deployed functions, real cases and authenticated browser verification were not exercised; all new case names/locators are synthetic.
- Metadata-only existing zero-work telemetry and history behavior remain; no paid provider, billing/settlement, security, retention, schema or deployment changes.

## Remaining Stage 5 backlog (not started)
- Other mapped decision/proceeding variants and international/supranational issuer-specific formats.
- Remaining normative/legislative/administrative materials and institutional records.
- Treaties, constitutions and expanded secondary/publication/media variants.
- Every later batch requires its own verified primary evidence, explicit scope, fixtures/caller tests and licensing/full-text gate. This list is backlog, not an approved implementation sequence or complete coverage claim.