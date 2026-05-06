**What the last logs show**

The latest `citation-chat` logs confirm the current fix is over-filtering:

1. The query is parsed as:
   - `party1 = "סע\"ש קמיקר"`
   - `party2 = "מדינת ישראל ורשות האוכלוסין וההגירה"`

   That is wrong: `סע״ש` is the procedure type, not part of party 1. Party 1 should be only `קמיקר`.

2. Perplexity returned three results:
   - `ת״פ 51883-03-22` — `מדינת ישראל` נ׳ `קמיקר`
   - `המ״ד 45993-06-17` — `מדינת ישראל` נ׳ `קמיקר`
   - `סע״ש 50358-09-16` — empty parties, court `תל אביב`, database `takdin`, year `2016`

3. The reversed criminal/other results were correctly dropped.

4. The correct `סע״ש 50358-09-16` result was also dropped because Perplexity left `party1` and `party2` empty, so the strict party-token filter treated it as irrelevant.

**Root problems**

- Procedure prefix is still being captured inside `party1`.
- The filter is too strict when a result has a strong docket/procedure match but missing party fields.
- The search prompt asks broadly for all cases “between the parties”, which invites reversed-party and unrelated cases; when a procedure prefix is present, the search should be focused around that prefix and party order.
- Known metadata for the correct case is still incomplete (`date` is empty). If the exact date is not found by search, the system must output `[חסר: תאריך]` rather than inventing or silently degrading.

**Implementation plan**

1. Normalize party extraction in `supabase/functions/citation-chat/index.ts`:
   - Detect a BIU procedure prefix immediately before party 1.
   - Remove that prefix from the extracted `party1` before token filtering and before constructing the search query.
   - Keep the prefix separately as `userCaseTypeNorm`.

2. Make party filtering smarter:
   - Keep dropping reversed-party results like `מדינת ישראל נ׳ קמיקר` when the user typed `קמיקר נ׳ מדינת ישראל...`.
   - But allow a result with empty party fields if it strongly matches the user-supplied case type (`סע״ש`) and includes a valid docket number.
   - Prefer such a prefix+docket match over reversed-party hallucinations.

3. Strengthen the Perplexity party-search prompt:
   - If the user supplied a procedure prefix, explicitly search for that prefix + party names first.
   - Instruct the search to reject reversed-party results unless the official title really matches the typed order.
   - Ask for exact metadata fields: `caseType`, `caseNumber`, `party1`, `party2`, `court`, `date`, `databaseName`, `year`.

4. Improve the single-result hint builder:
   - If the accepted result has empty parties, fill parties from the user’s parsed parties only when the case type/docket match is strong.
   - Keep `databaseName = תקדין/takdin` from the result.
   - Do not fake the date. If the date remains empty, force `[חסר: תאריך]` in the generated citation.

5. Add more diagnostic logging:
   - Log the parsed `rawParty1`, cleaned `party1`, `party2`, and detected user case type.
   - Log whether a result was accepted because of `sameOrder` or because of the strong `caseType+docket` fallback.

6. Update the memory note for this disambiguation logic so future work preserves:
   - Procedure prefix must not be treated as a party token.
   - Empty-party results may still be valid if they match the requested procedure type and docket.
   - Reversed-party results remain disallowed.

**Expected behavior after the fix**

For `סע״ש קמיקר נ מדינת ישראל ורשות האוכלוסין וההגירה`, the system should no longer say that no relevant result was found. It should accept the `סע״ש 50358-09-16` candidate, preserve `תקדין/takdin`, preserve court/year when available, and require a missing-date marker unless the search returns the exact full date.