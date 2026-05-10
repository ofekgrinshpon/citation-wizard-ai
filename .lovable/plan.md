**Findings**
- The exact toast `יש להזין טקסט.` exists in only one place: `LegalQAChat.tsx` inside `handleAcademicSubmit`.
- That toast should only fire for early wizard steps (`suggest_topics`, `validate_question`, `propose_outline`). It should never fire for `write_conclusion`.
- Therefore, if clicking `סיכום ומסקנות` still shows it, the safest fix is to make the conclusion path completely bypass the generic typed-text guard, instead of relying on shared guard inference.

**Implementation plan**
1. Add an explicit helper/classifier for academic actions:
   - typed-input steps: `suggest_topics`, `validate_question`, early `propose_outline`
   - writing steps: `write_chapter`, `write_introduction`, `write_conclusion`, abstract generation
2. Refactor `handleAcademicSubmit` to use a `switch`/explicit branch so `write_conclusion` cannot reach the `יש להזין טקסט` branch under any state combination.
3. Add a dedicated `writeConclusion`/conclusion branch that uses:
   - saved `researchQuestion` or explicit `extraBody.researchQuestion`
   - completed body chapters as `previousChapters`
   - current chapter title/index only as metadata
4. Add `type="button"` to the academic chapter write button and other academic wizard action buttons to prevent accidental default submit behavior.
5. Keep the correct conclusion validation:
   - if no body chapter content exists, show `ניתן לכתוב סיכום רק לאחר שנכתב לפחות פרק גוף אחד.`
   - otherwise, proceed without requiring any textbox content.

**Why this keeps happening**
The current code still routes all academic actions through one shared submit guard. Even though the guard was improved, a stale/early academic action can still hit the typed-text branch. The fix is to structurally separate conclusion generation from typed-input validation so the conclusion is based only on already-written chapters.