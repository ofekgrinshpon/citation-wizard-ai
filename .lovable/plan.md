

## Root cause
`verify-case-fulltext` fetched a Supreme Court **DOCX download URL** (`...&type=4`) and treated the response as HTML — it stripped tags from binary ZIP bytes, producing 134K chars of unreadable garbage that passed the 3000-char threshold. The AI received noise, so every field came back as "(לא צוין בפסק הדין)". The header rendered correctly only because metadata came from Perplexity's JSON, not from the document.

The local ingestion function (`apify-ingest-cases`) already solves this with `fflate` DOCX extraction. The verify function never got that treatment.

## Fix — `supabase/functions/verify-case-fulltext/index.ts`

Add proper binary handling to the external-retrieval branch (lines 189–222):

1. **Detect content type** from response `Content-Type` header AND URL hints (`.docx`, `.pdf`, `type=4`, `type=3`, `Download?`).
2. **DOCX path** — use `fflate` (already proven in `apify-ingest-cases`) to unzip and extract `<w:t>` runs from `word/document.xml`. Same code, copy-pasted.
3. **PDF path** — call the existing `convert-doc` edge function (which the project already uses for ingestion) by POSTing the binary, OR skip and fall through to "not found" if convert-doc isn't suitable for inline use. Simpler: skip PDFs in this first pass, log it, fall through.
4. **HTML path** (current behavior) — keep, but only when the response actually looks like HTML (`text/html` or starts with `<!DOCTYPE`/`<html`).
5. **Sanity gate** — after extraction, verify the result contains a reasonable proportion of Hebrew characters (≥ 5% of chars in the `\u0590-\u05FF` range). If not, treat as failed extraction → fall through to "not found" instead of returning garbage.

## Fix — `supabase/functions/legal-qa/index.ts` (defense in depth)

Add the same Hebrew-ratio sanity check on `verify.fullText` before sending to Gemini (around line 740). If the text fails the check, return the same refusal message as `source === "none"`. This prevents future regressions from any other extraction path.

## Out of scope
- PDF extraction (defer — needs convert-doc integration; for now, PDF-only sources fall through to refusal, which is correct strict behavior).
- Improving Perplexity's URL selection to prefer HTML viewer pages over download endpoints (would require prompt changes; the binary handling above makes it unnecessary).
- Any UI changes — refusal already renders correctly.

## Files touched
- **Edit** `supabase/functions/verify-case-fulltext/index.ts` — add `fflate` import, content-type detection, DOCX extraction, Hebrew-ratio gate.
- **Edit** `supabase/functions/legal-qa/index.ts` — Hebrew-ratio guard on returned `fullText`.
- **Deploy** both functions.

## Expected outcome
For the Supreme Court case the user just tried (`גילון נ' ממשלת ישראל`), the external DOCX download will be properly unzipped → real Hebrew text reaches Gemini → the report fills in עובדות / טענות / דעות / הכרעה / הלכה from actual judgment content instead of placeholders. If extraction still fails, the user sees the proper "upload the file" refusal instead of an empty skeleton report.

