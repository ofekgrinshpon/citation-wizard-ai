## Goal

Show live stage progress + streaming draft in the legal QA "מהיר (Fast)" research mode, the same way Deep already does.

## Root cause

Everything for Fast streaming is already wired **except one server-side gate**:

- Frontend (`src/components/LegalQAChat.tsx`) already sends `stream: true` for **both** Fast and Deep research, parses SSE, and renders `<StageProgressList mode="research_fast" />`.
- Pipeline already calls `emitStage(...)` at every Fast-relevant stage (frame, decompose, retrieve, rerank, source_pack, claim_map, drafter, coverage_gap, statute_completion, footnote_validate).
- The Fast structured drafter already prefers `callDrafterStreaming` whenever `__activeEmitter` is installed, emitting `draft_delta` chunks.

But `supabase/functions/legal-qa/index.ts` line ~8304:

```ts
const wantsStream = Boolean(
  parsedBody &&
    parsedBody.stream === true &&
    parsedBody.depth === "deep",   // ← this blocks Fast
);
```

So for Fast, the server never installs the SSE wrapper → no emitter → frontend gets a plain JSON response → falls back to `<ResearchProgress>` (the generic spinner) and no live draft.

## Change

**Single edit** in `supabase/functions/legal-qa/index.ts`:

```ts
const wantsStream = Boolean(
  parsedBody && parsedBody.stream === true,
);
```

Drop the `depth === "deep"` clause. Update the surrounding comment from "Only Deep mode opts in" to reflect that both Fast and Deep now stream.

## Why this is safe

- Fast-only stages already exist and emit; Deep-only stages (`anchor_pass`, `critic`, `coherence_critic`, `revision`, etc.) simply never fire in Fast — `StageProgressList` dedups by stage name so missing stages just don't appear.
- `callDrafterStreaming` already handles the structured (Fast) drafter variant and falls back to non-streaming on any failure.
- SSE wrapper already strips `stream` from the inner request and converts the handler's JSON response into a `final` event + legacy `data:` frame, so non-SSE clients (eval scripts, Word add-in) that don't send `stream: true` are untouched.
- Frontend `useSseStream = taskMode === "research"` and `body.stream = true` already cover Fast — no client change needed.

## Verification

1. Deploy `legal-qa` edge function.
2. In the app, open העוזר המשפטי → מחקר משפטי, ensure ⚡ מהיר is selected, run a query like "חופש הביטוי בפסיקת בג״ץ".
3. Expect: header "מחפש, מסכם ומעגן מקורות..." (the existing `research_fast` copy), live ✔/⟳ rows for frame/decompose/retrieve/rerank/source_pack/claim_map/drafter, "טיוטה חיה" with blinking caret as the structured drafter streams, then the final answer card.
4. Check `supabase--edge_function_logs legal-qa` for `[mode] depth=fast` and stage logs to confirm SSE wrapper activated.
5. Re-run with 🧠 מעמיק to confirm Deep still streams unchanged.

## Out of scope

- No new stages, no new labels, no telemetry changes.
- No frontend changes (already Fast-aware).
- No change to credit cost or `MODE_PROFILES`.
- Word add-in / eval scripts that don't send `stream: true` keep the current JSON response.

## Files

- Edited: `supabase/functions/legal-qa/index.ts` (gate + comment, ~3 lines)
