

## Goal
Fix the Bibliography Generator so Hebrew journal articles are formatted per Rule 24 instead of being returned in a book-shape with the journal name dropped. Concrete failure: `נטע ברק-קורן, חני לרנר ותרצה קלמן "הקמת אסיפה מכוננת לפתרון המשבר החוקתי בישראל" משפטים נו ...` came back as `נטע ברק-קורן, חני לרנר ותרצה קלמן הקמת אסיפה מכוננת לפתרון המשבר החוקתי בישראל (כרך נו) (2002)` — no quotes around the title, no journal name (משפטים), `(כרך נו)` instead of bare `נו`, no opening page, wrong year format.

## Root cause
In `supabase/functions/bibliography-lookup/index.ts`, the Perplexity system prompt mentions the article shape in a single line (`מחבר "שם המאמר" כתב עת כרך עמוד (שנה)`) but doesn't enforce: required quotation marks around the title, required journal name, required page number, the prohibition on `(כרך X)`, or the Hebrew-year requirement. Sonar collapses the article into a book-style citation when the journal name isn't already in the user's input. There is also no post-validation, so the broken citation is returned as `status: "ok"` and the user only sees the result after it lands in step 2 — without any warning chip or `[חסר: ...]` placeholder pointing at what's missing.

## Fix

### 1. Harden the Perplexity prompt — `supabase/functions/bibliography-lookup/index.ts`
Rewrite `PERPLEXITY_SYSTEM` to make the article (Rule 24) shape explicit and strict:
- Title MUST appear inside straight quotation marks `"..."`.
- Journal name (משפטים, עיוני משפט, הפרקליט, מחקרי משפט, …) is mandatory and must appear right after the title, unquoted.
- Volume is a bare Hebrew letter or digit (e.g. `נו`, `מח`, `12`) — NEVER wrapped in `(כרך X)`.
- Opening page number is mandatory.
- Year is in Hebrew with `ה` prefix in parentheses, e.g. `(התשפ"ה)` — Gregorian year only when Hebrew is genuinely unknown.
- If any required component cannot be verified, insert `[חסר: שם כתב העת]` / `[חסר: עמוד פתיחה]` / `[חסר: שנה]` instead of silently dropping it or substituting a guessed value.
- Add a worked example for the משפטים article so Sonar mirrors the correct shape:
  `נטע ברק-קורן, חני לרנר ותרצה קלמן "הקמת אסיפה מכוננת לפתרון המשבר החוקתי בישראל" משפטים נו 1 (התשפ"ה).`
- Apply the same "quotes + journal + bare volume + page + Hebrew year" rule to English articles (Rule 24 English equivalent).

### 2. Post-lookup article validator — same edge function
After `callPerplexity` returns, run a small validator on `result.citation`:
- If it looks like an article candidate (starts with a Hebrew or English author and contains a Hebrew journal hint OR the user's input already mentioned `משפטים|עיוני משפט|הפרקליט|מחקרי משפט|כתב[\s-]עת`), assert that the citation contains `"…"` around a title and a recognisable journal token.
- If quotes are missing, wrap the segment between author block and journal token in straight quotes.
- If the citation contains `(כרך X)`, strip the wrapper so the volume becomes bare `X`.
- If the journal name is absent but the user's `rawSource` contained one, splice it back in, or substitute `[חסר: שם כתב העת]`.
- If opening page is absent, append `[חסר: עמוד פתיחה]` after the volume.
- These transformations are conservative — they never invent journal names, only restore tokens already present in the user's raw input or insert explicit `[חסר: …]` placeholders.

### 3. Surface the warning in step 2 — `src/components/BibliographyGenerator.tsx`
The review row already flags `[חסר:` strings via `stats.needsFix` (line 275) and the inline warning chip. No structural change. Verify the chip text reads "חסרים פרטים — תקן ידנית או חפש שוב". This means once the validator inserts placeholders, the user sees the row highlighted in step 2 instead of pushing a silently-broken article into step 3.

### 4. No DB / no client-classifier change
Classification of `literature` already wins for `"…"` + journal + volume thanks to the recent `looksLikeHebrewArticle` pre-check, so once the validator adds the missing quotes/journal the article also lands under **ספרות משפטית** automatically.

## Out of scope
- Replacing Perplexity with a dedicated journal-metadata API (e.g. RAMBI, NLI). Possible follow-up if the validator still flags too many entries.
- Adding משפטים / עיוני משפט volume-to-year tables to auto-fill Hebrew years.
- Changes to the 3-step wizard, disambiguation flow, or verified-source priority.

## Outcome
- `נטע ברק-קורן, חני לרנר ותרצה קלמן "הקמת אסיפה מכוננת לפתרון המשבר החוקתי בישראל"` pasted by the user now returns with title in quotes, `משפטים` present, bare volume `נו`, opening page (or `[חסר: עמוד פתיחה]`), and Hebrew year — and lands under **ספרות משפטית** in step 3.
- If Sonar still can't supply the page or journal, the row is flagged in step 2 with explicit `[חסר: …]` placeholders so the user fixes it before commit instead of seeing a silent book-shaped citation.
- Existing book and case-law lookups are unaffected — the validator only triggers on article-shaped candidates.

