

## Fix: Reclassify Law Journal Articles and Add Source Type Validation

### Problem
1. ~1,000+ articles from כתב העת "משפטים" were ingested with `source_type = 'knesset_research'` instead of `'journal_article'` or `'literature'`. Many have garbage titles like "פרטי מסמך" or "תוכן עניינים".
2. The Legal QA retrieval engine has no mechanism to inspect or validate what kind of source a document is before presenting it to the AI.
3. The specific article "מזונות האשה בנישואין בטלים" by פנחס שיפמן is **not in the database** as its own document — it only appears as a reference within other documents' text.

### Proposed Changes

#### 1. Database: Reclassify journal articles (migration + data update)

**Step A — Identify journal articles** by scanning `knesset_research` documents whose content or title matches law journal patterns (e.g., contains "כרך", "כתב העת משפטים", academic author names, article-style titles with parenthetical volume references like "(כרך כ״ג)").

**Step B — Update `source_type`** from `'knesset_research'` to a new value `'journal_article'` for matched records. This distinguishes them from actual Knesset Research Center documents.

**Step C — Fix titles** for documents with generic titles ("פרטי מסמך", "תוכן עניינים") — extract the real article title from the first chunk's content using a pattern-based approach.

#### 2. Edge function: Add source type label for journal articles

**File: `supabase/functions/legal-qa/index.ts`**

- Add a branch for `source_type === 'journal_article'` in the source card builder (around line 320) to label them as "מאמר אקדמי" instead of "מחקר כנסת / חקיקה".
- Update the citation builder for journal articles to present them in proper academic citation format (author, title, journal, volume, page).

#### 3. Edge function: Add source metadata preview in context

Add a short "source fingerprint" to each source card's excerpt that includes:
- `source_type` (human-readable label)
- Document title
- First 100 chars of content

This gives the AI enough context to evaluate source relevance and type before citing it.

### Technical details

- The reclassification query will use pattern matching on content (e.g., `content ILIKE '%כתב העת משפטים%'` or title containing `(כרך ...)`) to identify journal articles.
- A database migration will add `'journal_article'` as a recognized source type value.
- The data update (via insert tool) will batch-update matching records.
- No schema changes needed — `source_type` is already a free text field.

### Files affected
- `supabase/functions/legal-qa/index.ts` — source card labeling and citation formatting
- Database data update — reclassify ~1,000 records from `knesset_research` to `journal_article`

