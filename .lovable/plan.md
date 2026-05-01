**What is going wrong**

The current fix still lets bad data pass in two places:

1. **Party-name results are only weakly grounded.** The backend accepts a result if either its own `sourceUrl` is trusted or the overall Perplexity response has any trusted citation. In the log for `רבינאי נגד מן שקד`, Perplexity returned `ע"א 158/77` but attached the same 2022 Supreme Court URL used for `ע"א 1456/22`, so the old case was not actually proven by its own source.
2. **The final formatter can still invent data after a failed selection.** When clicking an option like `ע"א 3901/96`, the exact-number search returns `found:false` or unusable data, but the function still falls through to the general AI citation formatter with only a “don’t invent” hint. That model then fabricated: `ע"א 3901/96 דוד מן שקד נ' שלמה רבינאי, פ"ד נב(5) 721 (1998)`.
3. **There is no post-output case-number guard.** The final citation is not checked against the selected/input docket and the verified parties, so a fabricated citation can reach the UI.

**Implementation plan**

1. **Add deterministic extraction before AI for party-name searches**
   - Use Perplexity Search API/raw search snippets first for party-name queries.
   - Parse docket numbers and party names from snippets/URLs deterministically.
   - For `רבינאי נגד מן שקד`, this should surface `ע"א 158/77` and the newer `ע"א 1456/22` only if each has its own matching evidence.

2. **Require per-result source grounding**
   - Replace the run-level `hasAnyTrustedCitation` fallback with per-result validation.
   - A result must have either:
     - a trusted `sourceUrl` whose URL/title/snippet/content contains the same docket number, or
     - a raw search result whose title/snippet contains the same docket number and both party names.
   - If Perplexity gives `sourceUrl` for a different case, drop that result.

3. **Make disambiguation options safe**
   - When multiple options are shown, include only validated options.
   - Ensure the option text includes the exact docket number used for later verification.
   - If nothing is validated, show a missing-data response asking for a precise docket instead of offering guessed options.

4. **Short-circuit failed exact docket selections**
   - In the case-number branch, if exact lookup returns `found:false` or fails required checks, return a safe response immediately instead of sending the request to the general AI formatter.
   - The response should contain `[חסר: ...]` fields or a concise message that the exact docket was not verified.
   - This specifically prevents `ע"א 3901/96` from being repurposed into made-up parties/publication data.

5. **Add a final output validator for case-law citations**
   - After the AI gateway response, if the request is case-law:
     - verify the output docket matches the user input/selected docket when one exists;
     - verify party tokens are not contradicted by verified search data;
     - if a `פ"ד` volume/page appears, allow it only when the backend found verified publication fields.
   - If validation fails, replace the response with the safe missing-data citation rather than showing hallucinated metadata.

6. **Improve JSON parsing robustness**
   - Add a reusable `extractJsonObject` helper that strips markdown fences and avoids greedy parsing problems.
   - Use it in both the party-name and exact-number case-law branches.

7. **Add logging for why each candidate is accepted or dropped**
   - Log candidate docket, source URL, matched evidence, and rejection reason.
   - This will make future failures diagnosable from Lovable Cloud logs.

**Files to change**

- `supabase/functions/citation-chat/index.ts`
  - Harden party-name search validation.
  - Add exact-selection short-circuit.
  - Add final case-law output guard.
  - Add safer JSON extraction and better logs.

No database changes are required.