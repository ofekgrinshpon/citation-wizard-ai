

# Clickable Chapter List & Per-Chapter Feedback Input

## Overview
Two additions to the academic writing wizard:
1. **Clickable chapter list** — during writing/checkpoint, show all chapters as a sidebar-style list so the user can click any already-written chapter to view it.
2. **Per-chapter feedback textbox** — after each chapter is output (checkpoint step), show a text input where the user can type instructions (e.g. "focus more on case law"), then re-generate the chapter with that feedback appended to the prompt.

## Changes (all in `src/components/LegalQAChat.tsx`)

### 1. Clickable Chapter List
In the **writing** and **checkpoint** steps, render the `chapters` array as a vertical list of buttons above/beside the current chapter card:
- Each chapter shows its title and a status indicator (✓ written / current / pending)
- Clicking a written chapter sets `currentChapter` to that index and shows its content in a read-only card (reusing the checkpoint display)
- Clicking the current unwritten chapter returns to the "write" prompt
- This lets users freely browse completed chapters without losing any data

### 2. Feedback Textbox on Checkpoint
After a chapter is written (checkpoint step), add a textarea below the chapter content:
- Placeholder: `"הנחיות נוספות לשכתוב (למשל: הרחב את סקירת הפסיקה, התמקד בגישה הביקורתית...)"` 
- A "שכתב עם הנחיות" (Rewrite with instructions) button sends the chapter for rewrite, passing the feedback text as `userFeedback` in the `handleAcademicSubmit` payload
- The edge function (`legal-qa/index.ts`) will append this feedback to the `write_chapter` prompt so the AI incorporates it

### 3. Edge Function Update (`legal-qa/index.ts`)
In the `write_chapter` sub-mode handler, read an optional `userFeedback` field from the request body and append it to the system/user prompt:
```
הנחיות נוספות מהמשתמש: {userFeedback}
```

## File Changes
- `src/components/LegalQAChat.tsx` — chapter list UI, feedback textarea + rewrite button, pass `userFeedback` in payload
- `supabase/functions/legal-qa/index.ts` — read `userFeedback` and inject into `write_chapter` prompt

