

## Bug
The prompt tells the AI to output 3 questions, where **each question has 3 numbered sub-points** (ניסוח, הסבר, מקורות). The client parser uses the regex `/^(\d+)[.)]\s*(.+)$/` which matches the first `1.`/`2.`/`3.` it sees — so it parses the 3 sub-points of the FIRST question as if they were the 3 questions. Result: 3 cards all describing one question.

## Fix (2 files)

### 1. `supabase/functions/legal-qa/index.ts` — `suggest_topics` prompt (lines 156–163)
Change the output format so questions and sub-points use **different markers**:

```
**שאלה 1:** <ניסוח ברור של שאלת המחקר>
- מעניינת אקדמית כי: ...
- מקורות זמינים: ...

**שאלה 2:** <ניסוח ...>
- מעניינת אקדמית כי: ...
- מקורות זמינים: ...

**שאלה 3:** ...
```
Add explicit instruction: "אל תשתמש במספור (1./2./3.) בתת-הסעיפים — השתמש במקפים (-)."

### 2. `src/components/LegalQAChat.tsx` — `parseProposedQuestions` (lines 70–96)
Rewrite the parser to look for the `שאלה N:` marker (with optional `**` bold) instead of any `N.`:
- Match `^\*{0,2}שאלה\s+(\d+)\s*[:.]\s*\*{0,2}\s*(.+)$`
- Capture only the question text on that line (strip the bullet sub-points that follow until the next `שאלה N:`)
- Keep fallback: if no `שאלה N:` markers found, fall back to the old numbered-list parser for backward compatibility

## Out of scope
No changes to outline/writing steps, persistence, or the click handlers — only the prompt format and the matching parser.

