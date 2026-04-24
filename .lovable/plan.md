

# Live progress: real stages, then live streaming text

The pipeline already records every stage (`stage_runs` in `qa_logs.metadata` — Frame, Decompose, Plan, Retrieve, Rerank, SourcePack, ClaimMap, Drafter, AnchorPass, CoverageGap, StatuteCompletion, FootnoteValidate). Today the user sees a single spinner for ~150s. We're going to surface those real stage transitions live, then hand off to live token streaming the moment the drafter starts.

This builds directly on the SSE infrastructure already in place for Deep mode and combines with the streaming + history work from the previous approved plan.

## What the user sees

```text
┌─────────────────────────────────────────────┐
│  ✓ ניתוח השאלה                              │  ← stage events arriving live
│  ✓ פירוק לתתי-סוגיות                         │
│  ✓ אחזור מקורות (16 מסמכים)                 │
│  ✓ דירוג רלוונטיות                          │
│  ✓ בניית חבילת מקורות                       │
│  ⟳ ניסוח טיוטה...                            │  ← active stage with spinner
└─────────────────────────────────────────────┘

         ↓ drafter starts streaming ↓

┌─────────────────────────────────────────────┐
│  עילת הסבירות, כפי שעוצבה בפסיקת בית        │  ← text appears word-by-word
│  המשפט העליון, מהווה כלי ביקורת שיפוטית▌    │     with blinking caret
└─────────────────────────────────────────────┘

         ↓ drafter finishes, post-processing ↓

┌─────────────────────────────────────────────┐
│  [full preliminary text]                    │
│                                             │
│  ⟳ מאמת ציטוטים והערות שוליים...            │  ← small footer indicator
└─────────────────────────────────────────────┘

         ↓ final canonical version arrives ↓

┌─────────────────────────────────────────────┐
│  [final answer with numbered footnotes]     │
└─────────────────────────────────────────────┘
```

## Backend changes — `supabase/functions/legal-qa/index.ts`

**1. Define a stage event protocol.** The SSE stream now emits four event types (named events, not just `data:` payloads):

```text
event: stage      data: {"stage":"frame|decompose|plan|retrieve|rerank|source_pack|claim_map|drafter|anchor_pass|coverage_gap|statute_completion|footnote_validate","status":"running|complete","label":"<Hebrew label>","detail":"<optional, e.g. '16 מסמכים'>"}
event: draft_delta data: {"text":"…token chunk…"}
event: post_processing data: {"label":"מאמת ציטוטים…"}
event: final      data: {"status":200,"body":{answer,footnotes,…}}
```

**2. Emit stage events at every existing stage boundary.** Each stage already brackets its work with timing logs that feed `stage_runs`. We add an `emitStage(stage, status, detail?)` helper at exactly those spots. No new computation — we're just surfacing what's already happening. Hebrew label map lives next to the helper:

```text
frame              → "ניתוח השאלה"
decompose          → "פירוק לתתי-סוגיות"
plan               → "תכנון אחזור"
retrieve           → "אחזור מקורות" (detail: "N מסמכים")
rerank             → "דירוג רלוונטיות"
source_pack        → "בניית חבילת מקורות"
claim_map          → "מיפוי טענות"
drafter            → "ניסוח טיוטה"
anchor_pass        → "עיגון ציטוטים"
coverage_gap       → "בדיקת כיסוי"
statute_completion → "השלמת חקיקה"
footnote_validate  → "אימות הערות שוליים"
```

**3. Stream the drafter token-by-token via the Lovable AI gateway.** In `aiProvider.ts` add `callDrafterStreaming(systemPrompt, userPrompt, opts, onDelta)` that POSTs with `stream: true`, parses SSE line-by-line (handling CRLF, `[DONE]`, partial JSON across chunks per the gateway docs), accumulates full text, and returns the same `DrafterResult` shape. `onDelta(chunk)` is called per token batch — the SSE wrapper enqueues each as a `draft_delta` event. On stream error: silent fallback to existing non-streaming `callDrafter` (run still completes).

**4. Wire it up in `runHandlerSSE`.** Pass an `emitter` (controller-backed closure) into `handleLegalQARequest`. At each stage boundary call `emitter.stage(...)`. When the drafter starts, emit `stage:drafter:running` then call `callDrafterStreaming` with `onDelta: (chunk) => emitter.draftDelta(chunk)`. After drafter completes, emit `stage:drafter:complete` and `post_processing` for the anchor/dedup/statute/validate phase. Emit `final` with the canonical body when everything is done. Heartbeat `: ping` lines stay (every 15s) for socket keepalive between events.

**5. Combine with the previously-approved plan.** This plan supersedes Issue 2 of the prior plan (live streaming + SSE-for-all-research). Issue 1 (academic sub-mode `qa_logs` insert + history sidebar metadata badges) stays exactly as approved.

## Frontend changes — `src/components/LegalQAChat.tsx`

**1. Extend the SSE gate** to all research runs (Fast + Deep) and academic chapter writes (per the prior plan).

**2. Parse the four event types** from the SSE stream. Track three pieces of state on the in-flight assistant message:
- `stages: { name, status, label, detail }[]` — appended/updated as `stage` events arrive
- `streamingAnswer: string` — accumulated from `draft_delta` events; cleared when `final` arrives
- `postProcessingLabel: string | null` — set on `post_processing`, cleared on `final`

**3. Render logic in the message bubble:**

```text
if (streamingAnswer.length === 0 && !final):
   render <StageProgressList stages={stages} />   // checklist with running spinner
elif (streamingAnswer.length > 0 && !final):
   render <StreamingText text={streamingAnswer} caret />
   if (postProcessingLabel) render small footer "⟳ מאמת ציטוטים…"
else:
   render final answer with footnotes (existing renderer)
```

**4. New `StageProgressList` component** (lightweight, RTL): each stage row is `[icon] [label] [detail?]`. Icon = ✓ when `status:complete`, animated spinner when `running`, dim circle when not yet started. Stages appear in pipeline order; new stages slide in as their events arrive.

**5. Streaming text + caret:** plain `<div>` with the accumulated text and a CSS-animated `▌` at the end (only while streaming, not after `final`). RTL preserved. No markdown parsing during stream — final canonical answer (which goes through the existing markdown renderer) replaces it on `final`.

## What we're explicitly NOT doing

- Not streaming the planner / claim-map JSON stages — they're tool-call JSON, only useful complete; we just emit `stage:running`/`stage:complete` for them.
- Not re-rendering markdown progressively — the live stream is plain text; the final replacement uses the existing markdown renderer with footnote anchors.
- Not changing what's saved to `qa_logs` — still one row with the final canonical answer (no half-streamed drafts persisted).
- Not building a generic stage component for case_summary / pleading_analysis — they finish in <30s, the existing spinner is fine.

## Files touched

- `supabase/functions/legal-qa/index.ts` — `emitStage` helper, named SSE events, drafter-streaming wiring, post-processing event, `final` event; preserve heartbeat. Plus the academic `qa_logs` insert from the prior plan (Issue 1).
- `supabase/functions/legal-qa/aiProvider.ts` — new `callDrafterStreaming` with `onDelta` + non-streaming fallback.
- `src/components/LegalQAChat.tsx` — extend SSE gate (Fast + Deep + academic chapter), parse the four event types, drive `StageProgressList` / `StreamingText` / final-render state machine.
- `src/components/StageProgressList.tsx` — new (small, RTL checklist with spinner).
- `src/components/QAHistorySidebar.tsx` — academic sub-step badges from prior plan.
- `.lovable/memory/features/legal-qa/streaming.md` — new memory documenting the four-event SSE protocol and the stage→label map.

## Acceptance

- Start a Deep query → within ~1-2s the first stage rows appear and tick off in real time as the backend progresses.
- Drafter stage transition: stage list collapses, live text begins appearing word-by-word with blinking caret (within ~30s of submitting).
- Drafter finishes → caret stops, small "⟳ מאמת ציטוטים…" indicator appears for ~10-15s.
- `final` event → preliminary text replaced by canonical answer with numbered footnotes.
- Network tab: continuous `event: stage` and `event: draft_delta` chunks throughout the run — no 150s of silence.
- Fast research mode also shows live stages + streaming (~30-50s total).
- Academic chapter writes show the same UX.
- Stream failure mid-flight → silent fallback to non-streaming, user still gets the final answer.
- `qa_logs.metadata.stage_runs` continues to record per-stage timings unchanged.

