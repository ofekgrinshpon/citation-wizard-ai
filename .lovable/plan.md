## Goal

Reframe the conclusion chapter as a **pure synthesis** of the body chapters: ~400–600 words (1–1.5 pages), reuses citations from the body via "לעיל ה״ש X", and runs **no new retrieval** and brings **no new sources**.

Today the conclusion still runs the full Deep pipeline (retrieval → claim map → drafter → Perplexity completion → critic), is sized 700–1300 words, and is allowed to mint new footnotes. That's why conclusions come out long and over-cited.

## Changes

### 1. `supabase/functions/legal-qa/academicProfiles.ts` — `conclusion` profile

Switch to a synthesis profile, mirroring `abstract`:

- `enableDeepPipeline: false`
- `inheritsFrom: null`
- `criticEnabled: false` (remove `criticMinCoverage`)
- All `qaGuard*` thresholds → `0`
- Add a comment block matching `abstract`'s describing the new role.

Credit cost stays at 8 (no billing change unless you want to lower it — flag in a question if you'd prefer).

### 2. `supabase/functions/legal-qa/index.ts` — routing

In the `isAbstractGeneration` gate (~line 2550), extend the synthesis branch to cover `write_conclusion`:

```ts
const isConclusionGeneration =
  taskMode === "academic_writing" && academicStep === "write_conclusion";
const isSynthesisOnly = isAbstractGeneration || isConclusionGeneration;
```

Then replace the three `isAbstractGeneration` checks in the shortcut block (skip local search, skip document context, pick `max_tokens`) with `isSynthesisOnly`. The final-user message stays generic (`question`) for conclusion — only abstract keeps its "כתוב את התקציר עכשיו…" override. Word-count guard at ~2876 stays abstract-only.

This makes the conclusion exit through the same lightweight path as `abstract` / `outline`: one LLM call, no retrieval, no claim map, no Perplexity, no critic.

### 3. `buildConclusionPrompt` (~line 1640) — tighten

Rewrite the constraints block:

- **Length**: "אורך מחייב: 400–600 מילים (1–1.5 עמודים)" (replaces the 700–1300 line).
- **No new sources**: add an explicit rule — "אסור בהחלט להציג מקור חדש שלא מופיע בפרקי הגוף שלמעלה. הסיכום אינו מביא ראיות חדשות."
- **Reuse via "שם" / "לעיל ה״ש X"**: add — "אם ברצונך לעגן טענה במקור שכבר צוטט בגוף — השתמש בהפניה חוזרת מקוצרת (לעיל ה״ש X / שם), לא בציטוט מלא חדש. עדיף בכלל לוותר על הערות שוליים אם הסינתזה ברורה."
- **Footnote target**: "0–3 הערות שוליים סך הכל, כולן הפניות חוזרות לפרקי הגוף."
- Keep the existing rules about "אל תחזור על המבוא", "אל תפתח טיעון חדש", "פרוזה רציפה ללא חלוקה פרק-אחר-פרק".

Optional: pass `body.footnoteOffset` / a list of body footnote numbers into the prompt so the model knows which `ה״ש X` numbers actually exist. (Skip unless you want it — body footnotes are already visible inside the chapter content.)

### 4. Nothing else changes

- `write_introduction` keeps the Deep pipeline and current envelope.
- `write_chapter` keeps the Deep pipeline.
- Frontend wizard, credit charging, footnote numbering, and the just-shipped background-resume flow all keep working — conclusion just returns sooner and shorter.

## Out of scope

- Reducing credit cost (ask if you want it).
- Touching introduction length / behavior.
- Hard regex enforcement of "no new sources" — the prompt rule + skipping retrieval is enough; if a model ignores it, we add a post-parse stripper later.

## Verification

After deploy, generate one conclusion on an existing paper and check:
- Word count ≤ ~650.
- Footnotes either empty or only "לעיל ה״ש …" / "שם".
- `qa_logs.metadata.profile_used_academic.step === "conclusion"` and no `chapter_engine` / `chapter_critic` / `statute_completion` keys (proves the lightweight path).
