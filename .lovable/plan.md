

# Improve Perplexity prompt to distinguish published vs. database case law

## Problem
Perplexity finds case references on secondary sites (legal blogs, database citations) and incorrectly reports `isPublished: false` with a database name, even when the case IS officially published in פ"ד. This happens because Perplexity doesn't access Nevo directly — it sees whatever citation format appears on the web pages it finds.

## Root cause
The current prompt asks Perplexity "if published in פ"ד, say so; otherwise, name the database." But Perplexity often encounters database citations first (e.g., a Nevo link) and stops there, never checking whether a פ"ד publication also exists.

## Solution: Multi-layered prompt hardening

### Change 1: Restructure the Perplexity search prompt
In `supabase/functions/citation-chat/index.ts`, rewrite the system prompt to:

1. **Prioritize פ"ד lookup** — explicitly instruct: "First, check if this case appears in פ"ד (פסקי דין של בית המשפט העליון). Search for the case number together with 'פ"ד' and volume number."
2. **Add negative confirmation** — "Only mark `isPublished: false` if you specifically searched for פ"ד publication and confirmed it does NOT exist."
3. **Flag uncertainty** — Add a new JSON field `"confidence": "high"/"low"` so the system can treat low-confidence results more cautiously.

### Change 2: Add a secondary verification search
When Perplexity returns `isPublished: false`, run a **second focused query** specifically asking: "Is case X published in פ"ד? Search for '[case number] פ"ד כרך'". This targeted search is more likely to find the official publication if it exists.

### Change 3: Handle low-confidence gracefully
If both searches disagree or confidence is low, inject a note to the user: "לא ניתן לאמת בוודאות אם פסק הדין פורסם בפ"ד. מוצג כפסיקה ממאגר. אם ידוע לך שפורסם בפ"ד, נא לציין כרך וחלק."

## Technical details

**File: `supabase/functions/citation-chat/index.ts`** (~lines 488-508)

1. Rewrite the system prompt for the Perplexity call to emphasize פ"ד priority
2. After the first search returns `isPublished: false`, add a second `fetch` call to Perplexity with a focused query like: `"האם ${fullCaseRef} פורסם בפ"ד? חפש כרך וחלק ועמוד ראשון"`
3. If the second search finds פ"ד data, override `isPublished` to `true` and populate volume/part/page
4. Add `confidence` field handling throughout the existing parse logic

| File | Change |
|------|--------|
| `supabase/functions/citation-chat/index.ts` | Rewrite Perplexity prompt to prioritize פ"ד; add secondary verification search; handle uncertainty |

