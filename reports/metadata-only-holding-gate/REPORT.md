# metadata_only_holding_gate_v1 — final validation report

Runner: `scripts/legal-research-v1-metadata-only-holding-gate.ts` (poll by `job_id`,
terminal status only, placeholder rows rejected). Sequential (CONC=1).
Result: **10/10 pass**. No CPU kills, no stale rows, no stubs, no verifier failures.

## Run table

| ID | job_id / run_id | status | drafted | branch | used src | fns | judg cited | body-acq | metadata-only | remaining | ref-only section | quality impact | CPU/stale/stub/verifier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G15 | 6624fa9b / 05b07215 | done | drafted | — | 3 (was 7 pre-gate) | 4 | 0 | 0 | 0 cited (1 demoted: דנג"ץ 8537/18) | 0 | yes | thinner but acceptable | no |
| G13 | b948277b / 91089171 | done | drafted | — | 6 | 5 | 1 | 1 | 0 | 0 | no | unchanged | no |
| G14 | a15ec183 / b51a8548 | done | drafted | — | 6 | 9 | 1 | 1 | 0 | 0 | no | unchanged | no |
| G17 | 31afe35e / dfe07811 | done | drafted (legislation-only) | — | 2 | 2 | 0 | 0 | 0 | 0 | no | unchanged | no |
| G07 | b1520aad / 62e14751 | done | refused | insufficient_sources_limitation | 0 | 0 | 0 | 0 | 0 | n/a | unchanged (over-refusal preserved by design) | no |
| G08 | 9a21a306 / 8c4d1ef2 | done | drafted | — | 4 | 5 | 2 | 2 | 0 cited (2 demoted: s4, s6) | 0 | yes | improved (was over-refusal) | no |
| G10 | 3485fae8 / 6c89ba42 | done | drafted | — | 3 | 3 | 0 | 0 | 0 | 0 | no | unchanged | no |
| R02 | c3d0f34b / 4ce388b1 | done | drafted | — | 2 | 2 | 2 | 2 | 0 | 0 | no | unchanged (exact body) | no |
| P02 | 6401f794 / f4234980 | done | refused | docket_limitation | 0 | 0 | 0 | 0 | 0 | n/a | unchanged | no |
| B8 | 9441cf0b / 32713942 | done | drafted | canonical_quote_registry | 1 | 1 | 0 | 0 | 0 | n/a | unchanged, byte-identical | no |

## Special checks

1. **G15** — 0 judgments cited. The answer is thinner but still legally usable: it is
   grounded in חוק המקרקעין ס' 38, 39–43 and תיקון 17 (ס' 40א) plus scholarship, and it
   explicitly states the doctrine was not sufficiently anchored *in the retrieved sources*
   (no non-existence claim). The single metadata-only judgment (דנג"ץ 8537/18) appears
   **only** in the reference-only disclosure block, not as proposition support. Verdict:
   acceptable, not too thin; the real gap is retrieval of the landmark judgments
   (בע"מ 1398/11 and line), which is a sufficiency-track item.
2. **G17 / G13 / G14** —
   - G13 cites one body-acquired judgment (פסק-דין הבטלות היחסית, court.gov.il `.txt`
     body) which does carry the relative-voidness proposition it supports.
   - G14 cites ע"א 9225/01 זיימן with acquired body; the good-faith objective-standard
     proposition is carried by that body.
   - G17 cites only legislation and openly states no usable case law was found — no
     borrowed propositions.
   - Source-soup: used-source counts dropped or stayed flat (G15 7→3); no raw filenames
     in footnotes — all footnote titles are citations or descriptive titles.
     Residual cosmetic issue: R02 fn2 renders as "מסמך מאתר אתר ממשלתי (gov.il)" and
     G08 fn1 as "…בג"ץ 6732/20 - Gov" — generic titles, not filenames. Title-recovery
     item, not a gate defect.
3. **G07 / G08** — not loosened in this track. G07 remains the same
   `insufficient_sources_limitation` refusal. G08 drafted this time (retrieval drew a
   usable בג"ץ 6732/20 body) with both metadata-only judgments demoted to reference-only;
   this is a retrieval-variance improvement, not a gate loosening.
4. **R02** — drafted from ע"א 6821/93 official archive body; `read_in_full = [s1, s2]`,
   0 metadata-only. No downgrade.
5. **P02** — deterministic `docket_limitation` refusal, 0 sources, upload invitation intact.
6. **B8** — canonical quote byte-identical to the registry text.

## Acceptance

- 0 metadata-only holdings in drafted answers — **met**.
- `metadata_only_holdings_remaining = 0` on every model-drafted answer — **met**.
- Reference-only sources carry no legal propositions (G15, G08 disclosure blocks only) — **met**.
- No unsafe answers — **met**.
- No CPU kills / stale jobs / stubs / verifier failures — **met**.
- R02 / P02 / B8 unchanged — **met**.

## Monitor

- G15-style thinning: gate correctness is fine; landmark judgment acquisition is the
  bottleneck. Track under sufficiency/topical matching.
- Generic gov/court document titles surfacing in footnotes (R02 fn2, G08 fn1).
- G08 drafted vs. refused across runs — mode/retrieval variance, not gate-driven.
