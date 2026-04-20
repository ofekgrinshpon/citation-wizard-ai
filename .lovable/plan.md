

## Goal
Two clear submission modes for **בקרה למסמכים משפטיים**:
1. **File only** → audit the file.
2. **File + text** → text is treated as user **context/instructions** about the file (not the document to audit).
3. **Text only** → audit the typed text as the document.

## Changes

### 1. `src/components/LegalQAChat.tsx`
- Enable submit when **either** text (≥5 chars) **or** a file is attached.
- When submitting:
  - If file attached → send `question` as either the typed text (treated as user context) or a default instruction (`"בצע ביקורת מקיפה על המסמך המצורף"`) when textbox is empty.
  - If no file → send typed text as the document to audit (current behavior).
- Pass a flag (e.g. `hasDocument: true/false`) to the edge function so it knows how to interpret `question`.

### 2. `supabase/functions/legal-qa/index.ts` — `pleading_analysis` branch
- Read the `hasDocument` flag (or infer from presence of `documentContext`).
- **Branch A — file present**: the **document content** is the audit subject; the typed `question` becomes "הנחיות נוספות מהמשתמש" injected into the prompt (e.g. "התמקד בסעיף הסעדים", "בדוק במיוחד את התאריכים"). The auditor follows those instructions while running the full protocol on the document.
- **Branch B — text only**: the typed `question` IS the document being audited (current behavior).
- Move the 150-word minimum to apply to **whichever is the audit subject** (document content in Branch A, typed text in Branch B). If subject < 150 words → return the existing "need more context" message.

## Out of scope
- Other modes (research / case_summary / academic_writing) — unchanged.
- UI redesign of upload area or new visual indicators.
- History/sidebar display.

## Files touched
- `src/components/LegalQAChat.tsx`
- `supabase/functions/legal-qa/index.ts` (+ redeploy)

## Expected outcome
- Upload contract PDF, leave textbox empty → full audit of the contract.
- Upload contract PDF, type "התמקד בסעיף הפיצויים" → audit of the contract with extra emphasis on the compensation clause.
- Type a 200-word כתב טענה directly, no file → audit of the typed text.

