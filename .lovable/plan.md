## You're right — conclusion has no question box

The conclusion step has no input field by design. It's a "כתוב סיכום" button that should synthesize the body chapters that already exist. The user should never be asked to type anything.

## The bug

`src/components/LegalQAChat.tsx` line 1089–1094:

```ts
const handleAcademicSubmit = async (academicStep: string, extraBody?: ...) => {
  const q = question.trim();
  if (!q && academicStep !== "write_chapter") {
    toast.error("יש להזין טקסט.");
    return;
  }
```

The empty-text guard exempts only `write_chapter`. So when the conclusion button fires `handleAcademicSubmit("write_conclusion")` with an empty `question` field (which is correct — there's no input to type into), the guard rejects it before the request is ever sent.

The body builder a few lines below already falls back correctly: `question: q || researchQuestion`. So once we get past the guard, the backend receives the saved research question + previous chapters and runs the new light synthesis path we wired up earlier.

## Fix (frontend, one edit)

In `src/components/LegalQAChat.tsx` ~line 1090, replace the guard with:

```ts
const isPaperLevelSynthesis =
  academicStep === "write_chapter" ||
  academicStep === "write_introduction" ||
  academicStep === "write_conclusion";

if (!q && !isPaperLevelSynthesis) {
  toast.error("יש להזין טקסט.");
  return;
}

// Defensive: synthesis steps need a saved research question
if (isPaperLevelSynthesis && !q && !researchQuestion?.trim()) {
  toast.error("שאלת המחקר חסרה — חזור לשלב ניסוח שאלת המחקר.");
  return;
}
```

That's it. No backend changes — the routing fix from the previous turn (light synthesis path for `write_introduction` / `write_conclusion`) stays as is, and the HNSW index is already built.

## Files touched

- `src/components/LegalQAChat.tsx` — guard at ~line 1090.

## Out of scope

- No backend, prompt, wizard-order, or styling changes.
- No billing change (still 8 credits).
