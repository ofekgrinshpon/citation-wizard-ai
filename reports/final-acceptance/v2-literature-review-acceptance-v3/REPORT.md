# V2 Literature Review — Acceptance #3 (with Same-Work Trust Boundary Fix)

## 1. Executive summary

The trust-boundary fix is implemented, tested and live: agent-supplied
identity may shape a recovery query, but it can never prove that an alternate
document is the same work. Across all ten acceptance runs
`same_work_agent_hint_used_for_equivalence = 0`.

Acceptance #3 ran the exact ten harness prompts (L1–L8, N1, N2) sequentially,
one fresh run each, with no code changes during acceptance. All ten completed.
Compared with Acceptance #2 the system is materially better: every memoed
source that reached verification passed span and support verification
(`span_yield = 1`, `support_yield = 1` in every run where memoed evidence
existed), N1 now returns a correct verified answer instead of nothing, N2 stays
compact, Drafter utilization is 100% in all ten runs, and the first live
same-work recovery in the programme occurred (L5, basis `title_and_year`).

It is not a SHIP. Two representative blockers remain: foreign academic
acquisition is still thin (L7 lost 5 of 7 sources at fetch), and one footnote
rendered a wrong publication year (L8, "(2026)" for a much older English
article). Wrong metadata, even without a false author, is a bibliographic
defect. The dominant evidence loss also shifted: it is no longer acquisition or
span failure but `WINDOW_SERVED_NOT_MEMOED` — readable, quotable academic text
the agent read but did not carry into the memo.

## 2. Trust-boundary fix

Split search identity from proof identity:

- `TrustedWorkIdentity` — only deterministic sources: discovery/search
  metadata, repository/journal metadata, DOI parsed from a discovered URL,
  already-parsed bibliographic metadata, acquired body/header identity.
- `RecoverySearchHint` — agent-supplied `{title, authors, year, doi}`; used by
  `queryIdentity(trusted, hint)` to formulate the bounded recovery query and to
  narrow a metadata lookup, never passed into `isSameWork()`.
- `enrichAndCompare` takes `search_hint` separately from the trusted `wanted`
  identity; an agent DOI can never produce `doi_exact`.
- New telemetry: `same_work_original_identity_trusted_fields`,
  `same_work_search_hint_fields`, `same_work_agent_hint_used_for_query`,
  `same_work_agent_hint_used_for_equivalence` (structurally always 0).

Tests T1–T7 in `src/test/sameWorkTrustBoundary.test.ts`. Full suite: **1047
passed / 88 files**. Typecheck clean. `legal-research-v2` deployed.

## 3. Targeted live trust-boundary validation (Phase 2)

Run `samework-F2-1790015208009` (tattoo copyright):

| Field | Value |
|---|---|
| recovery triggered | 3 |
| candidates seen | 18 |
| trusted original fields | `["title","year"]` |
| search-hint fields | `[]` |
| agent hint used for query | NO (none offered) |
| **agent hint used for equivalence** | **NO (0)** |
| enrichment triggered | 1 |
| result | `identity_still_insufficient_after_enrichment`, 2× `no_equivalent_public_copy` |

The boundary is real in live traffic: equivalence was attempted only against
`title` + `year` learned deterministically from discovery.

## 4. Runs

| Run | run_id | latency | resumes |
|---|---|---|---|
| L1 | eafb395e-dfbc-4910-ba0d-087b9eba9d95 | 303 s | 0 |
| L2 | ac4b43d6-d531-4303-9000-f4b236791071 | 302 s | 0 |
| L3 | 91723310-908b-4cae-9293-c543852c0ce7 | 263 s | 0 |
| L4 | 07e76882-c705-4409-a29b-2e6e0bf22aec | 495 s | 1 (stall at 192 s) |
| L5 | 8cee562e-d2d4-4220-a37d-22eed5f4f8f8 | 262 s | 0 |
| L6 | 25a6cd67-b97d-4e2b-8f73-0261f472ca4b | 363 s | 0 |
| L7 | 48a7e489-87c4-47b4-a194-2ef8076fa37e | 202 s | 0 |
| L8 | 1cd5dae4-108b-4542-b411-984527ebe628 | 242 s | 0 |
| N1 | b71b939d-9207-4a20-91cd-d27829f2a0ad | 162 s | 0 |
| N2 | 9b13334e-3c28-4e20-a9e5-aa278d42d8e9 | 60 s | 0 |

## 5. Evidence funnel

| Run | acad discovered | acquired | usable | quotes served | memoed | span ok | support ok | final pack | drafter avail → cited |
|---|---|---|---|---|---|---|---|---|---|
| L1 | 4 | 4 | 4 | 4 | 1 | 1 | 1 | 1 | 2 → 2 |
| L2 | 6 | 6 | 6 | 4 | 4 | 4 | 4 | 4 | 4 → 4 |
| L3 | 2 | 2 | 2 | 2 | 1 | 1 | 1 | 1 | 2 → 2 |
| L4 | 6 | 5 | 4 | 4 | 3 | 3 | 3 | 3 | 3 → 3 |
| L5 | 6 | 5 | 5 | 5 | 2 | 2 | 2 | 2 | 2 → 2 |
| L6 | 4 | 3 | 3 | 2 | 1 | 1 | 1 | 1 | 1 → 1 |
| L7 | 6 | 2 | 2 | 2 | 1 | 1 | 1 | 1 | 1 → 1 |
| L8 | 5 | 5 | 5 | 5 | 3 | 3 | 3 | 3 | 3 → 3 |
| N1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 1 → 1 |
| N2 | 0 | – | – | – | – | – | – | – | 1 → 1 |

Span and support yield were 1.00 in every run with memoed evidence. Two
`span_not_found` events occurred (L6 S5, L8 S5) and were correctly excluded, not
patched over.

**Terminal loss classes (all L-runs):** `WINDOW_SERVED_NOT_MEMOED`
(memo_selection) 15, `NOT_ACQUIRED` (acquisition) 12,
`READ_NO_QUOTE_REQUESTED` 7, `MEMOED_SPAN_NOT_FOUND` 1,
`UNUSABLE_EXTRACTION` 1. No run reported a vague, unclassified loss.

## 6. L5 / L7 / L8 acquisition audit

**L5 (corporate governance, English scholarship)**

| Source | #2 status | #3 status | failure class | recovery | enrichment | recovered | final pack |
|---|---|---|---|---|---|---|---|
| Stanford — Controlling Shareholders | NBER-only | acquired, 75k chars | – | – | – | – | yes |
| core.ac.uk — Constraints on Private Benefits | fail | fail | http_failed | yes | no | no | no |
| gov.il — חוק החברות | fail | fail | http_failed | yes | no | **yes → isa.gov.il** | no (unsupported_response) |
| HUJI — חובת ההגינות | – | acquired 63k | – | – | – | – | no (not memoed) |
| Yale LJ — Idiosyncratic Vision | fail | **acquired 199k** | – | – | – | – | no (not memoed) |
| Harvard corpgov | – | acquired | – | – | – | – | no (not memoed) |
| Nevo — חוק החברות | – | acquired 199k | – | – | – | – | yes |

Yale Law Journal, previously unreachable, was acquired in full. The first
successful live same-work recovery occurred here (`title_and_year`, recovered
host `www.new.isa.gov.il`); the recovered copy then failed the ordinary body
check (`unsupported_response`) and correctly did not become evidence.

**L7 (tattoo copyright)** — the weakest run: Marquette (×2), W&L Scholarly
Commons, Minnesota Law Review and Justia all returned `http_failed`; 4 recovery
attempts, 18 candidates, 15 rejected on identity, 1 enrichment,
0 recovered. Boston College Law Review was acquired through its repository
landing page and then its PDF (`repository_page` metadata basis) and carried the
answer.

**L8 (Israel/England comparative)** — strongest foreign result: Cambridge Core
(Elias, *Stuck at a Crossroad?*), White Rose eprints (Tomlinson) and two HUJI
PDFs all acquired; 3 of 5 reached the final pack; acquisition yield 1.00.

## 7. Same-work recovery and enrichment audit

| Run | triggered | seen | rej. identity | rej. host | success | failed | enrichment | still insufficient | conflict | basis |
|---|---|---|---|---|---|---|---|---|---|---|
| L4 | 1 | 6 | 5 | 0 | 0 | 1 | 0 | 0 | 0 | – |
| L5 | 2 | 10 | 8 | 0 | **1** | 1 | 0 | 0 | 0 | `title_and_year` |
| L6 | 1 | 6 | 6 | 0 | 0 | 1 | 2 | 2 | 0 | – |
| L7 | 4 | 18 | 15 | 0 | 0 | 4 | 1 | 1 | 0 | – |
| others | 0 | – | – | – | – | – | – | – | – | – |

Totals: 8 triggers, 40 candidates, 34 identity rejections, **0 host
rejections needed, 0 title-only acceptances, 0 DOI conflicts, 1 recovery**, and
**agent-supplied identity used for equivalence = 0**.

## 8. Bibliographic footnote audit

Every footnote in L1–L8 was read. Defect classes:

| Defect class | Recurrence |
|---|---|
| False author attribution | **none** — only one run rendered a personal author (L7, "Sean Doolittle", from repository metadata) |
| Garbage title (`pubdat`, mojibake) | **none** (was present in Acceptance #2, L5) |
| File-path title (`C:\Working Papers\…`) | **none** |
| API endpoint cited as scholarship | **none** (Crossref/OpenAlex never appear) |
| Raw URL inside structured citation text | **none** — structured citations (L2 #1/#3, L5 #1, L7 #1) carry no URL |
| Raw URL visible in title-only citations | **present** — L2 #2, L3 #1, L4 #1/#2, L8 #1, N1, N2 |
| Wrong metadata | **one** — L8 #2 renders Tomlinson's *The narrow approach to substantive legitimate expectations* as "(2026)" |
| Discovery-artefact titles | minor — L1 #1 and L2 #1 keep search-result decoration ("[PDF] …", "… \| בעקבות …", trailing ellipsis) |

Missing metadata is common (`bibliographic_sources_with_authors` is 0 in most
Hebrew runs), which is acceptable. The wrong year in L8 is not.

## 9. Narrow controls

**N1** (`מה קובע סעיף 12 לחוק החוזים (חלק כללי)?`) — 144 s, 18 steps, 2
documents, 2 verified claims, 1 footnote, 336-character answer. It states
12(a) (good-faith negotiation) and 12(b) (damages) correctly and cites
ע"א 6370/00 קל בנין. It did **not** depend on any single site being alive, and
it did not trigger literature-scale research. Regression from Acceptance #2
(zero verified claims) is fixed. Residual: the answer rests on a judgment that
quotes the section rather than on an acquired official statute text.

**N2** (`מה נקבע ברע"א 3365/20?`) — 60 s, 5 steps, one source, 4 verified
claims, 811 characters, correct holding and costs. Faster than the #2 baseline
and correctly narrow.

## 10. Synthesis, Drafter and reliability

Synthesis projection was lossless in 9 of 10 runs
(`synthesis_claim_refs_dropped = 0`); only L6 dropped refs (4 claim / 1 source),
consequent to two unsupported claims. Drafter utilization was
`verified_sources_available = verified_sources_cited` in all ten runs — **100%**.
A Drafter model change is not justified.

Reliability: 10 launched, 10 completed; one stall with one automatic resume
(L4); no chunk freezes, no abandoned runs, no credit or search-quota errors.
This is a clear improvement over Acceptance #2.

## 11. Evidence safety

No verification gate was weakened. Enrichment metadata was never extracted,
stored, quoted or cited; Crossref/OpenAlex never appear as sources; search
results remain non-evidence; the one recovered candidate still had to pass the
ordinary document check and was rejected by it. Span and support verification
are unchanged, and the two `span_not_found` events dropped their claims.

## 12. Remaining blockers

1. **Foreign repository acquisition** — `cgi/viewcontent.cgi` law-school
   repositories (Marquette, W&L), Minnesota Law Review and core.ac.uk still
   fail; L7 lost 5 of 7 sources.
2. **Wrong publication year** in one rendered citation (L8 #2).
3. **Memo selection is now the dominant loss** — 15 academic sources were
   read, quoted and usable but never memoed, so broad answers stay thinner than
   the evidence gathered (L1, L2 and L6 report `central_issue_covered = false`).
4. Raw URLs remain visible in title-only citations.

## 13. Product-readiness conclusion

The system behaves as an honest research instrument: it finds genuine Hebrew
and English scholarship, converts what it memoes into verified evidence without
loss, states its limitations explicitly, keeps narrow questions narrow, and
never manufactures identity or attribution. It is not yet a dependable
literature-review product for foreign scholarship, and one wrong-year citation
plus the memo-selection loss keep it short of SHIP.

V2 LITERATURE REVIEW — PARTIAL / REVIEW

AGENT-OWNED RESEARCH DEPTH: ACTIVE
VERIFIED RESEARCH SYNTHESIS HANDOFF: ACTIVE
ACADEMIC EVIDENCE YIELD: ACTIVE
BIBLIOGRAPHIC FAIL-SAFE: ACTIVE
SAME-WORK RECOVERY: ACTIVE
SAME-WORK IDENTITY ENRICHMENT: ACTIVE
AGENT-SUPPLIED IDENTITY USED FOR EQUIVALENCE: NO
EXACT AUTHORITY FALLBACK: ACTIVE
DRAFTER MODEL CHANGE: NOT JUSTIFIED
PRIMARY REMAINING BOTTLENECK: readable academic sources are read and quotable but not carried into the research memo, and foreign law-school repositories still refuse acquisition.
