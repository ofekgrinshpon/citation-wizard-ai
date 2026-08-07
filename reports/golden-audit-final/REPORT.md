# Golden Audit G01–G20 — Final Report
Post specific-case / hierarchy / CPU-bounding stabilization. No code changes during this batch.

## Full table
| ID | Topic type | Status | Branch | Drafted | Used | Admitted | ms |
|---|---|---|---|---|---|---|---|
| G01 | Ka'adan (specific case) | Good | – | yes | – | – | ~200k |
| G02 | Bank Mizrahi (specific case) | Good | – | yes (official archive) | – | – | ~250k |
| G03 | Fake docket | Refusal (correct) | docket_limitation | no | – | – | ~180k |
| G04 | Fake docket | Refusal (correct) | docket_limitation | no | – | – | ~180k |
| G05 | Doctrine | Good | – | yes | – | – | ~230k |
| G06 | Doctrine | Good | – | yes | – | – | ~240k |
| G07 | Doctrine (was stale) | Good (after Track 1) | – | yes | – | – | ~250k |
| G08 | Proportionality | Limited | insufficient_sources_limitation | no | 0 | 26 | ~210k |
| G09 | Doctrine | Good | – | yes | – | – | ~240k |
| G10 | Mutual wills | Good | – | yes | 6 | 22 | 228,066 |
| G11 | §6 Companies Law | Limited (safe) | statute_section_limitation | no | 1 | 21 | 274,547 |
| G12 | (not run – reserved) | – | – | – | – | – | – |
| G13 | Relative voidness | Good | – | yes | 9 | 20 | 211,716 |
| G14 | Good faith | Acceptable (source-soup) | – | yes | 14 | 18 | 254,390 |
| G15 | Specific sharing | Good | – | yes | 7 | 22 | 264,961 |
| G16 | Doctrine | Good | – | yes | 5 | 21 | 264,968 |
| G17 | Doctrine | Acceptable (12 sources) | – | yes | 12 | 26 | 263,581 |
| G18 | Doctrine | Limited | insufficient_sources_limitation | no | 0 | 30 | 200,630 |
| G19 | Doctrine | Good | – | yes | 10 | 23 | 284,743 |
| G20 | Doctrine | Good | – | yes | 8 | 20 | 369,045 |

## Grade distribution (19 executed)
- Good: 12 (G01, G02, G05, G06, G07, G09, G10, G13, G15, G16, G19, G20)
- Acceptable: 2 (G14, G17)
- Limited / controlled refusal: 5 (G03, G04, G08, G11, G18)

## Headline counts
- Technical failures (stale row / CPU kill / stub / verifier crash): **0**
- Unsafe answers (fabricated holding, wrong/adjacent source presented as requested): **0**
- Refusals / limitations: **5** (2 correct fake-docket refusals, 1 statute-section, 2 insufficient-sources)
- Average runtime (G10–G20 measured set): **~262s**; full-audit estimate ~245s

## G15 focus
- Completed: **yes** — drafted, 7 used / 22 admitted, 264,961 ms, terminal status persisted.
- Binary extraction skip (`binary_too_large_for_inline_extraction`): **did not fire** in this run.
- Large binary fetched: **no** — candidate pool contained no PDF above the 900 KB inline gate.
- CPU / stale failure: **did not return** — no isolate kill, no `stale_worker_timeout`, no row left running with NULL error.
- Caveat carried forward: the skip path remains unobserved in production telemetry; it is verified by code path only.

## Source-pack bottlenecks
1. **Sufficiency false negatives** — G08/G18 refused with 26–30 admitted sources. Topical matching still relies on weak Hebrew stemming; scholarship roles are mislabeled, so no source is counted as carrying the doctrine.
2. **Source-soup on open doctrine** — G14 (14 used) and G17 (12 used) still cite nearly the whole usable pool; `lead_ref` prioritization is not pruning the tail.
3. **Statute-section acquisition gap** — G11 admits 21 sources but cannot bind a specific statutory section body, so it refuses. No statute-text acquisition stage exists analogous to judgment acquisition.
4. **Runtime tail** — G20 at 369s is close to the practical envelope; acquisition-heavy doctrine queries dominate wall time.

## Top 3 remaining product tracks
1. **Track 2 — sufficiency / topical matching** (highest value): body-text topical matching instead of stem overlap, and correct scholarship role labeling. Directly converts G08/G18 from refusal to answer.
2. **Citation discipline / pruning**: enforce a used-source ceiling with primary-first selection so G14/G17-class answers cite 5–8 authoritative sources instead of the full pool.
3. **Statute-text acquisition stage**: docket-acquisition equivalent for legislation sections, to remove `statute_section_limitation` on answerable questions like G11.

## Liveness verdict
Nineteen sequential runs, zero stale rows, zero CPU kills, zero stub answers. The specific-case / CPU-bounding stabilization holds under the full audit.
