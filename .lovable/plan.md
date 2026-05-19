## Root cause

When `RESEARCH_V2=true` and/or `RESEARCH_V3=true` (currently both `true` per boot logs) and the user runs **Deep research**, `supabase/functions/legal-qa/index.ts` (≈line 2470) routes the request into `runResearchV3` / `runResearchV2` and **returns before reaching any of the legacy `emitStage(...)` calls** (the first one — `emitStage("frame","complete")` — lives at line 3338, well after the V2/V3 early-return at line 2515).

The SSE wrapper still opens the socket (`: stream-open`), so the frontend enters its streaming branch. But because **no `stage` events are ever emitted** during the V2/V3 run, `StageProgressList` keeps showing only its placeholder row `{ stage: "__starting__", label: "מתחיל…" }`. With `denominator = 11` for Deep, the progress math gives `0.5 / 11 ≈ 4.5% → 5%`. The percentage and the "מתחיל" label stay there for the full ~60–120 s until the `final` event arrives.

(Confirmed by edge logs: `[research_v3] gate ON — running Deep pipeline`, then 31 s `research_plan_v2` + 34 s `legal_research_plan_v3` with zero stage logs in between. `rg "emitStage" researchV2Pipeline.ts researchV3Pipeline.ts` → 0 matches.)

This is purely a UX/telemetry gap — the pipeline itself runs to completion. There's also a separate symptom in logs (`[retrieve_v2 text] canceling statement due to statement timeout`) but that does not cause the stuck-at-5% screen.

## Fix — emit stage events from the V2/V3 path

Keep V2/V3 as the source of truth. Thread a `stage` emitter into the pipeline so the user sees the same kind of live progress they get from the legacy path.

### Backend

1. **`supabase/functions/legal-qa/researchV2Pipeline.ts`** and **`researchV3Pipeline.ts`**
   - Extend the existing `run...` options with an optional `onStage?: (name, status, detail?) => void`.
   - Wrap each major step with `running` / `complete` calls. Reuse the **same stage names** the frontend already labels in `StageProgressList` (so no UI changes are needed):
     - `frame` (complete immediately on entry)
     - `decompose` (around the research-plan call — `research_plan_v2` / `legal_research_plan_v3`)
     - `retrieve` (around `retrieveClaims`, with detail = local doc count)
     - `rerank` (only if V2/V3 actually does a rerank step; otherwise skip)
     - `source_pack` (around source-pack assembly, detail = pack size)
     - `claim_map` (around ledger / claim verification, detail = entries kept)
     - `drafter` (around the compact drafter call, detail = char count on complete)
     - `anchor_pass` (around the anchor/footnote merge, detail = anchors applied)
     - `footnote_validate` (final validator pass; matches existing `postProcessingLabel` UX)
   - Wrap every emit in a try/catch so a thrown emitter never breaks the pipeline.

2. **`supabase/functions/legal-qa/index.ts`** (≈line 2483)
   - Pass `onStage: emitStage` into the `runner({...})` call inside the V2/V3 gate. `emitStage` is already in scope from the SSE wrapper setup (`stage: (name, status, detail) => { controller.enqueue(... event: stage ...) }`).
   - Emit `emitStage("frame","complete")` immediately before invoking the runner so the first row flips from the placeholder "מתחיל…" to a real stage within ~50 ms.
   - On V2 fallback to V1, the existing legacy `emitStage` calls take over naturally — no extra glue needed.

### Frontend

No changes required. `StageProgressList` already:
- de-dupes stages by name (so a real `frame:complete` replaces `__starting__`),
- renders Hebrew labels via `ACADEMIC_LABEL_OVERRIDES` for academic mode and the built-in research labels otherwise,
- caps the progress bar at 99% until the SSE `final` event sets `isComplete=true`.

## Out of scope (kept as-is)

- `[retrieve_v2 text] canceling statement due to statement timeout` — separate Postgres-side issue with the V2 text retrieval queries. Not the cause of the spinner; can be addressed in a follow-up (likely a `statement_timeout` / index / query-shape fix).
- Async 202 + polling path — unaffected; the polling UI already updates `postProcessingLabel` per checkpoint.
- Academic chapter writes — already go through the legacy path with `emitStage` and are not stuck.
- Credit costs, prompts, ranking logic, claim-map content — untouched.

## Verification

1. Deploy `legal-qa` and run a Deep research query.
2. Watch the live panel: within ~1 s the row should change from "מתחיל…" to "ניתוח שאלת המחקר" (`frame:complete`) and the bar should leave 5%.
3. New rows should appear roughly in order: decompose → retrieve → source_pack → claim_map → drafter → anchor_pass → footnote_validate, each flipping from spinner to ✔ as the V3 pipeline progresses.
4. Final event still arrives; bar hits 100% and answer renders unchanged.
5. Fast research (V1) and academic chapter writes: confirm progress still works as today (regression check).
