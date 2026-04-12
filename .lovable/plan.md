

## Fix: Force AI to Prioritize Local Database Sources + Clean Up Notebooks

### Problem
The local database has 18,000+ documents (10,906 case law + 7,202 knesset research/law journal articles) and the text search **does find relevant matches** (tested: "צוואה בעל פה" returns 5 high-quality hits). However, the AI model ignores local sources and cites only Perplexity web URLs because:

1. Local source cards show raw citations like `"פרטי מסמך"` or article titles without proper legal citation format — the AI doesn't recognize them as authoritative
2. Perplexity cards show full URLs to nevo.co.il / knesset.gov.il which look more "official" to the model
3. The prompt says "prefer 8-12 quality references" but doesn't **mandate** using local sources first
4. The 20 notebook entries add noise (and you confirmed they're not official sources)

### Changes

**1. Database migration — delete notebooks**
```sql
DELETE FROM legal_document_chunks WHERE document_id IN (
  SELECT id FROM legal_documents WHERE source_type = 'notebook'
);
DELETE FROM legal_documents WHERE source_type = 'notebook';
```

**2. Edge function (`supabase/functions/legal-qa/index.ts`) — improve local source presentation and AI priority**

- **Increase local match count** from 5 to 10 — more candidates means more likely the AI finds something to cite
- **Improve source card format** — instead of raw `document_citation` (which is often just the title repeated), build a richer card: include document title, court, case number, source type label in Hebrew
- **Add explicit priority instruction to the system prompt**: tell the AI that local verified sources (marked `[מאומת]`) must be cited first, and web sources only fill gaps
- **Tag local sources** in the source catalog as `[מאומת]` so the AI visually distinguishes them

Specific prompt addition:
```
כלל חשוב: מקורות המסומנים [מאומת] הם מקורות שנמצאים במאגר המשפטי המקומי ועברו אימות.
תעדיף תמיד לצטט מקורות מאומתים על פני מקורות מהאינטרנט.
השתמש במקורות אינטרנט רק כהשלמה למקורות מאומתים, לא כתחליף.
```

**3. Better source card construction for case law**
For `caselaw` documents, build citation from structured fields: `case_number`, `court`, `decision_date`, `title` — instead of using the raw `document_citation` field which is often just the title.

For `knesset_research` / law journal articles, use the title and volume info from the citation field.

### Technical details

Files changed:
- `supabase/functions/legal-qa/index.ts` — search count increase, source card enrichment, prompt priority instruction
- Database migration — delete notebook documents and their chunks

### Expected outcome
After this change, when the text search finds local matches (which it does for most questions), the AI will be instructed to cite them first. The source cards will look like proper legal citations rather than raw titles, making the AI more likely to use them.

