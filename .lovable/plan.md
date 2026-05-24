## Change

**`src/components/LegalQAChat.tsx` — academic topic/question textarea (~line 2359)**

Add `onKeyDown` so Enter triggers the primary CTA `הצע שאלות מחקר` (suggest_topics); Shift+Enter inserts a newline. Reuses the same guard as the button: `question.trim().length >= 5` and the `checkDestructiveEdit("topic_or_question")` check.

## Out of scope
Trash-button behavior in research panel. No other changes.
