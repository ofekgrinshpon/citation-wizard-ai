

# V2 Infrastructure: Legal Source Database + RAG Pipeline

## Overview
Build a two-layer legal knowledge system: (1) a structured database of Israeli legal sources (statutes, case law, academic literature) and (2) a vector embeddings pipeline for semantic search over legal text. The Legal QA edge function will query this local knowledge base first, using Perplexity only as a fallback for sources not yet indexed.

## Architecture

```text
User Question
     │
     ▼
┌─────────────────────┐
│  legal-qa function   │
│                     │
│  1. Embed question  │──► pgvector similarity search
│  2. Local DB match? │──► verified_sources + legal_documents
│  3. If gaps remain  │──► Perplexity (fallback only)
│  4. Gemini structure│──► format answer + footnotes
└─────────────────────┘
```

## Changes

### 1. Database: `legal_documents` table (migration)
New table to store full-text legal content with vector embeddings:
- `id` (uuid, PK)
- `source_type` (text): legislation, caselaw, book, article, international
- `title` (text): law name, case name, book title
- `content` (text): full text or relevant excerpts
- `citation` (text): formatted citation per Uniform Citation Rules
- `metadata` (jsonb): year, case number, publisher, volume, page, S.H./K.T. ref
- `embedding` (vector(768)): text embedding for semantic search
- `source_url` (text, nullable): link to Nevo/official source
- `created_at`, `updated_at` timestamps
- RLS: public SELECT, admin-only INSERT/UPDATE/DELETE
- Enable pgvector extension

### 2. Database: `legal_document_chunks` table (migration)
For long documents, store chunked text with embeddings:
- `id` (uuid, PK)
- `document_id` (uuid, FK to legal_documents)
- `chunk_index` (int)
- `content` (text): chunk text (~500 tokens)
- `embedding` (vector(768))
- RLS: public SELECT, admin-only writes

### 3. Edge Function: `embed-legal-source` (new)
Accepts a legal document (text + metadata), chunks it, generates embeddings via Lovable AI Gateway, and inserts into both tables.
- Auth: admin-only (check user_roles)
- Chunking: ~500 token windows with 50-token overlap
- Embedding model: use Lovable AI Gateway (google/gemini-2.5-flash for text embedding or a dedicated embedding endpoint)

### 4. Edge Function: `search-legal-sources` (new)
Semantic search endpoint:
- Takes a question string
- Generates embedding for the query
- Performs pgvector cosine similarity search on `legal_document_chunks`
- Returns top-K matching chunks with their parent document citations
- Auth: authenticated users only

### 5. Update `legal-qa` edge function
Modify the existing flow:
1. First call `search-legal-sources` logic internally (embed question → pgvector search)
2. If sufficient high-quality local matches found (similarity > 0.75), use those as the primary context
3. If local results are insufficient, fall back to Perplexity search (current behavior)
4. Pass combined context to Gemini for answer structuring
5. Tag each footnote with `source: "local"` or `source: "perplexity"` so the frontend can show provenance

### 6. Admin UI: Source ingestion page
Add an admin-only section (in existing Admin page) for:
- Pasting legal text + metadata to ingest into the database
- Bulk import from CSV (law name, citation, text, type)
- View ingested documents count by category
- Re-embed existing verified_sources entries

### 7. Frontend: Source provenance indicator
In `LegalQAChat.tsx`, show a small badge next to each footnote:
- Green dot = sourced from local verified database
- Gray dot = sourced from Perplexity search

## Migration SQL Summary
1. Enable pgvector: `CREATE EXTENSION IF NOT EXISTS vector`
2. Create `legal_documents` with vector column
3. Create `legal_document_chunks` with vector column and FK
4. Create similarity search function: `match_legal_chunks(query_embedding vector(768), match_threshold float, match_count int)`
5. RLS policies for both tables

## Implementation Order
1. Database migrations (pgvector + tables + search function)
2. `embed-legal-source` edge function
3. `search-legal-sources` edge function
4. Update `legal-qa` to use local search first
5. Admin ingestion UI
6. Frontend provenance badges

