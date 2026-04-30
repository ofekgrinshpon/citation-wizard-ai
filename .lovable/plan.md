**Findings**

The latest failed entry in `citation_history` is:

`raw_input: סע״שׁ 50358-09-16`

and the returned citation was:

`סע"ש 50358-09-16 [חסר: שם המערער/העותר] נ' [חסר: שם המשיב] ([חסר: שם המאגר] [חסר: תאריך מלא]).`

The backend logs show the real problem:

`[case-law] isCaseLaw=false, caseNumberMatch=null`

So the case-law lookup branch still never ran for the last query. The previous regex fix works for normal `סע"ש`, but this last input contained an extra Hebrew diacritic/mark on the final letter: `סע״שׁ` (`shin` + `shin dot`). Because neither the frontend nor the edge function strips Hebrew niqqud/cantillation marks, the regex did not recognize the docket prefix.

There is a second issue: even when the search branch does run, the code converts only the first hyphen in `50358-09-16` to `/`, producing `50358/09-16`. That can make the external lookup less reliable. For Israeli lower-court/labor docket numbers, the original hyphenated format should be preserved for Takdin-style lookup.

**Plan**

1. **Normalize Hebrew legal input before classification and regex matching**
   - Add a small shared normalization helper in `citation-chat/index.ts` that:
     - normalizes Hebrew geresh/gershayim to standard quote characters;
     - removes Hebrew niqqud/cantillation marks (`\u0591-\u05C7`), including the `ׁ` that broke `סע״שׁ`;
     - normalizes repeated whitespace.
   - Use this normalized value for:
     - `isValidCitationInputServer` checks where relevant;
     - `classMatch` / `caseNumberMatch` / party matching;
     - verified-source search token extraction.

2. **Make docket detection resilient to quote variants and diacritics**
   - Keep support for `סע"ש`, `סע״ש`, and normalized `סע"ש`.
   - Add missing labor/court prefixes to both frontend detection and backend detection where needed, especially `סע"ש`, `ק"ג`, `ד"מ`, `ס"ק`, and similar labor prefixes already used in search results.
   - Ensure a recognized prefix plus `NNNNN-MM-YY` always forces `פסיקה (מאגר)` behavior even if the auto-classifier says `unknown` or `book`.

3. **Preserve full lower-court docket numbers**
   - Replace the current `caseNumberMatch[2].replace('-', '/')` behavior.
   - Preserve `50358-09-16` exactly for lower-court/labor-style dockets.
   - Only normalize slash/hyphen when appropriate for single-separator Supreme Court-style dockets.
   - Log both the raw and normalized docket to make future failures visible.

4. **Improve external search reliability for this exact pattern**
   - In the case-law lookup prompt, query with both:
     - `סע"ש 50358-09-16`
     - `50358-09-16 קמיקר מדינת ישראל רשות האוכלוסין וההגירה` only if parties are already known from the query or a prior hit.
   - Make the prompt explicitly say not to return unrelated “latest cases” if the docket is not found.
   - Consider switching this specific lookup from `sonar` to `sonar-pro` with JSON schema output, matching the more reliable pattern already used in `_shared/partyLookup.ts`.

5. **Frontend normalization parity**
   - Update `src/data/abbreviations.ts` so `normalizeAbbreviations()` also strips Hebrew diacritics before detecting source type.
   - Add `סע"ש` and the relevant labor docket prefixes to `CASE_TYPE_ABBREVIATIONS`, so the UI shows the case-law search state and sends the correct classification hint.

6. **Deploy and verify**
   - Deploy the updated `citation-chat` edge function.
   - Test the function with the exact problematic input variants:
     - `סע"ש 50358-09-16`
     - `סע״ש 50358-09-16`
     - `סע״שׁ 50358-09-16`
   - Confirm logs now show `isCaseLaw=true` and `caseNumberMatch=סע"ש 50358-09-16`.
   - Confirm the response no longer falls through to the generic AI path with missing parties/date.