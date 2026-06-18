## Problem

For the citation `שחר ליפשיץ "שלילת אבהות בהסכמה" משפטים נא(1) 231 (2021).` the validator falsely reports:
`⚠️ חסרים 1 רכיבי חובה: עמוד תחילת המאמר`

even though page `231` is present.

## Root cause

In `src/lib/citationValidation.ts` (article branch, lines ~195–198), the firstPage regex is:

```
/\*\*[^*]+\*\*\s+(?:[א-ת]+|\d+)\s+(\d+)/
```

It assumes `**Journal** Volume PAGE`, with whitespace right after the volume token. But per כלל 24.6 the volume can be immediately followed by a חוברת in parentheses with no space, e.g. `**משפטים** נא(1) 231`. The `\s+` after the volume token fails to match, so `firstPage` is never extracted and the validator reports it as missing.

The volume regex has the same gap — it captures `נא` correctly here only because `(` is not in `[א-ת]|\d`, but pure-digit volumes followed by `(` would also stop at the paren, which is fine. The real fix is just the firstPage regex.

## Fix

Update the article-branch regexes in `extractFieldsFromResponse` (`src/lib/citationValidation.ts`, ~lines 195–198) to allow an optional `(חוברת)` between the volume and the first page, with optional whitespace around it:

```ts
const volMatch = response.match(/\*\*[^*]+\*\*\s+([א-ת]+|\d+)/);
if (volMatch) fields.volume = volMatch[1];

const pageMatch = response.match(
  /\*\*[^*]+\*\*\s+(?:[א-ת]+|\d+)\s*(?:\([^)]+\))?\s+(\d+)/
);
if (pageMatch) fields.firstPage = pageMatch[1];
```

This keeps the existing behavior for plain `Volume Page` cases and additionally handles `Volume(חוברת) Page`.

## Verification

After the change, the example citation should validate cleanly (no "missing first page" warning), and existing cases like `**משפטים** מד 7 (2014)` should continue to pass. No other code paths change.

## Files

- `src/lib/citationValidation.ts` (single regex tweak in the article branch)
