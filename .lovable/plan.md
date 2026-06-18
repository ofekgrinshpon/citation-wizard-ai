## Goal

When the user generates a body chapter in "כתיבה אקדמית", the system first runs the academic source-search engine (the same one behind "חיפוש מקורות"), tailored to that specific chapter (title + flow tag + research question + thesis), and feeds the resulting ranked source pool into the chapter writer as the citation grounding. Intro / סיכום / תקציר stages do NOT trigger a search (they synthesize from already-written chapters).

As part of this work the chapter engine is taken out of the current 503 "offline" short-circuit so the new pipeline can actually run end-to-end.

## Behavior per chapter type

| Chapter role | Pre-search? | Search profile |
|---|---|---|
| body — הדין המצוי | yes | חקיקה + פסיקה מחייבת ראשונית, מיעוט מלומדים |
| body — ניתוח ביקורתי | yes | מלומדים ישראליים + פסיקה רלוונטית |
| body — משפט משווה | yes | מלומדים זרים (אנגלית) + חקיקה/פסיקה זרה |
| body — הדין הראוי | yes | מלומדים (כולל זרים) + דוחות ועדות/ממשלה |
| body — (untagged) | yes | תמהיל ברירת מחדל (הפרופיל הנוכחי של sources_only) |
| מבוא / סיכום / תקציר | **no** | משתמש רק בפרקי הגוף שכבר נכתבו |

## Architecture

```text
Client (LegalQAChat, write_chapter)
        │  chapter {title, flowTag, idx}, researchQuestion, thesis
        ▼
legal-qa  (academicStep = "write_chapter")
        │  1) build chapter-tuned query + role profile
        │  2) invoke shared sourcesForChapter() ──► reuses
        │       legal-research-v1 pipeline in sources_only mode
        │  3) receive SourcesOnlyPayload
        │  4) compose chapter prompt with:
        │       • flow-tag rules + academic tone rules
        │       • required citation pool (ranked sources)
        │       • coherence ledger from prior chapters
        │  5) stream chapter via Lovable AI gateway
        ▼
Client renders chapter + shows the source pool that grounded it
```

## Implementation steps

1. **Extract a reusable entry point for the search engine**
   - In `supabase/functions/legal-research-v1/`, expose a callable `runSourcesOnly({ question, profile, runId, userId })` that returns `SourcesOnlyPayload` without going through the HTTP handler.
   - `profile` controls retrieval: `{ allowForeign: bool, includeCaseLaw: bool, includeLegislation: bool, scholarshipWeight, maxSources }`.
   - Existing `index.ts` sources_only branch keeps working — it just calls this new function.

2. **Chapter→search bridge (new file)**
   - `supabase/functions/_shared/chapterSourceProfile.ts`
     - `profileForFlowTag(flowTag)` → returns the profile from the table above.
     - `buildChapterQuery({ researchQuestion, thesis, chapterTitle, flowTag, chapterExpansion })` → a focused Hebrew query string.

3. **Lift the chapter 503 in `supabase/functions/legal-qa/index.ts`**
   - Remove the `if (isChapterClassWrite) { ... 503 ... }` short-circuit (lines ~317-323) and remove the `CHAPTER_OFFLINE_*` UI banner activation path (keep the strings, but stop forcing it).
   - Add credit cost for `write_chapter` / `write_introduction` / `write_conclusion` (TBD — placeholder: chapter 8 credits, intro/conclusion 5 credits; ask the user if a different number is wanted before charging).

4. **`write_chapter` pipeline (in legal-qa)**
   - Inputs from client (already mostly present): `researchQuestion`, `outline`, `chapters` (with prior content + ledgers), `currentChapter`, `lastAcademicAction`.
   - Steps:
     1. `profile = profileForFlowTag(chapter.flowTag)`.
     2. `query = buildChapterQuery(...)`.
     3. `sources = await runSourcesOnly({ question: query, profile, runId, userId: user.id })`.
     4. Build the chapter system prompt: existing academic-tone block + flow-tag-specific guidance + a "required citation pool" section listing each source as `[Sn] display_citation — short reason — url`.
     5. Stream via Lovable AI gateway (`google/gemini-3-flash-preview`) with `streamText`, persist to `qa_logs` as today, write progress checkpoints.
     6. Return both the streamed chapter text AND `sources_used: SourceResult[]` so the client can display the grounding pool under the chapter.
   - `write_introduction` and `write_conclusion`: NO search step. They consume only prior chapter content + ledgers + research question (current contract).

5. **Client (`src/components/LegalQAChat.tsx`)**
   - Extend `ChapterData` with `sourcesUsed?: SourceResult[]` and persist it (DB column `chapters` is JSON, no migration needed).
   - After a chapter finishes streaming, render a collapsible "מקורות שעמדו בבסיס הפרק" panel using the same card layout as `LegalSourceSearchPanel` (extract its result-list into a shared `<SourceResultsList />` component).
   - No new top-level UI — the search is automatic, invisible to the user until the chapter is delivered.

6. **Credit + offline behavior**
   - If `runSourcesOnly` returns zero sources, still write the chapter but flag `low_grounding: true` and surface a small warning chip ("נכתב ללא בסיס מקורות חיצוני").
   - If the search engine itself errors, abort the chapter and refund credits (existing `refundAndPayload` path).

## Out of scope (explicitly)

- Per-chapter manual source picking UI / regeneration with edited pool. Can be a follow-up.
- Changing intro/summary/abstract generation logic.
- Changing the citation validation rules themselves.
- Touching the case_summary or research modes.

## Files touched

- `supabase/functions/legal-research-v1/index.ts` — extract `runSourcesOnly` helper, call it from the HTTP branch.
- `supabase/functions/legal-research-v1/lib/sourcesOnly.ts` — accept `profile` knobs (allowForeign / includeCaseLaw / includeLegislation / weights).
- `supabase/functions/_shared/chapterSourceProfile.ts` *(new)* — flow-tag → profile + query builder.
- `supabase/functions/legal-qa/index.ts` — remove chapter 503, add write_chapter pipeline with search step, credits, prompt composer, streaming response.
- `src/components/LegalQAChat.tsx` — extend `ChapterData`, send `flowTag` + `chapterExpansion` with write_chapter, render sources panel.
- `src/components/LegalSourceSearchPanel.tsx` → extract `SourceResultsList` for reuse (or move to `src/components/sources/SourceResultsList.tsx`).

## Open questions for build phase

1. Credit cost per chapter generation (search + write)?
2. Should the "low grounding" path block generation or proceed with a warning? (Plan currently: proceed + warn.)
3. Should foreign-language search be capped (e.g. max 5 English sources) to keep the prompt small?
