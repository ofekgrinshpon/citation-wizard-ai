# Fix: literature titles containing "חוק" misclassified as חקיקה ראשית

## What happens today

For the input `אורי אהרונסון חוק הלאום בראי חוקי היסוד האחרים` the type is decided by the regex classifier only:

- `detectSourceType` (src/data/abbreviations.ts, line 382) matches `חוק ` anywhere in the string and returns `primary_legislation`. The earlier `חוק־יסוד` rule doesn't fire because the text has `חוקי היסוד` (plural, no hyphen).
- `shouldUseLLMClassifier` (src/lib/sourceTypeClassifier.ts) then returns `false` for `primary_legislation` as soon as `/חוק\s+\S/` matches, so the Gemini classifier is never asked.

Result: the regex wins with a false positive, and only the manual "מאמר שפורסם בספר" override produces the right citation.

## Fix — position-based strength, not year-based

The distinction is **where** the statute marker appears, not whether the input is formally formatted. Informal statute inputs without a year stay legislation.

### 1. Strong statute signal (never overridden)

Classification stays `primary_legislation` / `basic_law` when any of these hold:

- the input **starts** with `חוק`, `חוק יסוד`, `חוק-יסוד`, `חוק־יסוד`, `פקודת`, or `תקנות` (leading quotes/whitespace ignored);
- the input contains a Hebrew statute year (`התשל"ג-1973`, `תש"ן-1990`, …);
- the input contains `נוסח חדש` / `נוסח משולב`;
- the input matches a known statute/basic-law name pattern already in the abbreviations data.

No year, hyphen, colon, or official title is required. `חוק הלאום`, `חוק יסוד הלאום`, `חוק החוזים`, `פקודת הנזיקין` all stay legislation. Basic-law routing is widened so `חוק יסוד ...` (spaced, no hyphen/colon) is recognized as `basic_law`, not just `חוק-יסוד`.

### 2. Weak mid-title mention

If `חוק` / `פקודת` / `תקנות` appears **only later inside a longer title** and none of the strong signals above hold, the legislation match is marked **weak** — the regex still returns a legislation type as its best guess, but the result carries a weak flag instead of being treated as final.

### 3. Literature-shape signal

Detect: a Hebrew personal-name prefix (2–3 Hebrew words) followed by a longer descriptive title, with no docket (`\d+/\d+`), no statute year, no URL, and not starting with a statute marker. When this fires and the legislation match is weak, the input is treated as scholarship-leaning and routed to the LLM classifier (falling back to book/article/article-in-book from the existing literature rules if the LLM is unavailable).

### 4. LLM override rule

`shouldUseLLMClassifier` stops short-circuiting on `/חוק\s+\S/`; it short-circuits only on the **strong** statute signals from step 1. In `resolveSourceType`, the ambiguous set is widened to include *weak* `primary_legislation` / `basic_law`, and an LLM result with confidence ≥ 0.7 may override it. Strong statute matches are never sent for override.

### 5. Classifier prompt

Sharpen `supabase/functions/classify-source/index.ts`: an author name followed by a descriptive title that merely mentions a statute (e.g. `אורי אהרונסון חוק הלאום בראי חוקי היסוד האחרים`) is scholarship — article / article-in-book / book. An input that *is* the statute name (`חוק יסוד הלאום`, `חוק-יסוד: ישראל — מדינת הלאום של העם היהודי`, `חוק החוזים`) is legislation/basic law, even without a year.

## Validation matrix

Add a test file covering both sides.

Literature / scholarship expected:

- אורי אהרונסון חוק הלאום בראי חוקי היסוד האחרים
- דניאל פרידמן נער לפי שנות החקיקה הישראלית החדשה
- אהרן ברק פרשנות במשפט
- ברק מדינה דיני זכויות האדם בישראל
- יצחק זמיר הסמכות המינהלית

Legislation / basic law expected:

- חוק הלאום
- חוק יסוד הלאום
- חוק יסוד ישראל מדינת הלאום
- חוק-יסוד: ישראל — מדינת הלאום של העם היהודי
- חוק יסוד כבוד האדם וחירותו
- חוק-יסוד: כבוד האדם וחירותו
- חוק החוזים
- חוק החוזים (חלק כללי)
- חוק החוזים (חלק כללי), התשל"ג-1973
- פקודת הנזיקין
- פקודת הנזיקין [נוסח חדש]
- תקנות סדר הדין האזרחי

Plus regression: existing case-law inputs (docket + `נ'`) unchanged.

## Acceptance

- The Aharonson title is no longer classified as primary legislation.
- Informal statute/basic-law inputs still classify as legislation/basic_law.
- Strong statute-shaped matches cannot be overridden by the LLM.
- Weak mid-title `חוק` matches can be sent to the LLM.
- No regressions in existing legislation/case-law detection.

## Technical notes

- Changes confined to `src/data/abbreviations.ts` (strength-aware detection + basic-law widening), `src/lib/sourceTypeClassifier.ts` (strength gating and override rule), the prompt in `supabase/functions/classify-source/index.ts`, and a new test file under `src/test/`.
- `detectSourceType`'s existing signature keeps returning a `SourceType`; the weak/strong flag is exposed through a small companion helper so no caller breaks.
