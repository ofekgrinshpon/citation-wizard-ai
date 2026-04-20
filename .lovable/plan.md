

## Goal
Fix incorrect classification where ordinary Hebrew laws like "חוק הירושה", "חוק התחרות הכלכלית", "חוק העונשין" land under **ספרות משפטית** instead of **חקיקה ראשית**.

## Root cause
`classifyCitation` in `src/hooks/useBibliography.tsx` runs the **author/literature** check before the **legislation** check (lines 100–130).

Inside `hasAuthorPrefix` (line 65) the guard regex uses `\b` after Hebrew words:
```
/^(חוק|חוק-יסוד|פקודת|תקנות|...)\b/
```
JavaScript's `\b` is **ASCII-only** — Hebrew letters are not `\w`, so `\b` never matches between `חוק` and a following space. The "this is not an author" guard therefore **never fires** for Hebrew, and any "חוק <word>," string (e.g. `חוק הירושה,`) matches the generic 2-word author pattern and is mis-classified as literature.

This is why some laws happen to land correctly:
- `חוק החוזים (חלק כללי), ...` → next char is `(`, breaks the author lookahead → falls through to legislation ✓
- `חוק-יסוד: הכנסת, ...` → `:` breaks the leading char class → falls through ✓
- `חוק הירושה, ...` / `חוק העונשין, ...` / `חוק התחרות הכלכלית, ...` → cleanly matches the author 2-word pattern → wrongly tagged as literature ✗

## Fix

### `src/hooks/useBibliography.tsx`

1. **Replace ASCII `\b` with explicit lookaheads** in `hasAuthorPrefix`'s `nonAuthorStarters` regex so it actually rejects Hebrew legislation/case-law openers:
   ```
   /^(חוק-יסוד|חוק\s+יסוד|חוק|פקודת|פקודה|תקנות|תקנה|צו|נוהל|הוראת|הצעת|תזכיר|סעיף|סימן|פרק|תוספת|בית|פסק|דין|מדינת|הממשלה|הכנסת|משרד|רשות|בג"ץ|ע"א|רע"א|דנ"א|ע"פ|רע"פ|דנ"פ|ע"ע|עש"מ|בש"פ|ת"א|ת"פ|ע"מ|ה"פ|המר|פר"ק|ת"ט|תא"מ|ת"ד|עב"ל|ס"ק|ד"מ|ראו|ראה|השוו|השווה|שם|לעיל)(?=[\s:,\-־\(\.])/
   ```
   (uses an explicit lookahead instead of `\b`, so Hebrew openers are reliably rejected from the "is this an author?" path.)

2. **Re-order `classifyCitation`** so structural markers win over generic name detection. New order:
   1. Case-law detectors (`isSupremeCase`, `isDistrictCase`, `isMagistrateCase`, `isSpecializedCase`, `isGenericCase`) — case-law tokens are unambiguous.
   2. Legislation detectors (`hasPrimaryLegislation`, `hasSecondaryLegislation`) — same reason.
   3. `authorDetected` / `hasLiteratureMarkers` — only after structural sources are ruled out.
   4. URL → `misc`.

   `authorSurname` extraction stays gated on `sourceType === "literature"`, so it only runs when literature classification actually wins.

3. The `useEffect` at lines 260–275 already re-runs `rebuildBibliographyEntries` on mount, which calls `classifyCitation` again. Existing mis-classified entries in `localStorage` will be **auto-corrected** on the next page load — no migration needed.

### `src/components/BibliographyGenerator.tsx`
No change. The category-override popover already lets users move a row manually if a future edge case slips through; this fix removes the need for them to use it on plain-vanilla laws.

### Edge function
No change.

## Out of scope
- No changes to disambiguation, Perplexity fallback, verified-source priority, or the 3-step wizard.
- No DB schema changes.

## Outcome
- `חוק הירושה, התשכ"ה–1965, ס"ח 63` → **חקיקה ראשית** ✓
- `חוק התחרות הכלכלית, התשמ"ח–1988, ס"ח 128` → **חקיקה ראשית** ✓
- `חוק העונשין, התשל"ז–1977, ס"ח 226` → **חקיקה ראשית** ✓
- `חוק-יסוד: הכנסת` and `חוק החוזים (חלק כללי)` → keep working as today.
- Existing wrongly-categorized entries in the user's bibliography will reshuffle to the correct category automatically on next reload.

