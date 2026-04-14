

## Fix: Wrong year and page numbers in journal article citations

### Verified problem

The article "להיות או לא להיות" exists in the database with:
- `source_url`: `https://lawjournal.huji.ac.il/article/12/689` (689 = starting page)
- `volume`: "כרך לג" (vol. 33)
- **No author, no year** in metadata

The Perplexity enrichment query returned year 2003 (likely confusing vol. 33 with a year). The actual publication date is **02.02.2018** per the journal website. The source card also never includes the starting page, so the AI fabricates page references.

### Root causes
1. **No starting page in source card** — the URL encodes it (`/article/12/689`) but it's never extracted
2. **Perplexity enrichment returns wrong year** — the query is too vague; vol. 33 gets confused with 2003
3. **Year and page not included in richCitation** — even when enrichment succeeds, the year/page aren't added to the citation string sent to the AI

### Changes

**File: `supabase/functions/legal-qa/index.ts`**

**A. Extract starting page from source URL for journal articles (~line 383-398)**

Add page extraction from known URL patterns before building richCitation:

```typescript
// Extract starting page from URL patterns
// mishpatim: /article/{issue}/{page}
// Other journals may have similar patterns
let startPage = (meta.page as string) || "";
if (!startPage && m.source_url) {
  const pageMatch = m.source_url.match(/\/article\/\d+\/(\d+)/);
  if (pageMatch) startPage = pageMatch[1];
}
```

**B. Include year and page in richCitation (~line 395-397)**

After building the base citation with author/title/journal/volume, append page and year:

```typescript
richCitation = author ? `${author} "${m.document_title}"` : `"${m.document_title}"`;
if (journal) richCitation += ` **${journal}**`;
if (vol) richCitation += ` ${vol}`;
if (startPage) richCitation += ` ${startPage}`;
const year = (meta.year as string) || "";
if (year) richCitation += ` (${year})`;
```

This produces: `רונן פרי "להיות או לא להיות..." **משפטים** כרך לג 689 (2018)` — giving the AI the correct data.

**C. Improve Perplexity enrichment query (~line 328)**

Make the query more specific to avoid volume/year confusion:

```
מצא את שם המחבר ושנת הפרסום של המאמר האקדמי הישראלי: "${article.document_title}". 
המאמר פורסם בכתב העת ${journalName || ""} ${volume || ""}.
החזר רק בפורמט: מחבר: [שם], שנה: [שנה לועזית בת 4 ספרות]
```

Also pass the journal name and volume into the enrichment query to provide context and reduce hallucination.

**D. Add prompt rule about page accuracy (~after existing prompt rules)**

```
כלל קריטי – עמודים:
- כאשר מקור מהמאגר כולל מספר עמוד פתיחה, השתמש בו בדיוק. אל תמציא מספרי עמודים.
- ב"שם, בעמ' X" — ציין מספר עמוד רק אם אתה יודע בוודאות שהעמוד קיים במאמר. אם אינך בטוח, כתוב "שם" בלבד ללא הפניה לעמוד ספציפי.
```

### Technical details
- All changes in `supabase/functions/legal-qa/index.ts`
- Page extraction uses existing URL patterns from the mishpatim journal
- Enrichment query includes journal context to prevent year confusion
- Redeploy Edge Function `legal-qa`

