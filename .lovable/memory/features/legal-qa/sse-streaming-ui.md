---
name: SSE Streaming UI (StageProgressList)
description: Frontend SSE consumption for legal-qa — Fast+Deep research and academic write_chapter stream stage/draft_delta/post_processing/final events; StageProgressList renders live progress + draft caret; backend owns academic qa_logs inserts
type: feature
---

# SSE Streaming UI

## Backend contract (already deployed)

`legal-qa` SSE wrapper emits four named events:
- `stage` → `{ stage, status: "running"|"complete", label, detail? }` — one per pipeline step (frame, decompose, retrieve, rerank, source_pack, claim_map, drafter, anchor_pass, coverage_gap, statute_completion, footnote_validate)
- `draft_delta` → `{ text }` — chunks streamed from the gpt-5-mini structured drafter via `callDrafterStreaming`
- `post_processing` → `{ label }` — single emit for "מאמת הערות שוליים"
- `final` → `{ status, body }` — canonical answer payload (also echoed as legacy unnamed `data:` for back-compat), followed by `data: [DONE]`
- Comments `: stream-open` and `: ping <ts>` (15s) keep the socket alive

## Frontend gating

`useSseStream` is true for:
- `taskMode === "research"` (both Fast and Deep) — request body sets `stream: true`
- `academicStep === "write_chapter"` inside `handleAcademicSubmit` — only the chapter-write sub-mode runs the full pipeline; topic suggest / outline / etc. are short single-shot prompts and stay JSON

All other modes (`case_summary`, `pleading_analysis`, short academic sub-steps) keep the plain JSON path.

## Components

- `src/components/StageProgressList.tsx` — RTL Hebrew card with one row per stage (✔ complete / ⟳ running), optional post-processing row, and a streaming draft preview with a blinking caret. De-dupes by stage name (latest status wins).
- `src/components/ResearchProgress.tsx` — kept as fallback while no SSE events have arrived yet (or non-streamed modes).
- `src/components/LegalQAChat.tsx`:
  - State: `stageEvents`, `postProcessingLabel`, `streamingDraft` (reset in both submits + `handleStop`)
  - `consumeSseStream(body, handlers)` parses `event:`/`data:`/blank-line frames per the SSE spec (multi-line `data:` joined with `\n`); dispatches to handlers; resolves with `{ data, status }` after `final` (or legacy unnamed payload)
  - Loading region picks `<StageProgressList>` once any event has arrived, otherwise `<ResearchProgress>`

## qa_logs ownership

The backend now writes every academic sub-mode (`metadata.academic_step`, `is_abstract`, `duration_ms`) into `qa_logs` itself. The duplicate client-side insert in `handleAcademicSubmit` was removed — the client only calls `onResultSaved?.()` to refresh the sidebar.

`research` mode logs were already server-side-canonical.

## History sidebar

`QAHistorySidebar` selects `metadata` and renders an outline badge with the Hebrew sub-step label (`הצעת נושאים` / `אימות שאלת מחקר` / `בניית מתווה` / `כתיבת פרק` / `תקציר` when `is_abstract`) instead of the old generic "המשך עבודה אקדמית" tag.
