# Fix: editors placed before the book title in "מאמר בספר" citations (rule 24.11)

## What went wrong

For the query `אורי אהרונסון, חוק הלאום בראי חוקי־היסוד האחרים` the system produced:

```text
... "חוק הלאום בראי חוקי-היסוד האחרים" ידידיה צ' שטרן, יובל שני עורכים ספר הפרשנות ... 79 (2023).
```

The editor names were dropped into the **book-author slot** (which sits *before* the book title) instead of the **editor slot** (which sits *inside the parentheses*, before the year). Correct output:

```text
... "חוק הלאום בראי חוקי-היסוד האחרים" ספר הפרשנות ... 79 (ידידיה צ' שטרן, יובל שני עורכים 2023).
```

Rule 24.11 keeps `שם מחבר הספר` (an actual authored book, e.g. פרידמן וכהן **חוזים**) before the title, while `שם העורך` (rule 23.7) belongs in the trailing parentheses with the edition/translator/year. The edited-volume case has no book author at all.

## Fix

Two layers, both inside the uniform-citation function (`supabase/functions/citation-chat/index.ts`), plus a shared deterministic guard.

### 1. Prompt hardening (rule 24.11 block)

- Add an explicit contrast rule: a name followed by `עורך/עורכת/עורכים/עורכות` is **never** a book author and must appear only inside the parentheses before the year; the book-author slot is used only for a single-authored/co-authored book (like the `אריאל פורת ... חוזים כרך ג` example).
- For edited collections (`ספר ...`, `בתוך`, presence of editors), state that the book-author slot must stay empty.
- Add a wrong/right example pair using exactly this case so the model has a negative exemplar.

### 2. Data-mapping guard in the article-in-book hint

Where the search result is rendered into the `נתוני מאמר בספר` hint block: if `bookAuthor` contains an editor marker (`עורך/עורכת/עורכים/עורכות`), move that value into the `עורך` field and leave `מחבר הספר` empty, so the model never sees editors labelled as book author.

### 3. Deterministic post-validator (belt and braces)

Add an `article_in_book` normalisation to the shared validator (`supabase/functions/_shared/articleCitationValidator.ts`, reused by the chapter router):

- Detect a segment matching `<names> עורכ(ים|ות|ת|)` that appears **between the closing quote of the article title and the book title / start page**.
- Remove it from that position and splice it into the trailing parentheses immediately before the year — creating the parentheses if the citation only has `(2023)`.
- Idempotent: no change when the editor phrase is already inside the parentheses.

## Validation

Re-run the reported query plus three regression inputs:

- `אורי אהרונסון, חוק הלאום בראי חוקי־היסוד האחרים` → editors inside parentheses.
- `עידו קטרי, על צומת דרכים` → matches the rulebook example.
- `אריאל פורת, חוזים אחידים` → real book author stays **before** the title (no false move).
- One journal-article input → unchanged (no regression on rule 24 path).

## Technical notes

- No schema or UI changes; edits confined to the citation prompt, the hint builder, and the shared validator.
- The validator change also benefits academic-chapter footnotes routed through `chapterCitationRouter.ts`.
