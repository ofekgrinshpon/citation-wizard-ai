

# Legal Q&A Feature (V1) — Implementation Plan

## What This Builds
A new "שאלה משפטית" section where users ask legal questions and receive structured Hebrew answers with inline superscript footnote numbers. Footnotes cite real laws, case law, and academic sources found via Perplexity search and formatted by Lovable AI.

## Changes

### 1. Edge Function: `supabase/functions/legal-qa/index.ts`
- Auth gate (JWT validation via `getClaims`)
- Step 1: Send user question to **Perplexity (sonar-pro)** with a Hebrew legal search prompt targeting Israeli + international sources
- Step 2: Pass the Perplexity results + question to **Lovable AI (gemini-2.5-flash)** with a system prompt that enforces:
  - Structured Hebrew answer with superscript numbers (¹²³)
  - Only cite sources Perplexity actually found
  - Tool calling to extract structured JSON: `{ answer: string, footnotes: [{ number, citation, source_type }] }`
- Returns structured JSON (non-streaming, needs complete footnotes)
- Handles 429/402 errors from AI gateway

### 2. Config: `supabase/config.toml`
- Add `[functions.legal-qa]` block with `verify_jwt = false`

### 3. New Page: `src/pages/LegalQA.tsx`
- RTL layout with `GeometricBackground` (matching auth pages)
- `AppSidebar` on the right
- Textarea for the legal question
- Submit button: "שאל שאלה משפטית"
- Answer area rendering:
  - Hebrew text with superscript footnote numbers
  - "הערות שוליים" section at bottom with numbered citations
- Loading skeleton during API call
- Copy button (answer + footnotes)
- Disclaimer banner: "תשובות ReLex הן בגדר עזר בלבד ואינן מהוות ייעוץ משפטי"
- Auth guard (redirect to `/auth` if not logged in)

### 4. Route: `src/App.tsx`
- Add `/legal-qa` route pointing to `LegalQA` page

### 5. Navigation: `src/components/AppSidebar.tsx`
- Add "⚖️ שאלה משפטית" link navigating to `/legal-qa`, placed above "מקורות מאומתים"

## Technical Details

**Perplexity prompt** searches for: Israeli statutes, court decisions, academic articles, and international sources relevant to the question. Uses `sonar-pro` for multi-step reasoning with citations.

**Lovable AI system prompt** enforces:
- Answer in Hebrew with numbered superscripts
- Each footnote must reference a real source from the Perplexity results
- Source types: `legislation`, `caselaw`, `book`, `article`, `international`
- `[missing:...]` protocol for uncertain data

**Structured output** via tool calling ensures reliable JSON parsing of the answer and footnotes array.

