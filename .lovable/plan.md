

## Goal
Lock the **Abstract** (תקציר) chapter in the Academic Writing wizard until **all other chapters** are written. When unlocked, generation must use the full context of every previously written chapter and produce a strict ≤250-word formal Hebrew academic abstract covering research question, methodology, main arguments, and conclusion.

## Current behavior (verified)
- Default chapter list (`approveOutline`, line 665): `["תקציר", "מבוא", "המסגרת הנורמטיבית", "סקירה פסיקתית ודוקטרינרית", "ניתוח ביקורתי", "סיכום ומסקנות"]` — תקציר is **already first** in the list.
- The wizard renders chapters as clickable chips (lines 1187–1207) and lets the user write any chapter via `viewChapter` / `writeCurrentChapter`. There is no special handling for "abstract".
- Chapter generation goes through `handleAcademicSubmit("write_chapter")` → edge function `legal-qa` → `getAcademicSubModePrompt("write_chapter", body)` (lines 302–330). All chapters share the same prompt.
- `previousChapters` is already sent to the edge function with **2,000-char slices per chapter** (line 311). For the abstract we'll need to send **fuller content**.

## Plan

### 1. Frontend — `src/components/LegalQAChat.tsx`

**A. Identify the abstract chapter**
Add a small helper:
- `isAbstractChapter(title)` → true when title is "תקציר" / "Abstract" / starts with תקציר.
- `abstractIdx` = index of the abstract chapter (memoized).
- `nonAbstractChapters` = all chapters except the abstract.
- `abstractUnlocked` = every non-abstract chapter has `content`.

**B. Lock the chapter chip** (lines 1187–1207)
For the abstract chip when `!abstractUnlocked`:
- Render a `Lock` icon (lucide-react) instead of the check.
- Apply muted/disabled styling and `cursor-not-allowed`.
- Wrap in a `Tooltip` showing: `ניתן לייצר תקציר רק לאחר השלמת כל פרקי העבודה, כדי להבטיח שהוא משקף את המחקר במלואו`.
- `onClick` becomes a no-op (or a `toast.info` with the same message).

**C. Lock the writing card** (lines 1210–1230)
When the user is on the abstract chapter and it's locked:
- Replace the "כתוב פרק זה" button with a disabled button labeled "ייצר תקציר" + `Lock` icon and the tooltip above.
- Show a small inline notice: `יש להשלים תחילה {N}/{M} פרקים נותרים` listing missing chapter titles.

**D. Unlocked state — visual feedback**
When `abstractUnlocked`:
- The abstract chip shows a `Wand2` (Magic Wand) icon if not yet written, or `Check` if written (already handled).
- The writing-card button becomes "ייצר תקציר" with the `Wand2` icon, primary variant.

**E. Send a flag for abstract generation**
In `writeCurrentChapter`, when on the abstract:
- Pass `{ isAbstract: true }` via `extraBody` to `handleAcademicSubmit("write_chapter", { isAbstract: true })`.
- Inside `handleAcademicSubmit`, when `isAbstract` is true, override the `previousChapters` slice cap (currently 2,000 chars) and send full content per chapter (or a higher cap, e.g., 6,000 chars per chapter) so the AI sees the whole paper.

**F. Auto-jump on completion**
When the last non-abstract chapter is finished, surface a small toast: `כל הפרקים הושלמו — ניתן לייצר תקציר`.

### 2. Backend — `supabase/functions/legal-qa/index.ts`

**A. Extend `write_chapter` prompt** (lines 302–330)
Read `body.isAbstract` (boolean). When true, return a dedicated abstract prompt instead of the generic chapter prompt:

```
אתה חוקר אקדמי בכיר במשפטים. עליך לכתוב **תקציר** לעבודה סמינריונית שכבר נכתבה במלואה.

שאלת המחקר: "${rq}"

=== כל פרקי העבודה ===
{prevChapters joined, with titles}

הנחיות מחייבות:
- אורך: עד 250 מילים בלבד (קשיח). אל תחרוג.
- טון: עברית אקדמית פורמלית ברגיסטר גבוה.
- מבנה (פסקה אחת רציפה או 2-4 פסקאות קצרות):
  1. שאלת המחקר וחשיבותה.
  2. המסגרת התיאורטית/המתודולוגיה.
  3. הטיעונים המרכזיים שהוצגו בפרקים.
  4. המסקנה והתרומה של המחקר.
- אל תוסיף הערות שוליים, רשימת מקורות, כותרות משנה או רשימות ממוספרות.
- אל תפתח במילים "תקציר זה..." — פתח ישר בתוכן.
- אם חרגת מ-250 מילים — קצר את עצמך.
```

**B. Skip retrieval for abstract**
The abstract is purely a synthesis of existing chapters — no need for vector search or Perplexity. In the main handler (around lines 554–620 where the academic sub-mode shortcut runs), extend the shortcut list to include `"write_chapter"` **only when `body.isAbstract === true`**, so the abstract is generated through the lightweight path (LLM only, no retrieval). This:
- Speeds up generation.
- Avoids polluting the abstract with new external citations (rule per memory: abstract = synthesis, no new citations).

**C. Post-process word-count guard**
After the LLM responds, count Hebrew words in the answer. If > 250, log a warning (do not fail). Optionally trim trailing sentence overflow. Keep this defensive — the prompt is the primary enforcement.

### 3. Memory update
Add `mem://features/academic-writing-mode/abstract-locking` describing:
- Abstract is locked until all other chapters are complete.
- Abstract uses a dedicated 250-word synthesis prompt.
- Abstract skips retrieval (synthesis-only).
Add a one-line reference in `mem://index.md`.

## Files to change
- `src/components/LegalQAChat.tsx` — chip lock UI + writing card lock + isAbstract flag + full-content payload.
- `supabase/functions/legal-qa/index.ts` — `getAcademicSubModePrompt` abstract branch + extend academic shortcut.
- `mem://features/academic-writing-mode/abstract-locking` (new) + `mem://index.md` (append reference line).

## Out of scope
- Changing the default outline (תקציר stays the first chapter).
- Editable abstract length cap (250 is fixed per spec).
- Retroactive abstracts for old QA sessions.

## Expected outcome
- Abstract chip is visually locked (🔒) with a clear Hebrew tooltip until every other chapter has content.
- Once unlocked, chip swaps to a Magic Wand (🪄) and the action button reads "ייצר תקציר".
- Generated abstract is ≤250 words, formal Hebrew, covers all 4 required elements, contains no footnotes.

