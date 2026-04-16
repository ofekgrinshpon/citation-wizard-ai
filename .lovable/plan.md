

# Bi-directional Navigation, Copy Full Paper, and Destructive Edit Warnings

## Overview
Add a visual progress stepper, back/forward navigation between wizard steps, destructive edit warnings, and a persistent "Copy Full Paper" button to the Academic Writing wizard.

## Changes (all in `src/components/LegalQAChat.tsx`)

### 1. Track furthest reached step
Add a `maxReachedStep` state (persisted in `safeStorage` alongside existing session data) that records the furthest step the user has reached. This enables the "forward" button when the user navigates back.

### 2. Visual Progress Stepper
Replace the current simple progress bar (lines 754-766) with a clickable step indicator showing: **נושא/שאלה → מתווה → כתיבה**. The current step is highlighted; completed steps are clickable. This stepper is always visible (except at `init`).

### 3. Back & Forward buttons
- **Back**: Visible at every step past `init`. Navigates to the previous step without clearing data. E.g., from `writing` back to `outline` — chapters and outline remain intact.
- **Forward (קדימה)**: Visible only when `maxReachedStep` is ahead of the current step. Jumps forward to where the user left off, with all data intact.

### 4. Destructive Edit Warning
When the user is on a previous step and takes an action that would regenerate content (e.g., submitting a new research question from `topic_or_question` when chapters already exist, or re-proposing an outline when chapters exist):
- Show `window.confirm("שים לב: שינוי [שם השלב] יגרום למחיקת התוכן שנכתב בהמשך. האם להמשיך?")`
- Only on confirm: clear subsequent state (chapters/outline as appropriate) and reset `maxReachedStep`
- On cancel: do nothing

### 5. "העתק טקסט מלא" (Copy Full Paper) button
- A floating/sticky button visible whenever `chapters.some(ch => ch.content)` is true, regardless of current wizard step
- Uses the existing `handleCopy` logic (lines 640-658) which already aggregates chapters into rich text
- Positioned in the stepper bar area or as a small fixed button so it's always accessible

### 6. State persistence update
Update `AcademicSession` interface and `saveAcademicSession`/`loadAcademicSession` to include `maxReachedStep`. Navigation changes (back/forward) trigger a persist.

## Step dependency rules
```text
topic_or_question → outline → writing/checkpoint/done
```
- Going back from `outline` to `topic_or_question` is non-destructive (just viewing)
- Actually submitting a NEW topic/question from `topic_or_question` when outline/chapters exist → destructive warning
- Actually re-proposing outline when chapters exist → destructive warning
- Simply viewing a previous step = safe, no data loss

## No other files change
All modifications are contained in `LegalQAChat.tsx`.

