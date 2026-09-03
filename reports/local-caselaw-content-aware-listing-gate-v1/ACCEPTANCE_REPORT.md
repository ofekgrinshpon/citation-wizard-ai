# local_caselaw_content_aware_listing_gate_v1 — acceptance report

Listing suppression is now **content-aware for `origin = local_db` caselaw only**.
Web/perplexity/external listing suppression is byte-for-byte unchanged.

## What was built

| Piece | Location |
|---|---|
| Deterministic content classifier + batched signal enrichment | `stages/localCaselawListingGate.ts` |
| Content-gate protection at the original suppression decision | `stages/discoveryPrecision.ts` (`protectionFor`) |
| Usability restore for verified local judgments | `stages/candidatePool.ts` |
| DB signal lookup (case_number, body length, 3k head), service_role only | `local_caselaw_body_signals(uuid[])` |
| Telemetry | `retrieval.local_caselaw_content_listing_gate` + durable mark |
| Tests | `src/test/localCaselawListingGate.test.ts` (8) — suite 23 files / 230 tests pass |

Gate rule: bypass URL-based listing suppression only when origin `local_db`,
caselaw-type, collector/listing-shaped stored URL, body ≥ 2,000 chars,
docket/case_number **or** formal opener present, ≥ 2 judgment markers, and NOT
(listing vocabulary ≥ 5 with < 4 judgment markers). Partial summaries
(≥ 900 chars + identity) are admitted with `limited_claim_scope: true` and are
**not** upgraded to judgment usability, so the metadata-only holding gate still
prevents them supporting holdings.

## Before / after suppression

| Fixture | listing-suppressed before | after | local caselaw checked | bypassed | still suppressed | pool before → after | prior pool size |
|---|---|---|---|---|---|---|---|
| AW4 | 46 | **2** (`listing_title_pattern`, web) | 53 | 53 | 0 | 210 → 12 | 30 |
| AW9 | 43 | **2** (`listing_url_path`, web) | 93 | 93 | 0 | 203 → 21 | 30 |
| AW7 | 14 | **2** (`listing_url_path`, web) | 43 | 43 | 0 | 125 → 8 | 23 |

Final pool size did not increase in any fixture.

## Classification counts (runs)

| Fixture | substantive_judgment_body | partial_judgment_summary | metadata_only | listing_or_index_body |
|---|---|---|---|---|
| AW4 | 53 | 0 | 0 | 0 |
| AW9 | 93 | 0 | 0 | 0 |
| AW7 | 43 | 0 | 0 | 0 |

Corpus-wide simulation of the exact rule over all 4,481 collector-URL caselaw rows:

| classification | rows | avg chars |
|---|---|---|
| substantive_judgment_body | 4,354 | 24,817 |
| partial_judgment_summary | 59 | 1,625 |
| metadata_only | 68 | 3,462 |
| listing_or_index_body | 0 | — |

## Sample admitted candidate (AW4)

```
doc 0a717970… url …/dynamiccollectors/spokmanship_court?skip=4680
case_number_present: true   available_text_chars: 12,543
positive: case_number_column, formal_judgment_opener, decision_header,
          party_role_terms, party_block_vs
negative: []   classification: substantive_judgment_body
decision: bypass_suppression (substantive_body_with_judgment_identity)
elapsed_ms: 1
```

## Sample still-suppressed

No local caselaw candidate failed the gate in these runs (consistent with the
audit: 0/534 listings). Still-suppressed behaviour is covered by unit tests and
the corpus simulation:

- 68 corpus rows classify `metadata_only` (press headline only, < 400 chars or
  no judgment markers) → stay suppressible.
- Synthetic listing body (`תוצאות חיפוש / לצפייה ×n`, no docket) →
  `listing_or_index_body`, `keep_suppressible`.
- Web/perplexity candidates never receive gate metadata; the two suppressions
  per fixture above are web listing pages, unchanged.

## Final pool composition

| Fixture | size | origins | roles |
|---|---|---|---|
| AW4 | 12 | local_db 12 | scholarship 4, primary_statute 6, government_report 2 |
| AW9 | 21 | local_db 21 | primary_statute 8, binding_case_law 12, persuasive 1 |
| AW7 | 8 | local_db 8 | scholarship 5, binding_case_law 3 |

AW9 is the clearest unlock: 12 binding-case-law slots now come from local
judgment bodies that were previously suppressed by their collector URL.

## Footnotes / source roles

| Fixture | footnotes before | after | roles now cited |
|---|---|---|---|
| AW4 | 5 | 6 | 1 judgment (בג"ץ 5658/23), 1 Basic Law, 4 scholarship |
| AW9 | 4 | 6 | 1 Supreme Court judgment (בג"ץ 4634/04, official court URL), 1 Basic Law, 4 scholarship |
| AW7 | 1 | 1 | 1 scholarship — restrained, unchanged |

## Latency

| Fixture | candidates | p50 | p95 | stage total |
|---|---|---|---|---|
| AW4 | 53 | 0 ms | 1 ms | 125 ms |
| AW9 | 93 | 0 ms | 0 ms | 150 ms |
| AW7 | 43 | 0 ms | 1 ms | 62 ms |

One batched RPC (≤ 80 doc ids), no LLM, no network fetch, no PDF/OCR, no extra
retrieval. Added cost ≤ 0.15 s on ~200 s runs.

## False-positive / false-negative assessment

- **False positive** (listing admitted): 0 observed in 189 gated candidates and
  0/4,481 in the corpus simulation. Double-covered downstream by judgment
  identity validation and the metadata-only holding gate.
- **False negative** (real judgment kept suppressed): bounded by the 68
  metadata_only + 59 partial rows (2.8% of the corpus). The 59 partials are
  still admitted, only with limited claim scope; the 68 metadata_only rows
  genuinely have no body.

## Safety

Unchanged and still active: judgment identity validation, source integrity,
metadata-only holding gate, found-only support, CSM, source-role rules,
footnote invariants, secondary-cannot-support-primary. Partial summaries are
never treated as full judgment bodies. Hebrew prose behaviour untouched
(AW7 output identical in shape and restraint).
