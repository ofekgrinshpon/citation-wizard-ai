

## Fix: Copy with Rich Formatting (Bold, David 12pt, Justified, 1.5 spacing)

### Problem
`handleCopy` uses `copyPlainText` — raw `**bold**` markers are pasted as-is with no formatting.

### Changes

**`src/pages/LegalQA.tsx` — `handleCopy` function**

1. Build an HTML string from the answer + footnotes with proper styling:
   - Convert `**text**` to `<strong>text</strong>`
   - Wrap in a `<div>` with inline styles: `font-family: David, 'David Libre', serif; font-size: 12pt; line-height: 1.5; text-align: justify; direction: rtl;`
   - Footnotes section: same font at 10pt with `<strong>` for numbers

2. Switch from `copyPlainText` to `copyRichText(html, plainText)` (already exists in `src/lib/clipboard.ts`)

3. For the plain-text fallback, strip `**` markers so even plain paste looks clean

### No other files changed
- `clipboard.ts` already has `copyRichText` with HTML+plain support and Office iframe fallbacks

