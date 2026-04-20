

Let me explore the relevant files before planning.
<lov-tool-use id="toolu_vrtx_0178suaK4EbwsyVYuP8GSyu5" name="code--view" integration-id="code" data="{\"file_path\": \"src/pages/LegalQA.tsx\", \"lines\": \"1-100\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01X7y39TVwFZYr4E8otHgHEW" name="code--search_files" integration-id="code" data="{\"query\": \"task_mode|taskMode\", \"include_patterns\": \"src/**/*.tsx,src/**/*.ts,supabase/functions/**/*.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_011XA3e39rJpAg1br9coTKRU" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/legal-qa/index.ts\", \"lines\": \"1-80\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01SszvUyLfpBFxC3ghbfTNgn" name="code--search_files" integration-id="code" data="{\"query\": \"task_mode|taskMode|סיכום פסיקה|case_summary\", \"include_patterns\": \"src/**/*.tsx,src/**/*.ts,supabase/functions/**/*.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01RaAwUt8W4JNoomZkWbgpWa" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/legal-qa/index.ts\", \"lines\": \"1-120\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_016fWAr6yTr1rGTjZYTkFUeL" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/legal-qa/index.ts\", \"lines\": \"200-260\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01SXHiB3ii9jiePkP2vFcnBq" name="code--view" integration-id="code" data="{\"file_path\": \"src/components/LegalQAChat.tsx\", \"lines\": \"300-500\"}">
</lov-tool-use>
I have enough context. Let me check the case_law_search function and how the existing `case_summary` mode flows through to understand what already exists vs needs adding.
<lov-tool-use id="toolu_vrtx_017GuNVuaJT6JYnRndnaayq6" name="code--search_files" integration-id="code" data="{\"query\": \"case_summary|case-law-search\", \"include_patterns\": \"supabase/functions/legal-qa/index.ts,src/components/LegalQAChat.tsx\"}">
</lov-tool-use>
I have enough. The `case_summary` task mode already exists with a basic structure. The user wants to make it strict: verify full text exists before summarizing, restructure the template, and add UI states.

<lov-plan>

## Goal
Make `case_summary` task mode in העוזר המשפטי strict: refuse to summarize unless the full case text is available (uploaded, in local DB, or fetched externally). Restructure the summary template. Show a "Verifying source..." UI state and render output as a structured report.

## Current state
- `LegalQAChat.tsx` already has a `case_summary` TaskMode with a "סיכום פסיקה" button, file upload, and conversational rendering.
- `legal-qa/index.ts` `getTaskModeInstructions("case_summary")` returns a loose template (עובדות / שאלה / הכרעה / רציו / השלכות) with no full-text gating — AI will summarize from snippets/abstracts today.
- `case-law-search` edge function already exists and uses Perplexity to find case metadata (parties, date, court, publication) but **does not return full text**.
- `legal_documents` has full-text `content` for ingested cases (פסיקה ≈ 11,480 docs per memory).

## Plan

### 1. New edge function: `verify-case-fulltext`
Source-of-truth gate. Given the user's input + uploaded text, returns one of three states:
- `available_user`: user uploaded/pasted enough text (≥ 1500 chars). Returns that text.
- `available_local`: matched a `legal_documents` row where `source_type IN ('case_law', 'case_law_database')` AND `length(content) ≥ 3000`. Returns full content + metadata (parties, court, date, case_number).
- `available_external`: Perplexity confirms case exists AND we can fetch full text from `source_url` (Nevo/court website). If retrievable → returns text. Otherwise → falls through.
- `not_found`: none of the above. Frontend will show the strict refusal message.

Matching logic for local DB:
- Extract case number pattern (`בג"ץ 1234/56` etc.) from input → exact match on `case_number` column.
- Fallback: full-text search on `title + citation` via existing `search_legal_chunks_text` filtered to case_law sources.

### 2. Update `legal-qa/index.ts` for `case_summary` mode
- **New short-circuit at top of handler** (before retrieval): when `taskMode === "case_summary"`, call `verify-case-fulltext` first.
  - If `not_found` → return immediately with `{ refusal: true, message: "פסק הדין אינו קיים במערכת ולא ניתן היה לאתר את הטקסט המלא שלו..." }` and skip Gemini entirely.
  - If found → inject the full case text as the primary `documentContext` (overriding/augmenting any uploaded files) and pass case metadata to the prompt.
- **Replace `getTaskModeInstructions("case_summary")`** with the new strict template:
  ```
  כותרת: מספר התיק | צדדים | (שנה)
  **עובדות** – עובדות רלוונטיות בלבד
  **טענות הצדדים** – תמצית טענות כל צד
  **השאלה המשפטית** – הסוגיה המרכזית
  **דעות השופטים** – פירוט נפרד לכל שופט (רוב/מיעוט/הסכמה), כולל מסגרת נורמטיבית והמבחנים
  **הכרעה** – התקבל / נדחה
  **ההלכה** – הכלל המחייב מדעת הרוב
  ```
- **No footnotes** in case_summary output: skip the `buildCitationInstructions()` block + footnote post-processing for this mode (the summary is grounded in the single source case, not citing external authorities).
- Add explicit anti-hallucination clause: "הסיכום מבוסס אך ורק על טקסט פסק הדין שסופק. אסור להוסיף מידע שלא מופיע בו."

### 3. Frontend updates in `LegalQAChat.tsx`
- **Refusal rendering**: when response has `refusal: true`, render a distinct alert card (yellow/warning style) with the strict Hebrew message + an "העלה קובץ" button that triggers the existing file picker. No "footnotes" / no "copy" actions.
- **"Verifying source..." state**: when `taskMode === "case_summary"` and `loading === true`, show a dedicated progress UI with three sequential steps:
  1. ⏳ בודק קלט משתמש
  2. ⏳ מחפש במאגר המקומי
  3. ⏳ מאתר טקסט מלא חיצוני
  Then → ✅ מסכם / ❌ לא נמצא. Drive via SSE step events emitted by the edge function (or simpler: a single "מאמת מקור..." spinner with the three steps shown statically; backend emits a single `source: "user"|"local"|"external"|"none"` field and the UI swaps to "מסכם..." once verified).
- **Structured report rendering**: when result returns and `taskMode === "case_summary"`, render via a new `<CaseSummaryReport>` component instead of the conversational `MessageBubble`:
  - Header card: case number + parties + year (from verified metadata)
  - Section cards for each `**...**` block parsed from the response
  - Source badge: "מקור: הועלה ע"י המשתמש" / "מאגר מקומי" / "אוחזר חיצונית"
  - Print/copy buttons styled as a report

### 4. Files touched
- **New**: `supabase/functions/verify-case-fulltext/index.ts` + `supabase/config.toml` entry (`verify_jwt = false`)
- **Edit**: `supabase/functions/legal-qa/index.ts` — short-circuit + new prompt + skip footnotes for case_summary
- **Edit**: `src/components/LegalQAChat.tsx` — refusal card, verifying-source progress UI, route to new report component
- **New**: `src/components/CaseSummaryReport.tsx` — structured report rendering

## Out of scope
- Changing other task modes (research / pleading_analysis / academic_writing).
- Ingesting more case law into the DB (relies on what's already there).
- Building a full Nevo/court HTML scraper — `available_external` will only succeed when the Perplexity-returned `source_url` returns retrievable plain text within a 10s timeout; otherwise we fall through to `not_found` (the strict prohibition kicks in).

## Expected outcome
- User picks "סיכום פסיקה" + types "בג"ץ 6427/02" → UI shows "מאמת מקור..." → if local DB has full text → strict structured report. If not and no upload → strict refusal card with the exact requested Hebrew message + upload prompt.
- Zero hallucinated case summaries — AI never sees a "summarize this case" prompt without grounded full text in context.

