

## Goal
After the system proposes 3 research questions for a general topic, let the user (1) click any of the 3 to pick it, or (2) click a "יש לי שאלת מחקר" button to bail out and enter their own.

## Investigation needed
- How the 3 research questions are currently displayed in `LegalQAChat.tsx` (academic mode, `topic_or_question` step after general topic submit).
- Where the questions are stored in state (likely the assistant message text or a parsed array).
- The handler that submits a research question to advance to the `outline` step.

## Approach (single file: `src/components/LegalQAChat.tsx`)

### 1. Parse the 3 proposed questions
When the AI returns 3 research questions for a general topic, parse them out (numbered list `1. ... 2. ... 3. ...`) and store as an array `proposedQuestions: string[]` in wizard state.

### 2. Render clickable cards
Below the assistant message, render 3 clickable cards/buttons (one per question). Clicking one:
- Sets the chosen string as the active `researchQuestion`
- Calls the same submit path used today for "submit research question"
- Advances the wizard to the `outline` step

### 3. "יש לי שאלת מחקר" escape button
Next to the 3 cards, render a secondary outline button **"יש לי שאלת מחקר משלי"**. Clicking it:
- Clears `proposedQuestions`
- Switches the sub-mode back to `research_question` entry (the same UI shown when the user originally picked "יש לי שאלת מחקר")
- Keeps the topic context but lets them type their own question and submit normally

### 4. Persistence
The `proposedQuestions` array and current sub-mode are added to the existing `safeStorage` wizard snapshot so a refresh preserves the choice screen.

## Out of scope
- No edge function changes — the AI already returns the 3 questions; we only change client parsing/UI.
- No changes to outline/writing steps.

## File changes
- `src/components/LegalQAChat.tsx` — parse proposed questions, render clickable cards + escape button, wire to existing submit handlers, extend persistence.

