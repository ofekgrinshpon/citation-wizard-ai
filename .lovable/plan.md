## Feature B1.1 — "הצע שאלות נוספות" (Regenerate research questions)

Adds a button under the 3 suggested research questions that asks the system for 3 *more* questions on the same topic, while keeping the previous ones visible. When the system genuinely cannot produce more (no new sources / repeated suggestions), it shows a clear, actionable empty state offering to switch topic.

### UX flow

```text
[Topic input] → "הצע שאלות מחקר"
   ↓
Round 1: ▢ Q1  ▢ Q2  ▢ Q3        ← clickable, click = pick this question (existing behavior)
         📚 N במאגר · 🌐 M מהרשת
         [+ הצע 3 שאלות נוספות]   ← new
         [יש לי שאלת מחקר משלי]   (existing)
   ↓ (user clicks "הצע 3 שאלות נוספות")
Round 2 appended below Round 1 (Round 1 stays clickable):
         ──── סבב 2 ────
         ▢ Q4  ▢ Q5  ▢ Q6
         📚 N במאגר · 🌐 M מהרשת
         [+ הצע 3 שאלות נוספות]
   ↓ (system cannot produce new ones)
         ──── סבב 3 ────
         Card: "לא הצלחנו למצוא שאלות נוספות על הנושא הזה
                במקורות שברשותנו. אפשר לבחור מאחת מ-6 השאלות
                שכבר הוצעו, או לנסות נושא אחר."
         [נסה נושא אחר]   [יש לי שאלת מחקר משלי]
```

Hard cap: max **3 rounds (= 9 questions)** to bound cost. After round 3 the "+ הצע 3 שאלות נוספות" button is replaced by an info note.

All previous round cards remain mounted and their question buttons remain clickable at any time.

### Frontend changes (`src/components/LegalQAChat.tsx`)

1. Replace single `proposedQuestions: string[]` usage in the topic step with a new state shape kept locally in that view:
   ```ts
   type SuggestionRound = {
     questions: string[];
     coverage: QAResult["topicCoverage"]; // reuse existing type
     exhausted?: boolean;                 // backend signaled "no more"
   };
   const [suggestionRounds, setSuggestionRounds] = useState<SuggestionRound[]>([]);
   ```
   Round 1 is pushed when the first `suggest_topics` response arrives; existing `proposedQuestions` is derived from `suggestionRounds.flatMap(r => r.questions)` for any code that still reads it.

2. New handler `handleRegenerateTopics()`:
   - Calls `handleAcademicSubmit("suggest_topics", { previousQuestions: allQuestionsSoFar, round: suggestionRounds.length + 1 })`.
   - On success, **appends** a new `SuggestionRound`; never clears existing rounds.
   - If response carries `noMoreQuestions: true` (or returns an empty `questions` array), pushes a round with `exhausted: true` and renders the empty-state card.

3. Render: map over `suggestionRounds` instead of a single block. Each round shows its own coverage badges + its own question buttons (existing onClick logic unchanged). Add a separator `──── סבב N ────` between rounds.

4. Below the last round:
   - If `rounds.length < 3` and last round is not `exhausted`: show **"+ הצע 3 שאלות נוספות"** button (loading spinner while in flight, disabled while loading).
   - If `exhausted` or `rounds.length >= 3`: show empty-state card with two buttons: **"נסה נושא אחר"** (resets `question`, `suggestionRounds`, `result`) and **"יש לי שאלת מחקר משלי"** (existing bail-out).

5. Keep the existing per-question click handler unchanged so all questions across all rounds remain clickable.

### Backend changes (`supabase/functions/legal-qa/index.ts`)

1. Extend the `suggest_topics` request body with two optional inputs:
   - `previousQuestions?: string[]` — questions already shown to the user.
   - `round?: number` — 1-based round index (defaults to 1).

2. In `getAcademicSubModePrompt("suggest_topics", body)`:
   - When `previousQuestions.length > 0`, prepend a block:
     ```
     שאלות שכבר הוצעו (אסור לחזור עליהן ואסור לנסח מחדש בווריאציה זניחה):
     1. ...
     2. ...
     הצע 3 שאלות **חדשות לחלוטין** באותו נושא: זוויות שונות, היבטים שונים, או רמות הפשטה שונות.
     ```
   - Keeps the existing strict 3-question output format.

3. Reality-check pipeline (already in place for round 1) runs again for each round:
   - If `pplxEnabled` and round > 1, allow Perplexity even when local hits exceed `MIN_HITS`, to surface fresh angles. Cheap: same single `sonar` call already used.

4. Post-generation guard — **"no more" detection**:
   - Normalize each new question (lowercase, strip punctuation, collapse whitespace).
   - Compare against normalized `previousQuestions` using token-overlap ≥ 0.75 (Jaccard on word sets).
   - Drop near-duplicates. If fewer than 2 new unique questions remain after filtering, return:
     ```json
     { "questions": [], "noMoreQuestions": true,
       "answer": "לא הצלחנו לייצר שאלות נוספות על הנושא הזה...",
       "topicCoverage": { ...same shape as today, may be empty } }
     ```
   - Also return `noMoreQuestions: true` if `round >= 3` (hard cap enforced server-side too).

5. Telemetry: extend the existing `qa_logs.metadata.topic_reality_check` block with `round`, `previousQuestionsCount`, `dedupedDropped`, `noMoreQuestions`.

### Cost / safety notes
- Each "+ הצע 3 שאלות נוספות" click = 1 planner + (local search ×N) + optional 1 Perplexity `sonar` call. Same per-call cost as round 1.
- Hard cap of 3 rounds prevents runaway usage.
- `suggest_topics` already costs 0 credits (line 2186), so this stays free for the user, consistent with the existing wizard step.

### Files touched
- `src/components/LegalQAChat.tsx` — new state shape, regenerate handler, multi-round render, empty-state card with clickable options.
- `supabase/functions/legal-qa/index.ts` — `suggest_topics` prompt accepts `previousQuestions`/`round`, dedup guard, `noMoreQuestions` response field, expanded telemetry.
- `.lovable/memory/features/academic-writing-mode/topic-reality-check.md` — append a "Multi-round regeneration" section.
