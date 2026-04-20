

## Goal
Restructure the Seminar Wizard outline (academic_writing → `propose_outline`) to follow a strict academic research-proposal format with an Introduction (thesis + line of argument + structure), per-chapter expansion + counter-arguments + argumentative tone, "general → specific" / "מצוי → ראוי" flow, and an estimated Conclusion section. Render the result as a structured hierarchical report instead of raw markdown.

## Current state
- `supabase/functions/legal-qa/index.ts` `getAcademicSubModePrompt("propose_outline")` (lines 307–321) returns a thin 6-bullet template (תקציר / מבוא / מסגרת / סקירה / ניתוח / סיכום) with no thesis, no per-chapter expansion, no counter-arguments, no flow guidance.
- `LegalQAChat.tsx` `approveOutline()` (lines 838–851) parses chapter titles via a loose regex `^\d+\.\s*\*?\*?(.+)`. Needs to keep extracting the same titles even when the new richer outline has nested expansion bullets underneath.
- The outline is rendered with `<RenderMarkdown text={result.answer} />` inside a plain card (line 1366–1386). No hierarchical/visual structure.

## Plan

### 1. Rewrite `propose_outline` prompt (`supabase/functions/legal-qa/index.ts`)
Replace the case body with a strict three-section research-proposal template that the AI must output verbatim:

```
**מבוא**
- שאלת המחקר: <ניסוח מדויק>
- התזה המרכזית (Thesis): <טענה משפטית מרכזית במשפט אחד>
- חשיבות ותרומה לשיח המשפטי: <2-3 שורות>
- קו הטיעון (Line of Argument): <כיצד התזה מתפתחת לאורך הפרקים>
- מבנה העבודה: <משפט מקשר לפרקים שלמטה>

**רשימת הפרקים**
1. **<כותרת פרק>** – הדין המצוי
   - הרחבה: <2-4 משפטים — מוקד הפרק, הטיעונים הנטענים, וכיצד הוא משרת את שאלת המחקר>
   - טיעוני נגד אפשריים: <משפט-שניים — אילו השגות יועלו וכיצד הפרק נערך לקראתן>
2. **<כותרת פרק>** – ...
   - הרחבה: ...
   - טיעוני נגד אפשריים: ...
(המשך — בהדרגה מן הכלל אל הפרט: התחל בדין המצוי, עבור לביקורת/השוואה, סיים בדין הראוי / הצעה נורמטיבית)

**סיכום ומסקנות (משוערות)**
- מסקנה משוערת: <מה צפוי לעלות מהמחקר על-בסיס מה שידוע עד כה>
- תרומה משפטית: <שורה-שתיים>
```

Plus mandatory style rules in the prompt:
- **Argumentative tone**: "פרק זה טוען ש…" / "במאמר ייטען כי…" — never "אסקור" / "אבחן" / "ארצה להציג".
- **Logical flow**: chapters MUST progress general → specific, מצוי → ראוי. Mark each chapter with `– הדין המצוי` / `– ניתוח ביקורתי` / `– הדין הראוי` tag for clarity.
- 4–6 chapters, no תקציר in the outline (תקציר is generated last from the written work — keep the existing post-write flow untouched).
- Hebrew academic register; no footnotes inside the outline.

### 2. Keep chapter extraction working (`LegalQAChat.tsx` `approveOutline`)
The new outline puts chapter titles on numbered lines `1. **Title** – tag` followed by indented sub-bullets. Update the regex to:
- Match only top-level numbered lines (`^\d+\.\s+\*\*(.+?)\*\*`).
- Strip the trailing ` – הדין המצוי/הראוי/...` tag from the title before saving to `chapters[]` (so chapter buttons show clean titles).
- Skip any indented `- הרחבה:` / `- טיעוני נגד:` lines.
- Preserve the existing "fallback to default 6-section list" if no titles parse.
- **Inject תקציר** at the start of the parsed list automatically (since the new outline omits it, but the abstract-locking flow still needs it as the final synthesizable chapter).

### 3. New `OutlineReport` rendering (`LegalQAChat.tsx`, replace lines 1366–1386 block)
Build an inline structured renderer (no new file needed — keep co-located with the wizard) that parses the AI's three-section markdown into:
- **Header card** — "מתווה מחקר אקדמי" + the research question pulled from state.
- **Section: מבוא** — labelled rows for שאלת המחקר / תזה / חשיבות / קו הטיעון / מבנה. Each label bold, value in body text.
- **Section: רשימת הפרקים** — ordered list, each chapter as a sub-card with: number badge + title + flow-tag pill (מצוי/ביקורתי/ראוי) + two labelled paragraphs (הרחבה, טיעוני נגד).
- **Section: סיכום ומסקנות (משוערות)** — labelled rows for מסקנה משוערת / תרומה.
- Keep the existing "אשר מתווה והתחל כתיבה" + "חזרה לעריכה" buttons unchanged below.

Parsing strategy: split on the three `**...**` headers; within "רשימת הפרקים" split on `^\d+\.` lines and capture the indented `- הרחבה:` / `- טיעוני נגד:` bullets per chapter. Fallback: if parsing fails, render the original `<RenderMarkdown>` so nothing breaks for legacy outlines saved in localStorage/DB.

### 4. Backward compatibility
- Existing saved sessions (`outline` string in `academic_sessions` / localStorage) keep loading; `OutlineReport` falls back to plain markdown if the new headers aren't found, so old outlines render as before.
- No DB migration needed (outline is already stored as free text).
- `approveOutline` already handles the legacy 6-bullet shape via its fallback list; the updated regex is a strict superset.

### 5. Files touched
- **Edit** `supabase/functions/legal-qa/index.ts` — replace `propose_outline` case body (lines 307–321).
- **Edit** `src/components/LegalQAChat.tsx`:
  - Update `approveOutline()` regex + auto-inject תקציר.
  - Replace the outline-rendering Card block (lines 1366–1386) with the new `OutlineReport` inline component.
- **Deploy** `legal-qa` edge function.

## Out of scope
- Changing the abstract / write_chapter / suggest_topics prompts — only `propose_outline` is restructured.
- New DB columns for outline metadata (parsing happens at render time from the stored markdown string).
- Persisting the parsed structure separately — the markdown remains the source of truth.

## Expected outcome
- User picks "כתיבה אקדמית" → enters research question → wizard shows a structured research-proposal outline with thesis, per-chapter expansions, counter-arguments, מצוי→ראוי flow, and an estimated conclusion. Clicking "אשר מתווה" still extracts clean chapter titles (with תקציר auto-prepended) and proceeds to the existing chapter-writing flow without behaviour change.

