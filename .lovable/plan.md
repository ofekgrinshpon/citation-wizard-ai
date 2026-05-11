**What is happening**

The chapter is not being written because the request is being stopped before a valid `write_conclusion` request completes. A chapter only gets saved after `handleAcademicSubmit()` receives an AI answer and writes it into `chapters[targetIdx].content`. If the text-validation branch fires first, or the request is sent without usable `previousChapters`, the function returns early and that save block never runs.

**Do I know what the issue is?**

Yes. The current code has fixed part of the backend guard, but the conclusion flow still depends on live React state (`question`, `researchQuestion`, `chapters`, `currentChapter`) at click/runtime. For `סיכום ומסקנות`, that is fragile: the visible textarea can be empty, selected chapter state can drift, and `previousChapters` can be built from stale/empty state. When that happens, the flow aborts before the AI answer exists, so no chapter content is saved.

Also, the exact old text `יש להזין טקסט` no longer exists in the current source code outside the plan/comment, so if that exact text appears it means either an older client bundle is still running, or another generic submit/validation path is being triggered instead of the conclusion writer.

**Fix plan**

1. **Make conclusion generation independent of the visible textarea**
   - For `write_conclusion`, `write_introduction`, and abstract generation, build the request question only from the saved research question / outline fallback.
   - Never read `question.trim()` as a requirement for these writing steps.

2. **Snapshot chapter state at click time**
   - In `writeCurrentChapter`, capture:
     - selected chapter index,
     - selected title,
     - chapter role,
     - full `chapters` array,
     - saved `researchQuestion`,
     - `outline`.
   - Pass this snapshot into `handleAcademicSubmit()`.
   - Build `previousChapters` from the snapshot, not from possibly stale state.

3. **Guarantee `סיכום ומסקנות` receives body content**
   - For `write_conclusion`, filter the snapshot to written body chapters only.
   - If no body chapter has content, show only the correct blocker: `ניתן לכתוב סיכום רק לאחר שנכתב לפחות פרק גוף אחד.`
   - If body content exists, always send it as `previousChapters`.

4. **Save the returned answer to the exact selected chapter**
   - Continue using `extraBody.chapterIndex`, but prefer the snapshot index.
   - This prevents async drift from saving the answer into the wrong chapter or not visibly updating the conclusion.

5. **Remove remaining accidental submit paths**
   - Add `type="button"` to every remaining academic wizard button and raw button that lacks it.
   - This prevents a generic validation/send path from firing while the academic wizard is visible.

6. **Map backend synthesis errors to the right UI message**
   - `No previous chapter content available for synthesis` → body-chapter prerequisite message.
   - `Missing researchQuestion for academic synthesis` → missing research-question message.
   - Do not surface generic text-input errors for conclusion/intro/abstract.

7. **Add one targeted debug log**
   - Log the academic step, selected chapter title, number of written body chapters, and request `previousChapters.length`.
   - If anything still fails, the next browser snapshot will show exactly which branch stopped it.

<lov-actions>
  <lov-open-history>View History</lov-open-history>
</lov-actions>

<lov-actions>
<lov-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</lov-link>
</lov-actions>