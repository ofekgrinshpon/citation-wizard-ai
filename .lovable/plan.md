**Plan**

I’ll fix the remaining route where a selected or generated case-law option can still fall through to the book resolver.

**What I’ll change**

1. **Treat disambiguation selections as case law even without a docket number**
   - If the input starts with `[בחירת תוצאה]`, the backend will force case-law handling when the selected line contains case-law signals such as `נ'`, `נגד`, court names, a year, or a prior case-law result format.
   - This prevents selected options like `תביעה לשכר עבודה ... קמיקר ... נ' מדינת ישראל...` from being searched as a book.

2. **Do not suppress case-law handling for selections without a case number**
   - Current logic builds a `caseLawHint` for the selection but then `shouldSearchCaseLaw` is false and the flow later reaches the book branch.
   - I’ll make this branch stop the book resolver and continue into citation generation as case law.

3. **Strip markdown/formatting before party detection**
   - Selected options contain bold markers like `**קמיקר**`; the current party regex only accepts Hebrew letters/spaces/quotes, so `partyMatch=no`.
   - I’ll normalize selection text by removing markdown, list numbering, and `[חסר: ...]` placeholders before party/case-law checks.

4. **Strengthen the book hard-skip guard**
   - The book search will be blocked not only by `isCaseLaw`, but also by case-law signals in the cleaned text: party separator, Israeli court/procedure words, court names, or `[בחירת תוצאה]` case-law selection.
   - This is a safety net so even if the classifier says “book”, the book branch will not run for litigation references.

5. **Improve selected-result metadata extraction**
   - For selections with no docket number, I’ll parse available parties/date/court/type from the selected line and inject them as a case-law hint.
   - If the selected line has only a year and not a full date, the prompt will explicitly require a full-date lookup or `[חסר: תאריך מלא]`, rather than inventing or degrading to book output.

**Expected result**

For `סע״ש קמיקר נ מדינת ישראל ורשות האוכלוסין וההגירה` and for clicking the returned option, the system should remain in case-law mode throughout and never run the book resolver.