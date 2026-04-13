

## Fix: Footnotes Must Appear in Consecutive Order of First Appearance

### Problem
The AI may reference sources in non-sequential order (e.g., `[3]` before `[1]`), or skip numbers. The current code maps AI footnote numbers to new sequential numbers based on the order they appear in the **footnotes section**, not the order they first appear in the **body text**. This results in non-consecutive footnote numbering in the output.

### Solution
After building the footnotes array and replacing `[X]` with superscripts, add a **reordering pass** that:
1. Scans the body text left-to-right for superscript numbers
2. Records the order of first appearance
3. Renumbers both the superscripts in the body and the footnotes array to match that order (1, 2, 3...)

### Changes

**File: `supabase/functions/legal-qa/index.ts`**

Insert a reordering step between Step 6 (superscript replacement) and Step 7 (post-processing), around line 654:

```typescript
// ========= Step 6b: Reorder footnotes by first appearance in body =========
const superscriptPattern = /[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]+/g;
const superscriptToNum = (s: string) => {
  const reverseMap: Record<string, string> = {};
  for (const [digit, sup] of Object.entries(digitToSuperscript)) {
    reverseMap[sup] = digit;
  }
  return parseInt(s.split("").map(c => reverseMap[c] || c).join(""), 10);
};

// Collect footnote numbers in order of first appearance
const appearanceOrder: number[] = [];
let supMatch;
while ((supMatch = superscriptPattern.exec(answer)) !== null) {
  const num = superscriptToNum(supMatch[0]);
  if (!isNaN(num) && !appearanceOrder.includes(num)) {
    appearanceOrder.push(num);
  }
}

// Build old→new mapping based on appearance order
if (appearanceOrder.length > 0) {
  const reorderMap = new Map<number, number>();
  appearanceOrder.forEach((oldNum, idx) => {
    reorderMap.set(oldNum, idx + 1);
  });

  // Replace superscripts in body with placeholders, then with new numbers
  for (const [oldNum, newNum] of reorderMap) {
    answer = answer.replaceAll(toSuperscript(oldNum), `__REORDER_${newNum}__`);
  }
  for (const [, newNum] of reorderMap) {
    answer = answer.replaceAll(`__REORDER_${newNum}__`, toSuperscript(newNum));
  }

  // Reorder footnotes array to match
  const reorderedFootnotes = [];
  for (let i = 1; i <= appearanceOrder.length; i++) {
    const oldNum = appearanceOrder[i - 1];
    const fn = footnotes.find(f => f.number === oldNum);
    if (fn) {
      reorderedFootnotes.push({ ...fn, number: i });
    }
  }
  // Add any footnotes not referenced in body at the end
  for (const fn of footnotes) {
    if (!appearanceOrder.includes(fn.number)) {
      reorderedFootnotes.push({ ...fn, number: reorderedFootnotes.length + 1 });
    }
  }
  footnotes.length = 0;
  footnotes.push(...reorderedFootnotes);
}
```

This ensures footnotes always appear as 1, 2, 3... in the order they are first cited in the body text.

### Files
- `supabase/functions/legal-qa/index.ts` — add reordering pass after superscript replacement

