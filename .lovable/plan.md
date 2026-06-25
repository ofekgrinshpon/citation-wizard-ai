# Fix: stale mode wiring + V1 history replay

## Root cause (confirmed)

- `legal-research-v1/lib/telemetry.ts` writes rows with `task_mode: "legal_research_v1"`.
- `QAHistorySidebar.handleClick` forwards `log.task_mode || "research"` to `onLoadResult`.
- `Index.tsx` (line 1241) casts the string into `qaExternalResult.taskMode` as `"research" | "case_summary" | "academic_writing"` — but the actual string is `"legal_research_v1"`.
- `LegalQAChat.tsx` (line 1085) does `setTaskMode(externalResult.taskMode)`. Since `"legal_research_v1"` is not in the rendered switch (`research` / `legal_source_search` / `academic_writing` / `case_summary`), no panel mounts. The next submit falls through to the legacy `legal-qa` invoke path → returns the intentional 503 `engine_offline`.
- The V1 panel also currently ignores any cached payload, so even after we normalize the mode the user lands on an empty panel.

## Implementation plan (frontend only)

### 1. `src/components/QAHistorySidebar.tsx`

- Add `legal_research_v1` to `MODE_LABELS` mapped to `{ label: "מחקר", icon: Search }` so the history badge keeps reading "מחקר".
- In `handleClick`, when `log.task_mode === "legal_research_v1"`:
  - Build a dedicated envelope and call:
    ```ts
    onLoadResult(
      log.question,
      {
        __legal_research_v1: true,
        payload: {
          answer: log.answer,
          footnotes: Array.isArray(log.footnotes) ? log.footnotes : [],
        },
      } as any,
      "legal_research_v1",
    );
    return;
    ```
  - This bypasses the existing `Array.isArray(fn).map(...)` mapper which rewrites footnotes into the legacy `{citation, source_type}` shape and would clobber the V1 Footnote shape (`{number, title, url, sources}`).
- Leave the `legal_source_search` and case-summary branches untouched.

### 2. `src/pages/Index.tsx`

- Extend the `qaExternalResult` state union with a third variant:
  ```ts
  | { question: string; v1Payload: { answer: string; footnotes: any[] }; taskMode: "research" }
  ```
- In the `onLoadResult` handler (lines 1234–1243):
  - If `taskMode === "legal_research_v1"` and `result?.__legal_research_v1`:
    `setQaExternalResult({ question, v1Payload: result.payload, taskMode: "research" })`.
  - **Defensive normalization**: if `taskMode` is none of `academic_writing | legal_source_search | research | case_summary`, coerce to `"research"` before storing, so legacy/unknown rows can't poison chat state again.

### 3. `src/components/LegalQAChat.tsx`

- Extend `LegalQAChatProps.externalResult` union with the new V1 variant.
- Add a memoized `legalResearchV1External` (mirroring the existing `sourceSearchExternal` pattern) so identity is stable across parent renders:
  ```ts
  const legalResearchV1External = useMemo(
    () =>
      externalResult && "v1Payload" in externalResult
        ? { question: externalResult.question, payload: externalResult.v1Payload }
        : null,
    [externalResult],
  );
  ```
- In the external-result effect (lines 1076–1086):
  - If the variant is the V1 one: `setQuestion(externalResult.question); setTaskMode("research"); return;` — do **not** set `result` (the legacy `QAResult` shape doesn't fit) and do **not** invoke `legal-qa`.
  - Treat existing `"research"` taskMode the same way (the legacy chat path never had a "research" UI tab — research is already owned by the V1 panel today).
- Pass `externalResult={legalResearchV1External}` and `onConsumeExternalResult={onConsumeExternalResult}` to `<LegalResearchV1Panel />` at line 2954.

### 4. `src/components/LegalResearchV1Panel.tsx`

- Add props:
  ```ts
  interface Props {
    externalResult?: { question: string; payload: { answer: string; footnotes: Footnote[] } } | null;
    onConsumeExternalResult?: () => void;
  }
  ```
- Add a `useEffect([externalResult])` that, when a non-null externalResult is passed:
  - `stopAll(); clearResume();`
  - `setLoading(false); setError(null); setJobId(null);`
  - `setQuestion(externalResult.question);`
  - `setResult({ answer: externalResult.payload.answer, footnotes: externalResult.payload.footnotes ?? [], used_sources: [], debug: {} });`
  - Call `onConsumeExternalResult?.()` so the parent clears `qaExternalResult` and a subsequent project switch / new submit isn't blocked.
- Make the resume-on-mount effect (lines 192–208) a no-op when `externalResult` is provided on mount, so a cached history payload always wins over a leftover `sessionStorage` job.

## Acceptance check (manual, after switching to build mode)

1. Click a V1 row → UI switches to the V1 panel, badge says "מחקר", question fills in, cached answer + footnotes render.
2. Network tab shows **no** POST to `legal-qa`. No 503 toast.
3. Switching projects clears the pinned V1 result (existing `lastProjectIdRef` effect already handles this via `setQaExternalResult(null)`).
4. Clicking a legacy `research` / `case_summary` row keeps working unchanged.

## Out of scope (explicitly not touched)

- `supabase/functions/legal-qa/` (the 503 short-circuit stays as-is).
- `supabase/functions/legal-research-v1/` and its telemetry schema.
- `LegalSourceSearchPanel` / `citation-chat` / pipeline logic.
- No backend deploys required.

## Risk / fallback

The only non-trivial bit is shape compatibility of `log.footnotes` with `LegalResearchV1Panel`'s `Footnote` type. Confirmed in `supabase/functions/legal-research-v1/lib/types.ts:165` and `drafterV2.ts:531` that footnotes are persisted as `{number, title, url, source_type?, sources?}` — exactly what the panel expects. If a legacy row predates that shape, the renderer at lines 494–550 still survives because it null-checks `fn.sources` and `fn.url`.
