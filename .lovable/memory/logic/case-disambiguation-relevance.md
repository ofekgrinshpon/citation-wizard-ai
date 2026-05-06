---
name: Case Disambiguation Relevance
description: Party-search filtering rules for case-law disambiguation in citation-chat
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

Perplexity prompt for party search now demands populated `party1`/`party2`, respects user-typed party order, and forbids fabricated dates. When `userCaseTypeNorm` is set, the user message is reframed as: "find the {prefix} case where {p1} is plaintiff and {p2} is defendant".
