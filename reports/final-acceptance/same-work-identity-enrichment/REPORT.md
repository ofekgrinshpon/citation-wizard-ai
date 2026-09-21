# Same-Work Identity Enrichment — Acceptance Report

## 1. Previous bottleneck

Live same-work recovery was correctly wired and fail-safe (7 triggers, 31
candidates, 0 unsafe hosts, 0 title-only acceptances) but recovered nothing:
discovery returns **title + URL only**, so `isSameWork()` could not rise above
`title_only_insufficient`. The missing element was corroborating identity
(author / year / DOI), not equivalence logic.

## 2. What was added

`tools/identityEnrichment.ts` — bounded, identity-only enrichment, run **before**
the equivalence rejection, and only for a candidate that is already plausible:
`shouldEnrich()` requires `verdict.basis ∈ {title_only_insufficient,
insufficient_identity}` **and** `titleSimilarity ≥ 0.7`. Clear title mismatches,
contradicted identity and unsafe hosts never reach it.

Ladder per candidate (all bounded and deduped):

| Step | Source | Cap |
|---|---|---|
| A | candidate landing-page metadata (`citation_*`, `dc.*`, `og:*`, printed DOI) | 1 fetch |
| B | DOI metadata (Crossref `works/{doi}`) | 1 lookup |
| C | title-based metadata service (Crossref bibliographic, OpenAlex fallback) | 1 query |
| D | discovery/search metadata (no snippet inference) | 0 extra calls |

`ENRICHMENT_LIMITS`: 1 landing fetch, 1 DOI lookup, 1 title lookup,
**2 candidates per failed work**, 8 s timeout, 300 KB HTML cap.

`tools/identityEnrichmentLive.ts` — the live backends, using `publicHeaders()`
and `isSafeFetchUrl()`, per-run dedupe of repeated DOI/title/page lookups.

## 3. Identity trust hierarchy

`repository_page > doi_metadata > html_meta > metadata_service >
search_metadata`. Strongest basis wins per field; nothing is averaged; every
field carries its own `basis`. Embedded PDF metadata is not used here.

## 4. DOI, author and year rules

- DOI normalization is strictly syntactic: lowercase, strip `https://doi.org/`,
  strip `doi:`, trim, must match `10.\d{4,9}/…` — otherwise discarded.
- Same DOI → accepted immediately (`doi_exact`).
- Conflicting DOI → **hard reject**, overriding any title similarity.
- Authors normalized for formatting only ("Gilson, Ronald J." → "Ronald J.
  Gilson"); matching stays surname-based and requires high title similarity.
- Year never identifies a work alone; it only corroborates a high title overlap.
- `isSameWork()` was **not modified**. Title-only remains insufficient.

## 5. Safety

Garbage filters reject `pubdat`, file paths, mojibake, machine values and
discovery-endpoint labels (`isGarbageTitleValue` / `isGarbageAuthorValue`).
Enrichment output is **identity only**: it is never extracted, stored in the
EvidenceStore, quoted, verified or cited. Crossref/OpenAlex are never candidates
and never appear as scholarship. A confirmed candidate still passes URL safety,
document check, extraction, EvidenceStore, quote windows, span verification and
support verification unchanged.

## 6. Tests

`src/test/sameWorkIdentityEnrichment.test.ts` — E1–E10 plus E4b, DOI
normalization and author normalization: 13 passing.
Full suite: **1040 passed / 87 files**. Typecheck clean. `legal-research-v2`
deployed.

## 7. Live validation (F1 / F2 / F4)

| Run | Recovery triggered | Candidates seen | Rejected identity | Rejected host | Enrichment triggered | Landing meta | Crossref | Still insufficient | Conflicts | Recovered |
|---|---|---|---|---|---|---|---|---|---|---|
| samework-F2-1789992701175 (tattoo copyright) | 4 | 21 | 19 | 0 | 2 | 1 | 1 | 2 | 0 | 0 |
| samework-F4-1789992701814 (Hansmann & Kraakman) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | n/a — no recoverable acquisition failure |
| samework-F1-1789992695816 and rerun -1789994159009 (corporate governance) | — | — | — | — | — | — | — | — | — | stalled mid-run (pre-existing L1/F1 reliability issue, not enrichment) |

Before → after rejection reasons (F2): previously every failure was
`no_equivalent_public_copy`; now the enriched candidates report the specific
`identity_still_insufficient_after_enrichment`, so the loss reason is explicit.

Fields gained in F2: the landing page and the Crossref bibliographic query
returned a record whose title did not clear the 0.7 similarity gate or carried
no author/year for the alternate copy, so no corroborating field was admitted.
No wrong-work match was accepted, no unsafe host was used, no DOI conflict
occurred.

## 8. Remaining blockers

1. No previously blocked public source was recovered yet. In F2 the enriched
   alternates genuinely lacked a public equivalent copy with resolvable
   identity; F4 produced no recoverable failure to exercise; F1 stalled twice
   before reaching the measurement.
2. Run reliability on the broad corporate-governance prompt (F1) remains the
   limiting factor for live evidence, unchanged from earlier acceptance rounds.

Enrichment is exercised in live recovery and behaves exactly as specified, but
the "at least one previously blocked public source recovered" criterion is not
yet demonstrated on live traffic.

SAME-WORK IDENTITY ENRICHMENT — PARTIAL / REVIEW

TITLE-ONLY SAME-WORK ACCEPTANCE: NO
METADATA API AS EVIDENCE: NO
DETERMINISTIC SAME-WORK CHECK: ACTIVE
VERIFICATION STRICTNESS: UNCHANGED
DRAFTER MODEL: UNCHANGED
