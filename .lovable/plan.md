## Problem

Clicking a history item for a `legal_research_v1` answer renders footnotes as bare numbered rows with only an external-link arrow — no citation text. Cause: `legal-research-v1` writes footnotes as `{ number, title, url, source_type }` (no `citation` field), but `QAHistorySidebar.handleClick` sanitizes `citation` to `""` when missing, and `LegalQAChat` renders `fn.citation` (line 3091).

Verified in DB: e.g. `qa_logs.id = ff150ac3…` (task_mode `legal_research_v1`) has `footnotes[0] = { url, title, number, source_type }`.

## Fix (UI only)

**`src/components/QAHistorySidebar.tsx`** — in the array-footnotes branch of `handleClick` (~line 108), fall back `citation` to `title` when `citation` is missing:

```ts
citation:
  typeof f?.citation === "string" && f.citation.trim() !== ""
    ? f.citation
    : typeof f?.title === "string"
    ? f.title
    : "",
```

That's the only change. No backend changes, no schema changes, no other components touched.

## Out of scope
- Routing `legal_research_v1` history items to `LegalResearchV1Panel` instead of `LegalQAChat` (separate UX decision).
- Backfilling old rows.
- Any other unrelated UI work.