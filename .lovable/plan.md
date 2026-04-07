

# Add Notebook Uploads to Knowledge Base

## Concept
Law school notebooks are valuable **context material** — they contain distilled analysis, case summaries, and legal principles. The AI will use them to **reason better** but will cite the actual primary sources (statutes, cases, books) mentioned within them, not the notebooks themselves.

## Changes

### 1. Add "notebook" source type
In `LegalDocumentIngestion.tsx`, add a new source type:
- `{ value: "notebook", label: "📓 מחברת לימודים" }`

### 2. Update `legal-qa` edge function prompt
In the Gemini structuring prompt (step 4), add instructions:
- "Sources of type 'notebook' are study notes — use them for background knowledge and understanding, but do NOT cite them in footnotes. Instead, cite the primary sources (statutes, cases, books) that the notebook discusses."
- In the local context builder (step 1), tag notebook chunks with `[מחברת לימודים – לרקע בלבד]` so the LLM knows not to cite them directly.

### 3. Update `match_legal_chunks` behavior
No SQL changes needed — notebooks are already stored in `legal_documents` and chunked into `legal_document_chunks`. The vector search will naturally return relevant notebook chunks alongside primary sources.

### 4. Admin UX improvement
When "notebook" is selected as source type in the ingestion form:
- Show a helper note: "מחברות לימודים משמשות כרקע בלבד — ה-AI ישתמש בתוכן כדי להבין טוב יותר אך יצטט רק מקורות ראשוניים"
- Make citation field optional (notebooks don't have formal citations)
- Auto-generate a citation like "מחברת לימודים: [title]"

## Result
Admins can upload PDF/DOCX notebook files. The RAG pipeline retrieves relevant notebook passages to enrich the AI's understanding, while footnotes continue to cite only primary legal sources.

