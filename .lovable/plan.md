

## Fix: Natural Language Case Law Detection & Disambiguation

### Problem
The query "מכירה את פסק הדין המזרחי המאוחד המפורסם?" was not detected as case law, so it went to the general AI which hallucinated בג"ץ instead of ע"א. The system also returned only one result instead of presenting options.

### Root Cause
`detectSourceType` only recognizes formal patterns (ע"א, בג"ץ, case numbers, "נ'"). Natural language like "פסק הדין" bypasses case law handling.

### Approach — Minimal, No New Components

The existing disambiguation UI in `MessageBubble.tsx` already renders numbered case options as clickable buttons. The `VerifiedSuggestionCard` already handles "did you mean?" for verified sources. No new edge function parameter or component is needed.

**Two changes only:**

#### 1. Add natural language case law detection in `detectSourceType`
**File**: `src/data/abbreviations.ts`

Add a check for phrases like "פסק הדין", "פסק דין", "פס"ד" that indicate the user is asking about case law, even without formal citation patterns. This ensures the input gets the `case_law_database` classification tag, which the AI prompt already knows how to handle.

```typescript
// Natural language case law references (before the "unknown" fallback)
if (/פסק\s+(?:ה)?דין|פס["״]ד/.test(hebrewText) && 
    !/חוק|פקוד|תקנ|הצעת|ספר/.test(hebrewText)) {
  return 'case_law_database';
}
```

#### 2. Update the `citation-chat` system prompt to return multiple options for ambiguous case law queries
**File**: `supabase/functions/citation-chat/index.ts`

Add an instruction to the system prompt: when the user's case law query could match multiple cases (same parties, different procedures), list all matching cases as numbered options so the user can choose. The existing `isDisambiguationLine` regex in `MessageBubble` will automatically render them as clickable buttons.

### What We Are NOT Doing
- No new edge function parameters or `naturalLanguageQuery` field
- No new UI components — existing disambiguation UI handles it
- No changes to `case-law-search` edge function

### Files Changed
- `src/data/abbreviations.ts` — add natural language detection pattern
- `supabase/functions/citation-chat/index.ts` — add disambiguation instruction to system prompt

