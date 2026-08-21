# claim_facet_expansion_v1 — 12-query validation report

Engine: `legal-research-v1` with facet expansion (1 area-locked query per facet,
background/scholarship facets excluded from retrieval budget).
All runs terminal, no code changes made during validation.

| # | Query | Facets | Area lock | Branch | Used src | Footnotes | Compound | Metadata-only holdings | Grade | Failures |
|---|-------|--------|-----------|--------|----------|-----------|----------|------------------------|-------|----------|
| F01 | HCJ burden of proof | yes / 6 | public_law_hcj | draft | 3 | 3 | 1 | 0 | good | none |
| F02 | MAYA (rabbinical court review) | yes / 4 | public_law_hcj | draft | 6 | 5 | 3 | 0 | good | none |
| F03 | Bavli 1000/92 | no (specific_case) | — | docket_limitation | 0 | 0 | 0 | 0 | limited | none |
| F04 | Amir 2232/03 | no (specific_case) | — | draft | 3 | 2 | 1 | 0 | acceptable | none |
| F05 | Companies s.6 | no (statute shape) | — | draft | 4 | 5 | 2 | 0 | good | none |
| F06 | Contracts s.12 good faith | yes / 8 | contracts | draft | 8 | 8 | 5 | 0 | good | none |
| F07 | Proportionality | no | — | insufficient_sources_limitation | 0 | 0 | 0 | 0 | limited | none |
| R02 | Bank Mizrahi 6821/93 | no (specific_case) | — | draft | 2 | 2 | ~0 | 0 | good | none — exact body present |
| P02 | Fake docket | no (specific_case) | — | docket_limitation | 0 | 0 | 0 | 0 | good (refusal) | none |
| B8 | Canonical quote s.1 | no (quote) | — | canonical_quote_registry | 1 | 1 | 0 | 0 | good | byte-identical |
| N01 | Civil burden (noise control) | yes / 8 | none | draft | 4 | 4 | 0 | 0 | good | none |
| N02 | Reasonableness (noise control) | yes / 8 | public_law_hcj | draft | 8 | 8 | 6 | 0 | acceptable | none |

## Facets generated (with the single query each)

**F01 — public law / HCJ burden (all 6 requested facets, all primary_support_found = true)**
1. נטל ראשוני על העותר — "הנטל הראשוני המוטל על העותר בעתירה לבג\"ץ" — found 7 / used 1 / direct
2. חזקת התקינות המנהלית — "חזקת התקינות המנהלית נטל הסתירה" — found 2 / used 0 / tangential
3. חובת ההנמקה — "חובת ההנמקה של הרשות המינהלית…" — found 8 / used 0 / tangential
4. צו על תנאי — "צו על תנאי בבג\"ץ נטל התשובה של המשיב" — found 2 / used 0 / unrelated
5. סעד זמני — "סעד זמני בבג\"ץ מאזן הנוחות סיכויי העתירה" — found 9 / used 3 / direct
6. נטל שכנוע vs הבאת ראיות — found 5 / used 1 / direct

**F02 — MAYA (4 facets, all primary support):** intervention in religious courts (26 found / 5 used / direct), civil law applicability + חוק שיפוט בתי דין רבניים (28/6/direct), שיקול זר (17/2/partial), חוק יחסי ממון / איזון משאבים (14/4/direct).

**F06 / N01 / N02** used the generic structural family (binding provision, binding case law, application & exceptions, theoretical background) per claim, area-locked to contracts / none / public law respectively.

## Answers to the 10 focus points

1. **CPU/stale/stub** — zero after the cap when queries run one at a time. The two CPU kills observed (first F01 attempt at 14 queries, and P02 while three runs executed concurrently) both disappeared: F01 finished in 142 s, P02 in 162 s with the correct refusal. No stubs, no verifier failures, no stale jobs in the final set.
2. **Recall with one query per facet** — not degraded. Every facet in every triggered run reports `primary_support_found = true`; F02 found 14–28 sources per facet, F01 2–9.
3. **MAYA** — improves. 6 sources used with a body-acquired judgment, four separated facets including the previously missing חוק שיפוט בתי דין רבניים and חוק יחסי ממון anchors; previously `lead_ref: null` with scholarship-led footnotes.
4. **Companies s.6 / contracts s.12 / proportionality** — companies (4 sources, judgment with body) and contracts (8 sources, all facets direct) retain core authority. Proportionality returned the pre-existing `insufficient_sources_limitation` refusal; facet expansion did not trigger there, so this is not a facet regression, but it is the one open recall gap.
5. **R02** — unchanged: drafted, exact docket/body present, 2 judgments with acquired text.
6. **P02** — `docket_limitation` preserved.
7. **B8** — `canonical_quote_registry` branch, canonical text byte-identical.
8. **Gating** — correct: all specific_case (F03, F04, R02, P02) and canonical-quote (B8) runs show facet expansion off.
9. **Noise controls** — no over-trigger: N01 (civil burden) got no area lock and generic facets, i.e. no HCJ facet family leaked in; N02 (reasonableness) got the public-law lock with generic facets, which is correct.
10. **Compound footnotes** — reduced where facets are doctrinally distinct (F01 1/3, N01 0/4) but still high on wide generic-facet runs (F06 5/8, N02 6/8), because the generic family produces near-identical query sets and the same source pool matches every facet.

## Open items (not blocking, no code changed)

- Generic facet family fans out to 8 near-duplicate facets on multi-claim questions, which inflates compound footnotes and makes per-facet telemetry non-discriminating.
- Facet labels truncate claim text mid-word (cosmetic, prompt-side only).
- Proportionality still refuses on sufficiency; belongs to the earlier sufficiency track.
- Concurrency: three simultaneous research runs can trigger a CPU kill; validation should stay sequential.

**Verdict:** all acceptance criteria met — recommend closing `claim_facet_expansion_v1` as stable-initial / monitor.
