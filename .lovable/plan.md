

## Problem
The AI sometimes writes wrong target numbers in `לעיל ה"ש X` back-references. Example from latest run:
- FN #4: full citation `רן מס "רשימה: 'על לווייתנים ואריות'..." (2019)`
- FN #7 & #11: `רן מס, לעיל ה"ש 6` ← should be `לעיל ה"ש 4`

Current post-processing (lines 1820–1841) only checks:
1. Self-reference (X = own number) → strips the phrase
2. Target exists → keeps as-is

It does NOT verify that the target footnote actually contains the same source.

## Plan: Content-aware "לעיל ה"ש" validator

### Single change in `supabase/functions/legal-qa/index.ts`

Add a new validation pass **after** the existing exists-check (around line 1841), **before** `fixHebrewYearPrefix`. For every footnote that contains `לעיל ה"ש X`:

1. **Extract the back-ref key** from the short-form citation (everything before the `, לעיל ה"ש` phrase). Normalize it (trim quotes, whitespace, punctuation, lowercase Hebrew).
   - Example: `רן מס, לעיל ה"ש 6.` → key = `רן מס`
   - Example: `פקודת הנזיקין, ס' 13, לעיל ה"ש 1.` → key = `פקודת הנזיקין` (strip pinpoint after comma)
   - Example: `ת"צ (עבודה ת"א) 35327-08-20, לעיל ה"ש 3.` → key = `35327-08-20` (case number)

2. **Build a key-extraction helper** that pulls from each footnote's full citation:
   - Author surname (first 1–2 Hebrew words before `"`)
   - Case number pattern (`\d+/\d+` or `\d+-\d+-\d+`)
   - Law name (text before first comma if it starts with `חוק`/`פקודת`/`תקנות`)

3. **Search all footnotes** for one whose extracted key matches the back-ref key. Prefer the **earliest-numbered** footnote (since "לעיל" means "above").

4. **If a better target is found** and it differs from the AI's number:
   - Rewrite `לעיל ה"ש X` → `לעיל ה"ש <correctNum>`
   - Log: `Corrected back-ref in FN #N: "key..." → ה"ש X became ה"ש Y`

5. **If no matching full-citation found** (orphan back-ref), keep the existing exists-only check behavior (or strip the phrase if target also looks like a back-ref to avoid back-ref chains).

### Position in pipeline
Place AFTER the existing reorder logic (which already remaps numbers based on body appearance) so we work with the final numbering. The validator catches cases where the AI's original numbering was wrong, not just shifted.

### Out of scope
- No prompt changes (the prompt already says "אסור שהערה תפנה להערה שמכילה מקור אחר לחלוטין" — the AI is just unreliable here).
- No DB / SQL changes.
- No changes to the body-renumbering loop.

### Expected impact
- `רן מס, לעיל ה"ש 6` (when רן מס is at FN #4) → auto-corrected to `רן מס, לעיל ה"ש 4`.
- Same for `פקודת הנזיקין, לעיל ה"ש N` and case-number back-refs.
- A new log line: `Corrected back-ref in FN #N: ...` will let us audit how often the AI gets this wrong.

