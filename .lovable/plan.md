

## Fix: Enforce Memo Length & Citation Formatting (Prompt + Post-Processing)

### Root Causes
1. **Too short**: `gemini-2.5-flash` produces concise output by default. The 800-1200 word instruction is being ignored. Need to upgrade to `gemini-2.5-pro` for complex legal memos AND raise the minimum.
2. **Titles persist** (פרופ', ד"ר, רו"ח): The AI ignores the no-titles rule. Need server-side regex stripping.
3. **`[missing: פרט חסר]`**: The AI ignores the no-placeholders rule. Need server-side regex removal.
4. **Truncated footnote 4**: Likely a `max_tokens` limit. Need to increase it.
5. **Footnote 6 gap**: The existing renumbering logic only runs when blog URLs are filtered. Need a universal sequential renumber pass.

### Changes — `supabase/functions/legal-qa/index.ts`

**A. Switch model and increase tokens** (line 343):
- Change `google/gemini-2.5-flash` to `google/gemini-2.5-pro` for higher instruction adherence
- Add `max_tokens: 8192` to prevent truncation

**B. Strengthen length instructions** (line 306):
- Change "800–1200 מילים" to "1500–2500 מילים" with CRITICAL emphasis
- Add: "כל חלק (תקציר, מסגרת נורמטיבית, ניתוח מפורט, המלצות מעשיות) חייב לכלול לפחות 3–4 פסקאות. חלק 'ניתוח מפורט' חייב להיות הארוך ביותר עם לפחות 5 פסקאות."

**C. Add post-processing steps** (after line 470, the existing post-processing):

1. **Strip academic titles from footnotes**:
   - Regex to remove פרופ', ד"ר, עו"ד, רו"ח, שופט/ת, המנוח/ה, ז"ל from citation text
   - Pattern: `/\b(פרופ['׳]|ד"ר|עו"ד|רו"ח|שופט[ת]?|המנוח[ה]?|ז"ל)\s*/g` → replace with empty string

2. **Remove `[missing:...]` and `[חסר:...]` placeholders**:
   - Pattern: `/\[missing:[^\]]*\]|\[חסר:[^\]]*\]/g` → remove
   - Also clean up orphaned "עמ'" left behind: `/, עמ'\s*$/` → remove trailing incomplete refs

3. **Universal sequential renumbering**:
   - After ALL filtering, always renumber footnotes 1,2,3... and update superscripts in the answer text — not only when blog filtering occurs

4. **Filter truncated/empty footnotes**:
   - Remove any footnote where `citation.trim().length < 10` (too short to be valid)
   - Remove the corresponding superscript from the answer

### Files Changed
- `supabase/functions/legal-qa/index.ts` — model upgrade, max_tokens, stronger length prompt, 4 new post-processing steps
- Deploy updated edge function

