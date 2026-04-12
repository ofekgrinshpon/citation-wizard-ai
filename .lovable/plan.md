

## Fix: Display Font, Markdown Heading Rendering, and Citation Quality

### Issues Identified

1. **Display shows David font** — the result area has `fontFamily: DAVID_FONT` inline style on screen. Should use the app's default font for display; David only applies when copying.

2. **Raw `###` symbols ("סולמיות")** — the AI returns markdown headings (`## `, `### `) but the `RenderBold` component only handles `**bold**`. The headings render as raw text with hash marks.

3. **Citation format issues** — the AI system prompt instructs structured headings but doesn't explicitly forbid markdown `#` syntax. Need to tell the AI to use `**bold**` for headings, never `#`.

### Changes

**`src/components/LegalQAChat.tsx`**

1. **Remove David font from on-screen display** (lines 473, 75, 480, 491):
   - Remove `fontFamily: DAVID_FONT` from the result container div (line 473), footnote header (line 480), footnote items (line 491), and superscript elements (line 75)
   - Keep `fontSize`, `textAlign`, `lineHeight` for layout
   - David font remains ONLY in the `handleCopy` HTML string for clipboard

2. **Add markdown heading parsing** — update `RenderBold` (or create a new `RenderMarkdown` component) to:
   - Strip `## ` / `### ` / `#### ` prefixes from lines
   - Render heading lines as `<strong>` with appropriate sizing (e.g., `text-base font-bold` for `##`, `text-sm font-semibold` for `###`)
   - Continue handling `**bold**` inline markers

3. **Update `handleCopy`** — also strip `#` headings and convert to `<strong>` in the rich HTML builder (line 306)

**`supabase/functions/legal-qa/index.ts`**

4. **Tighten the system prompt** — add explicit instruction:
   - `אל תשתמש בסימני # לכותרות. השתמש ב-**כותרת** (הדגשה) בלבד.`
   - This prevents the AI from generating markdown headings in future responses

### Files
- `src/components/LegalQAChat.tsx` — remove David font from display, add heading parsing, fix copy HTML
- `supabase/functions/legal-qa/index.ts` — add no-`#` instruction to system prompt

