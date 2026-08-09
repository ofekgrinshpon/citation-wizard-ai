# Fix: literature titles containing "חוק" misclassified as חקיקה ראשית

## What happens today

For the input `אורי אהרונסון חוק הלאום בראי חוקי היסוד האחרים` the type is decided by the regex classifier only:

- `detectSourceType` (src/data/abbreviations.ts, line 382) matches `חוק ` and returns `primary_legislation`. The earlier `חוק־יסוד` rule doesn't fire because the text has `חוקי היסוד` (plural, no hyphen).
- `shouldUseLLMClassifier` (src/lib/sourceTypeClassifier.ts) then returns `false` for `primary_legislation` as soon as `/חוק\s+\S/` matches, so the Gemini classifier is never asked.

Result: the regex wins with a false positive, and only the manual "מאמר שפורסם בספר" override produces the right citation.

## Fix

1. **Tighten the primary-legislation regex.** Require statute-shaped context instead of the bare `חוק ` / `פקודת ` prefix: a following `תשי"ז/התשע"ח`-style year, a `-19xx/-20xx` suffix, `נוסח חדש`, or the input starting with `חוק`/`פקודת`. A `חוק` appearing mid-sentence inside a longer title no longer forces the legislation branch.

2. **Add a literature-shape signal.** Detect the pattern "Hebrew personal name (2–3 words) followed by a title" with no docket, no statute year, no URL — a strong hint the input is a book/article/article-in-book rather than legislation, and route it away from the legislation branch.

3. **Let the LLM arbitrate the ambiguous case.** In `shouldUseLLMClassifier`, stop short-circuiting on `/חוק\s+\S/` when the statute-shaped signals from step 1 are absent. In `resolveSourceType`, widen the `ambiguous` set so an LLM result with confidence ≥ 0.7 can override a *weak* `primary_legislation`/`basic_law` guess (a statute-shaped match stays authoritative and is never overridden).

4. **Sharpen the classifier prompt** in `supabase/functions/classify-source/index.ts`: an author name followed by a descriptive title that merely mentions a statute (e.g. "חוק הלאום בראי חוקי־היסוד האחרים") is scholarship, not legislation; legislation inputs look like a statute name plus a Hebrew year.

## Validation

- `אורי אהרונסון חוק הלאום בראי חוקי היסוד האחרים` → article / article-in-book, and the auto-run output matches the manual "מאמר שפורסם בספר" result.
- `חוק החוזים (חלק כללי), התשל"ג-1973` → primary_legislation (unchanged).
- `פקודת הנזיקין [נוסח חדש]` → primary_legislation (unchanged).
- `חוק-יסוד: כבוד האדם וחירותו` → basic_law (unchanged).
- `אהרן ברק פרשנות במשפט` → book (unchanged).

## Technical notes

- Changes confined to `src/data/abbreviations.ts`, `src/lib/sourceTypeClassifier.ts`, and the classifier prompt in `supabase/functions/classify-source/index.ts`. No schema or UI changes.
- The LLM override stays conservative: it only applies where the regex signal is weak, so existing legislation and case-law detection is untouched.
