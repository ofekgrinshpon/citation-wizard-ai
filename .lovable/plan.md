**What I found**

There are two separate bugs:

1. **Still classified as a book**
   - The frontend can classify `סע"ש קמיקר נ מדינת ישראל ורשות האוכלוסין וההגירה` as a book because the party separator is written as bare `נ` rather than `נ'` / `נגד`.
   - Then the backend receives a prompt that starts with the book engine hint. The backend’s prefix override is currently checking the whole prompt after only partially stripping the hint. Because the prompt starts with `[סיווג אוטומטי: ספר]` and `══ מנוע אזכור ...`, the actual text `סע"ש...` is not at the start anymore, so the prefix override does not trigger.
   - The backend logs confirm this: `isCaseLaw=false`, `partyMatch=no`, then `[book] Searching Perplexity for: סע"ש קמיקר...`.

2. **Can’t click the options**
   - The UI only turns option lines into clickable buttons if the line starts with a narrow set of prefixes: `ע`, `בג`, `ד`, `ר`, `ב`, `ת`, `ה`.
   - `סע"ש ...` starts with `ס`, so those lines render as plain formatted text, not buttons.
   - Even after clicking works, the current option handler sets input and then programmatically clicks the send button after 50ms. Because React state updates are async, it can click while the input is still empty/stale. We should send the selected option directly instead.

**Implementation plan**

1. **Harden frontend source detection** in `src/data/abbreviations.ts`
   - Add a shared case-law prefix list or extend the current detection so any input starting with a known docket prefix, including `סע"ש`, is classified as `case_law_database` even without a docket number.
   - Support bare Hebrew `נ` as a party separator when surrounded by spaces, so `קמיקר נ מדינת ישראל` is recognized like `קמיקר נ' מדינת ישראל`.
   - Prevent the generic Hebrew-name book heuristic from catching strings that contain known case-law prefixes or party separators.

2. **Harden backend prompt cleanup and case-law override** in `supabase/functions/citation-chat/index.ts`
   - Create a robust helper to strip classification tags and the entire engine-hint block before classification checks.
   - Run prefix-only and party-name checks against the cleaned user source text, not the full prompt.
   - Support bare ` נ ` as a party separator for party-only case-law searches.
   - Make case-law routing take precedence over the book branch: if a known case-law prefix or party separator is present, skip book search entirely even when the classifier label says `ספר`.

3. **Improve party-only case-law search output** in `supabase/functions/citation-chat/index.ts`
   - For `סע"ש` party-only searches, keep the labor-court constraint.
   - If multiple cases are returned, emit stable, machine-readable option lines that include the docket, parties, date/year, and court.
   - When the user selects an option, the backend should perform a focused case-number lookup if the selected option contains a docket number; otherwise it should build the final citation from the selected option’s parsed data.

4. **Make options reliably clickable** in `src/components/MessageBubble.tsx` and `src/pages/Index.tsx`
   - Expand `isDisambiguationLine` to recognize all known case-law prefixes, especially `סע"ש`, `ס"ק`, `ד"מ`, etc.
   - Use a dedicated selected-option submit function instead of `setInput(...)` + `document.querySelector('.btn-send').click()`.
   - This will immediately send `[בחירת תוצאה] ...` with the selected line, avoiding stale state and making clicks reliable.

5. **Deploy and verify**
   - Redeploy the `citation-chat` backend function.
   - Verify these scenarios:
     - `סע״ש קמיקר נ מדינת ישראל ורשות האוכלוסין וההגירה` is treated as case law, not book.
     - Multiple `סע"ש` options render as clickable buttons.
     - Clicking option 1 or 2 sends the selection and generates a final case-law citation.
     - `סע"ש 50358-09-16` remains classified as labor-court case law and keeps the full date when found.