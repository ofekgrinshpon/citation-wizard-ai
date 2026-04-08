

# Add Source Provenance Counter + Fix PDF Upload + Speed Up Multi-File Ingestion

## Three Issues to Address

### Issue 1: Source Provenance Counter (Local vs Perplexity)
The `legal-qa` edge function already returns `source: "local" | "perplexity"` on each footnote. We need to:

1. **Create a `qa_logs` table** to persist per-question stats:
   - `id`, `user_id`, `question` (truncated), `local_footnotes_count`, `perplexity_footnotes_count`, `total_footnotes`, `created_at`

2. **Update `legal-qa` edge function** to insert a row into `qa_logs` after generating the answer (using service role client, non-fatal).

3. **Add a stats card in Admin dashboard** (knowledge tab or analytics tab):
   - Query `qa_logs` to compute aggregate: total questions, % answered with at least one local source, average local vs Perplexity ratio
   - Display as StatCards: "📊 Total Questions", "🟢 % Local Sources", "🔴 % Perplexity Only"
   - Optionally a simple bar/pie chart showing the ratio over time

### Issue 2: PDF Worker Fails to Load
The error: `Failed to fetch dynamically imported module: .../pdf.js/5.6.205/pdf.worker.min.js`

The CDN path for version `5.6.205` doesn't have a compatible `pdf.worker.min.js` for dynamic import. Fix:
- Pin the worker to a known-working version (`4.8.69`) via CDN, or configure the worker inline using `pdfjs-dist/build/pdf.worker.min.mjs` bundled import
- Update `extractTextFromPdf` to set `workerSrc` to `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs` (a stable v4 release)
- Downgrade `pdfjs-dist` to `^4.8.69` in package.json for compatibility

### Issue 3: Slow Multi-File Upload
Currently files are uploaded **sequentially** with a 500ms delay between each, and each call to `embed-legal-source` generates embeddings (which takes ~5-10s per file). Fix:
- **Parallel uploads**: Process 3 files concurrently instead of one-by-one
- **Remove the artificial 500ms delay** between uploads
- **Show better progress**: Add a progress bar showing "3/10 uploaded" with estimated time
- **Skip embedding for batch uploads** (optional flag) — store documents with `null` embedding for text-search-only, and batch-embed later

## Technical Details

**New migration**: Create `qa_logs` table with RLS (admins can read, service role inserts).

**Files modified**:
- `supabase/functions/legal-qa/index.ts` — add qa_logs insert after response generation
- `src/components/admin/LegalDocumentIngestion.tsx` — fix PDF worker, parallelize uploads
- `src/pages/Admin.tsx` — add source provenance stats section
- `package.json` — downgrade pdfjs-dist to 4.8.69

