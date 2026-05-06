---
name: Case Disambiguation Relevance
description: Party-search filtering, prefix normalization, and publication-data verification rules for citation-chat
type: logic
---

When the user query contains a BIU procedure prefix (e.g. סע"ש, ת"א, בג"ץ), it is stripped from `party1` before tokenization and used as `userCaseTypeNorm` for both search focusing and result filtering.

Filter rules (`citation-chat/index.ts`, party-search branch):
- Reversed-party hallucinations (`p1`/`p2` swapped vs. user) are dropped UNLESS the result's `caseType` exactly matches `userCaseTypeNorm` and a docket number exists — then keep.
- Empty-party results are dropped UNLESS `caseType === userCaseTypeNorm` and a docket exists; in that case keep and backfill `party1`/`party2` from the user-typed values.
- Cross-jurisdiction known prefixes (e.g. user typed סע"ש, result is ת"פ) are dropped.
- Free-text labels like "תביעה"/"תביעה פלילית" do NOT count as known prefixes — they go through the party-token + order check instead.
- Single-result hint always emits parties (using user fallback), and emits `[חסר: תאריך]` when `r.date` is empty. Never invent dates.
- Multi-result blob carries `caseType: r.caseType || userCaseTypeNorm` and backfilled parties so the selection branch can format without a re-search.

Perplexity prompt for party search demands populated `party1`/`party2`, respects user-typed party order, forbids fabricated dates, and requires `source_url` per result.

Publication-data hallucination guard (post-filter, runs on every kept result):
- Trusted publisher domains for `padi_*` fields: `nevo.co.il`, `supreme.court.gov.il`, `court.gov.il`, `psakdin.co.il`. `takdin.co.il` and `lite.takdin.co.il` are search-only — used for parties/caseType/docket/databaseName, NEVER trusted for `padi_volume`/`padi_part`/`padi_page`/`year`.
- A result is `suspect` (and its `padi_*` must be re-verified) when any of:
  - `Math.abs(year - docketYear) > 3` (e.g. `/77` docket reporting year `2003`),
  - `isPublished=true` with empty `date`,
  - only one of `padi_volume` / `padi_page` is present,
  - `source_url` is not on the trusted list.
- `docketYear` is parsed from the trailing `/NN` or `/YYYY` of `caseNumber`; 2-digit years ≥40 are 19xx, otherwise 20xx.
- Suspect results call `verifyPadiPublication(caseType, caseNumber)`, a focused Perplexity call restricted to the trusted publisher domains. If verification confirms a פ"ד publication → `padi_*`/`year` are overridden. If it fails → `padi_volume`/`padi_part`/`padi_page` are cleared, `isPublished` is set to `false`, and a hallucinated `year` is dropped. Hallucinated `פ"ד` data is never displayed.
