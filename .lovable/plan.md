

## Update: Footnote Superscripts Must Follow Punctuation

### Problem
Currently, the AI places `[X]` markers anywhere in the text, and the server converts them to superscripts in-place. This results in superscripts appearing before punctuation (e.g., `בעניין בן גביר¹,` instead of `בעניין בן גביר,¹`).

### Changes

**File: `supabase/functions/legal-qa/index.ts`**

1. **Prompt instruction** (line 416): Add explicit rule that `[X]` must be placed **after** punctuation marks, with examples:
   ```
   - חשוב: סימן ההפניה [X] חייב לבוא תמיד אחרי סימן הפיסוק, לא לפניו.
     נכון: בעניין בן גביר,[1]
     נכון: מערכת בתי המשפט.[1]
     לא נכון: בעניין בן גביר[1],
   ```

2. **Post-processing fix** (after line 565, in Step 7): Add a regex pass that fixes any remaining cases where the AI placed the superscript before punctuation:
   ```typescript
   // Move superscripts that precede punctuation to after it
   answer = answer.replace(/([\u00B9\u00B2\u00B3\u2074-\u2079]+)([,.\-;:!?])/g, '$2$1');
   ```
   This catches all cases where superscript digits appear before `,` `.` `-` `;` `:` etc., and swaps them.

### Expected outcome
All footnote markers in the body text will appear after punctuation:
- `בפסק הדין בעניין בן גביר,¹`
- `מערכת בתי המשפט.¹`

