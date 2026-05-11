**What is actually happening**

The remaining failure is not the old toast string in the frontend — that exact `toast.error("יש להזין טקסט.")` no longer exists in the app code. The likely active blocker is the backend’s generic request guard:

```ts
if (!question || typeof question !== "string" || question.trim().length < 3) {
  return { error: "Question too short" }
}
```

That guard still runs before academic-step routing. For `סיכום ומסקנות`, the content should come from `previousChapters`, not from typed input, so this global `question` guard is conceptually wrong for `write_conclusion` / `write_introduction` / abstract synthesis.

**Do I know what the issue is?**

Yes: there are two separate validation layers. We fixed the frontend generic text toast, but the backend still treats every request as requiring a non-empty `question`. For paper-level academic synthesis, the required data is `researchQuestion + previousChapters`, not the visible textarea.

**Implementation plan**

1. **Move academic routing before the generic backend question guard**
   - In `supabase/functions/legal-qa/index.ts`, classify academic writing requests before validating `question`.
   - For `write_conclusion`, `write_introduction`, and abstract synthesis, validate:
     - `researchQuestion` is present.
     - `previousChapters` contains at least one body chapter with content.
   - Only keep the generic `question.trim().length < 3` guard for normal Legal QA, case summary, pleading analysis, and early academic steps that really need user text.

2. **Make frontend requests impossible to send an empty academic question**
   - In `LegalQAChat.tsx`, compute one explicit `requestQuestion` for academic writes:
     - use `effectiveResearchQuestion` for all academic writing steps;
     - never depend on the visible textarea for conclusion/intro/abstract.
   - For `writeCurrentChapter`, pass a fallback `researchQuestion: researchQuestion || outline-extracted question || question` if needed.

3. **Fix the chapter-save index bug for stale React state**
   - The response save currently writes to `updatedChapters[currentChapter]` after an async request. If the selected chapter changes while the request is running, the result can be saved into the wrong chapter.
   - Save to `extraBody.chapterIndex` when provided. This is important for `סיכום ומסקנות`, because it is selected explicitly from the chapter list.

4. **Finish button hardening**
   - Add `type="button"` to the remaining academic wizard/outline/checkpoint buttons that still omit it. This avoids accidental submit behavior documented in React/HTML (`button` defaults to `submit` inside forms).

5. **Validation**
   - Search confirms the old generic Hebrew toast does not exist anywhere except a comment.
   - Confirm `write_conclusion` can no longer hit a generic typed-text validation path.
   - Confirm the only conclusion-specific blocker is the intended message: `ניתן לכתוב סיכום רק לאחר שנכתב לפחות פרק גוף אחד.`