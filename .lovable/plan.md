

## Fix: Duplicate footnote groups in Legal QA output

### Problem
The AI sometimes writes the footnotes section without the exact `--- הערות שוליים ---` separator (e.g., using `**הערות שוליים**`, `הערות שוליים:`, or just `הערות שוליים` without dashes). When the regex doesn't match, the entire AI response — including its inline footnotes — becomes the body text, and the fallback logic appends a second set of footnotes from source cards. This produces two footnote groups in the output.

### Solution
Two changes in `supabase/functions/legal-qa/index.ts`:

1. **Broaden separator detection** (Step 5, ~line 611): Replace the strict regex with a flexible one that catches common variations:
   - `--- הערות שוליים ---`
   - `**הערות שוליים**`
   - `הערות שוליים:`
   - `הערות שוליים` (standalone heading line)

2. **Strip orphan footnotes from body on fallback**: If the separator still isn't found but the body contains a numbered list at the end (e.g., `1. ציטוט...`), detect and parse it as the footnotes section rather than leaving it in the body.

### Technical details
- File: `supabase/functions/legal-qa/index.ts`, lines ~611-633
- Replace separator regex: `/---\s*הערות שוליים\s*---/` → a multi-pattern approach that tries the strict format first, then falls back to looser patterns like `/\*?\*?הערות שוליים\*?\*?\s*:?/m`
- Add a final fallback: scan for a trailing block of consecutive `N. text` lines at the end of the response and split there
- Redeploy Edge Function `legal-qa`

