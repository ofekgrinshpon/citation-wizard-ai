

## Idea
Knesset titles are broken (`פרטי מסמך`) but the **content** (`legal_documents.content`) was successfully ingested. The real document title almost always appears in the **first lines of the content itself** (cover page: "מרכז המחקר והמידע של הכנסת — [topic]" + a `<h1>` style heading + author + date).

So instead of scraping the Knesset website, we mine the title from the text we already have.

## Plan: Recover Knesset titles from chunk content

### Step 1 — Probe: read 5–10 sample chunks
Before writing the recovery function, fetch the first chunk (`chunk_index=0`) of 5–10 broken-title knesset docs to confirm the cover-page pattern. Look for repeating markers like:
- `נושא:` / `הנושא:`
- `מוגש ל-` / `מוגשת ל-` / `הוכן עבור`
- `כתיבה:` / `כתב:`
- `תאריך:`
- A bold line right after `מרכז המחקר והמידע`

Pick the most reliable extractor. If multiple patterns exist, try them in order.

### Step 2 — New edge function `recover-knesset-titles`
Admin-only. Loops in pages of 50:

```text
for each doc where source_type='knesset_research' AND title='פרטי מסמך':
  fetch first chunk content (chunk_index=0)
  try extractors in order:
    1. line after "נושא:" up to newline
    2. line after "מרכז המחקר והמידע של הכנסת" (skip 1–2 lines)
    3. first non-empty line ≥ 10 chars that isn't boilerplate
  if extracted title looks valid (5–200 chars, Hebrew, not boilerplate):
    UPDATE legal_documents SET
      title = extracted,
      citation = extracted + " (מרכז המחקר והמידע של הכנסת)" + (date if found),
      metadata = metadata || {recovered_title: true, recovery_method: '...'}
  else:
    UPDATE metadata = metadata || {broken_title: true}
```

Returns `{processed, recovered, flagged_broken, failed}`.

### Step 3 — Date extraction (bonus)
While reading the cover page, regex for `\b(ינואר|פברואר|...|דצמבר)\s+\d{4}` or `\d{1,2}\.\d{1,2}\.\d{4}` to enrich the citation with the publication date (rule-compliant for knesset research).

### Step 4 — Filter in `legal-qa/index.ts`
Independent of recovery success:
- Skip cards where `source_type='knesset_research'` AND (`title='פרטי מסמך'` OR `metadata.broken_title=true`).
- Log: `Filtered N broken-title knesset docs from source pool`.

This way:
- Recovered docs (good title) → flow through normally.
- Unrecovered ones → permanently filtered.

### Step 5 — Ingestion guard (one-line)
In `ingest-knesset-research/index.ts`, reject incoming docs whose title is `פרטי מסמך` / `ללא כותרת` / empty so the pile doesn't grow.

### Step 6 — Admin UI button (small)
Add a "Recover Knesset titles" button to the existing admin batch panel that calls the new function and shows a toast with the summary. Optional — can also be triggered via curl.

### Out of scope
- No external scraping (Knesset SharePoint is geo-blocked, per existing memory).
- No re-embedding (chunks stay; only `legal_documents.title` and `citation` change).
- No changes to rerank / fuzzy URL matcher.

### Expected impact
- ~Most of the 6,159 docs get a real, distinctive title → fuzzy URL matcher works → footnote #12-style placeholders disappear.
- Docs where extraction fails → flagged + filtered out, never cited.
- Total cost: 1 read per doc + 1 update per doc, no external API calls, no embeddings recomputed.

