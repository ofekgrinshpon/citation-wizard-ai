

## Fix: Natural Language Case Law Detection Order & Disambiguation Prompt

### Problem
Two issues from the previous implementation:

1. **Detection order bug**: The natural language case law check (`פסק הדין`, `פס"ד`) was placed at line 396, AFTER the book heuristic at line 387-390. The input "מכירה את פסק הדין המזרחי המאוחד המפורסם?" has 7+ Hebrew words and matches the book heuristic first, so it never reaches the case law check. It gets classified as "ספר" (book).

2. **Missing disambiguation instruction**: The system prompt in `citation-chat/index.ts` was never updated with the disambiguation instruction for multiple matching cases.

### Changes

#### 1. Move natural language case law detection BEFORE the book checks
**File**: `src/data/abbreviations.ts`

Move the natural language case law detection block (currently at lines 396-399) to BEFORE line 381 (the `ספר|מהדורה` check) and BEFORE the book heuristic at lines 387-390. This ensures "פסק הדין" is caught before the generic book patterns.

#### 2. Add disambiguation instruction to the system prompt
**File**: `supabase/functions/citation-chat/index.ts`

Add a new section to the `SYSTEM_PROMPT` (around line 401, after the missing data protocol) instructing the AI: when a case law query is ambiguous or could match multiple cases (same parties, different procedures like both an appeal and a leave to appeal), list all matching cases as numbered options in this format:

```
נמצאו מספר פסקי דין תואמים. לאיזה פסק דין התכוונת?

1. ע"א 6821/93 בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי, פ"ד מט(4) 221 (1995)
2. רע"א 1908/94 בנק המזרחי המאוחד בע"מ נ' מגדל כפר שיתופי, פ"ד מט(4) 221 (1995)
```

This format matches the existing `isDisambiguationLine` regex in `MessageBubble.tsx`, which will automatically render them as clickable buttons.

### Files Changed
- `src/data/abbreviations.ts` -- move detection block earlier
- `supabase/functions/citation-chat/index.ts` -- add disambiguation instruction to system prompt + redeploy

