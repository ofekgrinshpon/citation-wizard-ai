# footnote_density_diagnosis_v1 — read-only

Why non-academic answers land on 1–2 footnotes even when 8–25 sources pass verification.
No code changed.

## Funnel (from reports/non-academic-regression-smoke-v1/results.json + V2 acceptance)

| run | sources passed to drafter | CSM drops | used sources | footnotes |
|-----|---------------------------|-----------|--------------|-----------|
| Q1 | 5 (23 in the first smoke) | 0 recorded | 0 → 1 after v2 | 0 → 1 |
| Q2 | 12 | 3 | 3 | 3 |
| Q3 | 8 | 5 | 2 | 2 |

~80% of drafter-admitted refs never become a footnote.

## Ranked causes

1. **claimSourceMatch Rule D/E** (`stages/claimSourceMatch.ts:532-588`) —
   `unrelated_legal_area` + `insufficient_authority_for_claim_category` remove 40–60%
   of admitted refs. Largest quantified loss; already flagged unresolved in
   `reports/non-academic-source-binding-csm-v1/ACCEPTANCE_REPORT.md` §11.1.
2. **Compound-footnote collapsing** (`stages/footnoteBuilder.ts:158-239`) — a block with
   2–3 surviving refs renders as ONE marker (`source_type: "compound"`). Footnote count is
   therefore bounded by *block count*, not by source count. This alone converts
   "5 used sources" into "2 footnotes".
3. **Three stacked 3-refs-per-block caps** — prompt `stages/drafterV2.ts:197`,
   `stages/topicAwareAlignment.ts:385` (MAX_REFS_PER_BLOCK), and
   `stages/claimSourceRebinding.ts:360` (DEFAULT_REF_CAP=3, SYNTHESIS_REF_CAP=5).
   No single owner of the cap; each re-prunes an already-pruned list.
4. **Block ceilings** (`stages/routerProfiles.ts:159,186`) — `statute_first` = 5,
   `doctrine_explainer` = 7. Combined with (2), the hard ceiling on distinct markers for
   ordinary Q&A is ~5–7, not `blocks × 3`.
5. **Deterministic single-ref branches** (`stages/drafterV2.ts:942,1713`) —
   `slice(0, 1)`; the statute-section-limitation path can never exceed 1 footnote.
6. **Prompt bundling instruction** (`stages/drafterV2.ts:195,215`) — actively tells the
   model to put co-supporting sources in one block "כי הקוד ייצור הערת שוליים מורכבת אחת".

## Recommendation — next track

`footnote_density_v1`, two coupled parts, in this order:

**A. Per-occurrence footnote emission (highest leverage, low risk).**
Stop collapsing a multi-ref block into one compound marker by default. Emit one marker per
distinct source, anchored at the sentence/clause it supports (occurrence-level rather than
block-level). Keeps every existing gate intact — no new source is admitted, only the
already-approved ones become individually visible and individually attributable. This
directly converts today's "3 kept refs → 1 footnote" into "3 kept refs → 3 footnotes"
and also fixes the residual compound-label garbling.

**B. Rule D/E precision pass.** Audit `unrelated_legal_area` and
`insufficient_authority_for_claim_category` against a labelled sample of dropped refs to
separate genuine mismatches from tagging artifacts (the constitutional/public_law_hcj class
of bug, one family deeper). Raise recall only where a drop is demonstrably wrong; do not
raise the per-block caps, which would invite citation padding.

Do NOT start by raising DEFAULT_REF_CAP / block ceilings — that adds padding risk without
addressing either root cause.
