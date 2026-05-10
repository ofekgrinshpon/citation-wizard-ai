**Why it still happens**

The button path is correct: `כתוב פרק זה` calls `writeCurrentChapter()`, which calls `handleAcademicSubmit("write_chapter")`.

But the visible toast `יש להזין טקסט` can still appear when `handleAcademicSubmit` is entered with an empty main textarea and the runtime is using a stale guard or a non-body/synthesis call path. The current code already intends to exempt body chapter writing from textarea validation, so the safest fix is to make that exemption explicit and impossible to bypass for all writing-stage chapter buttons.

**Plan**

1. Add a dedicated helper that classifies academic write actions:
   - body chapter write
   - introduction synthesis
   - conclusion synthesis
   - abstract synthesis
   - early text-required steps

2. Change the empty-text guard so `יש להזין טקסט` is only possible for early wizard steps that genuinely require user input:
   - topic suggestions
   - question validation
   - outline proposal when no saved research question exists

3. In `writeCurrentChapter()`, pass the current chapter title/role explicitly into `handleAcademicSubmit`, so the submit handler does not depend on textarea state or stale inferred state.

4. Add a defensive fallback for body chapters:
   - If `question` is empty, use `researchQuestion` as the request question.
   - If `researchQuestion` is missing, show the clearer message: `שאלת המחקר חסרה — חזור לשלב ניסוח שאלת המחקר.`

5. Keep conclusion/introduction behavior unchanged:
   - conclusion reads completed body chapters
   - introduction can use the conclusion
   - no new backend, billing, prompt, or styling changes.