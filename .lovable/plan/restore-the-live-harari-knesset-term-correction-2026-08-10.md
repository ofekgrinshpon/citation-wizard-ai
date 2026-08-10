# Restore the live Harari Knesset-term correction

## Confirmed diagnosis

- Recent live citation-history rows for `החלטת הררי` still store `"החלטת הררי" (החלטה של הכנסת ה-12, 13.6.1950).`
- The current `citation-chat` source derives the Knesset term from the date and then applies a final response normalizer before returning content.
- The existing regression test covers the exact failing sentence and expects `13.6.1950` to resolve to the First Knesset.
- The corresponding live invocations logged the older case-law path only: there is no Rule-15 search log and no `knesset_term_corrected` log. This shows the deployed function is not executing the current checked-in Rule-15/normalization path.

## Plan

1. Deploy the current `citation-chat` function, including its imported shared Knesset-term module.
2. Re-run the exact input `החלטת הררי` against the deployed function.
3. Verify all three runtime signals:
   - returned citation says the First Knesset (`הכנסת ה-1` or `הכנסת הראשונה`), never the 12th;
   - the newly stored citation-history row contains the corrected term;
   - function logs show the Rule-15 decision branch and deterministic term resolution/correction.
4. Run the focused Knesset-term regression suite to retain coverage for the exact sentence, Hebrew maqaf variants, word-form ordinals, and term boundaries.

## Acceptance criteria

- `החלטת הררי` with date `13.6.1950` cannot be returned or stored as a decision of `הכנסת ה-12`.
- The output identifies the First Knesset, based deterministically on the verified date.
- No unrelated product code changes.