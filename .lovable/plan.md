# Fix C — Attach procedure_type to research-mode dockets

**Status: SHIPPED (research-mode only).** `citation-chat` deliberately untouched.

## What shipped

1. **`supabase/functions/legal-qa/index.ts`**
   - New helpers `looksLikeDocketPrefix(s)` and `formatDocketForCaseLaw(meta)` — distinguish true docket prefixes (`בג"ץ`, `ע"א`, `רע"א`, …) from broad subject categories (`משפחה`, `פלילי`, …).
   - Case-law card builder now emits `richCitation = "${prefix} ${case_number} ${title} ..."` whenever `meta.procedure_type` is a docket prefix; bare otherwise.
   - `SourceCard.case_number` now stores the **prefixed** docket so the resolver's Tier-2 path (`matchCaseTypeAndNumber(caseNumberHint)`) succeeds.
   - New `SourceCard.docket_prefix` and `SourceCard.procedure_category` carry classified hints.
   - Stage 2 hint construction (≈line 6423) now derives `caseTypeHint` with priority: `card.docket_prefix` → `partial.caseType` → `card.procedure_category`. The bare docket remains the request key (so back-merge by `case_number` still works).

2. **`supabase/functions/_shared/partyLookup.ts`**
   - When `caseTypeHint` looks like a docket prefix, the prompt now renders `${prefix} ${caseNumber}` instead of bare `${caseNumber}`. Categories stay parenthesized as disambiguation hints.

3. **`supabase/functions/legal-qa/legalSourcePack.ts`**
   - `InternalSourcePackEntry` extended with `docket_prefix?` and `procedure_category?` for future-stage passthrough. Public `LegalSourcePackItem` contract unchanged.

## Out of scope (per user)

- `citation-chat` not touched.
- DB rewrites of `verified_sources` not touched.
- Non-caselaw serialization unchanged.

## Validation queued (next loop)

Not run in this loop. To validate:

1. Flip `MODE_PROFILES.fast.partyLookupRetryEnabled = true` in `supabase/functions/legal-qa/modeProfiles.ts`.
2. Run `eval/phase-c-fast-on-probe.mjs` — expect `recovered + recovered_with_placeholders > 0` for Q1 (which involves `18225-06-25`).
3. Spot-check `בג"ץ 18225-06-25` and `בג"ץ 2592/20` via `supabase--curl_edge_functions` and inspect `metadata.research_engine.party_lookup` + final `validFootnotes`.
4. Re-run `eval/phase-c-probe.mjs` Deep to confirm no regression.
5. If clean → flip the flag for real; otherwise revert and reopen.

## Reopen criteria if probe still fails

- Stage 2 `attempted > 0` but `recovered == 0` for Q1 → diagnosis is wrong; investigate Perplexity sonar-pro coverage of district records or the resolver's relaxed-fullDate path.
